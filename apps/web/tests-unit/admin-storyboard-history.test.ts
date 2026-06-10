import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { persistLocalStoryboardHistory } from '../lib/admin/storyboard/history';
import { STORYBOARD_GENERATED_IMAGE_TRUST_POLICY } from '../lib/admin/storyboard/image-trust';
import type { StoryboardGenerationResult } from '../lib/admin/storyboard/types';

function buildResult(): StoryboardGenerationResult {
  const trustedPrompt = [
    'Create exactly one full-bleed 16:9 single-scene storyboard cut image for a Korean food-travel / mukbang planning board.',
    'Style: cinematic hand-drawn food-storyboard keyframe, clean black pencil lines.',
  ].join('\n');

  return {
    generatedAt: '2026-06-05T08:15:00.000Z',
    mode: 'backend_agent_local_adapter',
    request: {
      prompt: '실제 히트맵 기반 스토리보드',
      tone: 'energetic',
      targetLengthMinutes: 14,
      sourceLimit: 40,
      segmentCount: 4,
      includeProductionNotes: true,
      generationMode: 'backend_agent',
    },
    sourceSummary: {
      heatmapDirectory: 'local',
      scannedFiles: 1,
      usableSources: 1,
      selectedSources: 1,
      totalMarkers: 1,
      topReplayScore: 1,
      isFallbackData: false,
      fallbackReason: null,
      dataModeLabel: '실제 히트맵 모드',
    },
    storyboard: {
      title: '히스토리 <정화> & 테스트',
      logline: '신뢰 이미지 저장만 허용',
      operatorBrief: '테스트',
      scenes: [
        {
          sceneNo: 1,
          title: '오염 컷',
          durationSec: 60,
          operatorIntent: '썸네일 생성기 오염 방지',
          visualDirection: '잘못된 이미지가 있으면 제거',
          hostBeat: '테스트',
          captionIdea: '테스트',
          heatmapEvidence: {
            videoId: 'v1',
            youtubeLink: 'https://www.youtube.com/watch?v=v1',
            peakTime: '01:00',
            replayScore: 0.9,
            reason: '테스트',
          },
          productionChecklist: [],
          generatedImage: {
            dataUrl: '/qa-history/storyboard/generated/2026-06-04T15-52-24-703Z/cut-01.png',
            mime: 'image/png',
            providerId: 'local-codex',
            model: 'gpt-image-2',
            prompt: 'Persisted local Codex GPT Image 2 storyboard cut image for CUT 1',
            generatedAt: '2026-06-05T08:15:00.000Z',
            warnings: [],
          },
        },
        {
          sceneNo: 2,
          title: '신뢰 컷',
          durationSec: 60,
          operatorIntent: '스토리보드 컷 유지',
          visualDirection: '신뢰 가능한 스토리보드 이미지',
          hostBeat: '테스트',
          captionIdea: '테스트',
          heatmapEvidence: {
            videoId: 'v2',
            youtubeLink: 'https://www.youtube.com/watch?v=v2',
            peakTime: '02:00',
            replayScore: 0.95,
            reason: '테스트',
          },
          productionChecklist: [],
          generatedImage: {
            dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            mime: 'image/png',
            providerId: 'local-codex',
            trustPolicy: STORYBOARD_GENERATED_IMAGE_TRUST_POLICY,
            model: 'gpt-image-2',
            prompt: trustedPrompt,
            generatedAt: '2026-06-05T08:15:00.000Z',
            warnings: [],
            provenance: {
              providerId: 'local-codex',
              authMode: 'codex_oauth',
              endpoint: 'https://chatgpt.com/backend-api/codex/responses',
              agentModel: 'gpt-5.5',
              requestToolType: 'image_generation',
              requestToolModel: 'gpt-image-2',
              model: 'gpt-image-2',
              modelProvenance: 'exact',
              responseId: 'resp_history_test',
              imageCallId: 'ig_history_test',
              imageItemCount: 1,
              generatedImageItemTypes: ['image_generation_call'],
              rawImageItemTypes: ['image_generation_call'],
              requestHash: 'a'.repeat(64),
              responseHash: 'b'.repeat(64),
              hasOpenAIAPIKey: false,
              generatedAt: '2026-06-05T08:15:00.000Z',
            },
          },
        },
      ],
      exportMarkdown: '# storyboard',
    },
    ahp: {
      targetScore: 99.8,
      score: 99.8,
      status: 'passed',
      committee: [],
      criteria: [],
      iterationBacklog: [],
    },
    backendAnalysis: {
      reusedLogic: [],
      localGapsHandled: [],
    },
  };
}

describe('admin storyboard local history persistence', () => {
  test('is disabled unless explicitly enabled outside production', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'storyboard-history-disabled-'));
    try {
      const result = await persistLocalStoryboardHistory(buildResult(), { NODE_ENV: 'development' }, { historyDir: dir });
      expect(result.persisted).toBe(false);
      expect(result.reason).toBe('disabled');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('writes only sanitized trusted-image storyboard history in local development', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'storyboard-history-enabled-'));
    try {
      const result = await persistLocalStoryboardHistory(
        buildResult(),
        { NODE_ENV: 'development', STORYBOARD_LOCAL_HISTORY_WRITE: '1' },
        { historyDir: dir },
      );
      expect(result.persisted).toBe(true);
      expect(result.trustedImages).toBe(1);

      const latest = JSON.parse(readFileSync(join(dir, 'latest-real-data.json'), 'utf8')) as {
        result: StoryboardGenerationResult;
      };
      expect(latest.result.storyboard.scenes[0].generatedImage).toBeUndefined();
      expect(latest.result.storyboard.scenes[1].generatedImage?.model).toBe('gpt-image-2');
      expect(latest.result.storyboard.scenes[1].generatedImage?.provenance).toMatchObject({
        providerId: 'local-codex',
        authMode: 'codex_oauth',
        requestToolType: 'image_generation',
        requestToolModel: 'gpt-image-2',
        model: 'gpt-image-2',
        modelProvenance: 'exact',
        responseId: 'resp_history_test',
        imageCallId: 'ig_history_test',
        hasOpenAIAPIKey: false,
      });
      const history = JSON.parse(readFileSync(join(dir, 'history-real-data.json'), 'utf8')) as { runs: Array<{ trustedImages: number }> };
      expect(history.runs[0].trustedImages).toBe(1);
      const html = readFileSync(join(dir, '2026-06-05T08-15-00-000Z.html'), 'utf8');
      expect(html).toContain('히스토리 &lt;정화&gt; &amp; 테스트');
      expect(html).not.toContain('히스토리 <정화> & 테스트');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
