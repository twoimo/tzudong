import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, '..', '..');
const ledgerScript = path.join(backendRoot, 'bin', 'apply_tzuyang_address_evidence_ledger.mjs');
const consistencyScript = path.join(backendRoot, 'bin', 'apply_supabase_address_consistency_candidates.mjs');
const trustScript = path.join(backendRoot, 'bin', 'address_evidence_trust.mjs');
const { main: applyLedger } = await import(pathToFileURL(ledgerScript).href);
const { main: applyConsistency } = await import(pathToFileURL(consistencyScript).href);
const {
  ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION,
  ADDRESS_EVIDENCE_ADMIN_APPROVAL_DOMAIN,
  ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROLE,
  ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID,
  canonicalEnvelopeBytes,
  canonicalizeIJson,
  computeAddressPredicate,
  loadTrustAnchors,
  verifyAddressEvidenceBundle,
} = await import(pathToFileURL(trustScript).href);

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const QUERY_SHA256 = 'a'.repeat(64);
const RECORD_SELECTOR_SHA256 = 'b'.repeat(64);
const LEDGER_CHANGED_FIELDS = [
  'road_address', 'jibun_address', 'lat', 'lng', 'geocoding_success',
  'geocoding_false_stage', 'db_error_message', 'db_error_details',
  'updated_by_admin_id', 'updated_at',
];

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalBytes(value) {
  return Buffer.from(canonicalizeIJson(value), 'utf8');
}

function publicAnchor(pair) {
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  return {
    algorithm: 'ed25519',
    public_key_spki_sha256: digest(der),
    public_key_spki_der_base64: der.toString('base64'),
  };
}

function signedWrapper(domain, envelope, signerId, pair) {
  const envelopeBytes = canonicalEnvelopeBytes(domain, envelope);
  return canonicalBytes({
    envelope,
    envelope_sha256: digest(envelopeBytes),
    signer_id: signerId,
    signature_algorithm: 'ed25519',
    signature: sign(null, envelopeBytes, pair.privateKey).toString('base64'),
  });
}

async function writeArtifact(root, relativePath, contents) {
  const file = path.join(root, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  return {
    relative_path: relativePath,
    byte_length: contents.length,
    sha256: digest(contents),
    file,
  };
}

async function writeReviewManifest(directory) {
  const names = ['apply-candidates.jsonl', 'operator-ledger-private.jsonl'];
  const artifacts = [];
  for (const name of names) {
    const bytes = await fs.readFile(path.join(directory, name));
    artifacts.push({ name, byte_length: bytes.length, sha256: digest(bytes), identity: 'regular_file' });
  }
  const bytes = Buffer.from(`${JSON.stringify({ schema_version: 1, artifacts })}\n`, 'utf8');
  await fs.writeFile(path.join(directory, 'review-manifest.json'), bytes);
  return digest(bytes);
}

function installTrustEnvironment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function snapshot(videoId) {
  return {
    status: 'pending',
    channel_name: 'tzuyang',
    origin_name: '테스트 식당',
    approved_name: null,
    naver_name: null,
    google_name: null,
    phone: '02-000-0000',
    youtube_link: `https://youtu.be/${videoId}`,
    geocoding_success: false,
    geocoding_false_stage: 2,
    updated_by_admin_id: null,
    is_missing: false,
    is_not_selected: false,
    origin_address: { address: '서울특별시 중구 테스트로 1', source: 'fixture' },
    origin_address_text: '서울특별시 중구 테스트로 1',
    road_address: null,
    jibun_address: null,
    english_address: null,
    lat: null,
    lng: null,
    evaluation_results: { category_validity_TF: { eval_value: true } },
    db_error_message: null,
    db_error_details: null,
    updated_at: '2026-07-12T00:00:00.000Z',
  };
}

function evidenceClasses(verification) {
  return {
    signed_video_manifest: true,
    signed_provider_receipt_count: verification.providers.length,
    independently_signed_provider_receipts: verification.providers.length >= 2,
  };
}

async function writeLedgerRows(fixture, row) {
  const bytes = `${JSON.stringify(row)}\n`;
  await fs.writeFile(path.join(fixture.ledgerDir, 'operator-ledger-private.jsonl'), bytes);
  await fs.writeFile(path.join(fixture.ledgerDir, 'apply-candidates.jsonl'), bytes);
  fixture.row = row;
  fixture.reviewDigest = await writeReviewManifest(fixture.ledgerDir);
}
async function writeAdminApproval(fixture, { signerId = 'admin-approval-signer-1', ...overrides } = {}) {
  const now = Date.now();
  const envelope = {
    schema_version: 1,
    action: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION,
    actor_user_id: ADMIN_USER_ID,
    review_manifest_sha256: fixture.reviewDigest,
    operation_id: ADMIN_OPERATION_ID,
    nonce: Buffer.from('01234567890123456789012345678901', 'utf8').toString('base64'),
    issued_at: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 60 * 60_000).toISOString(),
    ...overrides,
  };
  const bytes = signedWrapper(
    ADDRESS_EVIDENCE_ADMIN_APPROVAL_DOMAIN,
    envelope,
    signerId,
    fixture.adminApprovalSigner,
  );
  await fs.writeFile(path.join(fixture.ledgerDir, fixture.adminApprovalName), bytes);
  fixture.approval = {
    envelope,
    bytes,
    nonceSha256: digest(Buffer.from(envelope.nonce, 'base64')),
    approvalEnvelopeSha256: digest(bytes),
    operationId: envelope.operation_id,
  };
}


async function makeFixture(t, { id = 'restaurant-1', videoId = 'video-1' } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tzuyang-address-apply-'));
  const ledgerDir = path.join(directory, 'ledger');
  const crawlRoot = path.join(directory, 'crawl');
  const providerARoot = path.join(directory, 'provider-a');
  const providerBRoot = path.join(directory, 'provider-b');
  await Promise.all([ledgerDir, crawlRoot, providerARoot, providerBRoot].map((item) => fs.mkdir(item, { recursive: true })));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const videoSigner = generateKeyPairSync('ed25519');
  const providerASigner = generateKeyPairSync('ed25519');
  const providerBSigner = generateKeyPairSync('ed25519');
  const adminApprovalSigner = generateKeyPairSync('ed25519');
  const trustEnvironment = {
    TZUYANG_ADDRESS_VIDEO_SIGNERS_JSON: JSON.stringify({ 'video-signer-1': publicAnchor(videoSigner) }),
    TZUYANG_ADDRESS_PROVIDER_SIGNERS_JSON: JSON.stringify({
      'provider-signer-a': { ...publicAnchor(providerASigner), provider_id: 'provider-a', producer_id: 'producer-a' },
      'provider-signer-b': { ...publicAnchor(providerBSigner), provider_id: 'provider-b', producer_id: 'producer-b' },
    }),
    TZUYANG_ADDRESS_ADMIN_APPROVAL_SIGNERS_JSON: JSON.stringify({
      'admin-approval-signer-1': {
        ...publicAnchor(adminApprovalSigner),
        purpose: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION,
        role: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROLE,
        root_id: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID,
      },
    }),
    TZUYANG_ADDRESS_SOURCE_ROOTS_JSON: JSON.stringify({
      crawl: { kind: 'crawling', path: crawlRoot },
      'provider-a-root': { kind: 'provider', path: providerARoot },
      'provider-b-root': { kind: 'provider', path: providerBRoot },
    }),
  };
  installTrustEnvironment(t, trustEnvironment);

  const candidate = {
    restaurant_id: id,
    video_id: videoId,
    query_sha256: QUERY_SHA256,
    place: {
      name: '테스트 식당',
      road_address: '서울특별시 중구 테스트로 1',
      jibun_address: '서울특별시 중구 테스트동 1',
      lat: 37.5665351,
      lng: 126.9779692,
    },
  };
  const now = Date.now();
  const generatedAt = new Date(now - 60_000).toISOString();
  const expiresAt = new Date(now + 60 * 60_000).toISOString();
  const videoArtifact = await writeArtifact(crawlRoot, 'evidence/transcript.json', canonicalBytes({ transcript: '테스트로 1' }));
  const manifestEnvelope = {
    schema_version: 2,
    manifest_id: 'manifest-1',
    source_root_id: 'crawl',
    generated_at: generatedAt,
    expires_at: expiresAt,
    entries: [{
      artifact_id: 'video-artifact-1',
      kind: 'transcript',
      relative_path: videoArtifact.relative_path,
      byte_length: videoArtifact.byte_length,
      sha256: videoArtifact.sha256,
      source_identity: { video_id: videoId, record_selector_sha256: RECORD_SELECTOR_SHA256 },
    }],
  };
  const manifest = await writeArtifact(
    crawlRoot,
    'evidence/manifest.json',
    signedWrapper('tzudong.address.video-manifest.v2', manifestEnvelope, 'video-signer-1', videoSigner),
  );

  const providers = [];
  for (const [suffix, root, signer, providerId, producerId, sourceId, rootId] of [
    ['a', providerARoot, providerASigner, 'provider-a', 'producer-a', 'source-a', 'provider-a-root'],
    ['b', providerBRoot, providerBSigner, 'provider-b', 'producer-b', 'source-b', 'provider-b-root'],
  ]) {
    const selected = { place: candidate.place, response_id: suffix };
    const raw = await writeArtifact(root, `response-${suffix}.json`, canonicalBytes(selected));
    const receiptEnvelope = {
      schema_version: 2,
      receipt_id: `receipt-${suffix}`,
      provider_id: providerId,
      producer_id: producerId,
      source_id: sourceId,
      source_root_id: rootId,
      artifact: {
        artifact_id: `provider-artifact-${suffix}`,
        relative_path: raw.relative_path,
        byte_length: raw.byte_length,
        sha256: raw.sha256,
      },
      subject: {
        restaurant_id: candidate.restaurant_id,
        video_id: candidate.video_id,
        query_sha256: candidate.query_sha256,
      },
      fetched_at: generatedAt,
      expires_at: expiresAt,
      content: {
        media_type: 'application/json',
        canonical_sha256: digest(canonicalBytes(selected)),
        place: candidate.place,
      },
      nonce: Buffer.from(`fixture-nonce-${suffix}`).toString('base64'),
    };
    const receipt = await writeArtifact(
      root,
      `receipt-${suffix}.json`,
      signedWrapper('tzudong.address.provider-receipt.v2', receiptEnvelope, `provider-signer-${suffix}`, signer),
    );
    providers.push({
      raw,
      receipt,
      source: {
        root_id: rootId,
        artifact_id: receiptEnvelope.artifact.artifact_id,
        kind: 'provider_response',
        relative_path: raw.relative_path,
        byte_length: raw.byte_length,
        sha256: raw.sha256,
      },
      trusted: {
        receipt_relative_path: receipt.relative_path,
        receipt_byte_length: receipt.byte_length,
        receipt_sha256: receipt.sha256,
        receipt_signer_id: `provider-signer-${suffix}`,
        receipt_id: receiptEnvelope.receipt_id,
        artifact_id: receiptEnvelope.artifact.artifact_id,
      },
    });
  }

  const sourceArtifacts = [{
    root_id: 'crawl',
    artifact_id: 'video-artifact-1',
    kind: 'transcript',
    relative_path: videoArtifact.relative_path,
    byte_length: videoArtifact.byte_length,
    sha256: videoArtifact.sha256,
  }, ...providers.map((provider) => provider.source)];
  const trustedEvidence = {
    video: {
      manifest_relative_path: manifest.relative_path,
      manifest_byte_length: manifest.byte_length,
      manifest_sha256: manifest.sha256,
      manifest_signer_id: 'video-signer-1',
      entry_artifact_id: 'video-artifact-1',
    },
    providers: providers.map((provider) => provider.trusted),
  };
  const anchors = await loadTrustAnchors(trustEnvironment);
  const verification = await verifyAddressEvidenceBundle({
    anchors,
    candidate,
    trusted_evidence: trustedEvidence,
    source_artifacts: sourceArtifacts,
    record_selector_sha256: RECORD_SELECTOR_SHA256,
    risk_flags: [],
  });
  assert.equal(verification.ok, true, verification.code);
  const predicate = computeAddressPredicate({ verification, risk_flags: [] });
  assert.equal(predicate.pass, true);
  await verification.close();

  const row = {
    schema_version: 2,
    generated_at: generatedAt,
    id,
    scope_status: 'target',
    scope_reason: 'fixture',
    exclusion_reason: null,
    db_snapshot: snapshot(videoId),
    video_id: videoId,
    query_sha256: QUERY_SHA256,
    record_selector_sha256: RECORD_SELECTOR_SHA256,
    youtube_link: `https://youtu.be/${videoId}`,
    candidate_places: [candidate.place],
    trusted_evidence: trustedEvidence,
    source_artifacts: sourceArtifacts,
    risk_flags: [],
    evidence_families: predicate.families,
    evidence_classes: evidenceClasses(verification),
    trust_summary: verification.trust_summary,
    blocking_risk_flags: predicate.blocking_risk_flags,
    missing_requirements: predicate.missing_requirements,
    verifier_result: {
      schema_version: 2,
      ok: true,
      code: null,
      predicate,
      trust_summary: predicate.trust_summary,
    },
    trust_failure_code: null,
    strict_predicate_result: predicate,
    decision: 'apply_candidate',
    operator_decision: 'apply',
  };
  const fixture = {
    directory,
    ledgerDir,
    providers,
    row,
    trustEnvironment,
    videoSigner,
    adminApprovalSigner,
    adminApprovalName: 'admin-approval.json',
  };
  await writeLedgerRows(fixture, row);
  await writeAdminApproval(fixture);
  return fixture;
}

function applyArgs(fixture, extra = []) {
  return [
    '--ledger-dir', fixture.ledgerDir,
    '--review-manifest', 'review-manifest.json',
    '--confirm-manifest-sha256', fixture.reviewDigest,
    ...extra,
  ];
}

function applyWriteArgs(fixture) {
  return applyArgs(fixture, [
    '--apply',
    '--allow-db-write',
    '--admin-user-id',
    ADMIN_USER_ID,
    '--admin-approval',
    fixture.adminApprovalName,
    '--operation-id',
    fixture.approval.operationId,
  ]);
}

function makeTranscriptClient(steps) {
  const transcript = [...steps];
  const calls = [];
  let connectCalls = 0;
  return {
    calls,
    get connectCalls() { return connectCalls; },
    async connect() { connectCalls += 1; },
    async end() {},
    async query(sql, values = []) {
      calls.push({ sql, values });
      const step = transcript.shift();
      assert.ok(step, `unexpected query: ${sql}`);
      assert.match(sql, step.match);
      if (step.values) assert.deepEqual(values, step.values);
      if (step.error) throw step.error;
      return typeof step.result === 'function' ? step.result({ sql, values }) : (step.result || { rows: [] });
    },
    assertDrained() {
      assert.equal(transcript.length, 0, `unconsumed transcript steps: ${transcript.length}`);
    },
  };
}

function activeActorStep(result = { rows: [{ user_id: ADMIN_USER_ID }] }) {
  return {
    match: /from user_roles as role_row[\s\S]*role_row\.role = 'admin'[\s\S]*status_row\.account_status = 'active'[\s\S]*for update of role_row, status_row/i,
    values: [ADMIN_USER_ID],
    result,
  };
}
function consumeApprovalStep(fixture, result = { rows: [{ consumed: true, reason: null }] }) {
  return {
    match: /from public\.consume_tzuyang_address_evidence_admin_approval/i,
    values: [
      fixture.approval.operationId,
      fixture.approval.approvalEnvelopeSha256,
      fixture.approval.nonceSha256,
      ADMIN_USER_ID,
      fixture.reviewDigest,
      'admin-approval-signer-1',
      ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION,
      fixture.approval.envelope.issued_at,
      fixture.approval.envelope.expires_at,
    ],
    result,
  };
}

function identitySteps(videoId) {
  return [
    { match: /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/i, values: [`youtube:${videoId}`] },
    { match: /from restaurants[\s\S]*where status <> 'deleted' and youtube_link is not null/i, result: { rows: [] } },
  ];
}

function databaseRow(row, overrides = {}) {
  return { id: row.id, ...row.db_snapshot, origin_address: row.db_snapshot.origin_address, ...overrides };
}

function updateAndReadbackSteps(row, locked) {
  let payload;
  return [
    {
      match: /^update restaurants set/i,
      result: ({ values }) => {
        payload = Object.fromEntries(LEDGER_CHANGED_FIELDS.map((field, index) => [field, values[index + 1]]));
        return { rowCount: 1, rows: [] };
      },
    },
    { match: /^select id,/i, result: () => ({ rows: [{ id: row.id, ...locked, ...payload }] }) },
  ];
}

async function rejectBeforeClient(fn, args, expectedCode) {
  const client = makeTranscriptClient([]);
  await assert.rejects(() => fn(args, { client }), { code: expectedCode });
  assert.equal(client.connectCalls, 0);
  assert.equal(client.calls.length, 0);
}

test('ledger and compatibility entrypoint have identical signed-v2 fixture preflight decisions', async (t) => {
  const ledgerFixture = await makeFixture(t);
  const ledger = await applyLedger(applyArgs(ledgerFixture, ['--fixture-dry-run']));
  const launcherFixture = await makeFixture(t);
  const launcher = await applyConsistency(applyArgs(launcherFixture, ['--fixture-dry-run']));
  assert.deepEqual(
    { mode: ledger.mode, target_count: ledger.target_count, applied: ledger.applied, skipped: ledger.skipped },
    { mode: launcher.mode, target_count: launcher.target_count, applied: launcher.applied, skipped: launcher.skipped },
  );
  assert.equal(ledger.database_connection_attempted, false);
  assert.equal(launcher.database_connection_attempted, false);
});

test('legacy report inputs are rejected before environment or client access', async () => {
  const client = makeTranscriptClient([]);
  await assert.rejects(
    () => applyConsistency(['--report-dir', 'unsigned-legacy-report'], { client }),
    { code: 'legacy_consistency_report_not_authoritative' },
  );
  assert.equal(client.connectCalls, 0);
  assert.equal(client.calls.length, 0);
});
test('a substituted top-level YouTube URL fails before output or client access', async (t) => {
  const fixture = await makeFixture(t);
  const row = structuredClone(fixture.row);
  row.youtube_link = 'https://youtu.be/substituted-video';
  await writeLedgerRows(fixture, row);
  await rejectBeforeClient(applyLedger, applyWriteArgs(fixture), 'ARTIFACT_BINDING_INVALID');
  await assert.rejects(
    () => fs.lstat(path.join(fixture.ledgerDir, 'ledger-apply-results')),
    { code: 'ENOENT' },
  );
});

test('signature, membership, provider, and claimed-result attacks fail before client construction', async (t) => {
  await t.test('altered signed receipt', async (subtest) => {
    const fixture = await makeFixture(subtest);
    const receipt = fixture.providers[0].receipt;
    const altered = Buffer.from((await fs.readFile(receipt.file)).toString('utf8').replace(/"signature":"[^"]+"/, '"signature":"AAAA"'), 'utf8');
    await fs.writeFile(receipt.file, altered);
    const row = structuredClone(fixture.row);
    row.trusted_evidence.providers[0].receipt_byte_length = altered.length;
    row.trusted_evidence.providers[0].receipt_sha256 = digest(altered);
    await writeLedgerRows(fixture, row);
    await rejectBeforeClient(applyLedger, applyWriteArgs(fixture), 'invalid_signature');
  });

  await t.test('signed manifest does not contain substituted entry', async (subtest) => {
    const fixture = await makeFixture(subtest);
    const row = structuredClone(fixture.row);
    row.trusted_evidence.video.entry_artifact_id = 'substituted-video-artifact';
    row.source_artifacts[0].artifact_id = 'substituted-video-artifact';
    await writeLedgerRows(fixture, row);
    await rejectBeforeClient(applyLedger, applyWriteArgs(fixture), 'manifest_membership_mismatch');
  });

  await t.test('raw provider response cannot be self-asserted after receipt signing', async (subtest) => {
    const fixture = await makeFixture(subtest);
    const mutatedRaw = canonicalBytes({ place: fixture.row.candidate_places[0], authenticated: true, response_id: 'a' });
    await fs.writeFile(fixture.providers[0].raw.file, mutatedRaw);
    const row = structuredClone(fixture.row);
    row.source_artifacts[1].byte_length = mutatedRaw.length;
    row.source_artifacts[1].sha256 = digest(mutatedRaw);
    await writeLedgerRows(fixture, row);
    await rejectBeforeClient(applyLedger, applyWriteArgs(fixture), 'receipt_artifact_mismatch');
  });

  await t.test('stored predicate cannot authorize a different result', async (subtest) => {
    const fixture = await makeFixture(subtest);
    const row = structuredClone(fixture.row);
    row.strict_predicate_result.pass = false;
    await writeLedgerRows(fixture, row);
    await rejectBeforeClient(applyLedger, applyWriteArgs(fixture), 'trust_claim_mismatch');
  });
});
test('signed admin approval binds the actor, review, operation, signer purpose, expiry, and durable replay consumption', async (t) => {
  await t.test('rejects an approval assigned to a different admin before client construction', async (subtest) => {
    const fixture = await makeFixture(subtest);
    const args = applyWriteArgs(fixture);
    args[args.indexOf('--admin-user-id') + 1] = '33333333-3333-4333-8333-333333333333';
    await rejectBeforeClient(applyLedger, args, 'admin_approval_actor_mismatch');
  });

  await t.test('rejects reviewed-manifest and operation mismatches before client construction', async (subtest) => {
    const fixture = await makeFixture(subtest);
    await writeAdminApproval(fixture, { review_manifest_sha256: 'c'.repeat(64) });
    await rejectBeforeClient(applyLedger, applyWriteArgs(fixture), 'admin_approval_manifest_mismatch');

    await writeAdminApproval(fixture);
    const args = applyWriteArgs(fixture);
    args[args.indexOf('--operation-id') + 1] = '33333333-3333-4333-8333-333333333333';
    await rejectBeforeClient(applyLedger, args, 'admin_approval_operation_mismatch');
  });

  await t.test('rejects expired approvals and producer-key collisions before client construction', async (subtest) => {
    const fixture = await makeFixture(subtest);
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await writeAdminApproval(fixture, {
      issued_at: new Date(Date.now() - 120_000).toISOString(),
      expires_at: expiredAt,
    });
    await rejectBeforeClient(applyLedger, applyWriteArgs(fixture), 'admin_approval_expired');

    await writeAdminApproval(fixture);
    process.env.TZUYANG_ADDRESS_ADMIN_APPROVAL_SIGNERS_JSON = JSON.stringify({
      'admin-approval-signer-1': {
        ...publicAnchor(fixture.videoSigner),
        purpose: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION,
        role: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROLE,
        root_id: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID,
      },
    });
    await rejectBeforeClient(applyLedger, applyWriteArgs(fixture), 'admin_approval_signer_key_collision');
  });
  await t.test('rejects a relabeled approval wrapper when signer aliases share one pinned key', async (subtest) => {
    const fixture = await makeFixture(subtest);
    await writeAdminApproval(fixture, { signerId: 'admin-approval-signer-2' });
    process.env.TZUYANG_ADDRESS_ADMIN_APPROVAL_SIGNERS_JSON = JSON.stringify({
      'admin-approval-signer-1': {
        ...publicAnchor(fixture.adminApprovalSigner),
        purpose: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION,
        role: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROLE,
        root_id: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID,
      },
      'admin-approval-signer-2': {
        ...publicAnchor(fixture.adminApprovalSigner),
        purpose: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ACTION,
        role: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROLE,
        root_id: ADDRESS_EVIDENCE_ADMIN_APPROVAL_ROOT_ID,
      },
    });
    await rejectBeforeClient(applyLedger, applyWriteArgs(fixture), 'admin_approval_signer_key_collision');
  });

  await t.test('rolls back a durable replay rejection', async (subtest) => {
    const fixture = await makeFixture(subtest);
    const client = makeTranscriptClient([
      { match: /^begin$/i },
      activeActorStep(),
      consumeApprovalStep(fixture, { rows: [{ consumed: false, reason: 'replayed' }] }),
      { match: /^rollback$/i },
    ]);
    await assert.rejects(
      () => applyLedger(applyWriteArgs(fixture), { client }),
      (error) => error?.code === 'APPLY_TRANSACTION_INCOMPLETE' && error.reason === 'admin_approval_replayed',
    );
    client.assertDrained();
  });
});

test('artifact replacement during an apply transaction rolls back before commit', async (t) => {
  const fixture = await makeFixture(t);
  const locked = databaseRow(fixture.row);
  let payload;
  const client = makeTranscriptClient([
    { match: /^begin$/i },
    activeActorStep(),
    consumeApprovalStep(fixture),
    ...identitySteps(fixture.row.video_id),
    { match: /where id = any\(\$1\).*for update/i, result: { rows: [locked] } },
    {
      match: /^update restaurants set/i,
      result: async ({ values }) => {
        payload = Object.fromEntries(LEDGER_CHANGED_FIELDS.map((field, index) => [field, values[index + 1]]));
        const candidatePath = path.join(fixture.ledgerDir, 'apply-candidates.jsonl');
        await fs.writeFile(candidatePath, Buffer.from('{"replacement":true}\n', 'utf8'));
        return { rowCount: 1, rows: [] };
      },
    },
    { match: /^select id,/i, result: () => ({ rows: [{ id: fixture.row.id, ...locked, ...payload }] }) },
    { match: /^rollback$/i },
  ]);
  await assert.rejects(
    () => applyLedger(applyWriteArgs(fixture), { client }),
    (error) => error?.code === 'APPLY_TRANSACTION_INCOMPLETE' && error.reason === 'artifact_recheck_failed',
  );
  assert.equal(client.calls.some(({ sql }) => /^commit$/i.test(sql)), false);
  client.assertDrained();
});

test('signed ledger apply preserves one transaction, active-admin verification, locks, CAS, and compact receipts', async (t) => {
  const fixture = await makeFixture(t);
  const locked = databaseRow(fixture.row);
  const client = makeTranscriptClient([
    { match: /^begin$/i },
    activeActorStep(),
    consumeApprovalStep(fixture),
    ...identitySteps(fixture.row.video_id),
    {
      match: /select id,.*from restaurants where id = any\(\$1\) order by id for update/i,
      values: [[fixture.row.id]],
      result: { rows: [locked] },
    },
    ...updateAndReadbackSteps(fixture.row, locked),
    { match: /^commit$/i },
  ]);
  const result = await applyLedger(applyWriteArgs(fixture), { client });
  assert.equal(result.db_write_performed, true);
  assert.deepEqual(result.applied.map(({ id }) => id), [fixture.row.id]);
  assert.equal(client.calls.filter(({ sql }) => /^begin$/i.test(sql)).length, 1);
  assert.equal(client.calls.filter(({ sql }) => /^commit$/i.test(sql)).length, 1);
  assert.deepEqual(client.calls.filter(({ sql }) => /pg_advisory_xact_lock/i.test(sql)).map(({ values }) => values), [[`youtube:${fixture.row.video_id}`]]);
  assert.equal(JSON.stringify(result).includes(ADMIN_USER_ID), false);
  client.assertDrained();
});

test('transaction regressions roll back on actor, CAS, update, readback, and commit failures', async (t) => {
  const cases = [
    {
      name: 'inactive admin',
      build: (fixture) => [
        { match: /^begin$/i },
        activeActorStep({ rows: [] }),
        { match: /^rollback$/i },
      ],
    },
    {
      name: 'reviewed snapshot drift',
      build: (fixture) => [
        { match: /^begin$/i },
        activeActorStep(),
        consumeApprovalStep(fixture),
        ...identitySteps(fixture.row.video_id),
        {
          match: /where id = any\(\$1\).*for update/i,
          result: { rows: [databaseRow(fixture.row, { english_address: 'changed after review' })] },
        },
        { match: /^rollback$/i },
      ],
    },
    {
      name: 'update count mismatch',
      build: (fixture) => [
        { match: /^begin$/i },
        activeActorStep(),
        consumeApprovalStep(fixture),
        ...identitySteps(fixture.row.video_id),
        { match: /where id = any\(\$1\).*for update/i, result: { rows: [databaseRow(fixture.row)] } },
        { match: /^update restaurants set/i, result: { rowCount: 0, rows: [] } },
        { match: /^rollback$/i },
      ],
    },
    {
      name: 'readback mismatch',
      build: (fixture) => {
        const locked = databaseRow(fixture.row);
        let payload;
        return [
          { match: /^begin$/i },
          activeActorStep(),
          consumeApprovalStep(fixture),
          ...identitySteps(fixture.row.video_id),
          { match: /where id = any\(\$1\).*for update/i, result: { rows: [locked] } },
          {
            match: /^update restaurants set/i,
            result: ({ values }) => {
              payload = Object.fromEntries(LEDGER_CHANGED_FIELDS.map((field, index) => [field, values[index + 1]]));
              return { rowCount: 1, rows: [] };
            },
          },
          { match: /^select id,/i, result: () => ({ rows: [{ id: fixture.row.id, ...locked, ...payload, lat: 0 }] }) },
          { match: /^rollback$/i },
        ];
      },
    },
    {
      name: 'ambiguous commit',
      build: (fixture) => {
        const locked = databaseRow(fixture.row);
        return [
          { match: /^begin$/i },
          activeActorStep(),
          consumeApprovalStep(fixture),
          ...identitySteps(fixture.row.video_id),
          { match: /where id = any\(\$1\).*for update/i, result: { rows: [locked] } },
          ...updateAndReadbackSteps(fixture.row, locked),
          { match: /^commit$/i, error: new Error('acknowledgement lost') },
          { match: /^rollback$/i },
        ];
      },
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const fixture = await makeFixture(subtest);
      const client = makeTranscriptClient(scenario.build(fixture));
      await assert.rejects(() => applyLedger(applyWriteArgs(fixture), { client }), { code: 'APPLY_TRANSACTION_INCOMPLETE' });
      assert.equal(client.calls.some(({ sql }) => /^commit$/i.test(sql)), scenario.name === 'ambiguous commit');
      client.assertDrained();
    });
  }
});

test('the compatibility source has no second trust implementation or writer', async () => {
  const source = await fs.readFile(consistencyScript, 'utf8');
  assert.match(source, /applyLedger/);
  assert.match(source, /legacy_consistency_report_not_authoritative/);
  assert.doesNotMatch(source, /createDatabaseClient|pg_advisory|provider_responses|coreSignalsPass|update restaurants/i);
});
