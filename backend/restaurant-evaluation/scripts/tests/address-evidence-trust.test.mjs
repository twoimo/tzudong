import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalEnvelopeBytes,
  canonicalizeIJson,
  loadTrustAnchors,
  verifyAddressEvidenceBundle,
} from '../../../bin/address_evidence_trust.mjs';

const NOW = '2026-07-13T12:00:00.000Z';
const QUERY_SHA256 = 'a'.repeat(64);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytes(value) {
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
  return bytes({
    envelope,
    envelope_sha256: digest(envelopeBytes),
    signer_id: signerId,
    signature_algorithm: 'ed25519',
    signature: sign(null, envelopeBytes, pair.privateKey).toString('base64'),
  });
}

async function writeArtifact(root, relativePath, contents) {
  const file = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  return {
    relative_path: relativePath,
    byte_length: contents.length,
    sha256: digest(contents),
  };
}

async function buildFixture({ duplicateProducer = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'address-evidence-trust-'));
  const roots = {
    crawl: path.join(directory, 'crawl'),
    providerA: path.join(directory, 'provider-a'),
    providerB: path.join(directory, 'provider-b'),
    ...(duplicateProducer ? { providerC: path.join(directory, 'provider-c') } : {}),
  };
  for (const root of Object.values(roots)) await mkdir(root, { recursive: true });

  const videoSigner = generateKeyPairSync('ed25519');
  const providerASigner = generateKeyPairSync('ed25519');
  const providerBSigner = generateKeyPairSync('ed25519');
  const providerCSigner = duplicateProducer ? generateKeyPairSync('ed25519') : null;
  const candidate = {
    restaurant_id: 'restaurant-1',
    video_id: 'video-1',
    query_sha256: QUERY_SHA256,
    place: {
      name: '테스트 식당',
      road_address: '서울특별시 중구 테스트로 1',
      jibun_address: '서울특별시 중구 테스트동 1',
      lat: 37.5665351,
      lng: 126.9779692,
    },
  };

  const videoContents = bytes({ transcript: '식당은 테스트로 1에 있습니다.' });
  const videoArtifact = await writeArtifact(roots.crawl, 'evidence/transcript.json', videoContents);
  const manifestEnvelope = {
    schema_version: 2,
    manifest_id: 'manifest-1',
    source_root_id: 'crawl',
    generated_at: '2026-07-13T11:00:00.000Z',
    expires_at: '2026-07-13T13:00:00.000Z',
    entries: [{
      artifact_id: 'video-artifact-1',
      kind: 'transcript',
      ...videoArtifact,
      source_identity: { video_id: candidate.video_id, record_selector_sha256: 'b'.repeat(64) },
    }],
  };
  const manifest = await writeArtifact(
    roots.crawl,
    'evidence/manifest.json',
    signedWrapper('tzudong.address.video-manifest.v2', manifestEnvelope, 'video-signer-1', videoSigner),
  );

  const providers = [];
  const providerFixtures = [
    ['a', roots.providerA, providerASigner, 'provider-a', 'producer-a', 'source-a', 'provider-a-root'],
    ['b', roots.providerB, providerBSigner, 'provider-b', 'producer-b', 'source-b', 'provider-b-root'],
    ...(duplicateProducer ? [['c', roots.providerC, providerCSigner, 'provider-c', 'producer-a', 'source-c', 'provider-c-root']] : []),
  ];
  for (const [suffix, root, signer, providerId, producerId, sourceId, rootId] of providerFixtures) {
    const raw = await writeArtifact(root, `response-${suffix}.json`, bytes({ place: candidate.place, response_id: suffix }));
    const receiptEnvelope = {
      schema_version: 2,
      receipt_id: `receipt-${suffix}`,
      provider_id: providerId,
      producer_id: producerId,
      source_id: sourceId,
      source_root_id: rootId,
      artifact: { artifact_id: `provider-artifact-${suffix}`, ...raw },
      subject: {
        restaurant_id: candidate.restaurant_id,
        video_id: candidate.video_id,
        query_sha256: candidate.query_sha256,
      },
      fetched_at: '2026-07-13T11:00:00.000Z',
      expires_at: '2026-07-13T13:00:00.000Z',
      content: {
        media_type: 'application/json',
        canonical_sha256: digest(bytes({ place: candidate.place, response_id: suffix })),
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
      source: {
        root_id: receiptEnvelope.source_root_id,
        artifact_id: receiptEnvelope.artifact.artifact_id,
        kind: 'provider_response',
        ...raw,
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

  const anchors = await loadTrustAnchors({
    TZUYANG_ADDRESS_VIDEO_SIGNERS_JSON: JSON.stringify({ 'video-signer-1': publicAnchor(videoSigner) }),
    TZUYANG_ADDRESS_PROVIDER_SIGNERS_JSON: JSON.stringify({
      'provider-signer-a': {
        ...publicAnchor(providerASigner),
        provider_id: 'provider-a',
        producer_id: 'producer-a',
      },
      'provider-signer-b': {
        ...publicAnchor(providerBSigner),
        provider_id: 'provider-b',
        producer_id: 'producer-b',
      },
      ...(duplicateProducer ? {
        'provider-signer-c': {
          ...publicAnchor(providerCSigner),
          provider_id: 'provider-c',
          producer_id: 'producer-a',
        },
      } : {}),
    }),
    TZUYANG_ADDRESS_SOURCE_ROOTS_JSON: JSON.stringify({
      crawl: { kind: 'crawling', path: roots.crawl },
      'provider-a-root': { kind: 'provider', path: roots.providerA },
      'provider-b-root': { kind: 'provider', path: roots.providerB },
      ...(duplicateProducer ? { 'provider-c-root': { kind: 'provider', path: roots.providerC } } : {}),
    }),
  });

  return {
    anchors,
    directory,
    input: {
      anchors,
      candidate,
      now: NOW,
      record_selector_sha256: 'b'.repeat(64),
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
        ...videoArtifact,
      }, ...providers.map((provider) => provider.source)],
    },
  };
}
function cloneInput(input) {
  const { anchors, ...untrusted } = input;
  return { anchors, ...structuredClone(untrusted) };
}
test('uses deterministic JCS ordering and domain-separated envelope bytes', () => {
  assert.equal(canonicalizeIJson({ z: 1, a: ['x', true] }), '{"a":["x",true],"z":1}');
  assert.equal(canonicalEnvelopeBytes('tzudong.address.video-manifest.v2', { b: 1 }).toString('utf8'), 'tzudong.address.video-manifest.v2\n{"b":1}');
});

test('rejects a provider place that differs from the bound candidate', async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.directory, { recursive: true, force: true }));
  const altered = cloneInput(fixture.input);
  altered.candidate.place.road_address = '서울특별시 중구 다른로 1';
  const verified = await verifyAddressEvidenceBundle(altered);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'provider_place_mismatch');
});

test('rejects the same pinned SPKI under two signer labels', async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.directory, { recursive: true, force: true }));
  const shared = generateKeyPairSync('ed25519');
  const sharedAnchor = publicAnchor(shared);
  await assert.rejects(
    loadTrustAnchors({
      TZUYANG_ADDRESS_VIDEO_SIGNERS_JSON: JSON.stringify({ 'video-signer-x': sharedAnchor }),
      TZUYANG_ADDRESS_PROVIDER_SIGNERS_JSON: JSON.stringify({
        'provider-signer-x': { ...sharedAnchor, provider_id: 'provider-x', producer_id: 'producer-x' },
      }),
      TZUYANG_ADDRESS_SOURCE_ROOTS_JSON: JSON.stringify({
        crawl: { kind: 'crawling', path: path.join(fixture.directory, 'crawl') },
      }),
    }),
    (error) => error?.code === 'signer_key_collision',
  );
});


test('verifies exact signed membership and independent provider receipts without network access', async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.directory, { recursive: true, force: true }));
  const verified = await verifyAddressEvidenceBundle(fixture.input);
  assert.equal(verified.ok, true);
  assert.equal(verified.predicate.pass, true);
  assert.deepEqual(verified.predicate.families, ['provider:provider-a', 'provider:provider-b', 'video:transcript']);
  assert.deepEqual(verified.predicate.blocking_risk_flags, []);
  assert.deepEqual(verified.predicate.missing_requirements, []);
  assert.deepEqual(verified.predicate.trust_summary, verified.trust_summary);
  assert.deepEqual(verified.trust_summary, {
    schema_version: 2,
    video_manifest_id: 'manifest-1',
    video_signer_id: 'video-signer-1',
    provider_receipt_count: 2,
    provider_ids: ['provider-a', 'provider-b'],
    provider_signer_ids: ['provider-signer-a', 'provider-signer-b'],
    producer_ids: ['producer-a', 'producer-b'],
    source_ids: ['source-a', 'source-b'],
    raw_artifact_sha256: verified.trust_summary.raw_artifact_sha256,
    envelope_sha256: verified.trust_summary.envelope_sha256,
  });
  assert.equal(Object.isFrozen(verified), true);
  await verified.recheck();
  await verified.close();
});

test('does not accept a self-asserted authentication flag or an altered signature', async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.directory, { recursive: true, force: true }));
  const altered = cloneInput(fixture.input);
  altered.trusted_evidence.providers[0].receipt_sha256 = 'f'.repeat(64);
  altered.authenticated = true;
  const verified = await verifyAddressEvidenceBundle(altered);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'artifact_digest_mismatch');
});

test('rejects a valid extra receipt that duplicates an independence dimension', async (t) => {
  const fixture = await buildFixture({ duplicateProducer: true });
  t.after(async () => rm(fixture.directory, { recursive: true, force: true }));
  const verified = await verifyAddressEvidenceBundle(fixture.input);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'provider_independence_mismatch');
});

test('rejects duplicate JSON keys before detached signature verification', async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.directory, { recursive: true, force: true }));
  const receiptPath = path.join(fixture.directory, 'provider-a', 'receipt-a.json');
  const duplicate = Buffer.from('{"envelope":{},"envelope":{},"envelope_sha256":"a","signer_id":"x","signature_algorithm":"ed25519","signature":"x"}', 'utf8');
  await writeFile(receiptPath, duplicate);
  const altered = cloneInput(fixture.input);
  altered.trusted_evidence.providers[0].receipt_byte_length = duplicate.length;
  altered.trusted_evidence.providers[0].receipt_sha256 = digest(duplicate);
  const verified = await verifyAddressEvidenceBundle(altered);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'duplicate_json_key');
});
