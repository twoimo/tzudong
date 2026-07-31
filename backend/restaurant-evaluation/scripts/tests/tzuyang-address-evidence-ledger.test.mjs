import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalEnvelopeBytes, canonicalizeIJson } from '../../../bin/address_evidence_trust.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const QUERY_SHA256 = 'a'.repeat(64);
const RECORD_SELECTOR_SHA256 = 'b'.repeat(64);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
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
    file,
    relative_path: relativePath,
    byte_length: contents.length,
    sha256: digest(contents),
  };
}

function reviewRow(id, videoId) {
  return {
    id,
    status: 'pending',
    channel_name: 'tzuyang',
    origin_name: '테스트 식당',
    approved_name: null,
    naver_name: null,
    google_name: null,
    youtube_link: `https://youtu.be/${videoId}`,
    geocoding_success: false,
    geocoding_false_stage: 2,
    updated_by_admin_id: null,
    is_missing: false,
    is_not_selected: false,
    origin_address: { address: '서울특별시 중구 테스트로 1' },
    road_address: null,
    jibun_address: null,
    lat: null,
    lng: null,
    updated_at: new Date(),
  };
}

async function makeFixture(t, { duplicateProducer = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tzuyang-signed-ledger-'));
  const guardedRoot = path.join(directory, 'guarded');
  const evaluationRoot = path.join(directory, 'evaluation');
  const crawlRoot = path.join(directory, 'crawl');
  const providerARoot = path.join(directory, 'provider-a');
  const providerBRoot = path.join(directory, 'provider-b');
  const outputRoot = path.join(directory, 'output');
  await Promise.all([guardedRoot, evaluationRoot, crawlRoot, providerARoot, providerBRoot].map((item) => fs.mkdir(item, { recursive: true })));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const id = 'restaurant-1';
  const videoId = 'abc12345';
  const now = Date.now();
  const generatedAt = new Date(now - 60_000).toISOString();
  const expiresAt = new Date(now + 60 * 60_000).toISOString();
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
  const videoSigner = generateKeyPairSync('ed25519');
  const providerASigner = generateKeyPairSync('ed25519');
  const providerBSigner = generateKeyPairSync('ed25519');
  const videoRaw = await writeArtifact(crawlRoot, 'evidence/transcript.json', canonicalBytes({ transcript: '테스트로 1' }));
  const manifestEnvelope = {
    schema_version: 2,
    manifest_id: 'manifest-1',
    source_root_id: 'crawl',
    generated_at: generatedAt,
    expires_at: expiresAt,
    entries: [{
      artifact_id: 'video-artifact-1',
      kind: 'transcript',
      relative_path: videoRaw.relative_path,
      byte_length: videoRaw.byte_length,
      sha256: videoRaw.sha256,
      source_identity: { video_id: videoId, record_selector_sha256: RECORD_SELECTOR_SHA256 },
    }],
  };
  const manifest = await writeArtifact(crawlRoot, 'evidence/manifest.json', signedWrapper('tzudong.address.video-manifest.v2', manifestEnvelope, 'video-signer-1', videoSigner));

  const providers = [];
  for (const [suffix, root, signer, providerId, producerId, sourceId, rootId] of [
    ['a', providerARoot, providerASigner, 'provider-a', 'producer-a', 'source-a', 'provider-a-root'],
    ['b', providerBRoot, providerBSigner, 'provider-b', duplicateProducer ? 'producer-a' : 'producer-b', 'source-b', 'provider-b-root'],
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
      artifact: { artifact_id: `provider-artifact-${suffix}`, relative_path: raw.relative_path, byte_length: raw.byte_length, sha256: raw.sha256 },
      subject: { restaurant_id: id, video_id: videoId, query_sha256: QUERY_SHA256 },
      fetched_at: generatedAt,
      expires_at: expiresAt,
      content: { media_type: 'application/json', canonical_sha256: digest(canonicalBytes(selected)), place: candidate.place },
      nonce: Buffer.from(`fixture-nonce-${suffix}`).toString('base64'),
    };
    const receipt = await writeArtifact(root, `receipt-${suffix}.json`, signedWrapper('tzudong.address.provider-receipt.v2', receiptEnvelope, `provider-signer-${suffix}`, signer));
    providers.push({
      root,
      raw,
      receipt,
      source: { root_id: rootId, artifact_id: receiptEnvelope.artifact.artifact_id, kind: 'provider_response', relative_path: raw.relative_path, byte_length: raw.byte_length, sha256: raw.sha256 },
      trusted: { receipt_relative_path: receipt.relative_path, receipt_byte_length: receipt.byte_length, receipt_sha256: receipt.sha256, receipt_signer_id: `provider-signer-${suffix}`, receipt_id: receiptEnvelope.receipt_id, artifact_id: receiptEnvelope.artifact.artifact_id },
    });
  }

  const bundle = {
    schema_version: 2,
    query_sha256: QUERY_SHA256,
    record_selector_sha256: RECORD_SELECTOR_SHA256,
    candidate_place: candidate.place,
    trusted_evidence: {
      video: {
        manifest_relative_path: manifest.relative_path,
        manifest_byte_length: manifest.byte_length,
        manifest_sha256: manifest.sha256,
        manifest_signer_id: 'video-signer-1',
        entry_artifact_id: 'video-artifact-1',
      },
      providers: providers.map((provider) => provider.trusted),
    },
    source_artifacts: [{
      root_id: 'crawl',
      artifact_id: 'video-artifact-1',
      kind: 'transcript',
      relative_path: videoRaw.relative_path,
      byte_length: videoRaw.byte_length,
      sha256: videoRaw.sha256,
    }, ...providers.map((provider) => provider.source)],
  };
  const environment = {
    TZUYANG_ADDRESS_VIDEO_SIGNERS_JSON: JSON.stringify({ 'video-signer-1': publicAnchor(videoSigner) }),
    TZUYANG_ADDRESS_PROVIDER_SIGNERS_JSON: JSON.stringify({
      'provider-signer-a': { ...publicAnchor(providerASigner), provider_id: 'provider-a', producer_id: 'producer-a' },
      'provider-signer-b': { ...publicAnchor(providerBSigner), provider_id: 'provider-b', producer_id: duplicateProducer ? 'producer-a' : 'producer-b' },
    }),
    TZUYANG_ADDRESS_SOURCE_ROOTS_JSON: JSON.stringify({
      crawl: { kind: 'crawling', path: crawlRoot },
      'provider-a-root': { kind: 'provider', path: providerARoot },
      'provider-b-root': { kind: 'provider', path: providerBRoot },
    }),
  };
  await fs.writeFile(path.join(guardedRoot, 'review-queue.jsonl'), `${JSON.stringify(reviewRow(id, videoId))}\n`);
  const bundlePath = path.join(evaluationRoot, 'address-evidence-bundles.jsonl');
  await fs.writeFile(bundlePath, `${JSON.stringify({ restaurant_id: id, address_evidence: bundle })}\n`);
  return { directory, guardedRoot, evaluationRoot, crawlRoot, providerARoot, providerBRoot, outputRoot, bundlePath, bundle, providers, environment };
}

async function writeBundle(fixture) {
  await fs.writeFile(fixture.bundlePath, `${JSON.stringify({ restaurant_id: 'restaurant-1', address_evidence: fixture.bundle })}\n`);
}
async function prepareReviewedArtifacts(fixture) {
  const privateDir = path.join(fixture.outputRoot, 'operator-private');
  const privatePath = path.join(privateDir, 'operator-ledger-private.jsonl');
  const reviewedPath = path.join(fixture.outputRoot, 'operator-ledger-private.jsonl');
  const candidatePath = path.join(fixture.outputRoot, 'apply-candidates.jsonl');
  const reviewed = await privateLedger(fixture);
  assert.equal(reviewed.decision, 'apply_candidate');
  reviewed.operator_decision = 'apply';
  const reviewedBytes = Buffer.concat([canonicalBytes(reviewed), Buffer.from('\n')]);
  await fs.writeFile(privatePath, reviewedBytes);
  await fs.writeFile(reviewedPath, reviewedBytes);
  await fs.writeFile(candidatePath, reviewedBytes);

  const manifest = {
    schema_version: 1,
    artifacts: [
      { name: 'apply-candidates.jsonl', byte_length: reviewedBytes.length, sha256: digest(reviewedBytes), identity: 'regular_file' },
      { name: 'operator-ledger-private.jsonl', byte_length: reviewedBytes.length, sha256: digest(reviewedBytes), identity: 'regular_file' },
    ],
  };
  const manifestName = 'review-manifest.json';
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
  await fs.writeFile(path.join(fixture.outputRoot, manifestName), manifestBytes);
  return { manifestName, manifestSha256: digest(manifestBytes) };
}

function run(fixture, script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...fixture.environment },
  });
}

function build(fixture) {
  return run(fixture, 'backend/bin/build_tzuyang_address_evidence_ledger.mjs', [
    '--out', fixture.outputRoot,
    '--from-guarded-report', fixture.guardedRoot,
    '--evidence-bundles', fixture.bundlePath,
    '--source-root', `crawl=${fixture.crawlRoot}`,
    '--source-root', `provider-a-root=${fixture.providerARoot}`,
    '--source-root', `provider-b-root=${fixture.providerBRoot}`,
    '--json',
  ]);
}

function validate(fixture) {
  return run(fixture, 'backend/bin/validate_tzuyang_address_evidence_ledger.mjs', ['--ledger-dir', fixture.outputRoot, '--json']);
}

async function privateLedger(fixture) {
  const text = await fs.readFile(path.join(fixture.outputRoot, 'operator-private', 'operator-ledger-private.jsonl'), 'utf8');
  return JSON.parse(text.trim());
}

test('builds and validates an apply candidate only from one signed video and two independent signed providers', async (t) => {
  const fixture = await makeFixture(t);
  const built = build(fixture);
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const row = await privateLedger(fixture);
  assert.equal(row.schema_version, 2);
  assert.equal(row.decision, 'apply_candidate');
  assert.equal(row.strict_predicate_result.pass, true);
  assert.equal(row.trusted_evidence.providers.length, 2);
  assert.equal(row.source_artifacts.length, 3);
  assert.equal(row.verifier_result.ok, true);
  assert.equal(row.youtube_link, row.db_snapshot.youtube_link);
  assert.equal(row.video_id, 'abc12345');
  const validated = validate(fixture);
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
});
test('fixture review manifest binds the canonical reviewed artifacts for the no-database apply path', async (t) => {
  const fixture = await makeFixture(t);
  assert.equal(build(fixture).status, 0);
  const review = await prepareReviewedArtifacts(fixture);
  const applied = run(fixture, 'backend/bin/apply_tzuyang_address_evidence_ledger.mjs', [
    '--ledger-dir', fixture.outputRoot,
    '--review-manifest', review.manifestName,
    '--confirm-manifest-sha256', review.manifestSha256,
    '--fixture-dry-run',
  ]);
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  const summary = JSON.parse(await fs.readFile(path.join(fixture.outputRoot, 'ledger-apply-dry-run', 'summary.json'), 'utf8'));
  assert.equal(summary.fixture_dry_run, true);
  assert.equal(summary.db_write_performed, false);
  assert.equal(summary.applied.length, 1);
  assert.deepEqual(summary.reviewed_artifacts.map((artifact) => artifact.name), ['apply-candidates.jsonl', 'operator-ledger-private.jsonl']);
});

test('validator rejects a mutable top-level video link and retains the reviewed snapshot identity for signed verification', async (t) => {
  const fixture = await makeFixture(t);
  assert.equal(build(fixture).status, 0);
  const privatePath = path.join(fixture.outputRoot, 'operator-private', 'operator-ledger-private.jsonl');
  const claimed = await privateLedger(fixture);
  claimed.youtube_link = 'https://youtu.be/mutated-video';
  await fs.writeFile(privatePath, `${JSON.stringify(claimed)}\n`);

  const validated = validate(fixture);
  assert.notEqual(validated.status, 0);
  const summary = JSON.parse(await fs.readFile(path.join(fixture.outputRoot, 'ledger-validation.json'), 'utf8'));
  assert.ok(summary.errors.some((error) => error.code === 'youtube_link_snapshot_mismatch'));
  assert.ok(!summary.errors.some((error) => error.code === 'strict_predicate_claim_mismatch'));
});
test('self-asserted provenance and stored pass flags cannot authorize an apply candidate', async (t) => {
  const fixture = await makeFixture(t);
  fixture.bundle.authenticated = true;
  await writeBundle(fixture);
  const built = build(fixture);
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const row = await privateLedger(fixture);
  assert.equal(row.decision, 'manual_review');
  assert.equal(row.verifier_result.ok, false);

  const clean = await makeFixture(t);
  assert.equal(build(clean).status, 0);
  const privatePath = path.join(clean.outputRoot, 'operator-private', 'operator-ledger-private.jsonl');
  const claimed = await privateLedger(clean);
  claimed.strict_predicate_result.pass = false;
  claimed.verifier_result.predicate.pass = false;
  await fs.writeFile(privatePath, `${JSON.stringify(claimed)}\n`);
  const validated = validate(clean);
  assert.notEqual(validated.status, 0);
  const summary = JSON.parse(await fs.readFile(path.join(clean.outputRoot, 'ledger-validation.json'), 'utf8'));
  assert.ok(summary.errors.some((error) => error.code === 'strict_predicate_claim_mismatch'));
});

test('rejects changed signatures, raw bytes, provider-place disagreement, and duplicate producer independence', async (t) => {
  await t.test('altered detached receipt signature', async (subtest) => {
    const fixture = await makeFixture(subtest);
    const provider = fixture.providers[1];
    const wrapper = JSON.parse(await fs.readFile(provider.receipt.file, 'utf8'));
    wrapper.signature = Buffer.alloc(64, 0x5a).toString('base64');
    const bytes = canonicalBytes(wrapper);
    await fs.writeFile(provider.receipt.file, bytes);
    fixture.bundle.trusted_evidence.providers[1].receipt_byte_length = bytes.length;
    fixture.bundle.trusted_evidence.providers[1].receipt_sha256 = digest(bytes);
    await writeBundle(fixture);
    assert.equal(build(fixture).status, 0);
    assert.equal((await privateLedger(fixture)).decision, 'manual_review');
  });

  await t.test('provider place does not equal the candidate', async (subtest) => {
    const fixture = await makeFixture(subtest);
    fixture.bundle.candidate_place = { ...fixture.bundle.candidate_place, road_address: '서울특별시 중구 다른로 1' };
    await writeBundle(fixture);
    assert.equal(build(fixture).status, 0);
    assert.equal((await privateLedger(fixture)).decision, 'manual_review');
  });

  await t.test('two signed labels with one producer are not independent', async (subtest) => {
    const fixture = await makeFixture(subtest, { duplicateProducer: true });
    assert.equal(build(fixture).status, 0);
    const row = await privateLedger(fixture);
    assert.equal(row.decision, 'manual_review');
    assert.equal(row.trust_failure_code, 'provider_independence_mismatch');
  });

  await t.test('raw evidence changed after build fails validation', async (subtest) => {
    const fixture = await makeFixture(subtest);
    assert.equal(build(fixture).status, 0);
    await fs.writeFile(fixture.providers[0].raw.file, canonicalBytes({ place: fixture.bundle.candidate_place, response_id: 'changed' }));
    assert.notEqual(validate(fixture).status, 0);
    const summary = JSON.parse(await fs.readFile(path.join(fixture.outputRoot, 'ledger-validation.json'), 'utf8'));
    assert.ok(summary.errors.some((error) => error.code === 'strict_predicate_claim_mismatch'));
  });
});

test('signed-reference substitution attacks stay manual-only', async (t) => {
  const attacks = [
    ['untrusted manifest signer', (bundle) => { bundle.trusted_evidence.video.manifest_signer_id = 'untrusted-video'; }],
    ['absent manifest member', (bundle) => { bundle.trusted_evidence.video.entry_artifact_id = 'missing-video-artifact'; }],
    ['provider signer substitution', (bundle) => { bundle.trusted_evidence.providers[1].receipt_signer_id = 'provider-signer-a'; }],
    ['receipt replay', (bundle) => { bundle.trusted_evidence.providers[1].receipt_id = bundle.trusted_evidence.providers[0].receipt_id; }],
    ['root substitution', (bundle) => { bundle.source_artifacts[2].root_id = 'provider-a-root'; }],
    ['path traversal', (bundle) => { bundle.source_artifacts[2].relative_path = '../response-a.json'; }],
  ];
  for (const [name, mutate] of attacks) {
    await t.test(name, async (subtest) => {
      const fixture = await makeFixture(subtest);
      mutate(fixture.bundle);
      await writeBundle(fixture);
      const built = build(fixture);
      assert.equal(built.status, 0, built.stderr || built.stdout);
      assert.equal((await privateLedger(fixture)).decision, 'manual_review');
    });
  }
});
test('legacy schema-v1 ledgers are manual-only and can never validate as apply candidates', async (t) => {
  const fixture = await makeFixture(t);
  await fs.mkdir(path.join(fixture.outputRoot, 'operator-private'), { recursive: true });
  await fs.writeFile(path.join(fixture.outputRoot, 'operator-private', 'operator-ledger-private.jsonl'), `${JSON.stringify({ schema_version: 1, id: 'restaurant-1', decision: 'apply_candidate' })}\n`);
  const validated = validate(fixture);
  assert.notEqual(validated.status, 0);
  const summary = JSON.parse(await fs.readFile(path.join(fixture.outputRoot, 'ledger-validation.json'), 'utf8'));
  assert.ok(summary.errors.some((error) => error.code === 'legacy_manual_only'));
  assert.ok(summary.errors.some((error) => error.code === 'legacy_apply_candidate_forbidden'));
});
