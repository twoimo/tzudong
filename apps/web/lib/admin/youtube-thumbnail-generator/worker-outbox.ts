import { DatabaseSync } from 'node:sqlite';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import { thumbnailAsset, thumbnailProvenance, thumbnailUuid, parseThumbnail, THUMBNAIL_IMAGE_BYTES } from './queue-contract';
import { thumbnailChatResult, thumbnailExecutionIdentity, thumbnailExecutionJob } from './execution-contract';
import { THUMBNAIL_CHAT_MODEL, thumbnailChatResponse } from './chat-contract';
import type { ThumbnailGeminiDescriptor } from './gemini-worker-client';

if (typeof window !== 'undefined') throw new Error('Thumbnail worker outbox is worker-only.');

const APP_ID = 0x545A5448;
export const thumbnailWorkerOrigin = z.string().max(100).refine((value) => {
  try {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password
      && ((url.protocol === 'https:' && ['tzudong.app', 'www.tzudong.app'].includes(url.hostname) && !url.port)
        || (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname) && Boolean(url.port)));
  } catch { return false; }
});
const identity = thumbnailExecutionIdentity.extend({ origin: thumbnailWorkerOrigin }).strict();
export type ThumbnailOutboxIdentity = z.infer<typeof identity>;
const original = z.object({ sha256: thumbnailAsset.shape.sha256, mimeType: thumbnailAsset.shape.mimeType,
  bytes: thumbnailAsset.shape.bytes, width: thumbnailAsset.shape.width, height: thumbnailAsset.shape.height }).strict()
  .refine((image) => image.width * image.height <= 16_000_000);
const bundle = z.object({ original, provenance: thumbnailProvenance }).strict();
export type ThumbnailOutboxBundle = z.infer<typeof bundle> & { bytes: Buffer };
const chatBundle = z.object({ content: thumbnailChatResult.shape.content.omit({ path: true }),
  provenance: thumbnailChatResult.shape.provenance }).strict();
export type ThumbnailChatOutboxBundle = z.infer<typeof chatBundle> & { bytes: Buffer };
type Row = { job_id: string; attempt_id: string; identity_json: string; phase: 'start_requested' | 'result_saved' | 'delivered';
  bundle_json: string | null; original: Uint8Array | null; delivered_json: string | null };
const columns = 'job_id,attempt_id,identity_json,phase,bundle_json,original,delivered_json';
const table = `CREATE TABLE thumbnail_outbox (
  job_id TEXT NOT NULL, attempt_id TEXT NOT NULL, identity_json TEXT NOT NULL CHECK(length(identity_json)<=2048),
  phase TEXT NOT NULL CHECK(phase IN ('start_requested','result_saved','delivered')),
  bundle_json TEXT CHECK(bundle_json IS NULL OR length(bundle_json)<=8192),
  original BLOB CHECK(original IS NULL OR (length(original)>=16 AND length(original)<=12582912)),
  delivered_json TEXT CHECK(delivered_json IS NULL OR length(delivered_json)<=16384),
  PRIMARY KEY(job_id,attempt_id),
  CHECK((phase='start_requested')=(bundle_json IS NULL)), CHECK((phase='start_requested')=(original IS NULL)),
  CHECK((phase='delivered')=(delivered_json IS NOT NULL))
) STRICT`;
const pendingIndex = 'CREATE INDEX thumbnail_outbox_pending ON thumbnail_outbox(phase)';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export class ThumbnailOutboxError extends Error {
  constructor(readonly code: 'outbox_invalid' | 'outbox_busy' | 'outbox_conflict' | 'outbox_unavailable') {
    super(code); this.name = 'ThumbnailOutboxError';
  }
}
function checkedFile(file: string) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
    || (process.getuid && stat.uid !== process.getuid())) throw new ThumbnailOutboxError('outbox_invalid');
  return stat;
}
function snapshotIdentity(value: ThumbnailOutboxIdentity) { return parseThumbnail(identity, value); }
function parseJson(value: string) {
  try { return JSON.parse(value) as unknown; } catch { throw new ThumbnailOutboxError('outbox_invalid'); }
}
function parseUtf8(bytes: Buffer) {
  try { return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ThumbnailOutboxError('outbox_invalid'); }
}
function admitChatBytes(bytes: Buffer) {
  try {
    const result = thumbnailChatResponse.parse(parseUtf8(bytes));
    assertPrivacySafe([result.assistantMessage, ...Object.values(result.canvasPatch),
      ...result.textLayerPatches.map((patch) => patch.content ?? '')], { maxEntries: 128 });
  } catch { throw new ThumbnailOutboxError('outbox_invalid'); }
}

/**
 * One SQLite commit contains the exact original and proof. FULL synchronous is a durability request to SQLite;
 * it cannot guarantee survival when the OS/filesystem/storage lies, nor bridge SDK-response -> first commit.
 * Delivered rows are preserved. No invented retention or automatic deletion is part of this outbox.
 */
export class ThumbnailWorkerOutbox {
  private readonly db: DatabaseSync;
  readonly file: string;
  private closed = false;
  constructor(directory: string) {
    if (!isAbsolute(directory) || realpathSync(directory) !== directory) throw new ThumbnailOutboxError('outbox_invalid');
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o777) !== 0o700
      || (process.getuid && dir.uid !== process.getuid())) throw new ThumbnailOutboxError('outbox_invalid');
    this.file = join(directory, 'thumbnail-outbox.sqlite');
    let descriptor: number | undefined;
    let opened: DatabaseSync | undefined;
    try {
      try { descriptor = openSync(this.file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error; }
      if (descriptor !== undefined) { fsyncSync(descriptor); const parent = openSync(directory, constants.O_RDONLY); try { fsyncSync(parent); } finally { closeSync(parent); } }
      const before = checkedFile(this.file); this.checkSidecars();
      if (descriptor !== undefined && fstatSync(descriptor).ino !== before.ino) throw new ThumbnailOutboxError('outbox_invalid');
      this.db = opened = new DatabaseSync(this.file);
      const after = checkedFile(this.file);
      if (before.ino !== after.ino || before.dev !== after.dev) throw new ThumbnailOutboxError('outbox_invalid');
      this.db.exec('PRAGMA busy_timeout=1000;');
      // Do not change an unrelated database's journal mode or adopt its tables.
      const app = this.db.prepare('PRAGMA application_id').get() as { application_id: number };
      const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
      const rows = this.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string }[];
      if (app.application_id === 0 && version.user_version === 0 && rows.length === 0 && before.size === 0) {
        this.db.exec('BEGIN IMMEDIATE;');
        try {
          const current = this.db.prepare('PRAGMA application_id').get() as { application_id: number };
          if (current.application_id === 0) this.db.exec(`${table}; ${pendingIndex}; PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`);
          this.db.exec('COMMIT;');
        } catch (error) { this.db.exec('ROLLBACK;'); throw error; }
      }
      const actualApp = this.db.prepare('PRAGMA application_id').get() as { application_id: number };
      const actualVersion = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
      const schema = this.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type IN ('table','trigger','view','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[];
      if (actualApp.application_id !== APP_ID || actualVersion.user_version !== 1 || schema.length !== 2
        || schema[0].name !== 'thumbnail_outbox' || schema[0].sql !== table || schema[1].name !== 'thumbnail_outbox_pending'
        || schema[1].sql !== pendingIndex) throw new ThumbnailOutboxError('outbox_invalid');
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      const journal = this.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      const sync = this.db.prepare('PRAGMA synchronous').get() as { synchronous: number };
      if (journal.journal_mode !== 'wal' || sync.synchronous !== 2) throw new ThumbnailOutboxError('outbox_invalid');
      this.checkSidecars();
    } catch (error) {
      opened?.close();
      if (error instanceof ThumbnailOutboxError) throw error;
      throw new ThumbnailOutboxError('outbox_unavailable');
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  private checkSidecars() {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try { checkedFile(this.file + suffix); }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
  private row(key: Pick<ThumbnailGeminiDescriptor, 'jobId' | 'attemptId'>): Row {
    const row = this.db.prepare(`SELECT ${columns} FROM thumbnail_outbox WHERE job_id=? AND attempt_id=?`)
      .get(parseThumbnail(thumbnailUuid, key.jobId), parseThumbnail(thumbnailUuid, key.attemptId)) as Row | undefined;
    if (!row) throw new ThumbnailOutboxError('outbox_conflict');
    return row;
  }
  private admit(row: Row, expected?: ThumbnailOutboxIdentity) {
    const saved = snapshotIdentity(parseJson(row.identity_json) as ThumbnailOutboxIdentity);
    if (saved.jobId !== row.job_id || saved.attemptId !== row.attempt_id || (expected && !isDeepStrictEqual(saved, expected))) {
      throw new ThumbnailOutboxError('outbox_conflict');
    }
    return saved;
  }
  /** A duplicate record is never permission to start, even when it has exactly the same identity. */
  begin(value: ThumbnailOutboxIdentity): boolean {
    const snapshot = snapshotIdentity(value);
    try {
      const inserted = this.db.prepare("INSERT INTO thumbnail_outbox(job_id,attempt_id,identity_json,phase) VALUES(?,?,?,'start_requested') ON CONFLICT DO NOTHING")
        .run(snapshot.jobId, snapshot.attemptId, JSON.stringify(snapshot));
      this.admit(this.row(snapshot), snapshot); this.checkSidecars();
      return Number(inserted.changes) === 1;
    } catch (error) {
      if (error instanceof ThumbnailOutboxError) throw error;
      throw new ThumbnailOutboxError('outbox_unavailable');
    }
  }
  pending() {
    // Deliberately do not SELECT original BLOBs for a history/queue scan.
    const rows = this.db.prepare("SELECT job_id,attempt_id,identity_json,phase FROM thumbnail_outbox WHERE phase IN ('result_saved','start_requested') ORDER BY phase,rowid LIMIT 32")
      .all() as Pick<Row, 'job_id' | 'attempt_id' | 'identity_json' | 'phase'>[];
    return rows.map((row) => ({ identity: this.admit(row as Row), phase: row.phase }));
  }
  save(value: ThumbnailOutboxIdentity, bytes: Uint8Array, metadata: z.infer<typeof bundle>) {
    const snapshot = snapshotIdentity(value);
    // All data is copied synchronously before the transaction. Never persist a token or arbitrary response body.
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16 || bytes.byteLength > THUMBNAIL_IMAGE_BYTES) throw new ThumbnailOutboxError('outbox_invalid');
    const copied = Buffer.from(bytes); const info = parseThumbnail(bundle, metadata);
    if (copied.length !== info.original.bytes || hash(copied) !== info.original.sha256
      || info.provenance.model !== snapshot.model || info.provenance.attemptId !== snapshot.attemptId
      || info.provenance.inputSha256 !== snapshot.inputSha256) throw new ThumbnailOutboxError('outbox_conflict');
    this.writeResult(snapshot, copied, info);
  }
  private writeResult(snapshot: ThumbnailOutboxIdentity, copied: Buffer, info: unknown) {
    try {
      this.db.exec('BEGIN IMMEDIATE;');
      const prior = this.row(snapshot); this.admit(prior, snapshot);
      if (prior.phase !== 'start_requested') {
        if (!prior.original || !Buffer.from(prior.original).equals(copied) || !isDeepStrictEqual(parseJson(prior.bundle_json!), info)) {
          throw new ThumbnailOutboxError('outbox_conflict');
        }
      } else this.db.prepare("UPDATE thumbnail_outbox SET phase='result_saved',bundle_json=?,original=? WHERE job_id=? AND attempt_id=? AND phase='start_requested'")
        .run(JSON.stringify(info), copied, snapshot.jobId, snapshot.attemptId);
      this.db.exec('COMMIT;'); this.checkSidecars();
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* A commit may already be durable; never remove the original. */ }
      if (error instanceof ThumbnailOutboxError) throw error;
      throw new ThumbnailOutboxError('outbox_unavailable');
    }
  }
  result(value: ThumbnailOutboxIdentity): ThumbnailOutboxBundle {
    const snapshot = snapshotIdentity(value); const row = this.row(snapshot); this.admit(row, snapshot);
    if (row.phase === 'start_requested' || !row.original || !row.bundle_json) throw new ThumbnailOutboxError('outbox_conflict');
    const info = parseThumbnail(bundle, parseJson(row.bundle_json)); const bytes = Buffer.from(row.original);
    if (bytes.length !== info.original.bytes || hash(bytes) !== info.original.sha256
      || info.provenance.model !== snapshot.model || info.provenance.attemptId !== snapshot.attemptId
      || info.provenance.inputSha256 !== snapshot.inputSha256) throw new ThumbnailOutboxError('outbox_invalid');
    return { ...info, bytes };
  }
  saveChat(value: ThumbnailOutboxIdentity, bytes: Uint8Array, metadata: z.infer<typeof chatBundle>) {
    const snapshot = snapshotIdentity(value); const info = parseThumbnail(chatBundle, metadata);
    if (snapshot.model !== THUMBNAIL_CHAT_MODEL || !(bytes instanceof Uint8Array)
      || bytes.length !== info.content.bytes || hash(bytes) !== info.content.sha256
      || info.provenance.model !== snapshot.model || info.provenance.attemptId !== snapshot.attemptId
      || info.provenance.inputSha256 !== snapshot.inputSha256) throw new ThumbnailOutboxError('outbox_conflict');
    const copied = Buffer.from(bytes);
    admitChatBytes(copied);
    this.writeResult(snapshot, copied, info);
  }
  chatResult(value: ThumbnailOutboxIdentity): ThumbnailChatOutboxBundle {
    const snapshot = snapshotIdentity(value), row = this.row(snapshot); this.admit(row, snapshot);
    if (snapshot.model !== THUMBNAIL_CHAT_MODEL || row.phase === 'start_requested' || !row.original || !row.bundle_json) {
      throw new ThumbnailOutboxError('outbox_conflict');
    }
    const info = parseThumbnail(chatBundle, parseJson(row.bundle_json)), bytes = Buffer.from(row.original);
    if (bytes.length !== info.content.bytes || hash(bytes) !== info.content.sha256
      || info.provenance.model !== snapshot.model || info.provenance.attemptId !== snapshot.attemptId || info.provenance.inputSha256 !== snapshot.inputSha256) {
      throw new ThumbnailOutboxError('outbox_invalid');
    }
    admitChatBytes(bytes);
    return { ...info, bytes };
  }
  delivered(value: ThumbnailOutboxIdentity, rawJob: unknown) {
    const snapshot = snapshotIdentity(value); const job = parseThumbnail(thumbnailExecutionJob, rawJob);
    if (job.id !== snapshot.jobId || job.ownerId !== snapshot.ownerId || job.workerId !== snapshot.workerId
      || job.attemptId !== snapshot.attemptId || job.fence !== snapshot.fence || job.inputSha256 !== snapshot.inputSha256
      || job.model !== snapshot.model || job.state !== 'succeeded' || !job.result) {
      throw new ThumbnailOutboxError('outbox_conflict');
    }
    if (job.model === THUMBNAIL_CHAT_MODEL) {
      const saved = this.chatResult(snapshot);
      if (!isDeepStrictEqual(job.result.provenance, saved.provenance)
        || !isDeepStrictEqual({ ...job.result.content, path: undefined }, { ...saved.content, path: undefined })) throw new ThumbnailOutboxError('outbox_conflict');
    } else {
      const saved = this.result(snapshot);
      if (!isDeepStrictEqual(job.result.provenance, saved.provenance)
        || !isDeepStrictEqual({ ...job.result.original, path: undefined }, { ...saved.original, path: undefined })) throw new ThumbnailOutboxError('outbox_conflict');
    }
    try {
      this.db.prepare("UPDATE thumbnail_outbox SET phase='delivered',delivered_json=? WHERE job_id=? AND attempt_id=? AND phase IN ('result_saved','delivered')")
        .run(JSON.stringify(job.result), snapshot.jobId, snapshot.attemptId);
      this.checkSidecars();
    } catch { throw new ThumbnailOutboxError('outbox_unavailable'); }
  }
}
