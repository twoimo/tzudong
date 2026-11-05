import { execFileSync, spawn } from 'node:child_process';
import { thumbnailReleaseFixture } from './thumbnail-release-fixture';
import { publishThumbnailDurableRelease, readThumbnailDurableReleaseAsset,
  type ThumbnailReleaseRegistryAdapter } from '../../lib/admin/youtube-thumbnail-generator/release-registry';

const fixture = await thumbnailReleaseFixture();
const mode = process.argv[2];
if (!['ack-lost', 'uncommitted-read'].includes(mode)) throw new Error('FIXTURE_MODE_INVALID');
const args = ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
  '-p', process.env.FIXTURE_PG_PORT!, '-U', 'postgres', '-d', 'postgres'];
const psql = process.env.FIXTURE_PSQL!;
const q = (statement: string) => execFileSync(psql, args, { input: statement, encoding: 'utf8', timeout: 10_000 }).trim();
const literal = (value: unknown) => value === null || value === undefined ? 'NULL'
  : typeof value === 'number' ? String(value)
  : "'" + (typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''") + "'";
let finishPending: ((commit: boolean) => Promise<void>) | undefined;
let publishCalls = 0, readCalls = 0, deleteCalls = 0;
const assets = new Map<string, Buffer>();
const adapter: ThumbnailReleaseRegistryAdapter = {
  async readCurrentRelease() {
    readCalls++;
    const row = q("SET ROLE service_role; SELECT row_to_json(r) FROM public.youtube_thumbnail_releases r WHERE release_key='youtube-thumbnail-generator/current' AND status='active';");
    return row ? JSON.parse(row) : null;
  },
  async publishRelease(row) {
    publishCalls++;
    const values = [row.id, row.release_key, row.candidate_id, row.source_manifest_id, row.source_image_id,
      row.storage_bucket, row.storage_object_path, row.browser_image_path, row.sha256, row.score,
      row.issue_tags, row.text_layers, row.canvas, row.source_quality_gate, row.published_by ?? null, row.published_at];
    const statement = 'SELECT row_to_json(public.publish_youtube_thumbnail_release(' + values.map(literal).join(',') + '));';
    if (mode === 'ack-lost') q('SET ROLE service_role;' + statement);
    else {
      // Keep a real transaction uncommitted while another connection reads.
      const child = spawn(psql, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', error = '';
      const ended = new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => code === 0 ? resolve() : reject(new Error('FIXTURE_PENDING_SQL_FAILED')));
      });
      finishPending = async (commit) => { child.stdin.end(commit ? 'COMMIT;\n' : 'ROLLBACK;\n'); await ended; finishPending = undefined; };
      const ready = new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (bytes) => { output += bytes.toString(); if (output.includes('FIXTURE_PENDING')) resolve(); });
        child.stderr.on('data', (bytes) => { error += bytes.toString(); if (error.includes('ERROR:')) reject(new Error('FIXTURE_PENDING_SQL_FAILED')); });
        child.once('error', reject);
      });
      child.stdin.write('BEGIN; SET LOCAL ROLE service_role;' + statement + '\n\\echo FIXTURE_PENDING\n');
      await ready;
    }
    throw new Error('SYNTHETIC_ACK_DROP');
  },
  async uploadReleaseAsset(_bucket, path, bytes) { assets.set(path, bytes); },
  async deleteReleaseAsset(_bucket, path) { deleteCalls++; assets.delete(path); },
  async downloadReleaseAsset(_bucket, path) {
    const bytes = assets.get(path);
    if (!bytes) throw new Error('FIXTURE_ASSET_MISSING');
    return { bytes, contentType: 'image/png' };
  },
};
try {
  let status: string | null = null, code: string | null = null;
  try { status = (await publishThumbnailDurableRelease({ candidateId: 'fixture' }, {}, { ...fixture.options, adapter })).status; }
  catch (error) { code = error instanceof Error ? error.message : 'FIXTURE_UNKNOWN'; }
  const beforeCommitCount = q('SELECT count(*) FROM public.youtube_thumbnail_releases');
  if (finishPending) await finishPending(true);
  const image = await readThumbnailDurableReleaseAsset(fixture.options.releaseId, {}, { adapter });
  process.stdout.write(JSON.stringify({ mode, status, code, beforeCommitCount: Number(beforeCommitCount),
    afterCommitCount: Number(q('SELECT count(*) FROM public.youtube_thumbnail_releases')), publishCalls, readCalls, deleteCalls,
    imageExact: image.bytes.equals(fixture.bytes), assets: assets.size }) + '\n');
} finally {
  if (finishPending) await finishPending(false);
  fixture.cleanup();
}
