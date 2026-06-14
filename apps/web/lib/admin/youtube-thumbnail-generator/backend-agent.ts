import { accessSync, constants, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

import { buildYoutubeThumbnailPrompt } from './prompt';
import { generateYoutubeThumbnailWithPrompt } from './providers';
import type {
  ThumbnailChatAgentRequest,
  ThumbnailChatAgentResult,
  ThumbnailBackendAgentRun,
  ThumbnailBackendAgentStatus,
  PublicThumbnailBackendAgentStatus,
  ThumbnailChatCanvasPatch,
  ThumbnailChatTextLayerPatch,
  ThumbnailGeneratorPayload,
  ThumbnailGenerationResult,
  ThumbnailReferenceImage,
  ThumbnailTextLayer,
} from './types';
import { ThumbnailGenerationError, YOUTUBE_THUMBNAIL_TARGET_HEIGHT, YOUTUBE_THUMBNAIL_TARGET_WIDTH } from './types';

const BACKEND_AGENT_GRAPH = 'src/graph.py';
const BACKEND_AGENT_RUNNER = 'scripts/run-thumbnail-agent.py';
const APP_WEB_MARKER = 'app/api/admin/youtube-thumbnail-generator/route.ts';
const DEFAULT_THUMBNAIL_AGENT_TIMEOUT_MS = 120_000;
const MIN_THUMBNAIL_AGENT_TIMEOUT_MS = 5_000;
const MAX_THUMBNAIL_AGENT_TIMEOUT_MS = 600_000;
const DEFAULT_THUMBNAIL_AGENT_RUNTIME = 'codex_cli_oauth';
const DEFAULT_THUMBNAIL_AGENT_CODEX_MODEL = 'gpt-5.5';
const DEFAULT_THUMBNAIL_AGENT_CODEX_EFFORT = 'high';
const REQUIRED_PYTHON_MODULES = ['langgraph', 'langchain_core', 'langchain_openai'];
const UNSAFE_COMMAND_PATTERN = /[\s;&|`$<>()[\]{}!#\n\r]/;
const SECRET_PATTERNS = [
  /sk-proj-[A-Za-z0-9_-]{12,}/g,
  /sk-[A-Za-z0-9_-]{12,}/g,
  /eyJ[A-Za-z0-9_.-]{20,}/g,
  /(OPENAI[_A-Z]*|SERVICE[_A-Z]*|SUPABASE[_A-Z]*|API[_A-Z]*KEY|TOKEN|SECRET)\s*[:=]\s*[^\s,;]+/gi,
  /https:\/\/[^\s]+(?:token|key|secret)[^\s]*/gi,
];

type ResolvedThumbnailAgentCommand =
  | { ok: true; executable: string; args: string[] }
  | { ok: false; reason: string };

type CommandResult = {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
};

type ThumbnailAgentExecutionOptions = {
  signal?: AbortSignal;
  runId?: string;
  providerEnv?: NodeJS.ProcessEnv;
};

type ThumbnailAgentPlan = {
  mode: ThumbnailBackendAgentRun['mode'];
  runtime: string;
  concept: string;
  layoutBrief: string;
  promptAddendum: string;
  safetyReview: string;
  nextActions: string[];
  warnings: string[];
  diagnostics: Record<string, unknown>;
};

const TZUYANG_TOPIC_PATTERN = /(쯔양|tzuyang)/i;
const TZUYANG_CHANNEL_PRESET = 'tzuyang-food-travel-collage';
const PERSON_REFERENCE_ROLES = new Set<ThumbnailReferenceImage['role']>(['host', 'person']);
const CHAT_EXPLICIT_HEADLINE_PATTERN = /(?:^|[\n,;])\s*(?:메인\s*문구|메인|큰\s*문구|제목|headline)\s*[:：]\s*([^\n,;]+)/i;
const CHAT_EXPLICIT_HEADLINE_PARTICLE_PATTERN = /(?:^|[\n,;.])\s*(?:메인\s*)?(?:문구|제목)\s*(?:은|는|=)\s*["“'‘]?([^"”'’\n,;.]{2,42})/i;
const CHAT_EXPLICIT_SUBHEADLINE_PATTERN = /(?:^|[\n,;])\s*(?:보조\s*문구|보조|스티커|서브|sub)\s*[:：]\s*([^\n,;]+)/i;
const CHAT_TEXT_IDENTITY_PATTERN = /(쯔양|tzuyang|youtube\s*channel|유튜브\s*채널|계정|@[\w_.-]+)/gi;
const CHAT_REPLACEMENT_ACTION_PATTERN = /(?:수정|바꿔|바꾸|변경|교체|고쳐|고치)/i;
const CHAT_REPLACEMENT_TARGET_HEADLINE_PATTERN = /(?:메인\s*문구|메인|큰\s*문구|큰\s*제목|제목|headline)/i;
const CHAT_REPLACEMENT_TARGET_SUBHEADLINE_PATTERN = /(?:스티커\s*문구|스티커|보조\s*문구|보조|서브|작은\s*문구|sub)/i;
const CHAT_REPLACEMENT_TARGET_SELECTED_PATTERN = /(?:선택된\s*문구|선택\s*문구|현재\s*문구|이\s*문구|이거|그거|해당\s*문구)/i;
const CHAT_CANVAS_OPTIMIZATION_PATTERN = /(조회수|클릭률|클릭|CTR|최적화|가독성|잘\s*나오|잘\s*읽히|잘\s*보이|눈에\s*띄|주목|강조|배치|위치|폰트|크기)/i;
const CHAT_LOCAL_CODEX_PROVIDER_PATTERN = /(local\s*codex|로컬\s*codex|codex\s*(?:built-in|imagegen|로컬)|로컬\s*이미지젠|imagegen\s*로컬)/i;
const CHAT_OPENAI_GPT_IMAGE_2_PROVIDER_PATTERN = /(open\s*ai|오픈\s*ai|오픈에이아이)/i;
const MAIN_HEADLINE_MAX_LENGTH = 36;
const AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH = 14;
const SUB_HEADLINE_MAX_LENGTH = 20;
const FOOD_SUBJECT_MAX_LENGTH = 14;
const TZUYANG_BENCHMARK_COPY_SIGNAL_PATTERN =
  /\d+\s*(?:kg|KG|인분|그릇|마리|종|개|년|만원|cm|CM|m|M)|대왕|얼굴만한|역대급|끝판왕|밥도둑|전통|무한|최대|가득|폭탄|통수육|볶음밥|한상|레전드/i;

type ThumbnailChatReplacementTarget = 'headline' | 'subHeadline' | 'selected' | 'exact';

type ThumbnailChatReplacementIntent = {
  target: ThumbnailChatReplacementTarget;
  oldText?: string;
  newText: string;
};

function resolveThumbnailAgentCodexModel(env: NodeJS.ProcessEnv = process.env) {
  return env.THUMBNAIL_AGENT_CODEX_MODEL?.trim() || DEFAULT_THUMBNAIL_AGENT_CODEX_MODEL;
}

function resolveThumbnailAgentCodexEffort(env: NodeJS.ProcessEnv = process.env) {
  return env.THUMBNAIL_AGENT_CODEX_EFFORT?.trim() || DEFAULT_THUMBNAIL_AGENT_CODEX_EFFORT;
}

function requestsSpecificCreatorHost(payload: ThumbnailGeneratorPayload) {
  return TZUYANG_TOPIC_PATTERN.test(payload.topic)
    || (payload.stylePreset ?? TZUYANG_CHANNEL_PRESET) === TZUYANG_CHANNEL_PRESET;
}

function hasHostPersonReference(referenceImages: ThumbnailReferenceImage[]) {
  return referenceImages.some((image) => PERSON_REFERENCE_ROLES.has(image.role));
}

function allowsSpecificCreatorHost(_payload: ThumbnailGeneratorPayload, referenceImages: ThumbnailReferenceImage[]) {
  return hasHostPersonReference(referenceImages);
}

function firstExistingPath(candidates: string[]) {
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function resolveAppWebRoot() {
  return firstExistingPath([
    process.cwd(),
    path.resolve(process.cwd(), 'apps/web'),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
  ].filter((candidate) => existsSync(path.join(candidate, APP_WEB_MARKER))));
}

const APP_WEB_ROOT = resolveAppWebRoot();
const BACKEND_AGENT_ROOT = process.env.THUMBNAIL_AGENT_ROOT?.trim()
  ? path.resolve(APP_WEB_ROOT, process.env.THUMBNAIL_AGENT_ROOT.trim())
  : firstExistingPath([
    path.resolve(APP_WEB_ROOT, '../../backend/thumbnail-agent'),
    path.resolve(process.cwd(), 'backend/thumbnail-agent'),
  ]);

function backendAgentPath(relativePath: string) {
  return path.join(BACKEND_AGENT_ROOT, relativePath);
}

function resolveThumbnailAgentPython(env: NodeJS.ProcessEnv = process.env) {
  return env.THUMBNAIL_AGENT_PYTHON?.trim() || 'python3';
}

function resolveThumbnailAgentRuntime(env: NodeJS.ProcessEnv = process.env) {
  return env.THUMBNAIL_AGENT_RUNTIME?.trim() || DEFAULT_THUMBNAIL_AGENT_RUNTIME;
}

function resolveThumbnailAgentTimeoutMs(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Number(env.THUMBNAIL_AGENT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_THUMBNAIL_AGENT_TIMEOUT_MS;
  return Math.min(MAX_THUMBNAIL_AGENT_TIMEOUT_MS, Math.max(MIN_THUMBNAIL_AGENT_TIMEOUT_MS, Math.floor(parsed)));
}

function sanitizeCommandOutput(raw: string) {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), raw);
}

function resolveThumbnailAgentCommand(rawCommand?: string | null): ResolvedThumbnailAgentCommand {
  const command = rawCommand?.trim();
  const executableCandidates = command
    ? (path.isAbsolute(command)
      ? [command]
      : [
        path.resolve(APP_WEB_ROOT, command),
        path.resolve(process.cwd(), command),
        path.resolve(BACKEND_AGENT_ROOT, command),
      ])
    : [backendAgentPath(BACKEND_AGENT_RUNNER)];
  if (command && UNSAFE_COMMAND_PATTERN.test(command)) return { ok: false, reason: 'unsafe-command-string' };
  const executable = firstExistingPath(executableCandidates);
  try {
    accessSync(executable, constants.X_OK);
    return { ok: true, executable, args: [] };
  } catch {
    return { ok: false, reason: 'command-not-executable' };
  }
}

function listMissingPythonModules(env: NodeJS.ProcessEnv = process.env) {
  const script = [
    'import importlib, json',
    `mods = ${JSON.stringify(REQUIRED_PYTHON_MODULES)}`,
    'missing = []',
    'for mod in mods:',
    '    try:',
    '        importlib.import_module(mod)',
    '    except Exception:',
    '        missing.append(mod)',
    'print(json.dumps(missing))',
  ].join('\n');
  const result = spawnSync(resolveThumbnailAgentPython(env), ['-c', script], {
    cwd: BACKEND_AGENT_ROOT,
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      ...env,
      PYTHONPATH: [backendAgentPath('src'), env.PYTHONPATH ?? process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    },
  });
  if (result.error || result.status !== 0) return REQUIRED_PYTHON_MODULES;
  try {
    const parsed = JSON.parse(result.stdout.trim()) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : REQUIRED_PYTHON_MODULES;
  } catch {
    return REQUIRED_PYTHON_MODULES;
  }
}

export function getThumbnailBackendAgentStatus(env: NodeJS.ProcessEnv = process.env): ThumbnailBackendAgentStatus {
  const commandResolution = resolveThumbnailAgentCommand(env.THUMBNAIL_AGENT_COMMAND);
  const commandConfigured = Boolean(env.THUMBNAIL_AGENT_COMMAND?.trim());
  const graphEntrypoint = existsSync(backendAgentPath(BACKEND_AGENT_GRAPH)) ? backendAgentPath(BACKEND_AGENT_GRAPH) : null;
  const runnerEntrypoint = existsSync(backendAgentPath(BACKEND_AGENT_RUNNER)) ? backendAgentPath(BACKEND_AGENT_RUNNER) : null;
  const localAdapterAvailable = existsSync(BACKEND_AGENT_ROOT) && Boolean(graphEntrypoint) && Boolean(runnerEntrypoint);
  const commandAvailable = commandResolution.ok;
  const runtime = resolveThumbnailAgentRuntime(env);
  const missingPythonModules = (commandConfigured && runtime !== 'codex_cli_oauth') || runtime === 'local_graph'
    ? listMissingPythonModules(env)
    : [];

  return {
    available: commandAvailable || localAdapterAvailable,
    mode: commandConfigured ? 'command' : 'local_adapter',
    rootPath: BACKEND_AGENT_ROOT,
    graphEntrypoint,
    commandConfigured,
    commandAvailable,
    commandPath: commandResolution.ok ? commandResolution.executable : undefined,
    commandRejectionReason: commandResolution.ok ? undefined : commandResolution.reason,
    localAdapterAvailable,
    missingPythonModules,
    runtime,
    codexModel: resolveThumbnailAgentCodexModel(env),
    codexEffort: resolveThumbnailAgentCodexEffort(env),
    streamingAvailable: true,
  };
}

export function toPublicThumbnailBackendAgentStatus(
  status: ThumbnailBackendAgentStatus,
): PublicThumbnailBackendAgentStatus {
  const { rootPath: _rootPath, graphEntrypoint: _graphEntrypoint, commandPath: _commandPath, ...publicStatus } = status;
  return {
    ...publicStatus,
    diagnosticsRedacted: true,
  };
}

function summarizeReferences(
  referenceImages: ThumbnailReferenceImage[],
  allowSpecificCreatorHost: boolean,
  requestedSpecificCreatorHost = false,
) {
  if (!referenceImages.length) {
    if (requestedSpecificCreatorHost) {
      return '참고 이미지 없음: 특정 크리에이터 likeness는 host/person reference가 필요하므로 음식 중심/비식별 베이스로 구성';
    }
    return allowSpecificCreatorHost
      ? 'host/person reference 확인: 제공된 참고 이미지 기반 호스트 컷아웃만 허용'
      : '참고 이미지 없음: no-person food-first 또는 generic non-identifying collage로 구성';
  }
  return referenceImages
    .slice(0, 8)
    .map((image, index) => `${index + 1}. ${image.role} reference / ${image.mime} / ${image.name}`)
    .join('\n');
}


function summarizeRetrievalEvidence(payload: ThumbnailGeneratorPayload) {
  const evidence = payload.retrievalEvidence ?? [];
  const diagnostics = payload.retrievalDiagnostics;
  const evidenceSummary = evidence.length
    ? evidence.slice(0, 4).map((item, index) => {
      const score = typeof item.rerankScore === 'number'
        ? `rerank=${item.rerankScore.toFixed(3)}`
        : typeof item.hybridScore === 'number'
          ? `hybrid=${item.hybridScore.toFixed(3)}`
          : 'score=n/a';
      const source = [item.videoId, item.title].filter(Boolean).join(' · ') || item.id;
      return `${index + 1}. ${item.intent}/${item.uploadRole} · ${source} · ${score} · ${item.selectedReason}`;
    }).join('\n')
    : 'retrieval evidence 없음';
  const proofSummary = diagnostics
    ? [
      `status=${diagnostics.status}`,
      `runtime=${diagnostics.commandRuntime ?? 'none'}`,
      diagnostics.usedModels?.embedding ? `embedding=${diagnostics.usedModels.embedding}` : null,
      diagnostics.usedModels?.reranker ? `reranker=${diagnostics.usedModels.reranker}` : null,
      diagnostics.operations?.denseSparseHybrid ? 'hybrid=true' : null,
      diagnostics.operations?.mmrApplied ? 'mmr=true' : null,
      diagnostics.operations?.rerankerApplied ? 'rerank=true' : null,
      diagnostics.fallbackReason ? `fallback=${diagnostics.fallbackReason}` : null,
    ].filter(Boolean).join(' · ')
    : 'diagnostics 없음';
  return { evidenceSummary, proofSummary, evidenceCount: evidence.length };
}

function buildLocalAgentPlan(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  basePrompt: string,
  fallbackReason = 'command-not-configured',
): ThumbnailAgentPlan {
  const requestedSpecificHost = requestsSpecificCreatorHost(payload);
  const allowSpecificHost = allowsSpecificCreatorHost(payload, referenceImages);
  const subHeadline = payload.subHeadline ? `보조 문구 "${payload.subHeadline}"를 작은 스티커처럼 분리` : '보조 문구는 필요할 때만 작은 반응 스티커로 분리';
  const retrieval = summarizeRetrievalEvidence(payload);
  const concept = `${payload.headline} 중심의 고대비 먹방 썸네일: 검색 레퍼런스 ${retrieval.evidenceCount}건을 바탕으로 음식 클로즈업과 리액션 존을 분리해 클릭 전에 주제가 즉시 읽히게 한다.`;
  const hostZone = allowSpecificHost
    ? '오른쪽 또는 좌상단에 제공된 host/person reference와 일치하는 쯔양 호스트 컷아웃을 반드시 보이게 둔다. 빈 실루엣, 사람 없는 음식-only 결과, generic 인물 대체는 실패로 본다. 제공 레퍼런스에 일관되게 없는 안경/모자/마스크/무거운 액세서리는 새로 만들지 않는다.'
    : requestedSpecificHost
      ? '쯔양/특정 크리에이터 host/person 레퍼런스가 없으므로 사람 얼굴은 만들지 말고 음식 중심 또는 비식별 리액션 존으로 둔다.'
      : '오른쪽 또는 좌상단은 비식별 리액션/호스트 존 또는 음식 디테일 존으로 둔다.';
  const layoutBrief = [
    '하단 40~50%는 음식 클로즈업으로 채우고, 메인 문구가 겹칠 안전 영역을 남긴다.',
    hostZone,
    subHeadline,
    '실제 상표/간판/가격/연락처는 제거하고, 최종 한글 타이포는 캔버스에서 편집한다.',
  ].join(' ');
  const promptAddendum = [
    'Backend thumbnail agent orchestration brief:',
    `Concept: ${concept}`,
    `Layout: ${layoutBrief}`,
    `Reference plan:\n${summarizeReferences(referenceImages, allowSpecificHost, requestedSpecificHost)}`,
    `Retrieved reference plan:\n${retrieval.evidenceSummary}`,
    `Retrieval diagnostics: ${retrieval.proofSummary}`,
    allowSpecificHost
      ? 'Quality gate: preserve a clear editable headline safe area, require a visible reference-backed host cutout when host/person references are present, avoid blank silhouettes or food-only substitutions, avoid baked-in final Korean typography, avoid real logos/signage/contact data/prices, and keep the result suitable for human approval before export.'
      : 'Quality gate: preserve a clear editable headline safe area, map retrieved evidence only to food/style/composition/text zones, avoid baked-in final Korean typography, avoid real logos/signage/contact data/prices, and keep the result suitable for human approval before export.',
  ].join('\n');

  return {
    mode: 'local_adapter',
    runtime: 'local_adapter',
    concept,
    layoutBrief,
    promptAddendum,
    safetyReview: '기존 thumbnail safety validator를 통과한 payload만 backend-agent orchestration으로 전달하며, provider 호출 전후로 사람이 검수해야 합니다.',
    nextActions: ['이미지 생성 결과 검수', '캔버스 문구 위치/크기 조정', '경고가 있으면 업로드 전 승인'],
    warnings: [`backend_agent_local_adapter: backend-agent runner를 사용할 수 없어 Next.js local adapter가 orchestration brief를 생성했습니다. reason=${fallbackReason}`],
    diagnostics: {
      basePromptLength: basePrompt.length,
      referenceImageCount: referenceImages.length,
      retrievalEvidenceCount: retrieval.evidenceCount,
      retrievalProof: retrieval.proofSummary,
      target: `${YOUTUBE_THUMBNAIL_TARGET_WIDTH}x${YOUTUBE_THUMBNAIL_TARGET_HEIGHT}`,
    },
  };
}

function runThumbnailAgentCommand(
  command: Extract<ResolvedThumbnailAgentCommand, { ok: true }>,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  options: ThumbnailAgentExecutionOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ ok: false, exitCode: null, timedOut: false, aborted: true, stdout: '', stderr: 'aborted-before-start' });
      return;
    }
    const timeoutMs = resolveThumbnailAgentTimeoutMs(env);
    const child = spawn(command.executable, command.args, {
      cwd: existsSync(BACKEND_AGENT_ROOT) ? BACKEND_AGENT_ROOT : process.cwd(),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...env,
        THUMBNAIL_AGENT_CODEX_MODEL: resolveThumbnailAgentCodexModel(env),
        THUMBNAIL_AGENT_CODEX_EFFORT: resolveThumbnailAgentCodexEffort(env),
        THUMBNAIL_AGENT_RUN_ID: options.runId ?? '',
        THUMBNAIL_AGENT_JSON: JSON.stringify(payload),
      },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let cleanup = () => undefined;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      cleanup();
      resolve({ ok: false, exitCode: null, timedOut: true, aborted: false, stdout: sanitizeCommandOutput(stdout), stderr: sanitizeCommandOutput(stderr) });
    }, timeoutMs);
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill('SIGTERM');
      resolve({ ok: false, exitCode: null, timedOut: false, aborted: true, stdout: sanitizeCommandOutput(stdout), stderr: sanitizeCommandOutput(stderr) });
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    };

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: exitCode === 0, exitCode, timedOut: false, aborted: false, stdout: sanitizeCommandOutput(stdout), stderr: sanitizeCommandOutput(stderr) });
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, exitCode: null, timedOut: false, aborted: false, stdout: sanitizeCommandOutput(stdout), stderr: sanitizeCommandOutput(String(error)) });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function normalizeChatRequirement(value: string) {
  return value.replace(/[<>`{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 280);
}

function sanitizeCanvasChatText(value: string, fallback: string, maxLength = 18) {
  const sanitized = value
    .replace(CHAT_TEXT_IDENTITY_PATTERN, '')
    .replace(/\s*(?:으로|로)?\s*(?:생성해줘|생성|만들어줘|만들어|그려줘|그려|실행해줘|실행|이미지\s*뽑아줘|뽑아줘|수정해줘|수정|바꿔줘|바꿔|바꾸|변경해줘|변경|교체해줘|교체|고쳐줘|고쳐)\s*$/gi, '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[<>`{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  return sanitized || fallback;
}

function pickExplicitChatField(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.replace(/^["“'‘]|["”'’]$/g, '').trim() ?? '';
}

function joinThumbnailCopyTokens(tokens: Array<string | null | undefined>) {
  const uniqueTokens: string[] = [];
  tokens.forEach((token) => {
    const normalizedToken = token?.replace(/\s+/g, ' ').trim();
    if (!normalizedToken) return;
    if (uniqueTokens.some((existing) => existing === normalizedToken || existing.includes(normalizedToken))) return;
    uniqueTokens.push(normalizedToken);
  });
  return uniqueTokens.join(' ');
}

function deriveBenchmarkThumbnailHeadline(text: string, foodSubject: string) {
  const normalized = normalizeChatRequirement(text);
  if (!normalized || !TZUYANG_BENCHMARK_COPY_SIGNAL_PATTERN.test(normalized)) return '';

  const yearTradition = normalized.match(/\d+\s*년\s*(?:전통|노포)/i)?.[0];
  const quantity = normalized.match(/\d+\s*(?:kg|KG|인분|그릇|마리|종|개|만원|cm|CM|m|M)/)?.[0];
  const hasRiceThief = /밥도둑/.test(normalized);
  const hasFeast = /한상/.test(normalized);
  const scaleSignal = normalized.match(/얼굴만한|대왕|역대급|끝판왕|폭탄|무한|최대|가득|레전드/i)?.[0];

  if (foodSubject && (hasRiceThief || hasFeast)) {
    if (hasRiceThief && hasFeast) return '밥도둑 한상';
    return sanitizeCanvasChatText(
      joinThumbnailCopyTokens([foodSubject, hasRiceThief ? '밥도둑' : null, hasFeast ? '한상' : null]),
      '',
      AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH,
    );
  }

  if (foodSubject && (yearTradition || quantity || scaleSignal)) {
    return sanitizeCanvasChatText(
      joinThumbnailCopyTokens([yearTradition, scaleSignal, quantity, foodSubject]),
      '',
      AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH,
    );
  }

  if (/야시장|시장|노점|길거리/i.test(normalized)) {
    return sanitizeCanvasChatText(
      joinThumbnailCopyTokens([scaleSignal ?? '야시장', /끝판왕/.test(normalized) ? '끝판왕' : null]),
      '',
      AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH,
    );
  }

  return '';
}

function deriveAutomaticThumbnailHeadlineCopy(text: string, requestedHeadline = '', fallback = '역대급 먹방') {
  const normalized = normalizeChatRequirement(`${text} ${requestedHeadline}`);
  const foodSubject = deriveThumbnailFoodSubject(normalized);
  const benchmarkHeadline = deriveBenchmarkThumbnailHeadline(normalized, foodSubject);
  if (benchmarkHeadline) return benchmarkHeadline;
  if (foodSubject) {
    return sanitizeCanvasChatText(`${foodSubject} 먹방`, fallback, AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH);
  }
  return sanitizeCanvasChatText(requestedHeadline || normalized, fallback, AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH);
}

function deriveChatHeadline(text: string, fallback = '역대급 먹방') {
  const explicitHeadline =
    pickExplicitChatField(text, CHAT_EXPLICIT_HEADLINE_PATTERN) ||
    pickExplicitChatField(text, CHAT_EXPLICIT_HEADLINE_PARTICLE_PATTERN);
  if (explicitHeadline) {
    return wantsGeneration(text)
      ? deriveAutomaticThumbnailHeadlineCopy(text, explicitHeadline, fallback)
      : sanitizeCanvasChatText(explicitHeadline, fallback, MAIN_HEADLINE_MAX_LENGTH);
  }
  const quotedText = text.match(/["“'‘]([^"”'’]{2,42})["”'’]/)?.[1]?.trim();
  if (quotedText) {
    return wantsGeneration(text)
      ? deriveAutomaticThumbnailHeadlineCopy(text, quotedText, fallback)
      : sanitizeCanvasChatText(quotedText, fallback, MAIN_HEADLINE_MAX_LENGTH);
  }
  const foodSubject = deriveThumbnailFoodSubject(text);
  const benchmarkHeadline = deriveBenchmarkThumbnailHeadline(text, foodSubject);
  if (benchmarkHeadline) return benchmarkHeadline;
  if (foodSubject) return sanitizeCanvasChatText(`${foodSubject} 먹방`, fallback, AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH);
  if (/불맛|화력|철판|매운/i.test(text)) return '역대급 불맛';
  if (/대왕|대형|거대|압도|많이|양/i.test(text)) return '역대급 먹방';
  if (/한입|가능/i.test(text)) return '한입만 가능?';
  if (/야시장|시장|노점/i.test(text)) return '야시장 먹방';
  return fallback;
}

function deriveChatSubHeadline(text: string, fallback = '한입만 가능?') {
  const explicitSubHeadline = pickExplicitChatField(text, CHAT_EXPLICIT_SUBHEADLINE_PATTERN);
  if (explicitSubHeadline) return sanitizeCanvasChatText(explicitSubHeadline, fallback, SUB_HEADLINE_MAX_LENGTH);
  const foodSubject = deriveThumbnailFoodSubject(text);
  if (foodSubject && /제육|김치찌개|된장찌개|백반|국밥|삼겹살|갈비/i.test(foodSubject)) return '밥도둑 인정?';
  if (foodSubject && /떡볶이|라면|마라|불닭|매운/i.test(foodSubject)) return '맵기 실화?';
  if (foodSubject && /초밥|회|대게|킹크랩|랍스터|해산물/i.test(foodSubject)) return '퀄리티 미쳤다';
  if (/한입|가능/i.test(text)) return '한입만 가능?';
  if (/쯔양|tzuyang/i.test(text)) return '진짜 가능?';
  if (/매운|불맛|화력/i.test(text)) return '불맛 폭발';
  if (/야시장|시장|노점/i.test(text)) return '야시장 클라스';
  return fallback;
}

function deriveThumbnailFoodSubject(text: string) {
  const normalized = normalizeChatRequirement(text);
  const explicitFood = normalized.match(/(?:음식|메뉴|주제|소재)\s*[:：]\s*([가-힣A-Za-z0-9\s]{2,18})/)?.[1]?.trim();
  if (explicitFood) return sanitizeCanvasChatText(explicitFood, '', FOOD_SUBJECT_MAX_LENGTH);
  const foodMatch = normalized.match(/(제육볶음|김치찌개|된장찌개|부대찌개|라면|떡볶이|돈가스|돈까스|삼겹살|갈비|곱창|막창|마라탕|불닭|치킨|피자|햄버거|초밥|스시|회|대게|킹크랩|랍스터|해산물|국밥|백반|고기|꼬치|튀김)/i)?.[1];
  if (foodMatch) return sanitizeCanvasChatText(foodMatch, '', FOOD_SUBJECT_MAX_LENGTH);
  const sceneFallback = normalized.match(/(분식|야시장)/i)?.[1];
  return sceneFallback ? sanitizeCanvasChatText(sceneFallback, '', FOOD_SUBJECT_MAX_LENGTH) : '';
}

function hasExplicitChatHeadline(text: string) {
  return Boolean(pickExplicitChatField(text, CHAT_EXPLICIT_HEADLINE_PATTERN));
}

function hasExplicitChatSubHeadline(text: string) {
  return Boolean(pickExplicitChatField(text, CHAT_EXPLICIT_SUBHEADLINE_PATTERN));
}

function isSelectedLayerChatIntent(text: string) {
  return /(선택된|선택\s*항목|현재\s*캔버스에서\s*선택된|이\s*선택|이거|그거|해당\s*문구|현재\s*문구|선택\s*문구)/i.test(text);
}

function stripChatQuotes(value: string) {
  return value.replace(/^["“'‘]+|["”'’]+$/g, '').trim();
}

function sanitizeChatLayerContent(value: string, fallback: string, maxLength = 80) {
  const sanitized = stripChatQuotes(value)
    .replace(CHAT_TEXT_IDENTITY_PATTERN, '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[<>`{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  return sanitized || fallback;
}

function normalizeChatLayerComparable(value: string) {
  return stripChatQuotes(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ko-KR');
}

function parseRoleTargetedReplacementIntent(text: string): ThumbnailChatReplacementIntent | null {
  const roleMatch = text.match(
    /((?:메인\s*문구|메인|큰\s*문구|큰\s*제목|제목|headline)|(?:스티커\s*문구|스티커|보조\s*문구|보조|서브|작은\s*문구|sub)|(?:선택된\s*문구|선택\s*문구|현재\s*문구|이\s*문구|이거|그거|해당\s*문구))\s*(?:을|를|은|는)?\s+["“'‘]?(.{1,80}?)["”'’]?\s*(?:으로|로)\s*(?:수정|바꿔|바꾸|변경|교체|고쳐|고치)/i,
  );
  if (!roleMatch) return null;
  const role = roleMatch[1] ?? '';
  const rawNewText = roleMatch[2] ?? '';
  let target: ThumbnailChatReplacementTarget = 'selected';
  if (CHAT_REPLACEMENT_TARGET_HEADLINE_PATTERN.test(role)) {
    target = 'headline';
  } else if (CHAT_REPLACEMENT_TARGET_SUBHEADLINE_PATTERN.test(role)) {
    target = 'subHeadline';
  } else if (CHAT_REPLACEMENT_TARGET_SELECTED_PATTERN.test(role)) {
    target = 'selected';
  }
  return {
    target,
    newText: sanitizeChatLayerContent(rawNewText, '', 80),
  };
}

function parseExactTextReplacementIntent(text: string): ThumbnailChatReplacementIntent | null {
  const match = text.match(
    /["“'‘]?(.{2,80}?)["”'’]?\s*(?:을|를)\s+["“'‘]?(.{1,80}?)["”'’]?\s*(?:으로|로)\s*(?:수정|바꿔|바꾸|변경|교체|고쳐|고치)/i,
  );
  if (!match) return null;
  const oldText = sanitizeChatLayerContent(match[1] ?? '', '', 80);
  const newText = sanitizeChatLayerContent(match[2] ?? '', '', 80);
  if (!oldText || !newText) return null;
  return { target: 'exact', oldText, newText };
}

function parseThumbnailChatTextReplacementIntent(request: ThumbnailChatAgentRequest): ThumbnailChatReplacementIntent | null {
  const normalized = normalizeChatRequirement(request.message);
  if (!CHAT_REPLACEMENT_ACTION_PATTERN.test(normalized)) return null;
  return parseRoleTargetedReplacementIntent(normalized) ?? parseExactTextReplacementIntent(normalized);
}

function isThumbnailChatCanvasOptimizationIntent(text: string) {
  return CHAT_CANVAS_OPTIMIZATION_PATTERN.test(text) && !isSelectedLayerChatIntent(text);
}

function resolveSelectedChatLayer(request: ThumbnailChatAgentRequest): ThumbnailTextLayer | null {
  const layers = request.currentTextLayers ?? [];
  const editingLayer = request.editingLayerId
    ? layers.find((layer) => layer.id === request.editingLayerId)
    : undefined;
  if (editingLayer) return editingLayer;
  const activeLayer = request.activeLayerId
    ? layers.find((layer) => layer.id === request.activeLayerId)
    : undefined;
  return activeLayer ?? null;
}

function resolveThumbnailChatReplacementTarget(
  request: ThumbnailChatAgentRequest,
  intent: ThumbnailChatReplacementIntent,
): ThumbnailTextLayer | null {
  const layers = request.currentTextLayers ?? [];
  if (intent.target === 'selected') return resolveSelectedChatLayer(request);
  if (intent.target === 'headline' || intent.target === 'subHeadline') {
    return layers.find((layer) => layer.id === intent.target) ?? null;
  }

  const comparableOldText = normalizeChatLayerComparable(intent.oldText ?? '');
  const matchingLayers = layers.filter((layer) => normalizeChatLayerComparable(layer.content) === comparableOldText);
  if (!matchingLayers.length) return null;
  const editingLayer = request.editingLayerId
    ? matchingLayers.find((layer) => layer.id === request.editingLayerId)
    : undefined;
  if (editingLayer) return editingLayer;
  const activeLayer = request.activeLayerId
    ? matchingLayers.find((layer) => layer.id === request.activeLayerId)
    : undefined;
  if (activeLayer) return activeLayer;
  const headlineLayer = matchingLayers.find((layer) => layer.id === 'headline');
  if (headlineLayer) return headlineLayer;
  let bestLayer = matchingLayers[0];
  if (!bestLayer) return null;
  for (const layer of matchingLayers) {
    if (layer.zIndex > bestLayer.zIndex) bestLayer = layer;
  }
  return bestLayer;
}

function clampChatNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function createSelectedLayerStylePatch(
  normalized: string,
  layer: ThumbnailTextLayer,
): ThumbnailChatTextLayerPatch {
  const patch: ThumbnailChatTextLayerPatch = { id: layer.id };

  if (/(크게|키워|확대|잘\s*보이|강조|개선)/i.test(normalized)) {
    patch.fontSize = clampChatNumber(layer.fontSize + 10, 18, 180);
    patch.strokeWidth = Math.min(18, Math.max(layer.strokeWidth, layer.strokeWidth + 1));
    patch.shadow = layer.shadow === 'none' ? '0 12px 24px rgba(0,0,0,0.72)' : layer.shadow;
  }
  if (/(작게|줄여|축소)/i.test(normalized)) {
    patch.fontSize = clampChatNumber(layer.fontSize - 8, 18, 180);
  }
  if (/(노란|노랑|yellow)/i.test(normalized)) patch.fill = '#fff200';
  if (/(빨간|빨강|red)/i.test(normalized)) patch.fill = '#ff2d2d';
  if (/(흰\s*(?:글자|색|으로)|하얀|white\s*text)/i.test(normalized)) patch.fill = '#ffffff';
  if (/(검정\s*외곽|검은\s*외곽|black\s*stroke)/i.test(normalized)) patch.stroke = '#111111';
  if (/(흰\s*외곽|하얀\s*외곽|white\s*stroke)/i.test(normalized)) patch.stroke = '#ffffff';
  if (/(외곽\s*(?:굵게|두껍게)|굵은\s*외곽)/i.test(normalized)) {
    patch.strokeWidth = Math.min(18, layer.strokeWidth + 2);
  }
  if (/(외곽\s*(?:얇게|줄여)|얇은\s*외곽)/i.test(normalized)) {
    patch.strokeWidth = Math.max(0, layer.strokeWidth - 2);
  }
  if (/(그림자\s*(?:강|진하게|켜)|shadow)/i.test(normalized)) {
    patch.shadow = '0 12px 24px rgba(0,0,0,0.72)';
  }
  if (/(그림자\s*(?:끄|없|제거))/i.test(normalized)) patch.shadow = 'none';
  if (/(왼쪽\s*회전|반시계)/i.test(normalized)) {
    patch.rotation = clampChatNumber(layer.rotation - 8, -180, 180);
  } else if (/(오른쪽\s*회전|시계\s*방향)/i.test(normalized)) {
    patch.rotation = clampChatNumber(layer.rotation + 8, -180, 180);
  } else if (/(회전|기울)/i.test(normalized)) {
    patch.rotation = clampChatNumber(layer.rotation + 6, -180, 180);
  }
  if (/(가운데|중앙|center)/i.test(normalized)) {
    patch.x = 640;
    patch.align = 'center';
  }
  if (/(왼쪽으로|좌측으로)/i.test(normalized)) patch.x = clampChatNumber(layer.x - 48, 0, YOUTUBE_THUMBNAIL_TARGET_WIDTH);
  if (/(오른쪽으로|우측으로)/i.test(normalized)) patch.x = clampChatNumber(layer.x + 48, 0, YOUTUBE_THUMBNAIL_TARGET_WIDTH);
  if (/(위로|상단)/i.test(normalized)) patch.y = clampChatNumber(layer.y - 36, 0, YOUTUBE_THUMBNAIL_TARGET_HEIGHT);
  if (/(아래로|하단)/i.test(normalized)) patch.y = clampChatNumber(layer.y + 36, 0, YOUTUBE_THUMBNAIL_TARGET_HEIGHT);

  if (Object.keys(patch).length === 1) {
    patch.fontSize = clampChatNumber(layer.fontSize + 8, 18, 180);
    patch.shadow = '0 12px 24px rgba(0,0,0,0.72)';
  }

  return patch;
}

function createCanvasOptimizationTextLayerPatches(request: ThumbnailChatAgentRequest): ThumbnailChatTextLayerPatch[] {
  const layers = request.currentTextLayers ?? [];
  return layers.map((layer, index): ThumbnailChatTextLayerPatch => {
    if (layer.id === 'headline') {
      return {
        id: layer.id,
        x: 640,
        y: 520,
        fontFamily: 'Impact, Pretendard, system-ui, sans-serif',
        fontSize: clampChatNumber(Math.max(layer.fontSize, 104), 48, 180),
        fontWeight: 900,
        fill: '#ffffff',
        stroke: '#111111',
        strokeWidth: Math.max(layer.strokeWidth, 12),
        shadow: '0 14px 28px rgba(0,0,0,0.78)',
        align: 'center',
        rotation: 0,
        zIndex: Math.max(layer.zIndex, 20),
      };
    }
    if (layer.id === 'subHeadline') {
      return {
        id: layer.id,
        x: 978,
        y: 168,
        fontFamily: 'Arial Black, Pretendard, system-ui, sans-serif',
        fontSize: clampChatNumber(Math.max(layer.fontSize, 56), 32, 120),
        fontWeight: 900,
        fill: '#fff200',
        stroke: '#111111',
        strokeWidth: Math.max(layer.strokeWidth, 8),
        shadow: '0 10px 22px rgba(0,0,0,0.72)',
        align: 'center',
        rotation: -5,
        zIndex: Math.max(layer.zIndex, 21),
      };
    }
    return {
      id: layer.id,
      x: clampChatNumber(240 + index * 120, 64, YOUTUBE_THUMBNAIL_TARGET_WIDTH - 64),
      y: clampChatNumber(184 + index * 72, 64, YOUTUBE_THUMBNAIL_TARGET_HEIGHT - 64),
      fontSize: clampChatNumber(Math.max(layer.fontSize, 42), 24, 96),
      fontWeight: Math.max(layer.fontWeight, 800),
      strokeWidth: Math.max(layer.strokeWidth, 6),
      shadow: '0 10px 22px rgba(0,0,0,0.72)',
      zIndex: Math.max(layer.zIndex, 18 + index),
    };
  });
}

function getResponsiveMainHeadlineFontSize(headlineText: string, currentFontSize = 88) {
  if (headlineText.length >= 24) return Math.min(currentFontSize, 58);
  if (headlineText.length >= 16) return Math.min(currentFontSize, 66);
  return currentFontSize;
}

function createChatTextLayerPatches(request: ThumbnailChatAgentRequest): ThumbnailChatTextLayerPatch[] {
  const normalized = normalizeChatRequirement(request.message);
  const replacementIntent = parseThumbnailChatTextReplacementIntent(request);
  if (replacementIntent) {
    const replacementTarget = resolveThumbnailChatReplacementTarget(request, replacementIntent);
    if (!replacementTarget) return [];
    if (replacementTarget.id === 'headline') {
      return [{
        id: replacementTarget.id,
        content: replacementIntent.newText,
        fontSize: getResponsiveMainHeadlineFontSize(replacementIntent.newText, replacementTarget.fontSize),
        strokeWidth: replacementIntent.newText.length >= 16 ? Math.min(replacementTarget.strokeWidth, 9) : replacementTarget.strokeWidth,
      }];
    }
    return [{ id: replacementTarget.id, content: replacementIntent.newText }];
  }

  if (isSelectedLayerChatIntent(normalized)) {
    const layer = resolveSelectedChatLayer(request);
    return layer ? [createSelectedLayerStylePatch(normalized, layer)] : [];
  }

  if (isThumbnailChatCanvasOptimizationIntent(normalized)) {
    return createCanvasOptimizationTextLayerPatches(request);
  }

  return [];
}

function createChatCanvasPatch(request: ThumbnailChatAgentRequest): ThumbnailChatCanvasPatch {
  const normalized = normalizeChatRequirement(request.message);
  const selectedLayerIntent = isSelectedLayerChatIntent(normalized);
  const replacementIntent = parseThumbnailChatTextReplacementIntent(request);
  const replacementTarget = replacementIntent
    ? resolveThumbnailChatReplacementTarget(request, replacementIntent)
    : null;
  const optimizationIntent = isThumbnailChatCanvasOptimizationIntent(normalized);
  const headlineFallback = sanitizeCanvasChatText(request.currentHeadline ?? '', '역대급 먹방', MAIN_HEADLINE_MAX_LENGTH);
  const subHeadlineFallback = sanitizeCanvasChatText(request.currentSubHeadline ?? '', '한입만 가능?', SUB_HEADLINE_MAX_LENGTH);
  const topicFallback = normalizeChatRequirement(request.currentTopic ?? '') || '먹방 썸네일';
  const preservesGlobalText = selectedLayerIntent || replacementIntent || optimizationIntent;
  const replacementForHeadline = replacementIntent && (
    replacementIntent.target === 'headline' ||
    replacementTarget?.id === 'headline'
  )
    ? sanitizeCanvasChatText(replacementIntent.newText, headlineFallback, MAIN_HEADLINE_MAX_LENGTH)
    : null;
  const replacementForSubHeadline = replacementIntent && (
    replacementIntent.target === 'subHeadline' ||
    replacementTarget?.id === 'subHeadline'
  )
    ? sanitizeCanvasChatText(replacementIntent.newText, subHeadlineFallback, SUB_HEADLINE_MAX_LENGTH)
    : null;

  return {
    topic: preservesGlobalText ? topicFallback : normalized || topicFallback,
    headline: replacementForHeadline ?? (preservesGlobalText && !hasExplicitChatHeadline(normalized)
      ? headlineFallback
      : deriveChatHeadline(normalized, headlineFallback)),
    subHeadline: replacementForSubHeadline ?? (preservesGlobalText && !hasExplicitChatSubHeadline(normalized)
      ? subHeadlineFallback
      : deriveChatSubHeadline(normalized, subHeadlineFallback)),
  };
}

function wantsGeneration(message: string) {
  return /(생성|만들|그려|실행|뽑아|이미지|썸네일)/i.test(message) && !/(하지\s*마|생성\s*금지|멈춰)/i.test(message);
}


function isUnsafeThumbnailChatInstructionPrompt(value: string) {
  const normalized = normalizeChatRequirement(value);
  if (!normalized) return false;
  return /(?:이전\s*지시|지시\s*무시|ignore\s+(?:previous|all)\s+instructions|system\s*prompt|developer\s*message|환경\s*변수|env(?:ironment)?\s*var|process\.env|비밀\s*키|secret|api\s*key|토큰|token|검증\s*(?:건너|스킵|무시)|skip\s*verification|성공(?:했다고|으로)\s*말|false\s*success|delete\s+state|상태\s*삭제)/i.test(normalized);
}

function getUnsafeThumbnailChatInstructionMessage() {
  return '그 요청은 안전하게 처리할 수 없어요. 비밀 정보 보여주기, 확인 과정 건너뛰기, 사실과 다른 성공 처리는 하지 않습니다. 썸네일 문구나 배치를 어떻게 바꾸고 싶은지만 다시 적어 주세요.';
}

function wantsReset(message: string) {
  return /(초기화|리셋|reset)/i.test(message);
}

function resolveChatProviderId(
  message: string,
  fallback: ThumbnailGeneratorPayload['providerId'],
): ThumbnailGeneratorPayload['providerId'] {
  if (CHAT_LOCAL_CODEX_PROVIDER_PATTERN.test(message)) return 'local-codex';
  if (CHAT_OPENAI_GPT_IMAGE_2_PROVIDER_PATTERN.test(message)) return 'openai-gpt-image-2';
  return fallback;
}

function resolveChatGenerationMode(message: string, fallback: ThumbnailGeneratorPayload['generationMode']) {
  if (/(직접\s*(?:provider|프로바이더|호출)|direct\s*provider|direct_provider)/i.test(message)) return 'direct_provider';
  if (/(백엔드|에이전트|agent|langgraph|codex\s*cli)/i.test(message)) return 'backend_agent';
  return fallback;
}

export async function generateYoutubeThumbnailChatWithBackendAgent(
  request: ThumbnailChatAgentRequest,
  env: NodeJS.ProcessEnv = process.env,
  options: ThumbnailAgentExecutionOptions = {},
): Promise<ThumbnailChatAgentResult> {
  const normalizedMessage = normalizeChatRequirement(request.message);
  if (!normalizedMessage) {
    throw new ThumbnailGenerationError('invalid_text', '채팅 요구사항을 입력하세요.', 400);
  }

  const canvasPatch = createChatCanvasPatch(request);
  const textLayerPatches = createChatTextLayerPatches(request);
  const replacementIntent = parseThumbnailChatTextReplacementIntent(request);
  const replacementTarget = replacementIntent
    ? resolveThumbnailChatReplacementTarget(request, replacementIntent)
    : null;
  const optimizationIntent = isThumbnailChatCanvasOptimizationIntent(normalizedMessage);
  const resolvedProviderId = resolveChatProviderId(normalizedMessage, request.providerId ?? 'local-codex');
  const resolvedGenerationMode = resolveChatGenerationMode(normalizedMessage, request.generationMode ?? 'direct_provider');
  const agentPayload: ThumbnailGeneratorPayload = {
    providerId: resolvedProviderId,
    generationMode: resolvedGenerationMode,
    topic: canvasPatch.topic,
    headline: canvasPatch.headline,
    subHeadline: canvasPatch.subHeadline,
    stylePreset: 'tzuyang-food-travel-collage',
    referenceImageRoles: [],
    acknowledgedSafety: true,
    textLayers: request.currentTextLayers ?? [],
  };
  const basePrompt = [
    'Thumbnail chat agent task.',
    `User chat request: ${normalizedMessage}`,
    `Current topic: ${request.currentTopic ?? ''}`,
    `Current headline: ${request.currentHeadline ?? ''}`,
    `Current subHeadline: ${request.currentSubHeadline ?? ''}`,
    `Active layer: ${request.activeLayerId ?? ''}`,
    `Editing layer: ${request.editingLayerId ?? ''}`,
    `Last canvas action: ${request.lastCanvasActionLabel ?? ''}`,
    `Current text layers: ${JSON.stringify((request.currentTextLayers ?? []).slice(0, 8).map((layer) => ({
      id: layer.id,
      content: layer.content,
      x: layer.x,
      y: layer.y,
      fontSize: layer.fontSize,
      fill: layer.fill,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth,
      align: layer.align,
      rotation: layer.rotation,
    })))}`,
    'Return orchestration guidance for canvas edits, generation, reset/export intent, and safety review.',
  ].join('\n');
  const chatRunId = options.runId ?? request.chatRunId;
  const agentPlan = await resolveAgentPlan(agentPayload, [], basePrompt, env, {
    ...options,
    runId: chatRunId,
  });
  const status = getThumbnailBackendAgentStatus(env);
  const unsafeInstruction = isUnsafeThumbnailChatInstructionPrompt(normalizedMessage);
  const shouldReset = !unsafeInstruction && wantsReset(normalizedMessage);
  const shouldGenerate = !unsafeInstruction && wantsGeneration(normalizedMessage) && !shouldReset;
  if (unsafeInstruction) {
    return {
      assistantMessage: getUnsafeThumbnailChatInstructionMessage(),
      canvasPatch: {
        topic: request.currentTopic || '먹방 썸네일',
        headline: request.currentHeadline || '역대급 먹방',
        subHeadline: request.currentSubHeadline || '한입만 가능?',
      },
      textLayerPatches: [],
      providerId: request.providerId ?? 'local-codex',
      generationMode: request.generationMode ?? 'direct_provider',
      shouldGenerate: false,
      shouldReset: false,
      backendAgent: {
        mode: agentPlan.mode,
        runtime: agentPlan.runtime,
        concept: agentPlan.concept,
        layoutBrief: agentPlan.layoutBrief,
        promptAddendum: agentPlan.promptAddendum,
        safetyReview: agentPlan.safetyReview,
        nextActions: agentPlan.nextActions,
        diagnostics: {
          ...agentPlan.diagnostics,
          chatRunId,
          chatIntent: 'blocked_unsafe_instruction',
          codexModel: status.codexModel,
          codexEffort: status.codexEffort,
        },
      },
      diagnostics: {
        runtime: agentPlan.runtime,
        model: status.codexModel,
        effort: status.codexEffort,
        streaming: 'sse-progress',
        chatRunId,
      },
    };
  }
  const describeLayerForChat = (layerId: string | undefined) => {
    if (layerId === 'headline') return '메인 문구';
    if (layerId === 'subHeadline') return '스티커 문구';
    return '선택한 문구';
  };
  const getKoreanRoroParticle = (value: string) => {
    const lastChar = Array.from(value.trim()).pop();
    if (!lastChar) return '로';
    const code = lastChar.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return '로';
    const jong = (code - 0xac00) % 28;
    return jong === 0 || jong === 8 ? '로' : '으로';
  };
  let canvasSummary = `캔버스에 메인 문구 “${canvasPatch.headline}”와 스티커 문구 “${canvasPatch.subHeadline}”를 반영했어요.`;
  if (shouldReset) {
    canvasSummary = '입력값을 처음 상태로 되돌릴게요.';
  } else if (replacementIntent && replacementTarget) {
    canvasSummary = `${describeLayerForChat(replacementTarget.id)}를 “${replacementIntent.newText}”${getKoreanRoroParticle(replacementIntent.newText)} 바꿨어요.`;
  } else if (replacementIntent && !replacementTarget) {
    canvasSummary = '바꿀 문구를 찾지 못해서 캔버스 문구는 그대로 두었어요.';
  } else if (optimizationIntent && textLayerPatches.length) {
    canvasSummary = `문구 ${textLayerPatches.length}개의 위치와 크기를 보기 좋게 정리했어요. 내용은 그대로 두었습니다.`;
  } else if (textLayerPatches.length) {
    canvasSummary = `${describeLayerForChat(textLayerPatches[0]?.id)}를 다듬고, 메인 문구 “${canvasPatch.headline}”와 스티커 문구 “${canvasPatch.subHeadline}”를 확인했어요.`;
  }

  return {
    assistantMessage: [
      '요청을 이해했어요.',
      canvasSummary,
      shouldGenerate ? '이어서 실제 썸네일 이미지까지 만들게요.' : '바로 만들고 싶으면 “생성해줘”라고 입력하세요.',
    ].filter(Boolean).join(' '),
    canvasPatch,
    textLayerPatches,
    providerId: resolvedProviderId,
    generationMode: resolvedGenerationMode,
    shouldGenerate,
    shouldReset,
    backendAgent: {
      mode: agentPlan.mode,
      runtime: agentPlan.runtime,
      concept: agentPlan.concept,
      layoutBrief: agentPlan.layoutBrief,
      promptAddendum: agentPlan.promptAddendum,
      safetyReview: agentPlan.safetyReview,
      nextActions: agentPlan.nextActions,
      diagnostics: {
        ...agentPlan.diagnostics,
        chatRunId,
        chatIntent: shouldGenerate ? 'generate' : shouldReset ? 'reset' : 'edit',
        codexModel: status.codexModel,
        codexEffort: status.codexEffort,
      },
    },
    diagnostics: {
      runtime: agentPlan.runtime,
      model: status.codexModel,
      effort: status.codexEffort,
      streaming: 'sse-progress',
      chatRunId,
    },
  };
}

function parseCommandPlan(text: string): Partial<ThumbnailAgentPlan> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const jsonCandidate = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? '';
  if (!jsonCandidate) return null;
  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Partial<ThumbnailAgentPlan> : null;
  } catch {
    return null;
  }
}

function normalizeCommandPlan(parsed: Partial<ThumbnailAgentPlan>, fallback: ThumbnailAgentPlan, stderr: string): ThumbnailAgentPlan {
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((warning): warning is string => typeof warning === 'string') : [];
  const nextActions = Array.isArray(parsed.nextActions) ? parsed.nextActions.filter((action): action is string => typeof action === 'string') : fallback.nextActions;
  return {
    mode: 'command',
    runtime: typeof parsed.runtime === 'string' && parsed.runtime.trim() ? parsed.runtime.trim() : resolveThumbnailAgentRuntime(),
    concept: typeof parsed.concept === 'string' && parsed.concept.trim() ? parsed.concept.trim().slice(0, 600) : fallback.concept,
    layoutBrief: typeof parsed.layoutBrief === 'string' && parsed.layoutBrief.trim() ? parsed.layoutBrief.trim().slice(0, 1200) : fallback.layoutBrief,
    promptAddendum: typeof parsed.promptAddendum === 'string' && parsed.promptAddendum.trim() ? parsed.promptAddendum.trim().slice(0, 4000) : fallback.promptAddendum,
    safetyReview: typeof parsed.safetyReview === 'string' && parsed.safetyReview.trim() ? parsed.safetyReview.trim().slice(0, 1000) : fallback.safetyReview,
    nextActions,
    warnings: ['backend_agent_command: thumbnail backend-agent runner가 orchestration brief를 생성했습니다.', ...warnings],
    diagnostics: {
      ...(parsed.diagnostics && typeof parsed.diagnostics === 'object' ? parsed.diagnostics : {}),
      stderrPreview: stderr.slice(-400),
    },
  };
}

async function resolveAgentPlan(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  basePrompt: string,
  env: NodeJS.ProcessEnv,
  options: ThumbnailAgentExecutionOptions = {},
): Promise<ThumbnailAgentPlan> {
  const fallback = buildLocalAgentPlan(payload, referenceImages, basePrompt);
  const command = resolveThumbnailAgentCommand(env.THUMBNAIL_AGENT_COMMAND);
  if (!command.ok) {
    if (env.THUMBNAIL_AGENT_COMMAND?.trim()) {
      throw new ThumbnailGenerationError(
        'provider_unavailable',
        `Thumbnail backend-agent command를 사용할 수 없습니다: ${command.reason}`,
        503,
      );
    }
    return buildLocalAgentPlan(payload, referenceImages, basePrompt, command.reason);
  }

  const result = await runThumbnailAgentCommand(command, {
    runId: options.runId,
    request: payload,
    basePrompt,
    target: { width: YOUTUBE_THUMBNAIL_TARGET_WIDTH, height: YOUTUBE_THUMBNAIL_TARGET_HEIGHT },
    referenceImages: referenceImages.map((image) => ({ name: image.name, mime: image.mime, role: image.role, bytes: image.bytes.byteLength })),
    retrievalEvidence: payload.retrievalEvidence ?? [],
    retrievalDiagnostics: payload.retrievalDiagnostics ?? null,
  }, env, options);
  if (!result.ok) {
    if (result.aborted) {
      throw new ThumbnailGenerationError(
        'thumbnail_chat_aborted',
        'Thumbnail backend-agent 실행이 취소되었습니다.',
        499,
      );
    }
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      `Thumbnail backend-agent 실행 실패: ${result.timedOut ? 'timeout' : `exit=${result.exitCode}`}${result.stderr ? ` stderr: ${result.stderr.slice(-600)}` : ''}`,
      503,
    );
  }

  const parsed = parseCommandPlan(result.stdout);
  if (!parsed) {
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      `Thumbnail backend-agent 출력 JSON을 해석하지 못했습니다.${result.stderr ? ` stderr: ${result.stderr.slice(-600)}` : ''}`,
      503,
    );
  }

  return normalizeCommandPlan(parsed, fallback, result.stderr);
}

export async function generateYoutubeThumbnailWithBackendAgent(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  env: NodeJS.ProcessEnv = process.env,
  options: ThumbnailAgentExecutionOptions = {},
): Promise<ThumbnailGenerationResult> {
  const basePrompt = buildYoutubeThumbnailPrompt(payload, referenceImages);
  const agentPlan = await resolveAgentPlan(payload, referenceImages, basePrompt, env, options);
  const orchestratedPrompt = [basePrompt, '', agentPlan.promptAddendum].filter(Boolean).join('\n');
  const providerResult = await generateYoutubeThumbnailWithPrompt(
    { ...payload, generationMode: 'direct_provider' },
    referenceImages,
    orchestratedPrompt,
    options.providerEnv ?? env,
    options,
  );

  const backendAgent: ThumbnailBackendAgentRun = {
    mode: agentPlan.mode,
    runtime: agentPlan.runtime,
    concept: agentPlan.concept,
    layoutBrief: agentPlan.layoutBrief,
    promptAddendum: agentPlan.promptAddendum,
    safetyReview: agentPlan.safetyReview,
    nextActions: agentPlan.nextActions,
    diagnostics: {
      ...agentPlan.diagnostics,
      providerId: payload.providerId,
      providerModel: providerResult.baseImage.model,
      providerModelProvenance: providerResult.baseImage.modelProvenance,
    },
  };

  return {
    ...providerResult,
    prompt: orchestratedPrompt,
    warnings: [
      'backend_agent_orchestrated: 썸네일 backend-agent가 콘셉트/레이아웃/검수 brief를 만든 뒤 기존 provider를 호출했습니다.',
      ...agentPlan.warnings,
      ...providerResult.warnings,
    ],
    backendAgent,
  };
}
