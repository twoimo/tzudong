import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildEvidenceFrame } from '../lib/evidence-engineering/frames';
import { previewFramePublication, publishFrameFiles } from '../scripts/publish-evidence-frames';
import { buildPublicPopularity } from '../scripts/build-public-popularity';
import publication from '../lib/evidence-engineering/public-popularity-publication.json';
import { wrapMarkerWithPopularityTier } from '../lib/evidence-engineering/popularity-marker';
import { buildOverseasMarkerHtml } from '../lib/overseas-map-marker-helpers';

const cleanups: string[] = [];
afterEach(async () => { for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true }); });
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tzudong-publication-test-')); cleanups.push(root);
  const source = join(root, 'source'); const output = join(root, 'public'); await mkdir(source);
  const reviewed = JSON.parse(await readFile(resolve(import.meta.dir, '../../../docs/evidence/marker-evidence-live-20261021-v1/reviewed-frames.json'), 'utf8'));
  const first = reviewed.frames[0];
  const bytes = await readFile(resolve(import.meta.dir, '../public/evidence-frames', first.frame.storage_object_key));
  await writeFile(join(source, 'frame.webp'), bytes);
  const restaurantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const frame = buildEvidenceFrame({ ...first.frame, frame_id: 'test-frame' });
  const restaurantBytes = Buffer.from(JSON.stringify({ rows: [{ id: restaurantId, status: 'approved', youtube_link: `https://www.youtube.com/watch?v=${frame.video_id}` }] }));
  await writeFile(join(root, 'approved-source-rows.json'), restaurantBytes);
  const manifest = { restaurantSourceSha256: sha(restaurantBytes), frames: [{ restaurant_id: restaurantId, source_file: 'frame.webp', frame: { ...frame } }] };
  const path = join(root, 'manifest.json'); await writeFile(path, JSON.stringify(manifest));
  return { root, source, output, bytes, frame, manifest, path };
}

describe('reviewed evidence publication', () => {
  test('publishes hash-verified WebP idempotently and refuses a wrong confirmation or immutable collision', async () => {
    const f = await fixture(); const preview = await previewFramePublication(f.path, f.source);
    await expect(publishFrameFiles(f.path, f.source, f.output, 'wrong')).rejects.toThrow('publication_confirmation_mismatch');
    await publishFrameFiles(f.path, f.source, f.output, preview.previewHash);
    const target = join(f.output, f.frame.storage_object_key);
    expect(await readFile(target)).toEqual(f.bytes);
    await publishFrameFiles(f.path, f.source, f.output, preview.previewHash);
    await writeFile(target, 'collision');
    await expect(publishFrameFiles(f.path, f.source, f.output, preview.previewHash)).rejects.toThrow('immutable_frame_collision');
  });

  test('rejects unreviewed frames, altered bytes, source traversal and mismatched restaurant videos', async () => {
    const f = await fixture();
    f.manifest.frames[0].frame.moderation_status = 'pending'; await writeFile(f.path, JSON.stringify(f.manifest));
    await expect(previewFramePublication(f.path, f.source)).rejects.toThrow('frame_not_reviewed');
    f.manifest.frames[0].frame.moderation_status = 'approved';
    f.manifest.frames[0].frame.video_id = 'abc123DEF45';
    f.manifest.frames[0].frame = buildEvidenceFrame(f.manifest.frames[0].frame); await writeFile(f.path, JSON.stringify(f.manifest));
    await expect(previewFramePublication(f.path, f.source)).rejects.toThrow('frame_restaurant_video_mismatch');
    f.manifest.frames[0].frame = f.frame; f.manifest.frames[0].source_file = '../outside.webp';
    await writeFile(join(f.root, 'outside.webp'), f.bytes); await writeFile(f.path, JSON.stringify(f.manifest));
    await expect(previewFramePublication(f.path, f.source)).rejects.toThrow('source_path_outside_root');
    f.manifest.frames[0].source_file = 'frame.webp'; await writeFile(f.path, JSON.stringify(f.manifest)); await writeFile(join(f.source, 'frame.webp'), Buffer.concat([f.bytes, Buffer.from([1])]));
    await expect(previewFramePublication(f.path, f.source)).rejects.toThrow('content_hash_mismatch');
  });

  test('refuses publication through an output symlink', async () => {
    const f = await fixture(); const preview = await previewFramePublication(f.path, f.source);
    const outside = join(f.root, 'outside'); await mkdir(outside); await mkdir(f.output);
    await symlink(outside, dirname(join(f.output, f.frame.storage_object_key)), 'dir');
    await expect(publishFrameFiles(f.path, f.source, f.output, preview.previewHash)).rejects.toThrow('output_symlink_outside_root');
  });
});

describe('actual public popularity cohort', () => {
  test('reproduces every published member from the frozen public business rows and observed video metrics', async () => {
    const evidence = resolve(import.meta.dir, '../../../docs/evidence/marker-evidence-live-20261021-v1');
    const result = await buildPublicPopularity(join(evidence, 'approved-source-rows.json'), join(evidence, 'video-metrics-source.json'), publication.sourceRevision!);
    // Preserve the frozen v1 artifact while checking every cohort field under
    // the builder's reviewed v2 input policy.
    expect(result.publication).toEqual({ ...publication, publicationVersion: 'video-views-20261023-v2' });
    expect(result.evidence.thresholds.every((c) => c.knownGroups > 0 && c.fireAt! > 0)).toBe(true);
    const fire = publication.entries.find((e) => e.tier === 'fire')!;
    const domestic = wrapMarkerWithPopularityTier('<span>pin</span>', fire.tier as 'fire');
    const overseas = buildOverseasMarkerHtml({ imagePath: '/images/maker-images/webp/asian.webp', name: 'actual cohort marker', popularityTier: fire.tier });
    for (const html of [domestic, overseas]) {
      expect(html.match(/class="tz-popularity-flame"/g)).toHaveLength(1);
      expect(html).toContain('tz-popularity-flame-outer');
      expect(html).toContain('fill: #e10600');
      expect(html).not.toContain('tz-popularity-pulse');
      expect(html).not.toContain('data-flame-count');
      expect(html).toContain('data-popularity-tier="fire"');
      expect(html).not.toContain('<canvas');
    }
    expect(wrapMarkerWithPopularityTier('<span>pin</span>', 'standard')).not.toContain('<svg');
  });
});
