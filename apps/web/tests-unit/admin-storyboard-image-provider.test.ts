import { describe, expect, test } from 'bun:test';

import {
  buildStoryboardSceneImagePrompt,
  generateStoryboardSceneImages,
  getStoryboardImageProviderAvailability,
  resolveLocalCodexStoryboardModel,
} from '../lib/admin/storyboard/image-provider';
import {
  countTrustedStoryboardGeneratedImages,
  getTrustedStoryboardGeneratedImage,
  isTrustedStoryboardGeneratedImage,
  STORYBOARD_GENERATED_IMAGE_TRUST_POLICY,
  stripUntrustedStoryboardGeneratedImages,
} from '../lib/admin/storyboard/image-trust';
import type { StoryboardGenerateRequest, StoryboardScene } from '../lib/admin/storyboard/types';

const request: StoryboardGenerateRequest = {
  prompt: '실제 히트맵 기반으로 2x2 스토리보드 이미지를 만들어줘.',
  tone: 'energetic',
  targetLengthMinutes: 16,
  sourceLimit: 40,
  segmentCount: 4,
  includeProductionNotes: true,
  generationMode: 'backend_agent',
};

const scene: StoryboardScene = {
  sceneNo: 1,
  title: '오프닝 훅',
  durationSec: 240,
  operatorIntent: '강한 첫 입 리액션으로 초반 이탈을 줄입니다.',
  visualDirection: '뜨거운 한 그릇과 젓가락으로 들어 올리는 면을 스케치 컷으로 크게 보여줍니다.',
  hostBeat: '와, 이건 바로 다시 보게 되는 맛이에요.',
  captionIdea: '첫 입부터 터지는 피크',
  heatmapEvidence: {
    videoId: '-D43ezc57z8',
    youtubeLink: 'https://www.youtube.com/watch?v=-D43ezc57z8',
    peakTime: '06:57',
    replayScore: 1,
    reason: 'Most replayed / 리플레이 강도 100.0% 구간을 참조',
  },
  productionChecklist: ['음식 김/윤기 컷', '첫 표정 클로즈업'],
};

describe('admin storyboard image provider', () => {
  test('uses the local Codex GPT Image 2 gate instead of mock image generation', () => {
    const env = {
      ALLOW_LOCAL_CLI_THUMBNAIL: 'true',
      STORYBOARD_LOCAL_CODEX_COMMAND: '/tmp/codex-imagegen-storyboard-provider.py',
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
    } as NodeJS.ProcessEnv;

    expect(resolveLocalCodexStoryboardModel(env)).toBe('gpt-image-2');
    expect(getStoryboardImageProviderAvailability(env)).toMatchObject({
      available: true,
      reason: 'local_codex_command_configured',
      command: '/tmp/codex-imagegen-storyboard-provider.py',
      model: 'gpt-image-2',
      target: { width: 1280, height: 720, aspectRatio: '16:9' },
    });
    expect(getStoryboardImageProviderAvailability({} as NodeJS.ProcessEnv)).toMatchObject({
      available: false,
      reason: 'local_codex_gate_disabled',
      model: 'gpt-image-2',
    });
  });

  test('builds a storyboard-panel prompt that forbids real likenesses and baked text', () => {
    const prompt = buildStoryboardSceneImagePrompt(scene, {
      title: '실데이터 스토리보드',
      logline: '반복시청 피크 기반 4컷 이미지',
      request,
    });

    expect(prompt).toContain('Create exactly one 16:9 raster storyboard panel');
    expect(prompt).toContain('CUT 1');
    expect(prompt).toContain('Visual direction:');
    expect(prompt).toContain('do not recreate a real person likeness');
    expect(prompt).toContain('No logos, watermarks');
    expect(prompt).toContain('do not render readable text');
    expect(prompt).toContain('06:57');
  });

  test('runs an opt-in local Codex storyboard wrapper and returns generated image data URLs', async () => {
    const localScript = `
      const fs = require("node:fs");
      const args = process.argv.slice(2);
      const valueAfter = (name) => args[args.indexOf(name) + 1];
      const prompt = fs.readFileSync(valueAfter("--prompt-file"), "utf8");
      fs.writeFileSync(valueAfter("--json-output"), JSON.stringify({
        mime: "image/png",
        base64: "iVBORw0KGgo=",
        model: valueAfter("--model"),
        warnings: [prompt.includes("storyboard panel") ? "storyboard_prompt_received" : "storyboard_prompt_missing"],
      }));
    `;
    const env = {
      ALLOW_LOCAL_CLI_STORYBOARD_IMAGES: 'true',
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_ARGS_JSON: JSON.stringify([
        '-e',
        localScript,
        '--',
        '--prompt-file',
        '{promptFile}',
        '--json-output',
        '{outputJsonFile}',
        '--model',
        '{model}',
      ]),
    } as NodeJS.ProcessEnv;

    const result = await generateStoryboardSceneImages([scene], {
      title: '실데이터 스토리보드',
      logline: '반복시청 피크 기반 4컷 이미지',
      request,
    }, env);

    expect(result).toHaveLength(1);
    expect(result[0].sceneNo).toBe(1);
    expect(result[0].image.providerId).toBe('local-codex');
    expect(result[0].image.model).toBe('gpt-image-2');
    expect(result[0].image.trustPolicy).toBe(STORYBOARD_GENERATED_IMAGE_TRUST_POLICY);
    expect(result[0].image.mime).toBe('image/png');
    expect(result[0].image.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(result[0].image.warnings.join('\n')).toContain('local_codex_provider');
    expect(result[0].image.warnings.join('\n')).toContain('storyboard_prompt_received');
  });

  test('rejects local Codex JSON paths that escape the temporary work directory', async () => {
    const localScript = `
      const fs = require("node:fs");
      const path = require("node:path");
      const args = process.argv.slice(2);
      const valueAfter = (name) => args[args.indexOf(name) + 1];
      fs.writeFileSync(
        path.join(process.cwd(), "..", "storyboard-secret.png"),
        Buffer.from("iVBORw0KGgo=", "base64"),
      );
      fs.writeFileSync(valueAfter("--json-output"), JSON.stringify({
        mime: "image/png",
        path: "../storyboard-secret.png",
        model: valueAfter("--model"),
      }));
    `;
    const env = {
      ALLOW_LOCAL_CLI_STORYBOARD_IMAGES: 'true',
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_ARGS_JSON: JSON.stringify([
        '-e',
        localScript,
        '--',
        '--json-output',
        '{outputJsonFile}',
        '--model',
        '{model}',
      ]),
    } as NodeJS.ProcessEnv;

    await expect(generateStoryboardSceneImages([scene], {
      title: '실데이터 스토리보드',
      logline: '반복시청 피크 기반 4컷 이미지',
      request,
    }, env)).rejects.toThrow(/Local Codex 출력에서 스토리보드 이미지 데이터를 찾지 못했습니다/);
  });

  test('trusts only storyboard-panel GPT Image 2 metadata and strips thumbnail-like history images', () => {
    const prompt = buildStoryboardSceneImagePrompt(scene, {
      title: '실데이터 스토리보드',
      logline: '반복시청 피크 기반 4컷 이미지',
      request,
    });
    const trustedImage = {
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      mime: 'image/png' as const,
      providerId: 'local-codex' as const,
      trustPolicy: STORYBOARD_GENERATED_IMAGE_TRUST_POLICY,
      model: 'gpt-image-2',
      prompt,
      generatedAt: '2026-06-05T00:00:00.000Z',
      warnings: [],
    };
    const storyboardThumbnailCandidateImage = {
      ...trustedImage,
      prompt: `${prompt}\nOperator intent: 가장 강한 장면을 새 영상의 대표 썸네일 후보로 전환합니다.`,
    };
    const thumbnailLikeImage = {
      ...trustedImage,
      trustPolicy: undefined,
      prompt: 'Create a YouTube thumbnail for spicy noodles.',
    };
    const missingAttestationImage = {
      ...trustedImage,
      trustPolicy: undefined,
    };
    const legacyPersistedStoryboardImage = {
      ...trustedImage,
      trustPolicy: undefined,
      dataUrl: '/qa-history/storyboard/generated/2026-06-04T15-52-24-703Z/cut-01.png',
      prompt: 'Persisted local Codex GPT Image 2 storyboard panel for CUT 1',
      warnings: [
        'local_codex_provider: generated via local Codex OAuth provider and persisted for admin storyboard display.',
      ],
    };
    const arbitraryHistoryImage = {
      ...legacyPersistedStoryboardImage,
      prompt: 'Persisted local Codex GPT Image 2 storyboard panel without cut metadata',
      warnings: [],
    };

    expect(isTrustedStoryboardGeneratedImage(trustedImage)).toBe(true);
    expect(getTrustedStoryboardGeneratedImage(trustedImage)).toBe(trustedImage);
    expect(isTrustedStoryboardGeneratedImage(storyboardThumbnailCandidateImage)).toBe(true);
    expect(isTrustedStoryboardGeneratedImage(thumbnailLikeImage)).toBe(false);
    expect(isTrustedStoryboardGeneratedImage(missingAttestationImage)).toBe(false);
    expect(isTrustedStoryboardGeneratedImage(legacyPersistedStoryboardImage)).toBe(true);
    expect(isTrustedStoryboardGeneratedImage(arbitraryHistoryImage)).toBe(false);

    const pollutedResult = {
      generatedAt: '2026-06-05T00:00:00.000Z',
      mode: 'backend_agent_local_adapter' as const,
      request,
      sourceSummary: {
        heatmapDirectory: 'local',
        scannedFiles: 1,
        usableSources: 1,
        selectedSources: 1,
        totalMarkers: 1,
        topReplayScore: 1,
        isFallbackData: false,
        fallbackReason: null,
        dataModeLabel: '로컬 히트맵 모드',
      },
      storyboard: {
        title: '스토리보드',
        logline: '테스트',
        operatorBrief: '테스트',
        scenes: [
          { ...scene, generatedImage: thumbnailLikeImage },
          { ...scene, sceneNo: 2, generatedImage: legacyPersistedStoryboardImage },
          { ...scene, sceneNo: 3, generatedImage: trustedImage },
        ],
        exportMarkdown: '',
      },
      ahp: {
        targetScore: 99.8,
        score: 99.8,
        status: 'passed' as const,
        committee: [],
        criteria: [],
        iterationBacklog: [],
      },
      backendAnalysis: {
        reusedLogic: [],
        localGapsHandled: [],
      },
    };

    const sanitized = stripUntrustedStoryboardGeneratedImages(pollutedResult);
    expect(countTrustedStoryboardGeneratedImages(sanitized.storyboard.scenes)).toBe(2);
    expect(sanitized.storyboard.scenes[0].generatedImage).toBeUndefined();
    expect(sanitized.storyboard.scenes[1].generatedImage).toBe(legacyPersistedStoryboardImage);
    expect(sanitized.storyboard.scenes[2].generatedImage).toBe(trustedImage);
  });
});
