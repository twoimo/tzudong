import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildEvidenceFrame, unionApprovedEvidenceFrames } from '../lib/evidence-engineering/frames';
import { publicReviewedVideoFrames } from '../components/restaurant/RestaurantEvidenceCarousel';
import { collectRestaurantMergedMedia } from '../lib/restaurant-merged-media';
import type { Restaurant } from '../types/restaurant';
const reviewed = JSON.parse(readFileSync(resolve(import.meta.dir, '../../../docs/evidence/marker-evidence-live-20261021-v1/reviewed-frames.json'), 'utf8'));
const frame = buildEvidenceFrame(reviewed.frames[0].frame);

test('frame conflicts fail closed at both public read boundaries while strict publication validation still rejects', () => {
  for (const other of [
    buildEvidenceFrame({ ...frame, detected_shop_name: '충돌 이름' }),
    buildEvidenceFrame({ ...frame, moderation_status: 'rejected' }),
    buildEvidenceFrame({ ...frame, frame_id: 'same-key-different-frame' }),
  ]) {
    expect(() => unionApprovedEvidenceFrames([[frame], [other]])).toThrow();
    expect(publicReviewedVideoFrames([[frame], [other]])).toEqual([]);
    const media = collectRestaurantMergedMedia({ id: 'conflict-owner', name: '충돌 식당', youtube_link: frame.youtube_seek_url,
      evidence_frames: [frame], mergedEvidenceFrames: [other] } as unknown as Restaurant);
    expect(media.evidenceFrames).toEqual([]);
    expect(media.youtubeLinks).toContain(frame.youtube_seek_url);
  }
});
