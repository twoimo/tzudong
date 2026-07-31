import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalEnvelopeBytes,
  canonicalizeIJson,
  computeAddressPredicate,
  loadTrustAnchors,
  verifyAddressEvidenceBundle,
} from '../../../bin/address_evidence_trust.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const validator = path.join(repoRoot, 'backend/bin/validate_tzuyang_address_evidence_ledger.mjs');
const QUERY_SHA256 = 'a'.repeat(64);
const RECORD_SELECTOR_SHA256 = 'b'.repeat(64);
const SNAPSHOT_YOUTUBE_LINK = 'https://www.youtube.com/watch?v=abc12345';

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

function writeArtifact(root, relativePath, contents) {
  const file = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
  return {
    file,
    relative_path: relativePath,
    byte_length: contents.length,
    sha256: digest(contents),
  };
}

function preciseCandidatePlace(overrides = {}) {
  return {
    name: '테스트 식당',
    road_address: '서울특별시 중구 테스트로 1',
    jibun_address: '서울특별시 중구 테스트동 1',
    lat: 37.5665351,
    lng: 126.9779692,
    ...overrides,
  };
}

function candidateRiskFlags(candidate) {
  const place = candidate.place;
  const precise = typeof place?.name === 'string' && place.name.trim()
    && (typeof place.road_address === 'string' && place.road_address.trim()
      || typeof place.jibun_address === 'string' && place.jibun_address.trim())
    && typeof place.lat === 'number' && Number.isFinite(place.lat) && place.lat >= -90 && place.lat <= 90
    && typeof place.lng === 'number' && Number.isFinite(place.lng) && place.lng >= -180 && place.lng <= 180;
  return precise ? [] : ['candidate_place_not_precise'];
}
function youtubeVideoId(link) {
  const value = String(link ?? '').trim();
  return value.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1]
    ?? value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)?.[1]
    ?? '';
}


function rowFor({ candidate, dbSnapshot, trustedEvidence, sourceArtifacts, verification, riskFlags }) {
  const predicate = verification.ok
    ? verification.predicate
    : computeAddressPredicate({ verification: null, risk_flags: riskFlags });
  const verifierResult = {
    schema_version: 2,
    ok: verification.ok,
    code: verification.ok ? null : verification.code,
    predicate,
    trust_summary: predicate.trust_summary,
  };
  return {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    id: candidate.restaurant_id,
    scope_status: 'target',
    scope_reason: 'failed',
    exclusion_reason: null,
    db_snapshot: dbSnapshot,
    video_id: candidate.video_id,
    youtube_link: dbSnapshot.youtube_link,
    query_sha256: candidate.query_sha256,
    record_selector_sha256: RECORD_SELECTOR_SHA256,
    trusted_evidence: trustedEvidence,
    source_artifacts: sourceArtifacts,
    candidate_places: [{
      ...candidate.place,
      evidence_source: 'signed_provider_receipts',
      derived_from_current_evidence: true,
      confidence: 'review_required',
    }],
    evidence_classes: {
      signed_video_manifest: verification.ok,
      signed_provider_receipt_count: verification.ok ? verification.providers.length : 0,
      independently_signed_provider_receipts: verification.ok && verification.providers.length >= 2,
    },
    evidence_families: predicate.families,
    blocking_risk_flags: predicate.blocking_risk_flags,
    missing_requirements: predicate.missing_requirements,
    risk_flags: riskFlags,
    trust_summary: predicate.trust_summary,
    strict_predicate_result: predicate,
    verifier_result: verifierResult,
    trust_failure_code: verifierResult.code,
    decision: predicate.pass ? 'apply_candidate' : 'manual_review',
    operator_decision: 'review',
    decision_reason_ko: 'test',
    search_queries: [],
  };
}

async function fixture({
  candidatePlace = {},
  duplicateProviderDigest = false,
  duplicateProducer = false,
  malformedProviderReference = false,
  extraMalformedProvider = false,
  mutateSecondReceipt = null,
} = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ledger-validator-v2-'));
  const roots = {
    crawl: path.join(directory, 'crawl'),
    providerA: path.join(directory, 'provider-a'),
    providerB: path.join(directory, 'provider-b'),
  };
  Object.values(roots).forEach((root) => mkdirSync(root, { recursive: true }));

  const generatedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const dbSnapshot = { youtube_link: SNAPSHOT_YOUTUBE_LINK };
  const candidate = {
    restaurant_id: 'restaurant-1',
    video_id: youtubeVideoId(dbSnapshot.youtube_link),
    query_sha256: QUERY_SHA256,
    place: preciseCandidatePlace(candidatePlace),
  };
  // JSONL cannot represent NaN; derive claims from the exact persisted input.
  const persistedCandidate = JSON.parse(JSON.stringify(candidate));
  const signedCandidatePlace = preciseCandidatePlace();
  const videoSigner = generateKeyPairSync('ed25519');
  const providerASigner = generateKeyPairSync('ed25519');
  const providerBSigner = generateKeyPairSync('ed25519');

  const videoRaw = writeArtifact(
    roots.crawl,
    'evidence/transcript.json',
    canonicalBytes({ transcript: '테스트 식당은 테스트로 1에 있습니다.' }),
  );
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
      source_identity: {
        video_id: persistedCandidate.video_id,
        record_selector_sha256: RECORD_SELECTOR_SHA256,
      },
    }],
  };
  const manifest = writeArtifact(
    roots.crawl,
    'evidence/manifest.json',
    signedWrapper('tzudong.address.video-manifest.v2', manifestEnvelope, 'video-signer-1', videoSigner),
  );

  const providers = [];
  const selectedA = { place: signedCandidatePlace, response_id: 'a' };
  for (const [suffix, root, signer, providerId, producerId, sourceId, rootId, selected] of [
    ['a', roots.providerA, providerASigner, 'provider-a', 'producer-a', 'source-a', 'provider-a-root', selectedA],
    [
      'b',
      roots.providerB,
      providerBSigner,
      'provider-b',
      duplicateProducer ? 'producer-a' : 'producer-b',
      'source-b',
      'provider-b-root',
      duplicateProviderDigest ? selectedA : { place: signedCandidatePlace, response_id: 'b' },
    ],
  ]) {
    const raw = writeArtifact(root, `response-${suffix}.json`, canonicalBytes(selected));
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
        restaurant_id: persistedCandidate.restaurant_id,
        video_id: persistedCandidate.video_id,
        query_sha256: persistedCandidate.query_sha256,
      },
      fetched_at: generatedAt,
      expires_at: expiresAt,
      content: {
        media_type: 'application/json',
        canonical_sha256: digest(canonicalBytes(selected)),
        place: signedCandidatePlace,
      },
      nonce: Buffer.from(`fixture-nonce-${suffix}`).toString('base64'),
    };
    if (suffix === 'b' && mutateSecondReceipt) mutateSecondReceipt(receiptEnvelope);
    const receipt = writeArtifact(
      root,
      `receipt-${suffix}.json`,
      signedWrapper('tzudong.address.provider-receipt.v2', receiptEnvelope, `provider-signer-${suffix}`, signer),
    );
    providers.push({
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

  const trustedEvidence = {
    video: {
      manifest_relative_path: manifest.relative_path,
      manifest_byte_length: manifest.byte_length,
      manifest_sha256: manifest.sha256,
      manifest_signer_id: 'video-signer-1',
      entry_artifact_id: 'video-artifact-1',
    },
    providers: providers.map((provider) => ({ ...provider.trusted })),
  };
  if (malformedProviderReference) trustedEvidence.providers[1].receipt_relative_path = ' ';
  if (extraMalformedProvider) {
    trustedEvidence.providers.push({ ...providers[1].trusted, receipt_relative_path: ' ' });
  }
  const sourceArtifacts = [{
    root_id: 'crawl',
    artifact_id: 'video-artifact-1',
    kind: 'transcript',
    relative_path: videoRaw.relative_path,
    byte_length: videoRaw.byte_length,
    sha256: videoRaw.sha256,
  }, ...providers.map((provider) => provider.source)];
  const environment = {
    TZUYANG_ADDRESS_VIDEO_SIGNERS_JSON: JSON.stringify({
      'video-signer-1': publicAnchor(videoSigner),
    }),
    TZUYANG_ADDRESS_PROVIDER_SIGNERS_JSON: JSON.stringify({
      'provider-signer-a': {
        ...publicAnchor(providerASigner),
        provider_id: 'provider-a',
        producer_id: 'producer-a',
      },
      'provider-signer-b': {
        ...publicAnchor(providerBSigner),
        provider_id: 'provider-b',
        producer_id: duplicateProducer ? 'producer-a' : 'producer-b',
      },
    }),
    TZUYANG_ADDRESS_SOURCE_ROOTS_JSON: JSON.stringify({
      crawl: { kind: 'crawling', path: roots.crawl },
      'provider-a-root': { kind: 'provider', path: roots.providerA },
      'provider-b-root': { kind: 'provider', path: roots.providerB },
    }),
  };
  const anchors = await loadTrustAnchors(environment);
  const riskFlags = candidateRiskFlags(persistedCandidate);
  const verification = await verifyAddressEvidenceBundle({
    anchors,
    candidate: persistedCandidate,
    now: new Date().toISOString(),
    record_selector_sha256: RECORD_SELECTOR_SHA256,
    trusted_evidence: trustedEvidence,
    source_artifacts: sourceArtifacts,
    risk_flags: riskFlags,
  });
  const row = rowFor({
    candidate: persistedCandidate,
    dbSnapshot,
    trustedEvidence,
    sourceArtifacts,
    verification,
    riskFlags,
  });
  if (verification.ok) await verification.close();

  const privateDirectory = path.join(directory, 'operator-private');
  mkdirSync(privateDirectory);
  writeFileSync(path.join(privateDirectory, 'operator-ledger-private.jsonl'), `${JSON.stringify(row)}\n`);
  return { directory, environment, row, verificationCode: verification.ok ? null : verification.code };
}

function validate(item) {
  return spawnSync(process.execPath, [validator, '--ledger-dir', item.directory, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...item.environment },
  });
}

function dispose(item) {
  rmSync(item.directory, { recursive: true, force: true });
}

function assertManualReviewFailure(item, code, blocker = null) {
  assert.equal(item.row.schema_version, 2);
  assert.equal(item.verificationCode, code);
  assert.equal(item.row.verifier_result.ok, false);
  assert.equal(item.row.verifier_result.code, code);
  assert.equal(item.row.decision, 'manual_review');
  if (blocker) assert.ok(item.row.strict_predicate_result.blocking_risk_flags.includes(blocker));
  const result = validate(item);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /legacy_manual_only/);
}

test('independent validator accepts one signed video artifact plus two independent provider snapshots', async () => {
  const item = await fixture();
  try {
    assert.equal(item.row.verifier_result.ok, true);
    assert.equal(item.row.strict_predicate_result.pass, true);
    assert.deepEqual(item.row.evidence_families, [
      'provider:provider-a',
      'provider:provider-b',
      'video:transcript',
    ]);
    const accepted = validate(item);
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  } finally {
    dispose(item);
  }
});

test('manual review with duplicate provider digest records the signed v2 independence failure', async () => {
  const item = await fixture({ duplicateProviderDigest: true });
  try {
    assertManualReviewFailure(item, 'provider_independence_mismatch');
  } finally {
    dispose(item);
  }
});

test('manual review with malformed provider artifact records the exact signed-reference failure', async () => {
  const item = await fixture({ malformedProviderReference: true });
  try {
    assertManualReviewFailure(item, 'artifact_not_found');
  } finally {
    dispose(item);
  }
});

test('repeated producer across independently signed evidence is fail closed', async () => {
  const item = await fixture({ duplicateProducer: true });
  try {
    assertManualReviewFailure(item, 'provider_independence_mismatch');
  } finally {
    dispose(item);
  }
});

test('extra malformed signed evidence is fail closed even beside an independent baseline', async () => {
  const item = await fixture({ extraMalformedProvider: true });
  try {
    assertManualReviewFailure(item, 'artifact_not_found');
  } finally {
    dispose(item);
  }
});

test('malformed canonical receipt timestamps and content digests are signed then rejected', async () => {
  for (const [mutateSecondReceipt, code] of [
    [(receipt) => { receipt.fetched_at = '2026-07-13T11:00:00+00:00'; }, 'invalid_receipt_timestamp'],
    [(receipt) => { receipt.expires_at = '2026-07-13T11:00:00Zjunk'; }, 'invalid_receipt_timestamp'],
    [(receipt) => { receipt.content.canonical_sha256 = 'not-a-digest'; }, 'invalid_receipt_content'],
  ]) {
    const item = await fixture({ mutateSecondReceipt });
    try {
      assertManualReviewFailure(item, code);
    } finally {
      dispose(item);
    }
  }
});

test('string, non-finite, and out-of-range candidate coordinates are fail closed', async () => {
  for (const [lat, lng] of [
    ['37', 127],
    [Number.NaN, 127],
    [90.000001, 127],
    [37, -180.000001],
  ]) {
    const item = await fixture({ candidatePlace: { lat, lng } });
    try {
      assertManualReviewFailure(item, 'invalid_candidate_place', 'candidate_place_not_precise');
    } finally {
      dispose(item);
    }
  }
});
