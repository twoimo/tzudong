import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

/** Synthetic pixels and host proof exercise persistence, not image quality. */
export async function thumbnailReleaseFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'thumbnail-publish-ownership-'));
  const webRoot = join(repoRoot, 'apps/web');
  const batchRoot = join(repoRoot, '.omx/artifacts/thumbnail-live-aesthetic/batch-fixture');
  mkdirSync(join(batchRoot, 'generated'), { recursive: true });
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'package.json'), '{}');
  const bytes = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(batchRoot, 'generated/fixture.png'), bytes);
  const manifestPath = join(batchRoot, 'release-candidates.json');
  writeFileSync(manifestPath, JSON.stringify({
    generatedAt: '2026-10-23T00:00:00.000Z',
    eligibility: { providerId: 'local-codex', model: 'gpt-image-2', modelProvenance: 'exact',
      minVisualScore: 90, issueTags: ['none'], batchGate: { passedV1Gate: true } },
    releaseCandidates: [{ id: 'fixture', subjectId: 'fixture',
      imagePath: '.omx/artifacts/thumbnail-live-aesthetic/batch-fixture/generated/fixture.png',
      providerId: 'local-codex', model: 'gpt-image-2', modelProvenance: 'exact', sha256,
      score: 96, issueTags: ['none'], hostPresence: { creator: 'tzuyang', visible: true, evidence: 'synthetic-fixture-only' } }],
  }));
  return { bytes, sha256, options: { repoRoot, webRoot, manifestPath,
    releaseId: '00000000-0000-4000-8000-000000000123', now: new Date('2026-10-23T00:01:00.000Z') },
  cleanup: () => rmSync(repoRoot, { recursive: true, force: true }) };
}
