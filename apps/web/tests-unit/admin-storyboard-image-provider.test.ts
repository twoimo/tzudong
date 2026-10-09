import { describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

import {
  buildStoryboardSceneImagePrompt,
  generateStoryboardSceneImages,
  generateStoryboardSceneImage,
  parseLocalCodexCommandStdout,
  validateLocalCodexCommandResult,
  getStoryboardImageProviderAvailability,
  resolveLocalCodexStoryboardModel,
} from '../lib/admin/storyboard/image-provider';
import {
  canonicalizeStoryboardImageBytes,
} from '../lib/admin/storyboard/image-canonicalizer';
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

function browserApiKeyProvenance(
  responseId: string,
  imageCallId: string,
): StoryboardGeneratedImageProvenance {
  return {
    providerId: 'browser-openai-api-key',
    authMode: 'browser_memory_only_api_key',
    endpoint: 'https://api.openai.com/v1/images/generations',
    requestToolType: 'image_generation',
    requestToolModel: 'gpt-image-2',
    model: 'gpt-image-2',
    modelProvenance: 'exact',
    responseId,
    imageCallId,
    imageItemCount: 1,
    generatedImageItemTypes: ['image_generation_call'],
    rawImageItemTypes: ['image_generation_call'],
    requestHash: 'c'.repeat(64),
    responseHash: 'd'.repeat(64),
    hasOpenAIAPIKey: true,
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
  test('canonicalizes only complete static 16:9 images and rejects malformed image containers', async () => {
    const source = await sharp({
      create: {
        width: 1536,
        height: 864,
        channels: 3,
        background: { r: 32, g: 64, b: 96 },
      },
    }).png().toBuffer();
    const canonical = await canonicalizeStoryboardImageBytes(source);

    expect(canonical).toMatchObject({
      byteLength: canonical.bytes.length,
      height: 720,
      mime: 'image/png',
      sha256: createHash('sha256').update(canonical.bytes).digest('hex'),
      width: 1280,
    });
    expect(await sharp(canonical.bytes).metadata()).toMatchObject({
      format: 'png',
      width: 1280,
      height: 720,
    });

    const wrongDimensions = await sharp({
      create: {
        width: 1280,
        height: 719,
        channels: 3,
        background: { r: 32, g: 64, b: 96 },
      },
    }).png().toBuffer();
    const oversizedDimension = await sharp({
      create: {
        width: 8193,
        height: 1,
        channels: 3,
        background: { r: 32, g: 64, b: 96 },
      },
    }).png().toBuffer();

    for (const invalid of [
      Buffer.from('not an image'),
      source.subarray(0, -1),
      Buffer.concat([source, Buffer.from('trailing-polyglot-data')]),
      wrongDimensions,
      oversizedDimension,
    ]) {
      await expect(canonicalizeStoryboardImageBytes(invalid)).rejects.toThrow(
        'STORYBOARD_IMAGE_CANONICALIZATION_REJECTED',
      );
    }
  });
  test('preserves historical storyboard model label normalization independently of thumbnail configuration', () => {expect(resolveLocalCodexStoryboardModel({STORYBOARD_LOCAL_CODEX_IMAGE_MODEL:'gpt-image-2'})).toBe('gpt-image-2');expect(resolveLocalCodexStoryboardModel({THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL:'gpt-image-1'})).toBe('gpt-image-2');});

  test('normalizes historical provider payloads with exact model and provenance boundaries', () =>{
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

 rmSync(proofDir,{recursive:true,force:true});
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
    const browserKeyImage = {
      ...trustedImage,
      providerId: 'browser-openai-api-key' as const,
      provenance: browserApiKeyProvenance('resp_browser_trusted', 'ig_browser_trusted'),
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
    expect(isTrustedStoryboardGeneratedImage(browserKeyImage)).toBe(true);
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

// Distinct former gates cannot reopen the retired execution surface.
test.each([
 ['browser operation key',{}, {browserOpenAIApiKey:'test-key'}],
 ['local CLI gate',{ALLOW_LOCAL_CLI_STORYBOARD_IMAGES:'true'},{}],
 ['configured command',{STORYBOARD_LOCAL_CODEX_COMMAND:process.execPath,STORYBOARD_LOCAL_CODEX_ARGS_JSON:'["-e","throw Error(\"must not run\")"]'},{}],
 ['exact proof file gate',{STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE:'/private/unreadable-exact-proof.json'},{}],
 ['invalid model alias',{STORYBOARD_LOCAL_CODEX_IMAGE_MODEL:'gpt-image-1'},{}],
 ['thumbnail gate',{ALLOW_LOCAL_CLI_THUMBNAIL:'true',THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL:'gpt-image-2'},{}],
])('retired image provider ignores %s and never reports ready',async (_label,env,options)=>{
 expect(getStoryboardImageProviderAvailability(env,options)).toMatchObject({available:false,reason:'storyboard_workflow_retired',modelProvenance:'unverified'});
 await expect(generateStoryboardSceneImages([{} as never],{} as never,env,options)).rejects.toThrow('STORYBOARD_WORKFLOW_RETIRED');
 await expect(generateStoryboardSceneImage({} as never,{} as never,env,options)).rejects.toThrow('STORYBOARD_WORKFLOW_RETIRED');
});
test('retired image entrypoints never inspect settings or operation key getters',async()=>{
 let reads=0;const guarded=new Proxy({}, {get(){reads++;throw Error('must not inspect provider inputs');}});
 expect(getStoryboardImageProviderAvailability(guarded,guarded).available).toBe(false);
 await expect(generateStoryboardSceneImages([{} as never],{} as never,guarded,guarded)).rejects.toThrow('STORYBOARD_WORKFLOW_RETIRED');
 expect(reads).toBe(0);
});
test.each([
 ['wrong endpoint',{endpoint:'https://example.invalid/responses'}],
 ['wrong raw item',{rawImageItemTypes:['image_url']}],
 ['stale receipt',{generatedAt:'2000-01-01T00:00:00Z'}],
 ['bad digest',{requestHash:'not-sha256'}],
])('existing receipt parser rejects %s independently of execution',(_label,override)=>{
 const dir=join(tmpdir(),'storyboard-receipt-'+Date.now()+'-'+Math.random());
 try{const {proofPath}=writeExactProof(dir,override);const parsed=parseLocalCodexCommandStdout(readFileSync(proofPath,'utf8'));expect(()=>validateLocalCodexCommandResult(parsed,join(dir,'proof.png'))).toThrow('exact local-codex');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('existing exact receipt remains parseable without authorizing new image execution',()=>{
 const dir=join(tmpdir(),'storyboard-exact-receipt-'+Date.now());
 try{const {proofPath}=writeExactProof(dir);const parsed=parseLocalCodexCommandStdout(readFileSync(proofPath,'utf8'));expect(validateLocalCodexCommandResult(parsed,join(dir,'proof.png'))).toMatchObject({model:'gpt-image-2',modelProvenance:'exact',responseId:'resp_test_exact'});}finally{rmSync(dir,{recursive:true,force:true});}
});
