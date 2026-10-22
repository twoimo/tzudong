import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { parseEvidenceFrame } from '../lib/evidence-engineering/frames';
import { uploadEvidenceWebp, type EvidenceObjectStore } from '../lib/evidence-engineering/upload-evidence-frame';
import { extractCanonicalYouTubeVideoId } from '../lib/youtube-url';

type ReviewedFrame = { restaurant_id: string; source_file: string; frame: unknown };

export async function previewFramePublication(manifestPath: string, sourceDirectory: string) {
  const source = await realpath(sourceDirectory);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { restaurantSourceSha256: string; frames?: ReviewedFrame[] };
  const restaurantBytes = await readFile(resolve(dirname(manifestPath), 'approved-source-rows.json'));
  if (createHash('sha256').update(restaurantBytes).digest('hex') !== manifest.restaurantSourceSha256) throw new Error('restaurant_source_hash_mismatch');
  const restaurants = JSON.parse(restaurantBytes.toString()) as { rows: Array<{ id: string; status: string; youtube_link: string }> };
  const byRestaurant = new Map(restaurants.rows.map((row) => [row.id, row]));
  if (!Array.isArray(manifest.frames) || manifest.frames.length < 1 || manifest.frames.length > 5000) throw new Error('invalid_frame_manifest');
  const seen = new Set<string>();
  const seenKeys = new Set<string>();
  const entries = [];
  for (const item of manifest.frames) {
    if (!/^[a-f0-9-]{36}$/.test(item.restaurant_id) || typeof item.source_file !== 'string') throw new Error('invalid_frame_owner');
    const frame = parseEvidenceFrame(item.frame);
    const restaurant = byRestaurant.get(item.restaurant_id);
    if (!restaurant || restaurant.status !== 'approved' || extractCanonicalYouTubeVideoId(restaurant.youtube_link) !== frame.video_id) throw new Error('frame_restaurant_video_mismatch');
    if (frame.moderation_status !== 'approved' || frame.evidence_level !== 'SOURCE_OBSERVED') throw new Error('frame_not_reviewed');
    if (seen.has(frame.frame_id) || seenKeys.has(frame.storage_object_key)) throw new Error('duplicate_frame');
    seen.add(frame.frame_id); seenKeys.add(frame.storage_object_key);
    const file = await realpath(resolve(source, item.source_file));
    if (!file.startsWith(source + sep)) throw new Error('source_path_outside_root');
    const bytes = await readFile(file);
    // Run exactly the production upload validation during preview too.
    await uploadEvidenceWebp({ videoId: frame.video_id, timestampMs: frame.timestamp_ms, contentSha256: frame.content_sha256, bytes }, { exists: async () => false, put: async () => ({ publicUrl: null }) });
    entries.push({ restaurant_id: item.restaurant_id, frame, file, bytes });
  }
  const digest = createHash('sha256').update(JSON.stringify(entries.map(({ restaurant_id, frame }) => ({ restaurant_id, frame })))).digest('hex');
  return { entries, previewHash: digest };
}

export async function publishFrameFiles(manifestPath: string, sourceDirectory: string, outputDirectory: string, confirmationHash: string) {
  const preview = await previewFramePublication(manifestPath, sourceDirectory);
  if (confirmationHash !== preview.previewHash) throw new Error('publication_confirmation_mismatch');
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const physicalOutput = await realpath(output);
  for (const { frame, bytes } of preview.entries) {
    const file = resolve(output, frame.storage_object_key);
    if (!file.startsWith(output + sep)) throw new Error('output_path_outside_root');
    await mkdir(dirname(file), { recursive: true });
    if (!(await realpath(dirname(file))).startsWith(physicalOutput + sep)) throw new Error('output_symlink_outside_root');
    let existing: Buffer | null = null;
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error('output_file_is_symlink');
      existing = await readFile(file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (existing) {
      if (!existing.equals(bytes)) throw new Error('immutable_frame_collision');
      continue;
    }
    const store: EvidenceObjectStore = {
      exists: async () => false,
      put: async (_key, body) => { await writeFile(file, body, { flag: 'wx' }); return { publicUrl: null }; },
    };
    await uploadEvidenceWebp({ videoId: frame.video_id, timestampMs: frame.timestamp_ms, contentSha256: frame.content_sha256, bytes }, store);
  }
  return { previewHash: preview.previewHash, frames: preview.entries.map(({ restaurant_id, frame }) => ({ restaurant_id, ...frame })) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (key: string) => args[args.indexOf(key) + 1];
  if (!args.includes('--manifest') || !args.includes('--source-dir')) throw new Error('manifest_and_source_required');
  const result = args.includes('--apply')
    ? await publishFrameFiles(arg('--manifest'), arg('--source-dir'), args.includes('--output-dir') ? arg('--output-dir') : 'public/evidence-frames', arg('--confirm'))
    : await previewFramePublication(arg('--manifest'), arg('--source-dir'));
  console.log(JSON.stringify({ previewHash: result.previewHash, frames: 'frames' in result ? result.frames.length : result.entries.length, applied: args.includes('--apply') }));
}
