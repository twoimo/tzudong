import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { STORYBOARD_GENERATED_IMAGE_TRUST_POLICY } from './image-trust';
import {
  STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE,
  STORYBOARD_IMAGE_PROVIDER_ID,
  STORYBOARD_IMAGE_PROVIDER_MODEL,
} from './image-provider-readiness';
import type {
  StoryboardGenerateRequest,
  StoryboardGeneratedImageProvenance,
  StoryboardScene,
  StoryboardSceneGeneratedImage,
} from './types';

const STORYBOARD_IMAGE_TARGET_WIDTH = 1280 as const;
const STORYBOARD_IMAGE_TARGET_HEIGHT = 720 as const;
const LOCAL_CODEX_DEFAULT_MODEL = STORYBOARD_IMAGE_PROVIDER_MODEL;
const LOCAL_CODEX_ALLOWED_MODEL = STORYBOARD_IMAGE_PROVIDER_MODEL;
const STORYBOARD_IMAGE_OUTPUT_SIZE = '1536x864' as const;
const DEFAULT_LOCAL_CODEX_SCRIPT = 'scripts/codex-imagegen-storyboard-provider.py' as const;
const DEFAULT_LOCAL_CODEX_PROVENANCE_FILE =
  '.omx/artifacts/gpt-image-2-provenance/latest-verified.json' as const;
const LOCAL_CODEX_RESPONSES_ENDPOINT =
  'https://chatgpt.com/backend-api/codex/responses' as const;
const LOCAL_CODEX_PROVENANCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LOCAL_CODEX_PROVENANCE_FUTURE_SKEW_MS = 5 * 60 * 1000;
const STORYBOARD_GENERATED_IMAGE_PUBLIC_ROOT =
  '/qa-history/storyboard/generated' as const;
const LOCAL_CODEX_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const LOCAL_CODEX_COMMAND_MAX_OUTPUT_BYTES = 3 * 1024 * 1024;

type StoryboardImageContext = {
  title: string;
  logline: string;
  request: StoryboardGenerateRequest;
};

type StoryboardImageProviderUnavailableReason =
  | 'local_codex_model_not_allowed'
  | 'local_codex_bridge_unavailable'
  | 'local_codex_model_provenance_unverified';

type StoryboardImageProviderTarget = {
  width: typeof STORYBOARD_IMAGE_TARGET_WIDTH;
  height: typeof STORYBOARD_IMAGE_TARGET_HEIGHT;
  aspectRatio: '16:9';
};

type StoryboardImageProviderBaseAvailability = {
  command?: string;
  model: string;
  providerId: typeof STORYBOARD_IMAGE_PROVIDER_ID;
  target: StoryboardImageProviderTarget;
};

export type StoryboardImageProviderAvailability =
  | (StoryboardImageProviderBaseAvailability & {
    available: false;
    reason: StoryboardImageProviderUnavailableReason;
    modelProvenance: 'unverified';
    proof?: StoryboardImageProviderProofSummary;
  })
  | (StoryboardImageProviderBaseAvailability & {
    available: true;
    reason: 'ready';
    model: typeof STORYBOARD_IMAGE_PROVIDER_MODEL;
    modelProvenance: typeof STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE;
    proof: StoryboardImageProviderProofSummary;
  });

type StoryboardImageProviderProofSummary = {
  providerId: typeof STORYBOARD_IMAGE_PROVIDER_ID;
  authMode: 'codex_oauth';
  endpoint: typeof LOCAL_CODEX_RESPONSES_ENDPOINT;
  agentModel?: string;
  requestToolType: 'image_generation';
  requestToolModel: typeof STORYBOARD_IMAGE_PROVIDER_MODEL;
  model: typeof STORYBOARD_IMAGE_PROVIDER_MODEL;
  modelProvenance: typeof STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE;
  responseId: string;
  imageCallId: string;
  imageItemCount: number;
  generatedImageItemTypes?: string[];
  rawImageItemTypes: string[];
  mime: 'image/png';
  bytes: number;
  outputPath?: string;
  rawResponsePath?: string;
  requestHash: string;
  responseHash: string;
  hasOpenAIAPIKey: false;
  generatedAt: string;
};

export class StoryboardImageGenerationError extends Error {
  constructor(
    public readonly code: 'provider_unavailable' | 'invalid_payload' | 'provider_execution_failed',
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'StoryboardImageGenerationError';
  }
}

export function resolveLocalCodexStoryboardModel(env: NodeJS.ProcessEnv = process.env) {
  return env.STORYBOARD_LOCAL_CODEX_IMAGE_MODEL?.trim()
    || LOCAL_CODEX_DEFAULT_MODEL;
}

function isAllowedLocalCodexStoryboardModel(model: string) {
  return model === LOCAL_CODEX_ALLOWED_MODEL;
}

function getStoryboardImageTarget(): StoryboardImageProviderTarget {
  return {
    width: STORYBOARD_IMAGE_TARGET_WIDTH,
    height: STORYBOARD_IMAGE_TARGET_HEIGHT,
    aspectRatio: '16:9',
  };
}

function resolveDefaultLocalCodexScript() {
  return resolve(process.cwd(), DEFAULT_LOCAL_CODEX_SCRIPT);
}

function parseArgsJson(value: string | undefined) {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function resolveLocalCodexStoryboardCommandParts(env: NodeJS.ProcessEnv) {
  const configuredCommand = env.STORYBOARD_LOCAL_CODEX_COMMAND?.trim();
  if (configuredCommand) {
    const configuredArgs = parseArgsJson(env.STORYBOARD_LOCAL_CODEX_ARGS_JSON);
    return {
      command: configuredCommand,
      args: configuredArgs,
      label: [configuredCommand, ...configuredArgs].join(' '),
      scriptPath: configuredCommand,
      configured: true,
    };
  }

  const scriptPath = resolveDefaultLocalCodexScript();
  return {
    command: env.PYTHON ?? 'python3',
    args: [scriptPath],
    label: `${env.PYTHON ?? 'python3'} ${DEFAULT_LOCAL_CODEX_SCRIPT}`,
    scriptPath,
    configured: false,
  };
}

function isLocalCodexCommandAvailable(env: NodeJS.ProcessEnv) {
  const commandParts = resolveLocalCodexStoryboardCommandParts(env);
  if (!commandParts.configured) return existsSync(commandParts.scriptPath);
  if (commandParts.command.includes('/') || commandParts.command.includes('\\')) {
    return existsSync(commandParts.command);
  }
  return true;
}

function resolveLocalCodexProvenanceFile(env: NodeJS.ProcessEnv) {
  return resolve(
    process.cwd(),
    env.STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE?.trim()
      || DEFAULT_LOCAL_CODEX_PROVENANCE_FILE,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isFreshGeneratedAt(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const now = Date.now();
  return (
    timestamp >= now - LOCAL_CODEX_PROVENANCE_MAX_AGE_MS &&
    timestamp <= now + LOCAL_CODEX_PROVENANCE_FUTURE_SKEW_MS
  );
}

function toProofSummary(value: unknown): StoryboardImageProviderProofSummary | null {
  if (!value || typeof value !== 'object') return null;
  const proof = value as Record<string, unknown>;
  if (
    proof.ok !== true ||
    proof.providerId !== STORYBOARD_IMAGE_PROVIDER_ID ||
    proof.authMode !== 'codex_oauth' ||
    proof.requestToolType !== 'image_generation' ||
    proof.requestToolModel !== STORYBOARD_IMAGE_PROVIDER_MODEL ||
    proof.model !== STORYBOARD_IMAGE_PROVIDER_MODEL ||
    proof.modelProvenance !== STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE ||
    proof.mime !== 'image/png' ||
    proof.endpoint !== LOCAL_CODEX_RESPONSES_ENDPOINT ||
    !isNonEmptyString(proof.responseId) ||
    !isNonEmptyString(proof.imageCallId) ||
    typeof proof.imageItemCount !== 'number' ||
    proof.imageItemCount < 1 ||
    typeof proof.bytes !== 'number' ||
    proof.bytes <= 0 ||
    !Array.isArray(proof.rawImageItemTypes) ||
    proof.rawImageItemTypes[0] !== 'image_generation_call' ||
    (Array.isArray(proof.generatedImageItemTypes) &&
      !proof.generatedImageItemTypes.includes('image_generation_call')) ||
    !isSha256Hex(proof.requestHash) ||
    !isSha256Hex(proof.responseHash) ||
    !isFreshGeneratedAt(proof.generatedAt) ||
    proof.hasOpenAIAPIKey !== false
  ) {
    return null;
  }

  const outputPath = isNonEmptyString(proof.outputPath)
    ? proof.outputPath
    : undefined;
  if (outputPath && !existsSync(outputPath)) return null;

  return {
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    authMode: 'codex_oauth',
    endpoint: LOCAL_CODEX_RESPONSES_ENDPOINT,
    agentModel: isNonEmptyString(proof.agentModel) ? proof.agentModel : undefined,
    requestToolType: 'image_generation',
    requestToolModel: STORYBOARD_IMAGE_PROVIDER_MODEL,
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    modelProvenance: STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE,
    responseId: proof.responseId,
    imageCallId: proof.imageCallId,
    imageItemCount: proof.imageItemCount,
    generatedImageItemTypes: Array.isArray(proof.generatedImageItemTypes)
      ? proof.generatedImageItemTypes.filter((item): item is string => typeof item === 'string')
      : undefined,
    rawImageItemTypes: proof.rawImageItemTypes.filter((item): item is string => typeof item === 'string'),
    mime: 'image/png',
    bytes: proof.bytes,
    outputPath,
    rawResponsePath: isNonEmptyString(proof.rawResponsePath) ? proof.rawResponsePath : undefined,
    requestHash: proof.requestHash,
    responseHash: proof.responseHash,
    hasOpenAIAPIKey: false,
    generatedAt: proof.generatedAt,
  };
}

function toStoryboardGeneratedImageProvenance(
  proof: StoryboardImageProviderProofSummary,
): StoryboardGeneratedImageProvenance {
  return {
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    authMode: proof.authMode,
    endpoint: proof.endpoint,
    agentModel: proof.agentModel,
    requestToolType: proof.requestToolType,
    requestToolModel: proof.requestToolModel,
    model: proof.model,
    modelProvenance: proof.modelProvenance,
    responseId: proof.responseId,
    imageCallId: proof.imageCallId,
    imageItemCount: proof.imageItemCount,
    generatedImageItemTypes: proof.generatedImageItemTypes,
    rawImageItemTypes: proof.rawImageItemTypes,
    requestHash: proof.requestHash,
    responseHash: proof.responseHash,
    hasOpenAIAPIKey: false,
    generatedAt: proof.generatedAt,
  };
}

function readLocalCodexProof(env: NodeJS.ProcessEnv) {
  try {
    return toProofSummary(
      JSON.parse(readFileSync(resolveLocalCodexProvenanceFile(env), 'utf8')),
    );
  } catch {
    return null;
  }
}

export function getStoryboardImageProviderAvailability(
  env: NodeJS.ProcessEnv = process.env,
): StoryboardImageProviderAvailability {
  const model = resolveLocalCodexStoryboardModel(env);
  const target = getStoryboardImageTarget();
  const command = resolveLocalCodexStoryboardCommandParts(env).label;

  if (!isAllowedLocalCodexStoryboardModel(model)) {
    return {
      available: false,
      reason: 'local_codex_model_not_allowed',
      command,
      model,
      providerId: STORYBOARD_IMAGE_PROVIDER_ID,
      modelProvenance: 'unverified',
      target,
    };
  }

  if (!isLocalCodexCommandAvailable(env)) {
    return {
      available: false,
      reason: 'local_codex_bridge_unavailable',
      command,
      model,
      providerId: STORYBOARD_IMAGE_PROVIDER_ID,
      modelProvenance: 'unverified',
      target,
    };
  }

  const proof = readLocalCodexProof(env);
  if (proof) {
    return {
      available: true,
      reason: 'ready',
      command,
      model: STORYBOARD_IMAGE_PROVIDER_MODEL,
      providerId: STORYBOARD_IMAGE_PROVIDER_ID,
      modelProvenance: STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE,
      target,
      proof,
    };
  }

  return {
    available: false,
    reason: 'local_codex_model_provenance_unverified',
    command,
    model,
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    modelProvenance: 'unverified',
    target,
  };
}

function trimForPrompt(value: string, maxLength: number) {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

type StoryboardVisualRoleContract = {
  label: string;
  mustShow: string;
  mustAvoid: string;
  cameraAndAction: string;
};

const STORYBOARD_VISUAL_ROLE_CONTRACTS: StoryboardVisualRoleContract[] = [
  {
    label: 'storefront intro / outside arrival',
    mustShow: 'restaurant exterior arrival, doorway or street atmosphere, cropped hand or back-of-head silhouette only, food teaser as a small secondary detail',
    mustAvoid: 'do not show eating action, noodle lift, full table hero composition, or interior detail-only shot yet',
    cameraAndAction: 'wide establishing shot from outside, calm arrival action',
  },
  {
    label: 'ordering and menu context setup',
    mustShow: 'ordering moment, cropped hand pointing near a menu-like object, ingredient hints, table not fully filled yet',
    mustAvoid: 'no readable menu text, no finished feast, no bite reaction, no empty bowls',
    cameraAndAction: 'medium planning shot focused on hands and ordering context',
  },
  {
    label: 'kitchen prep / sizzle anticipation',
    mustShow: 'steam, sizzling pan, boiling broth, prep hands, cooking texture before serving',
    mustAvoid: 'no table-wide feast, no host reaction, no finished empty bowls, no storefront exterior',
    cameraAndAction: 'medium prep shot with motion from steam or cooking tools',
  },
  {
    label: 'full table arrival reveal',
    mustShow: 'entire spread arriving on the table, main dish plus side dishes and sauces visible at once',
    mustAvoid: 'no single bite close-up, no drink break, no outro street shot',
    cameraAndAction: 'wide overhead or three-quarter table reveal',
  },
  {
    label: 'first bite reaction without face detail',
    mustShow: 'first bite being lifted by chopsticks or spoon, cropped hands, food near frame edge, implied reaction without face',
    mustAvoid: 'no recognizable face, no repeated full-table layout, no empty bowls',
    cameraAndAction: 'tight food-and-hands shot at the decisive first bite moment',
  },
  {
    label: 'texture / ASMR macro detail',
    mustShow: 'macro texture, noodle stretch or crispy surface or broth ripple, microphone-like object or utensil detail if natural',
    mustAvoid: 'no storefront, no wide table, no note-taking, no final evaluation pose',
    cameraAndAction: 'extreme close-up with sensory texture as the focal point',
  },
  {
    label: 'sauce / side combination change',
    mustShow: 'sauce dip, side dish added on top, before-and-after combination implied in one coherent frame',
    mustAvoid: 'no full table hero shot, no first bite duplicate, no drink reset',
    cameraAndAction: 'medium shot of hands changing the flavor combination',
  },
  {
    label: 'pacing reset / drink / palate cleanser',
    mustShow: 'drink glass, water bottle, chopsticks resting, small pause between eating beats',
    mustAvoid: 'no dramatic food lift, no cooking action, no hero feast, no outro exterior',
    cameraAndAction: 'quiet medium shot with negative space and a resting rhythm',
  },
  {
    label: 'peak feast / hero table composition',
    mustShow: 'largest feast moment, abundant table, strongest food hero shape, steam and glossy highlights',
    mustAvoid: 'no storefront, no empty bowls, no note-taking detail-only shot, no drink-only frame',
    cameraAndAction: 'dynamic wide hero shot built for a thumbnail-like climax',
  },
  {
    label: 'almost finished / empty bowls satisfaction',
    mustShow: 'nearly empty bowls, sauce traces, finished plates, utensils resting after the meal',
    mustAvoid: 'no fresh full-table reveal, no raw prep, no first bite, no menu ordering',
    cameraAndAction: 'calm post-meal table shot showing completion evidence',
  },
  {
    label: 'final taste evaluation / note-taking',
    mustShow: 'cropped hand writing notes or rating thoughts beside one representative dish remnant',
    mustAvoid: 'no readable text, no host face, no cooking steam action, no storefront wide shot',
    cameraAndAction: 'medium evaluation shot with notebook-like prop but no legible writing',
  },
  {
    label: 'next episode prompt / outro exterior',
    mustShow: 'leaving the restaurant area, outside mood, next-food hint as a small object or silhouette',
    mustAvoid: 'no eating action, no full feast, no macro texture, no note-taking table',
    cameraAndAction: 'wide outro shot from behind or outside, forward-looking exit beat',
  },
];

function getStoryboardVisualRoleContract(scene: StoryboardScene) {
  const safeSceneNo = Number.isFinite(scene.sceneNo) ? Math.trunc(scene.sceneNo) : 1;
  return STORYBOARD_VISUAL_ROLE_CONTRACTS[
    ((Math.max(1, safeSceneNo) - 1) % STORYBOARD_VISUAL_ROLE_CONTRACTS.length)
  ];
}

export function buildStoryboardSceneImagePrompt(scene: StoryboardScene, context: StoryboardImageContext) {
  const visualRole = getStoryboardVisualRoleContract(scene);
  return [
    'Create exactly one full-bleed 16:9 single-scene storyboard cut image for a Korean food-travel / mukbang planning board.',
    'Composition contract: the entire image must be one continuous scene filling the full canvas edge-to-edge. This image will be placed into an external 2x2 grid by the web UI; never draw that grid inside the image.',
    'Hard negatives: no storyboard sheet, no comic page, no multi-panel layout, no split-screen, no inset panels, no thumbnail contact sheet, no wireframe boxes, no internal borders, no crop marks, no frame guides, no blank quadrants, no placeholder rectangles, and no X-mark empty panels.',
    'Style: cinematic hand-drawn food-storyboard keyframe, clean black pencil lines, subtle warm food-color accents, strong single focal point, no UI chrome.',
    'Safety: do not recreate a real person likeness; no recognizable face, no face close-up, no host face at all, and no detailed eyes/nose/mouth. Keep all human faces outside the frame; if a person is implied, keep any face outside frame. Show human presence only through cropped hands, chopsticks, food, over-shoulder silhouette, back-of-head silhouette, or cropped body parts without facial detail. No logos, watermarks, readable brand names, URLs, prices, or final typography.',
    `Visual role contract: CUT ${String(scene.sceneNo).padStart(2, '0')} is "${visualRole.label}".`,
    `Must show for this CUT: ${visualRole.mustShow}.`,
    `Camera/action contract for this CUT: ${visualRole.cameraAndAction}.`,
    `Must avoid for this CUT: ${visualRole.mustAvoid}.`,
    'Neighbor difference rule: adjacent CUTs must not reuse the same camera distance, food action, subject emphasis, or pacing beat.',
    'Sequence diversity rule: do not default to repeated food-only or noodle-lift shots; use a lifted noodle/bite only when the role explicitly needs first-bite, ASMR texture, or peak-feast emphasis, and keep surrounding context visible.',
    `Storyboard title: ${trimForPrompt(context.title, 120)}`,
    `Overall logline: ${trimForPrompt(context.logline, 180)}`,
    `User brief: ${trimForPrompt(context.request.prompt, 220)}`,
    `CUT ${scene.sceneNo}: ${trimForPrompt(scene.title, 80)}`,
    `Visual direction: ${trimForPrompt(scene.visualDirection, 220)}`,
    `Operator intent: ${trimForPrompt(scene.operatorIntent, 180)}`,
    `Caption idea for mood only, do not render readable text: ${trimForPrompt(scene.captionIdea, 120)}`,
    `Heatmap evidence mood: ${scene.heatmapEvidence.peakTime}, replay score ${scene.heatmapEvidence.replayScore}.`,
    'Output only the image. Fill the whole frame with one coherent CUT; do not include scene labels, timecodes, captions, subtitles, handwriting, speech bubbles, or any readable text.',
  ].join('\n');
}

type LocalCodexStoryboardCommandResult = {
  ok?: boolean;
  providerId?: string;
  authMode?: string;
  endpoint?: string;
  agentModel?: string;
  requestToolType?: string;
  requestToolModel?: string;
  model?: string;
  modelProvenance?: string;
  responseId?: string;
  imageCallId?: string;
  imageItemCount?: number;
  rawImageItemTypes?: string[];
  mime?: string;
  bytes?: number;
  outputPath?: string;
  rawResponsePath?: string;
  hasOpenAIAPIKey?: boolean;
  generatedAt?: string;
  code?: string;
  error?: string;
};

function createStoryboardImageRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

function getStoryboardGeneratedImageRoot() {
  return resolve(process.cwd(), 'public/qa-history/storyboard/generated');
}

function assertPathInside(root: string, target: string) {
  const safeRoot = resolve(root);
  const safeTarget = resolve(target);
  const pathFromRoot = relative(safeRoot, safeTarget);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new StoryboardImageGenerationError(
      'invalid_payload',
      '스토리보드 이미지 출력 경로가 허용된 public history 디렉터리를 벗어났습니다.',
      400,
    );
  }
  return safeTarget;
}

function parseLocalCodexCommandStdout(stdout: string): LocalCodexStoryboardCommandResult {
  const jsonLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!jsonLine) {
    throw new StoryboardImageGenerationError(
      'provider_execution_failed',
      '로컬 Codex gpt-image-2 bridge가 JSON 결과를 반환하지 않았습니다.',
      502,
    );
  }
  try {
    return JSON.parse(jsonLine) as LocalCodexStoryboardCommandResult;
  } catch (error) {
    throw new StoryboardImageGenerationError(
      'provider_execution_failed',
      `로컬 Codex gpt-image-2 bridge JSON 파싱에 실패했습니다: ${error instanceof Error ? error.message : 'unknown'}`,
      502,
    );
  }
}

function validateLocalCodexCommandResult(
  result: LocalCodexStoryboardCommandResult,
  expectedOutputPath: string,
): StoryboardImageProviderProofSummary {
  const proof = toProofSummary(result);
  if (!proof || result.outputPath !== expectedOutputPath) {
    throw new StoryboardImageGenerationError(
      'provider_execution_failed',
      '로컬 Codex bridge가 exact local-codex gpt-image-2 provenance를 증명하지 못해 이미지를 폐기했습니다.',
      502,
    );
  }
  return proof;
}

function runLocalCodexStoryboardCommand(
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
) {
  const { command, args } = resolveLocalCodexStoryboardCommandParts(env);
  return new Promise<LocalCodexStoryboardCommandResult>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
        OPENAI_API_KEY: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      rejectCommand(new StoryboardImageGenerationError(
        'provider_execution_failed',
        '로컬 Codex gpt-image-2 bridge 실행 시간이 초과되었습니다.',
        504,
      ));
    }, LOCAL_CODEX_COMMAND_TIMEOUT_MS);

    const appendStdout = (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > LOCAL_CODEX_COMMAND_MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        rejectCommand(new StoryboardImageGenerationError(
          'provider_execution_failed',
          '로컬 Codex gpt-image-2 bridge stdout이 허용 크기를 초과했습니다.',
          502,
        ));
      }
    };
    const appendStderr = (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > LOCAL_CODEX_COMMAND_MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        rejectCommand(new StoryboardImageGenerationError(
          'provider_execution_failed',
          '로컬 Codex gpt-image-2 bridge stderr가 허용 크기를 초과했습니다.',
          502,
        ));
      }
    };

    child.stdout.on('data', appendStdout);
    child.stderr.on('data', appendStderr);
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectCommand(new StoryboardImageGenerationError(
        'provider_execution_failed',
        `로컬 Codex gpt-image-2 bridge를 실행하지 못했습니다: ${error.message}`,
        502,
      ));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        let parsed: LocalCodexStoryboardCommandResult | null = null;
        try {
          parsed = stdout.trim() ? parseLocalCodexCommandStdout(stdout) : null;
        } catch {
          parsed = null;
        }
        rejectCommand(new StoryboardImageGenerationError(
          'provider_execution_failed',
          parsed?.error
            ? `로컬 Codex gpt-image-2 bridge 실패: ${parsed.error}`
            : `로컬 Codex gpt-image-2 bridge가 실패했습니다(exit ${code}): ${stderr.slice(0, 800)}`,
          502,
        ));
        return;
      }
      try {
        resolveCommand(parseLocalCodexCommandStdout(stdout));
      } catch (error) {
        rejectCommand(error);
      }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

async function getVerifiedGeneratedImageFile(path: string) {
  const fileStat = await stat(path);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new StoryboardImageGenerationError(
      'provider_execution_failed',
      '로컬 Codex bridge가 유효한 이미지 파일을 생성하지 않았습니다.',
      502,
    );
  }
  return fileStat;
}

export async function generateStoryboardSceneImage(
  scene: StoryboardScene,
  context: StoryboardImageContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoryboardSceneGeneratedImage> {
  const availability = getStoryboardImageProviderAvailability(env);
  if (!availability.available) {
    throw new StoryboardImageGenerationError(
      'provider_unavailable',
      `Local Codex 스토리보드 이미지 생성은 exact ${LOCAL_CODEX_ALLOWED_MODEL} backend provenance를 증명할 수 없어 중단되었습니다: ${availability.reason}`,
      503,
    );
  }

  const prompt = buildStoryboardSceneImagePrompt(scene, context);
  const runId = createStoryboardImageRunId();
  const publicDir = `${STORYBOARD_GENERATED_IMAGE_PUBLIC_ROOT}/${runId}`;
  const outputRoot = getStoryboardGeneratedImageRoot();
  const outputPath = assertPathInside(
    outputRoot,
    join(outputRoot, runId, `cut-${String(scene.sceneNo).padStart(2, '0')}.png`),
  );
  await mkdir(dirname(outputPath), { recursive: true });

  const result = await runLocalCodexStoryboardCommand(
    {
      prompt,
      sceneNo: scene.sceneNo,
      outputPath,
      size: env.STORYBOARD_LOCAL_CODEX_IMAGE_SIZE || STORYBOARD_IMAGE_OUTPUT_SIZE,
      outputFormat: 'png',
      background: 'opaque',
      agentModel: env.CODEX_IMAGEGEN_AGENT_MODEL || 'gpt-5.5',
      reasoningEffort: env.CODEX_IMAGEGEN_AGENT_EFFORT || 'high',
      timeout: 300,
    },
    env,
  );
  const proof = validateLocalCodexCommandResult(result, outputPath);
  await getVerifiedGeneratedImageFile(outputPath);

  return {
    dataUrl: `${publicDir}/cut-${String(scene.sceneNo).padStart(2, '0')}.png`,
    mime: 'image/png',
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    trustPolicy: STORYBOARD_GENERATED_IMAGE_TRUST_POLICY,
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    prompt,
    generatedAt: proof.generatedAt ?? new Date().toISOString(),
    warnings: [
      'local_codex_provider: generated via local Codex OAuth provider and persisted for admin storyboard display.',
      `exact_provenance: ${proof.requestToolType}.${proof.requestToolModel} response=${proof.responseId} call=${proof.imageCallId}`,
    ],
    provenance: toStoryboardGeneratedImageProvenance(proof),
  };
}

export async function generateStoryboardSceneImages(
  scenes: StoryboardScene[],
  context: StoryboardImageContext,
  env: NodeJS.ProcessEnv = process.env,
) {
  const limitedScenes = scenes.slice(0, 4);
  const images: Array<{ sceneNo: number; image: StoryboardSceneGeneratedImage }> = [];
  for (const scene of limitedScenes) {
    images.push({
      sceneNo: scene.sceneNo,
      image: await generateStoryboardSceneImage(scene, context, env),
    });
  }
  return images;
}
