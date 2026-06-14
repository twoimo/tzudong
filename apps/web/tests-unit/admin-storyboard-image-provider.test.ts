import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildStoryboardSceneImagePrompt,
  generateStoryboardSceneImages,
  getStoryboardImageProviderAvailability,
  resolveLocalCodexStoryboardModel,
} from '../lib/admin/storyboard/image-provider';
import {
  isExactStoryboardGptImage2ProviderPayload,
  isStoryboardImageProviderReady,
  mapStoryboardImageProviderReadiness,
} from '../lib/admin/storyboard/image-provider-readiness';
import {
  countTrustedStoryboardGeneratedImages,
  getTrustedStoryboardGeneratedImage,
  isExactStoryboardGeneratedImageProvenance,
  isTrustedStoryboardGeneratedImage,
  STORYBOARD_GENERATED_IMAGE_TRUST_POLICY,
  stripUntrustedStoryboardGeneratedImages,
} from '../lib/admin/storyboard/image-trust';
import type {
  StoryboardGeneratedImageProvenance,
  StoryboardGenerateRequest,
  StoryboardScene,
  StoryboardSceneGeneratedImage,
} from '../lib/admin/storyboard/types';

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
  productionChecklist: ['음식 김/윤기 컷', '첫 반응 손동작'],
};

const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l9ggGQAAAABJRU5ErkJggg==';

function exactProvenance(
  responseId: string,
  imageCallId: string,
): StoryboardGeneratedImageProvenance {
  return {
    providerId: 'local-codex',
    authMode: 'codex_oauth',
    endpoint: 'https://chatgpt.com/backend-api/codex/responses',
    agentModel: 'gpt-5.5',
    requestToolType: 'image_generation',
    requestToolModel: 'gpt-image-2',
    model: 'gpt-image-2',
    modelProvenance: 'exact',
    responseId,
    imageCallId,
    imageItemCount: 1,
    generatedImageItemTypes: ['image_generation_call'],
    rawImageItemTypes: ['image_generation_call'],
    requestHash: 'a'.repeat(64),
    responseHash: 'b'.repeat(64),
    hasOpenAIAPIKey: false,
    generatedAt: '2026-06-05T00:00:00.000Z',
  };
}

function writeExactProof(dir: string, overrides: Record<string, unknown> = {}) {
  const imagePath = join(dir, 'proof.png');
  const proofPath = join(dir, 'proof.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(imagePath, Buffer.from(tinyPngBase64, 'base64'));
  writeFileSync(
    proofPath,
    `${JSON.stringify({
      ok: true,
      providerId: 'local-codex',
      authMode: 'codex_oauth',
      endpoint: 'https://chatgpt.com/backend-api/codex/responses',
      agentModel: 'gpt-5.5',
      requestToolType: 'image_generation',
      requestToolModel: 'gpt-image-2',
      model: 'gpt-image-2',
      modelProvenance: 'exact',
      responseId: 'resp_test_exact',
      imageCallId: 'ig_test_exact',
      imageItemCount: 1,
      generatedImageItemTypes: ['image_generation_call'],
      rawImageItemTypes: ['image_generation_call'],
      mime: 'image/png',
      bytes: 70,
      outputPath: imagePath,
      requestHash: 'a'.repeat(64),
      responseHash: 'b'.repeat(64),
      hasOpenAIAPIKey: false,
      generatedAt: new Date().toISOString(),
      ...overrides,
    })}\n`,
  );
  return { proofPath, imagePath };
}

describe('admin storyboard image provider', () => {
  test('uses the local Codex GPT Image 2 gate instead of mock image generation', () => {
    const missingProofPath = join(tmpdir(), `missing-storyboard-proof-${Date.now()}.json`);
    const env = {
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: missingProofPath,
    } as NodeJS.ProcessEnv;

    expect(resolveLocalCodexStoryboardModel(env)).toBe('gpt-image-2');
    expect(getStoryboardImageProviderAvailability(env)).toMatchObject({
      available: false,
      reason: 'local_codex_model_provenance_unverified',
      command: process.execPath,
      model: 'gpt-image-2',
      providerId: 'local-codex',
      modelProvenance: 'unverified',
      target: { width: 1280, height: 720, aspectRatio: '16:9' },
    });
    expect(getStoryboardImageProviderAvailability({
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: missingProofPath,
    } as NodeJS.ProcessEnv)).toMatchObject({
      available: false,
      reason: 'local_codex_model_provenance_unverified',
      model: 'gpt-image-2',
      providerId: 'local-codex',
      modelProvenance: 'unverified',
    });
    expect(getStoryboardImageProviderAvailability({
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-1',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: missingProofPath,
    } as NodeJS.ProcessEnv)).toMatchObject({
      available: false,
      reason: 'local_codex_model_not_allowed',
      model: 'gpt-image-1',
      providerId: 'local-codex',
      modelProvenance: 'unverified',
    });
    expect(resolveLocalCodexStoryboardModel({
      THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-1',
    } as NodeJS.ProcessEnv)).toBe('gpt-image-2');
    expect(getStoryboardImageProviderAvailability({
      ALLOW_LOCAL_CLI_THUMBNAIL: 'true',
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: missingProofPath,
    } as NodeJS.ProcessEnv)).toMatchObject({
      available: false,
      reason: 'local_codex_model_provenance_unverified',
      model: 'gpt-image-2',
      providerId: 'local-codex',
      modelProvenance: 'unverified',
    });
    expect(getStoryboardImageProviderAvailability({
      STORYBOARD_LOCAL_CODEX_COMMAND: '/tmp/missing-codex-imagegen-storyboard-provider.py',
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: missingProofPath,
    } as NodeJS.ProcessEnv)).toMatchObject({
      available: false,
      reason: 'local_codex_bridge_unavailable',
      model: 'gpt-image-2',
      providerId: 'local-codex',
      modelProvenance: 'unverified',
    });
  });

  test('requires exact local-codex gpt-image-2 provenance before the client marks image generation ready', () => {
    const proofDir = join(tmpdir(), `storyboard-proof-${Date.now()}`);
    const { proofPath } = writeExactProof(proofDir);
    const unverifiedAvailablePayload = {
      provider: {
        available: true,
        providerId: 'local-codex',
        model: 'gpt-image-2',
        modelProvenance: 'unverified',
        target: { width: 1280, height: 720, aspectRatio: '16:9' },
      },
    };
    const wrongProviderPayload = {
      provider: {
        available: true,
        providerId: 'thumbnail-generator',
        model: 'gpt-image-2',
        modelProvenance: 'exact',
      },
    };
    const wrongModelPayload = {
      provider: {
        available: true,
        providerId: 'local-codex',
        model: 'gpt-image-1',
        modelProvenance: 'exact',
      },
    };
    const exactPayload = {
      provider: {
        available: true,
        providerId: 'local-codex',
        model: 'gpt-image-2',
        modelProvenance: 'exact',
        command: '/tmp/verified-codex-gpt-image-2-bridge',
        target: { width: 1280, height: 720, aspectRatio: '16:9' },
      },
    };

    expect(isExactStoryboardGptImage2ProviderPayload(unverifiedAvailablePayload.provider)).toBe(false);
    expect(mapStoryboardImageProviderReadiness(unverifiedAvailablePayload)).toMatchObject({
      status: 'blocked_provenance',
      reason: 'local_codex_model_provenance_unverified',
      providerId: 'local-codex',
      model: 'gpt-image-2',
      modelProvenance: 'unverified',
    });
    expect(mapStoryboardImageProviderReadiness(wrongProviderPayload)).toMatchObject({
      status: 'blocked_provenance',
      providerId: 'thumbnail-generator',
      model: 'gpt-image-2',
      modelProvenance: 'exact',
    });
    expect(mapStoryboardImageProviderReadiness(wrongModelPayload)).toMatchObject({
      status: 'blocked_model',
      reason: 'local_codex_model_not_allowed',
      providerId: 'local-codex',
      model: 'gpt-image-1',
      modelProvenance: 'exact',
    });
    const exactReadiness = mapStoryboardImageProviderReadiness(exactPayload);
    expect(isExactStoryboardGptImage2ProviderPayload(exactPayload.provider)).toBe(true);
    expect(isStoryboardImageProviderReady(exactReadiness)).toBe(true);
    expect(exactReadiness).toMatchObject({
      status: 'ready',
      reason: 'ready',
      providerId: 'local-codex',
      model: 'gpt-image-2',
      modelProvenance: 'exact',
    });
    expect(getStoryboardImageProviderAvailability({
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: proofPath,
    } as NodeJS.ProcessEnv)).toMatchObject({
      available: true,
      reason: 'ready',
      providerId: 'local-codex',
      model: 'gpt-image-2',
      modelProvenance: 'exact',
      proof: {
        authMode: 'codex_oauth',
        requestToolType: 'image_generation',
        requestToolModel: 'gpt-image-2',
        responseId: 'resp_test_exact',
        imageCallId: 'ig_test_exact',
      },
    });
    const wrongEndpointDir = join(tmpdir(), `storyboard-wrong-endpoint-proof-${Date.now()}`);
    const { proofPath: wrongEndpointProofPath } = writeExactProof(wrongEndpointDir, {
      endpoint: 'https://example.com/backend-api/codex/responses',
    });
    expect(getStoryboardImageProviderAvailability({
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: wrongEndpointProofPath,
    } as NodeJS.ProcessEnv)).toMatchObject({
      available: false,
      reason: 'local_codex_model_provenance_unverified',
      providerId: 'local-codex',
      model: 'gpt-image-2',
      modelProvenance: 'unverified',
    });
    const wrongItemDir = join(tmpdir(), `storyboard-wrong-item-proof-${Date.now()}`);
    const { proofPath: wrongItemProofPath } = writeExactProof(wrongItemDir, {
      rawImageItemTypes: ['message'],
    });
    expect(getStoryboardImageProviderAvailability({
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: wrongItemProofPath,
    } as NodeJS.ProcessEnv)).toMatchObject({
      available: false,
      reason: 'local_codex_model_provenance_unverified',
      providerId: 'local-codex',
      model: 'gpt-image-2',
      modelProvenance: 'unverified',
    });
    const staleProofDir = join(tmpdir(), `storyboard-stale-proof-${Date.now()}`);
    const { proofPath: staleProofPath } = writeExactProof(staleProofDir, {
      generatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(getStoryboardImageProviderAvailability({
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: staleProofPath,
    } as NodeJS.ProcessEnv)).toMatchObject({
      available: false,
      reason: 'local_codex_model_provenance_unverified',
      providerId: 'local-codex',
      model: 'gpt-image-2',
      modelProvenance: 'unverified',
    });
    const badDigestDir = join(tmpdir(), `storyboard-bad-digest-proof-${Date.now()}`);
    const { proofPath: badDigestProofPath } = writeExactProof(badDigestDir, {
      requestHash: 'not-a-sha256',
    });
    expect(getStoryboardImageProviderAvailability({
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: badDigestProofPath,
    } as NodeJS.ProcessEnv)).toMatchObject({
      available: false,
      reason: 'local_codex_model_provenance_unverified',
      providerId: 'local-codex',
      model: 'gpt-image-2',
      modelProvenance: 'unverified',
    });
    rmSync(proofDir, { recursive: true, force: true });
    rmSync(wrongEndpointDir, { recursive: true, force: true });
    rmSync(wrongItemDir, { recursive: true, force: true });
    rmSync(staleProofDir, { recursive: true, force: true });
    rmSync(badDigestDir, { recursive: true, force: true });
  });

  test('builds a single-scene cut prompt that forbids internal storyboard sheets, real likenesses, and baked text', () => {
    const prompt = buildStoryboardSceneImagePrompt(scene, {
      title: '실데이터 스토리보드',
      logline: '반복시청 피크 기반 4컷 이미지',
      request,
    });

    expect(prompt).toContain('Create exactly one full-bleed 16:9 single-scene storyboard cut image');
    expect(prompt).toContain('one continuous scene filling the full canvas edge-to-edge');
    expect(prompt).toContain('external 2x2 grid by the web UI');
    expect(prompt).toContain('never draw that grid inside the image');
    expect(prompt).toContain('no storyboard sheet');
    expect(prompt).toContain('no comic page');
    expect(prompt).toContain('no multi-panel layout');
    expect(prompt).toContain('no split-screen');
    expect(prompt).toContain('no inset panels');
    expect(prompt).toContain('no internal borders');
    expect(prompt).toContain('no blank quadrants');
    expect(prompt).toContain('no placeholder rectangles');
    expect(prompt).toContain('one coherent CUT');
    expect(prompt).toContain('CUT 1');
    expect(prompt).toContain('Visual role contract: CUT 01 is "storefront intro / outside arrival"');
    expect(prompt).toContain('Must show for this CUT: restaurant exterior arrival');
    expect(prompt).toContain('Must avoid for this CUT: do not show eating action');
    expect(prompt).toContain('Neighbor difference rule');
    expect(prompt).toContain('do not default to repeated food-only or noodle-lift shots');
    expect(prompt).toContain('Visual direction:');
    expect(prompt).toContain('do not recreate a real person likeness');
    expect(prompt).toContain('no recognizable face');
    expect(prompt).toContain('no face close-up');
    expect(prompt).toContain('no host face at all');
    expect(prompt).toContain('no detailed eyes/nose/mouth');
    expect(prompt).toContain('Keep all human faces outside the frame');
    expect(prompt).toContain('cropped hands');
    expect(prompt).toContain('chopsticks');
    expect(prompt).toContain('food');
    expect(prompt).toContain('over-shoulder silhouette');
    expect(prompt).toContain('back-of-head silhouette');
    expect(prompt).toContain('cropped body parts without facial detail');
    expect(prompt).toContain('face outside frame');
    expect(prompt).toContain('No logos, watermarks');
    expect(prompt).toContain('do not render readable text');
    expect(prompt).toContain('06:57');
  });

  test('changes the image role contract by CUT number so generated panels do not repeat the same food close-up', () => {
    const peakScenePrompt = buildStoryboardSceneImagePrompt(
      {
        ...scene,
        sceneNo: 9,
        title: '클라이맥스 히어로 한상',
        visualDirection: '테이블 전체와 가장 큰 한입, 풍성한 음식 높이, 김/윤기가 동시에 보이는 히어로 구도',
      },
      {
        title: '실데이터 스토리보드',
        logline: '반복시청 피크 기반 12컷 이미지',
        request: { ...request, segmentCount: 12 },
      },
    );

    expect(peakScenePrompt).toContain('Visual role contract: CUT 09 is "peak feast / hero table composition"');
    expect(peakScenePrompt).toContain('Must show for this CUT: largest feast moment');
    expect(peakScenePrompt).toContain('dynamic wide hero shot');
    expect(peakScenePrompt).toContain('no drink-only frame');
    expect(peakScenePrompt).not.toContain('storefront intro / outside arrival');
  });

  test('strict-stops before executing the local Codex storyboard wrapper when exact provenance is unavailable', async () => {
    const markerPath = join(tmpdir(), `storyboard-should-not-execute-${Date.now()}`);
    const missingProofPath = join(tmpdir(), `missing-storyboard-proof-${Date.now()}.json`);
    const localScript = `
      const fs = require("node:fs");
      fs.writeFileSync(process.env.STORYBOARD_EXEC_MARKER, "executed");
    `;
    const env = {
      ALLOW_LOCAL_CLI_STORYBOARD_IMAGES: 'true',
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: missingProofPath,
      STORYBOARD_EXEC_MARKER: markerPath,
      STORYBOARD_LOCAL_CODEX_ARGS_JSON: JSON.stringify(['-e', localScript]),
    } as NodeJS.ProcessEnv;

    await expect(generateStoryboardSceneImages([scene], {
      title: '실데이터 스토리보드',
      logline: '반복시청 피크 기반 4컷 이미지',
      request,
    }, env)).rejects.toThrow(/exact gpt-image-2 backend provenance/);
    expect(getStoryboardImageProviderAvailability(env)).toMatchObject({
      available: false,
      reason: 'local_codex_model_provenance_unverified',
      model: 'gpt-image-2',
      providerId: 'local-codex',
      modelProvenance: 'unverified',
    });
    expect(existsSync(markerPath)).toBe(false);
    rmSync(markerPath, { force: true });
  });

  test('executes the verified local Codex bridge and returns a trusted storyboard image', async () => {
    const proofDir = join(tmpdir(), `storyboard-generate-proof-${Date.now()}`);
    const { proofPath } = writeExactProof(proofDir);
    const markerPath = join(tmpdir(), `storyboard-executed-${Date.now()}`);
    const localScript = `
      const fs = require("node:fs");
      const path = require("node:path");
      let body = "";
      process.stdin.on("data", (chunk) => { body += chunk; });
      process.stdin.on("end", () => {
        const payload = JSON.parse(body);
        fs.mkdirSync(path.dirname(payload.outputPath), { recursive: true });
        const image = Buffer.from("${tinyPngBase64}", "base64");
        fs.writeFileSync(payload.outputPath, image);
        fs.writeFileSync(process.env.STORYBOARD_EXEC_MARKER, payload.prompt);
        console.log(JSON.stringify({
          ok: true,
          providerId: "local-codex",
          authMode: "codex_oauth",
          endpoint: "https://chatgpt.com/backend-api/codex/responses",
          agentModel: payload.agentModel,
          requestToolType: "image_generation",
          requestToolModel: "gpt-image-2",
          model: "gpt-image-2",
          modelProvenance: "exact",
          responseId: "resp_generation_test",
          imageCallId: "ig_generation_test",
          imageItemCount: 1,
          generatedImageItemTypes: ["image_generation_call"],
          rawImageItemTypes: ["image_generation_call"],
          requestHash: "${'a'.repeat(64)}",
          responseHash: "${'b'.repeat(64)}",
          mime: "image/png",
          bytes: image.length,
          outputPath: payload.outputPath,
          hasOpenAIAPIKey: false,
          generatedAt: new Date().toISOString()
        }));
      });
    `;
    const env = {
      STORYBOARD_LOCAL_CODEX_COMMAND: process.execPath,
      STORYBOARD_LOCAL_CODEX_ARGS_JSON: JSON.stringify(['-e', localScript]),
      STORYBOARD_LOCAL_CODEX_IMAGE_MODEL: 'gpt-image-2',
      STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE: proofPath,
      STORYBOARD_EXEC_MARKER: markerPath,
    } as NodeJS.ProcessEnv;

    const images = await generateStoryboardSceneImages([scene], {
      title: '실데이터 스토리보드',
      logline: '반복시청 피크 기반 4컷 이미지',
      request,
    }, env);

    expect(images).toHaveLength(1);
    const image = images[0]?.image;
    expect(image).toBeDefined();
    expect(image?.dataUrl).toMatch(/^\/qa-history\/storyboard\/generated\/.+\/cut-01\.png$/);
    expect(image?.providerId).toBe('local-codex');
    expect(image?.model).toBe('gpt-image-2');
    expect(image?.trustPolicy).toBe('storyboard-gpt-image-2-panel-v1');
    expect(image?.warnings.join('\n')).toContain('exact_provenance: image_generation.gpt-image-2');
    expect(image?.provenance).toMatchObject({
      providerId: 'local-codex',
      authMode: 'codex_oauth',
      endpoint: 'https://chatgpt.com/backend-api/codex/responses',
      agentModel: 'gpt-5.5',
      requestToolType: 'image_generation',
      requestToolModel: 'gpt-image-2',
      model: 'gpt-image-2',
      modelProvenance: 'exact',
      responseId: 'resp_generation_test',
      imageCallId: 'ig_generation_test',
      imageItemCount: 1,
      generatedImageItemTypes: ['image_generation_call'],
      rawImageItemTypes: ['image_generation_call'],
      requestHash: 'a'.repeat(64),
      responseHash: 'b'.repeat(64),
      hasOpenAIAPIKey: false,
    });
    expect(isExactStoryboardGeneratedImageProvenance(image?.provenance)).toBe(true);
    expect(isTrustedStoryboardGeneratedImage(image)).toBe(true);
    expect(existsSync(markerPath)).toBe(true);
    expect(existsSync(join(process.cwd(), 'public', image!.dataUrl))).toBe(true);
    rmSync(markerPath, { force: true });
    rmSync(proofDir, { recursive: true, force: true });
    rmSync(dirname(join(process.cwd(), 'public', image!.dataUrl)), { recursive: true, force: true });
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
      provenance: exactProvenance('resp_trusted', 'ig_trusted'),
    };
    const sharedSeedImage = {
      ...trustedImage,
      dataUrl: '/storyboard-seed/generated/cut-01.png',
      provenance: exactProvenance('resp_seed', 'ig_seed'),
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
    const wrongProviderImage = {
      ...trustedImage,
      providerId: 'thumbnail-generator',
    } as unknown as StoryboardSceneGeneratedImage;
    const wrongModelImage = {
      ...trustedImage,
      model: 'gpt-image-1',
    };
    const wrongMimeImage = {
      ...trustedImage,
      mime: 'text/plain',
    } as unknown as StoryboardSceneGeneratedImage;
    const remoteUrlImage = {
      ...trustedImage,
      dataUrl: 'https://example.com/storyboard/cut-01.png',
    };
    const wrongProvenanceImage = {
      ...trustedImage,
      provenance: {
        providerId: 'local-codex',
        authMode: 'codex_oauth',
        endpoint: 'https://chatgpt.com/backend-api/codex/responses',
        requestToolType: 'image_generation',
        requestToolModel: 'gpt-image-1',
        model: 'gpt-image-1',
        modelProvenance: 'exact',
        responseId: 'resp_wrong',
        imageCallId: 'ig_wrong',
        imageItemCount: 1,
        rawImageItemTypes: ['image_generation_call'],
        requestHash: 'a'.repeat(64),
        responseHash: 'b'.repeat(64),
        hasOpenAIAPIKey: false,
        generatedAt: '2026-06-05T00:00:00.000Z',
      },
    } as unknown as StoryboardSceneGeneratedImage;
    const legacyPersistedStoryboardImage = {
      ...trustedImage,
      trustPolicy: undefined,
      dataUrl: '/qa-history/storyboard/generated/2026-06-04T15-52-24-703Z/cut-01.png',
      prompt: 'Persisted local Codex GPT Image 2 storyboard cut image for CUT 1',
      warnings: [
        'local_codex_provider: generated via local Codex OAuth provider and persisted for admin storyboard display.',
      ],
    };
    const arbitraryHistoryImage = {
      ...legacyPersistedStoryboardImage,
      prompt: 'Persisted local Codex GPT Image 2 storyboard cut image without cut metadata',
      warnings: [],
    };

    expect(isTrustedStoryboardGeneratedImage(trustedImage)).toBe(true);
    expect(getTrustedStoryboardGeneratedImage(trustedImage)).toBe(trustedImage);
    expect(isTrustedStoryboardGeneratedImage(sharedSeedImage)).toBe(true);
    expect(getTrustedStoryboardGeneratedImage(sharedSeedImage)).toBe(sharedSeedImage);
    expect(isTrustedStoryboardGeneratedImage(storyboardThumbnailCandidateImage)).toBe(true);
    expect(isTrustedStoryboardGeneratedImage(thumbnailLikeImage)).toBe(false);
    expect(isTrustedStoryboardGeneratedImage(missingAttestationImage)).toBe(false);
    expect(isTrustedStoryboardGeneratedImage(wrongProviderImage)).toBe(false);
    expect(isTrustedStoryboardGeneratedImage(wrongModelImage)).toBe(false);
    expect(isTrustedStoryboardGeneratedImage(wrongMimeImage)).toBe(false);
    expect(isTrustedStoryboardGeneratedImage(remoteUrlImage)).toBe(false);
    expect(isTrustedStoryboardGeneratedImage(wrongProvenanceImage)).toBe(false);
    expect(isTrustedStoryboardGeneratedImage(legacyPersistedStoryboardImage)).toBe(false);
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
          { ...scene, sceneNo: 4, generatedImage: sharedSeedImage },
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
    expect(sanitized.storyboard.scenes[1].generatedImage).toBeUndefined();
    expect(sanitized.storyboard.scenes[2].generatedImage).toBe(trustedImage);
    expect(sanitized.storyboard.scenes[3].generatedImage).toBe(sharedSeedImage);
  });
});
