import { afterAll, describe, expect, mock, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const heatmapTestVideos = [
  {
    videoId: 'video-peak-1',
    title: '테스트 피크 영상 A',
    thumbnail: 'https://example.com/thumbnail-a.jpg',
    publishedAt: '2026-01-01T00:00:00.000Z',
    totalViews: 12500,
    duration: '04:00',
    heatmapData: [],
    peakSegment: { start: 20, end: 35, engagement: 0.91 },
    lowestSegment: { start: 60, end: 72, engagement: 0.11 },
    weeklyChange: 22.4,
    analysis: {
      peakReason: '클로징 컷에서 반응이 높았습니다.',
      lowestReason: '초반 오프닝이 긴 구간.',
      overallSummary: '테스트 요약',
      keywords: ['클로징', '반응'],
    },
  },
  {
    videoId: 'video-peak-2',
    title: '테스트 피크 영상 B',
    thumbnail: null,
    publishedAt: '2026-01-02T00:00:00.000Z',
    totalViews: 9800,
    duration: '03:15',
    heatmapData: [],
    peakSegment: { start: 10, end: 22, engagement: 0.8 },
    lowestSegment: { start: 70, end: 82, engagement: 0.2 },
    weeklyChange: null,
    analysis: {
      peakReason: '클로징 동작이 반복 조회를 유도했습니다.',
      lowestReason: '초반 텍스트 밀도가 낮았습니다.',
      overallSummary: '두 번째 테스트',
      keywords: ['클로징', '리액션'],
    },
  },
];

mock.module('@/lib/insight/heatmap', () => ({
  getAdminInsightHeatmap: async () => ({
    asOf: '2026-02-27T00:00:00.000Z',
    videos: heatmapTestVideos,
  }),
}));

type EnvSnapshot = Record<string, string | undefined>;

const TRACKED_ENV_VARS = [
  'INSIGHT_FRAME_CAPTION_BASE_PATH',
  'INSIGHT_GDRIVE_FRAME_CAPTION_PATH',
  'GDRIVE_REMOTE_PATH',
] as const;

function withEnv(env: Partial<Record<(typeof TRACKED_ENV_VARS)[number], string | undefined>>) {
  const snapshot: EnvSnapshot = {};
  for (const key of TRACKED_ENV_VARS) {
    snapshot[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, prev] of Object.entries(snapshot)) {
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  };
}

afterAll(() => {
  mock.restore();
});

describe('insight peak-frame local response', () => {
  test('routes peak-frame query to local heatmap with caption evidence', async () => {
    const basePath = await mkdtemp(join(tmpdir(), 'insight-peak-frame-'));
    const restoreEnv = withEnv({ INSIGHT_FRAME_CAPTION_BASE_PATH: basePath });
    const payloadPath = join(basePath, `${heatmapTestVideos[0].videoId}.jsonl`);
    await writeFile(payloadPath, [
      JSON.stringify({
        video_id: heatmapTestVideos[0].videoId,
        recollect_id: 0,
        start_sec: 40,
        end_sec: 58,
        duration: 120,
        rank: 2,
        raw_caption: '첫 번째 valid caption text',
        file_names: ['https://example.com/frame-peak-1-a.jpg', 'https://example.com/frame-peak-1-b.jpg'],
      }),
      '{ malformed-json-line',
      JSON.stringify({
        video_id: heatmapTestVideos[0].videoId,
        recollect_id: 0,
        start_sec: 60,
        end_sec: 72,
        duration: 120,
        rank: 1,
        parsed_json: {
          chronological_analysis: '두 번째 valid parsed_json caption text',
        },
      }),
      JSON.stringify({
        video_id: 'other-video',
        start_sec: 5,
        end_sec: 12,
        duration: 20,
        raw_caption: 'other video evidence should be filtered out',
      }),
    ].join('\n'));

    let restoreImportEnv = () => {};
    try {
      const { answerAdminInsightChat } = await import('@/lib/insight/chat?peak-frame-test-local-evidence');
      restoreImportEnv = restoreEnv;
      const response = await answerAdminInsightChat('영상 피크 프레임 분석해줘');

      expect(response.meta?.source).toBe('local');
      expect(response.visualComponent).toBe('heatmap');
      expect(response.meta?.toolTrace?.includes('local:peak-frame')).toBe(true);
      expect(response.sources?.length).toBeGreaterThan(0);
      const sourceText = response.sources?.map((source) => source.text).join('\n') || '';
      expect(sourceText).toContain('첫 번째 valid caption text');
      expect(sourceText).toContain('두 번째 valid parsed_json caption text');
      const frameLinks = response.sources?.map((source) => source.frameLink).filter(Boolean);
      const assetLinks = response.sources?.map((source) => source.assetLink).filter(Boolean);
      expect(frameLinks?.length).toBeGreaterThan(0);
      expect(assetLinks?.length).toBeGreaterThan(0);
      expect(frameLinks?.join('|')).toContain('https://example.com/frame-peak-1-a.jpg');
      expect(assetLinks?.join('|')).toContain('https://example.com/frame-peak-1-b.jpg');
      expect(sourceText).not.toContain('malformed-json-line');
      expect(sourceText).not.toContain('other video evidence');
    } finally {
      await rm(basePath, { recursive: true, force: true });
      restoreImportEnv();
    }
  });

  test('returns gdrive-aware hint when frame-caption path is missing', async () => {
    const basePath = join(tmpdir(), 'insight-peak-frame-missing');
    const restoreEnv = withEnv({
      INSIGHT_FRAME_CAPTION_BASE_PATH: basePath,
      INSIGHT_GDRIVE_FRAME_CAPTION_PATH: 'gs://tzuyang-frames/peak',
    });

    const { answerAdminInsightChat } = await import('@/lib/insight/chat?peak-frame-test-gdrive-hint');

    try {
      const response = await answerAdminInsightChat('피크 프레임 확인해줘');

      expect(response.meta?.source).toBe('local');
      expect(response.visualComponent).toBe('heatmap');
      expect(response.sources?.length).toBe(0);
      expect(response.meta?.toolTrace?.includes('local:peak-frame')).toBe(true);
      const hints = response.meta?.systemStatusHints || [];
      expect(hints.join('|')).toContain('피크 프레임 JSONL을 찾지 못해 증거 첨부가 제한됩니다. GDrive 경로를 확인하세요: gs://tzuyang-frames/peak');
    } finally {
      restoreEnv();
    }
  });
});
