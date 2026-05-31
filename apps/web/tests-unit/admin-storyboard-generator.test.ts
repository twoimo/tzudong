import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function withHeatmapFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tzudong-storyboard-heatmap-'));
  const row = {
    youtube_link: 'https://www.youtube.com/watch?v=fixture12345',
    channel_name: 'tzuyang',
    video_id: 'fixture12345',
    duration: 900,
    interaction_data: [
      { startMillis: '0', durationMillis: '10000', intensityScoreNormalized: 0.2, formatted_time: '00:00' },
      { startMillis: '120000', durationMillis: '10000', intensityScoreNormalized: 1, formatted_time: '02:00' },
      { startMillis: '240000', durationMillis: '10000', intensityScoreNormalized: 0.94, formatted_time: '04:00' },
    ],
    most_replayed_markers: [
      { startMillis: 115000, endMillis: 130000, peakMillis: 120000, label: '가장 많이 다시 본 장면' },
      { startMillis: 235000, endMillis: 250000, peakMillis: 240000, label: '상위 리플레이 구간' },
    ],
    status: 'success',
    collected_at: '2026-01-01T00:00:00.000Z',
  };
  for (let index = 0; index < 100; index += 1) {
    const videoId = `fixture${String(index).padStart(5, '0')}`;
    writeFileSync(
      path.join(dir, `${videoId}.jsonl`),
      `${JSON.stringify({ ...row, video_id: videoId, youtube_link: `https://www.youtube.com/watch?v=${videoId}` })}\n`,
      'utf8',
    );
  }

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('admin storyboard generator', () => {
  test('builds a local-first storyboard from explicit heatmap most-replayed markers', async () => {
    const fixture = withHeatmapFixture();
    const previous = process.env.TZUYANG_HEATMAP_DIR;
    process.env.TZUYANG_HEATMAP_DIR = fixture.dir;

    try {
      const { generateLocalStoryboard } = await import(`../lib/admin/storyboard/generator.ts?case=${Math.random()}`);
      const result = generateLocalStoryboard({
        prompt: '매운 음식 첫 입 리액션 중심으로 다음 영상안을 만들어줘.',
        tone: 'energetic',
        targetLengthMinutes: 12,
        sourceLimit: 10,
        segmentCount: 7,
        includeProductionNotes: true,
      });

      expect(result.mode).toBe('local_heatmap_fixture');
      expect(result.sourceSummary.scannedFiles).toBe(100);
      expect(result.sourceSummary.usableSources).toBe(100);
      expect(result.sourceSummary.totalMarkers).toBe(20);
      expect(result.sourceSummary.topReplayScore).toBe(1);
      expect(result.storyboard.scenes).toHaveLength(7);
      expect(result.storyboard.scenes[0].heatmapEvidence.videoId).toBe('fixture00000');
      expect(result.storyboard.scenes[0].heatmapEvidence.peakTime).toBe('02:00');
      expect(result.storyboard.exportMarkdown).toContain('fixture00000');
      expect(result.storyboard.exportMarkdown).toContain('히트맵 근거');
      expect(result.ahp.score).toBeGreaterThanOrEqual(99.8);
      expect(JSON.stringify(result)).toContain('backend/storyboard-agent');
    } finally {
      if (previous === undefined) {
        delete process.env.TZUYANG_HEATMAP_DIR;
      } else {
        process.env.TZUYANG_HEATMAP_DIR = previous;
      }
      fixture.cleanup();
    }
  });

  test('honors the production notes toggle for generated scene checklists', async () => {
    const fixture = withHeatmapFixture();
    const previous = process.env.TZUYANG_HEATMAP_DIR;
    process.env.TZUYANG_HEATMAP_DIR = fixture.dir;

    try {
      const { generateLocalStoryboard } = await import(`../lib/admin/storyboard/generator.ts?case=${Math.random()}`);
      const result = generateLocalStoryboard({
        prompt: '소리와 질감 중심으로 차분한 다음 영상안을 만들어줘.',
        tone: 'comfort',
        targetLengthMinutes: 18,
        sourceLimit: 10,
        segmentCount: 6,
        includeProductionNotes: false,
      });

      expect(result.storyboard.scenes).toHaveLength(6);
      expect(result.storyboard.scenes.every((scene) => scene.productionChecklist.length === 0)).toBe(true);
      expect(result.request.includeProductionNotes).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.TZUYANG_HEATMAP_DIR;
      } else {
        process.env.TZUYANG_HEATMAP_DIR = previous;
      }
      fixture.cleanup();
    }
  });
});
