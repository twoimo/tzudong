import { accessSync, constants, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  hasExplicitThumbnailGenerationCommand as hasSharedExplicitThumbnailGenerationCommand,
  isThumbnailChatGuidanceQuestion as isSharedThumbnailChatGuidanceQuestion,
} from './chat-intent';
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
const DEFAULT_THUMBNAIL_AGENT_PYTHON = process.platform === 'win32' ? 'python' : 'python3';

const BACKEND_AGENT_GRAPH = 'src/graph.py';
const BACKEND_AGENT_RUNNER = 'scripts/run-thumbnail-agent.py';
const APP_WEB_MARKER = 'app/api/admin/youtube-thumbnail-generator/route.ts';
const DEFAULT_THUMBNAIL_AGENT_TIMEOUT_MS = 120_000;
const MIN_THUMBNAIL_AGENT_TIMEOUT_MS = 5_000;
const MAX_THUMBNAIL_AGENT_TIMEOUT_MS = 600_000;
const MAX_THUMBNAIL_AGENT_OUTPUT_BYTES = 64 * 1024;
const THUMBNAIL_AGENT_TERMINATION_GRACE_MS = 1_000;
const DEFAULT_THUMBNAIL_AGENT_RUNTIME = 'codex_cli_oauth';
const DEFAULT_THUMBNAIL_AGENT_CODEX_MODEL = 'gpt-5.5';
const DEFAULT_THUMBNAIL_AGENT_CODEX_EFFORT = 'low';
const REQUIRED_PYTHON_MODULES = ['langgraph', 'langchain_core', 'langchain_openai'];
const UNSAFE_COMMAND_PATTERN = /[;&|`$<>()[\]{}!#\n\r]/;
const THUMBNAIL_AGENT_ENV_ALLOWLIST = [
  // Process lookup/runtime state and OAuth credential locations required by the local adapter.
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  // Adapter-only configuration. The request itself is always delivered through stdin.
  'THUMBNAIL_AGENT_RUNTIME',
  'THUMBNAIL_AGENT_CODEX_BIN',
  'THUMBNAIL_AGENT_TIMEOUT_MS',
  'THUMBNAIL_AGENT_CODEX_TIMEOUT_MS',
  'THUMBNAIL_AGENT_CODEX_TIMEOUT_SECONDS',
] as const;
const CONFIGURED_SECRET_ENV_NAME = /(?:API(?:_|)?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|BEARER)/i;

function getRuntimeCwd() {
  const cwd = Reflect.get(process, 'cwd');
  return typeof cwd === 'function' ? cwd.call(process) : '.';
}

function resolveFromRuntimeCwd(...segments: string[]) {
  return path.resolve(/* turbopackIgnore: true */ getRuntimeCwd(), ...segments);
}
type CommandTerminationReason = 'aborted' | 'output_limit' | 'spawn_error' | 'timed_out';

type ResolvedThumbnailAgentCommand =
  | { ok: true; executable: string; args: string[]; displayPath: string }
  | { ok: false; reason: string };

type CommandResult = {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
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
    getRuntimeCwd(),
    resolveFromRuntimeCwd('apps/web'),
    resolveFromRuntimeCwd('..'),
    resolveFromRuntimeCwd('../..'),
  ].filter((candidate) => existsSync(/* turbopackIgnore: true */ path.join(candidate, APP_WEB_MARKER))));
}

const APP_WEB_ROOT = resolveAppWebRoot();
const BACKEND_AGENT_ROOT = process.env.THUMBNAIL_AGENT_ROOT?.trim()
  ? path.resolve(/* turbopackIgnore: true */ APP_WEB_ROOT, process.env.THUMBNAIL_AGENT_ROOT.trim())
  : firstExistingPath([
    path.resolve(/* turbopackIgnore: true */ APP_WEB_ROOT, '../../backend/thumbnail-agent'),
    resolveFromRuntimeCwd('backend/thumbnail-agent'),
  ]);

function backendAgentPath(relativePath: string) {
  return path.join(BACKEND_AGENT_ROOT, relativePath);
}

function resolveThumbnailAgentPython(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.THUMBNAIL_AGENT_PYTHON?.trim() || env.PYTHON?.trim();
  if (configured && /^python3(?:\.\d+)?$/.test(configured)) {
    return configured;
  }
  return DEFAULT_THUMBNAIL_AGENT_PYTHON;
}

function resolveThumbnailAgentNode() {
  return process.execPath;
}

function resolveThumbnailAgentBash() {
  if (process.platform === 'win32') {
    const preferred = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    ];
    const found = preferred.find((candidate) => existsSync(candidate));
    if (found) return found;
  }
  return 'bash';
}

function resolveThumbnailAgentRuntime(env: NodeJS.ProcessEnv = process.env) {
  return env.THUMBNAIL_AGENT_RUNTIME?.trim() || DEFAULT_THUMBNAIL_AGENT_RUNTIME;
}

function resolveThumbnailAgentTimeoutMs(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Number(env.THUMBNAIL_AGENT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_THUMBNAIL_AGENT_TIMEOUT_MS;
  return Math.min(MAX_THUMBNAIL_AGENT_TIMEOUT_MS, Math.max(MIN_THUMBNAIL_AGENT_TIMEOUT_MS, Math.floor(parsed)));
}

function configuredSecretValues(env: NodeJS.ProcessEnv) {
  const values = new Set<string>();
  for (const source of [process.env, env]) {
    for (const [name, value] of Object.entries(source)) {
      if (CONFIGURED_SECRET_ENV_NAME.test(name) && typeof value === 'string' && value.length >= 8) {
        values.add(value);
      }
    }
  }
  return [...values].sort((left, right) => right.length - left.length);
}

function redactConfiguredSecrets(value: string, env: NodeJS.ProcessEnv) {
  return configuredSecretValues(env).reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
}

function createThumbnailAgentCommandEnv(env: NodeJS.ProcessEnv, options: ThumbnailAgentExecutionOptions): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV,
  };
  for (const name of THUMBNAIL_AGENT_ENV_ALLOWLIST) {
    const value = env[name] ?? process.env[name];
    if (typeof value === 'string') childEnv[name] = value;
  }
  childEnv.THUMBNAIL_AGENT_CODEX_MODEL = resolveThumbnailAgentCodexModel(env);
  childEnv.THUMBNAIL_AGENT_CODEX_EFFORT = resolveThumbnailAgentCodexEffort(env);
  childEnv.THUMBNAIL_AGENT_RUN_ID = options.runId ?? '';
  return childEnv;
}

function toShellScriptArg(command: string) {
  return process.platform === 'win32' ? command.replaceAll('\\', '/') : command;
}
function resolveScriptCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const extension = path.extname(command).toLowerCase();
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return { executable: resolveThumbnailAgentNode(), args: [command, ...args] };
  }
  if (extension === '.py') {
    return { executable: resolveThumbnailAgentPython(env), args: [command, ...args] };
  }
  if (extension === '.sh') {
    return { executable: resolveThumbnailAgentBash(), args: [toShellScriptArg(command), ...args] };
  }
  if (process.platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    const commandProcessor = env.ComSpec?.trim() || env.COMSPEC?.trim() || process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    return { executable: commandProcessor, args: ['/d', '/s', '/c', `call "${command}"`, ...args] };
  }
  return { executable: command, args };
}

function resolveThumbnailAgentCommand(
  env: NodeJS.ProcessEnv = process.env,
  rawCommand?: string | null,
): ResolvedThumbnailAgentCommand {
  const command = rawCommand?.trim();
  const executableCandidates = command
    ? (path.isAbsolute(command)
      ? [command]
      : [
        path.resolve(/* turbopackIgnore: true */ APP_WEB_ROOT, command),
        resolveFromRuntimeCwd(command),
        path.resolve(BACKEND_AGENT_ROOT, command),
      ])
    : [backendAgentPath(BACKEND_AGENT_RUNNER)];
  if (command && UNSAFE_COMMAND_PATTERN.test(command)) return { ok: false, reason: 'unsafe-command-string' };
  const executable = firstExistingPath(executableCandidates);
  const extension = path.extname(executable).toLowerCase();
  if (['.py', '.sh', '.js', '.mjs', '.cjs', '.cmd', '.bat'].includes(extension) && existsSync(executable)) {
    const runnable = resolveScriptCommand(executable, [], env);
    return { ok: true, executable: runnable.executable, args: runnable.args, displayPath: executable };
  }
  try {
    accessSync(executable, constants.X_OK);
    const runnable = resolveScriptCommand(executable, [], env);
    return { ok: true, executable: runnable.executable, args: runnable.args, displayPath: executable };
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
  const commandResolution = resolveThumbnailAgentCommand(env, env.THUMBNAIL_AGENT_COMMAND);
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
    graphEntrypoint: graphEntrypoint?.replaceAll('\\', '/') ?? null,
    commandConfigured,
    commandAvailable,
    commandPath: commandResolution.ok ? commandResolution.displayPath.replaceAll('\\', '/') : undefined,
    commandRejectionReason: commandResolution.ok ? undefined : commandResolution.reason,
    localAdapterAvailable,
    missingPythonModules,
    runtime,
    codexModel: resolveThumbnailAgentCodexModel(env),
    codexEffort: resolveThumbnailAgentCodexEffort(env),
    streamingAvailable: true,
  };
}

function createLocalThumbnailChatStatus(env: NodeJS.ProcessEnv = process.env): ThumbnailBackendAgentStatus {
  return {
    available: true,
    mode: 'local_adapter',
    rootPath: BACKEND_AGENT_ROOT,
    graphEntrypoint: null,
    commandConfigured: false,
    commandAvailable: false,
    localAdapterAvailable: true,
    missingPythonModules: [],
    runtime: resolveThumbnailAgentRuntime(env),
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

function hasValidThumbnailAgentPid(pid: number | undefined): pid is number {
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0;
}

function terminateWindowsThumbnailAgentProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    let operationObserved = false;
    const observeOperation = () => {
      if (operationObserved) return;
      operationObserved = true;
      resolve();
    };
    try {
      const taskkill = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      taskkill.once('error', observeOperation);
      taskkill.once('close', observeOperation);
    } catch {
      observeOperation();
    }
  });
}

function terminateThumbnailAgentProcessTree(pid: number | undefined, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
  if (!hasValidThumbnailAgentPid(pid)) return Promise.resolve();
  if (process.platform === 'win32') {
    return signal === 'SIGKILL' ? terminateWindowsThumbnailAgentProcessTree(pid) : Promise.resolve();
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // The close boundary below produces the same fixed failure.
  }
  return Promise.resolve();
}

function runThumbnailAgentCommand(
  command: Extract<ResolvedThumbnailAgentCommand, { ok: true }>,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  options: ThumbnailAgentExecutionOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ ok: false, exitCode: null, timedOut: false, aborted: true, stdout: '' });
      return;
    }

    const timeoutMs = resolveThumbnailAgentTimeoutMs(env);
    const child = (() => {
      try {
        return spawn(command.executable, command.args, {
          cwd: existsSync(/* turbopackIgnore: true */ BACKEND_AGENT_ROOT) ? BACKEND_AGENT_ROOT : getRuntimeCwd(),
          detached: process.platform !== 'win32',
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: createThumbnailAgentCommandEnv(env, options),
        });
      } catch {
        return null;
      }
    })();
    if (!child) {
      resolve({
        ok: false,
        exitCode: null,
        timedOut: false,
        aborted: Boolean(options.signal?.aborted),
        stdout: '',
      });
      return;
    }

    let stdout = '';
    let outputBytes = 0;
    let settled = false;
    let closeObserved = false;
    let closeExitCode: number | null = null;
    let terminationReason: CommandTerminationReason | null = null;
    let terminationComplete = false;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let cleanup = () => undefined;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ok: terminationReason === null && exitCode === 0,
        exitCode,
        timedOut: terminationReason === 'timed_out',
        aborted: terminationReason === 'aborted',
        stdout,
      });
    };
    const finishWhenCleanupCompletes = () => {
      if (settled || !closeObserved || (terminationReason !== null && !terminationComplete)) return;
      finish(closeExitCode);
    };
    const terminate = (reason: CommandTerminationReason) => {
      if (settled || terminationReason) return;
      terminationReason = reason;
      void (async () => {
        const gracefulTermination = terminateThumbnailAgentProcessTree(child.pid, 'SIGTERM');
        await new Promise<void>((resolveGrace) => {
          terminationTimer = setTimeout(resolveGrace, THUMBNAIL_AGENT_TERMINATION_GRACE_MS);
        });
        await Promise.all([
          gracefulTermination,
          terminateThumbnailAgentProcessTree(child.pid, 'SIGKILL'),
        ]);
      })().catch(() => undefined).finally(() => {
        terminationComplete = true;
        finishWhenCleanupCompletes();
      });
    };
    const timer = setTimeout(() => terminate('timed_out'), timeoutMs);
    const abort = () => terminate('aborted');
    options.signal?.addEventListener('abort', abort, { once: true });
    cleanup = () => {
      clearTimeout(timer);
      if (terminationTimer) clearTimeout(terminationTimer);
      options.signal?.removeEventListener('abort', abort);
    };

    const handleOutput = (stream: 'stdout' | 'stderr', chunk: unknown) => {
      if (terminationReason) return;
      const chunkBytes = typeof chunk === 'string'
        ? Buffer.byteLength(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk.byteLength
          : null;
      if (chunkBytes === null || chunkBytes > MAX_THUMBNAIL_AGENT_OUTPUT_BYTES - outputBytes) {
        terminate('output_limit');
        return;
      }
      outputBytes += chunkBytes;
      if (stream === 'stdout' && typeof chunk === 'string') stdout += chunk;
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => handleOutput('stdout', chunk));
    child.stderr.on('data', (chunk) => handleOutput('stderr', chunk));
    child.stdin.on('error', () => undefined);
    child.on('close', (exitCode) => {
      closeObserved = true;
      closeExitCode = exitCode;
      finishWhenCleanupCompletes();
    });
    child.on('error', () => terminate('spawn_error'));

    if (options.signal?.aborted) terminate('aborted');
    try {
      child.stdin.end(JSON.stringify(payload));
    } catch {
      terminate('spawn_error');
    }
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
type ThumbnailChatIntent =
  | 'safety'
  | 'casual_chat'
  | 'conversation'
  | 'review'
  | 'edit'
  | 'generate'
  | 'reset';

function normalizeThumbnailChatThreadId(value: string | undefined) {
  return value?.replace(/[^\w:.-]/g, '').slice(0, 120) || `thumbnail-chat-${Date.now().toString(36)}`;
}

function stripThumbnailChatExecutionControls(value: string) {
  return normalizeChatRequirement(value)
    .replace(/(?:아직|지금은|우선|먼저|일단|당장은)?\s*(?:이미지|썸네일)[^.!?。]{0,48}(?:만들|생성|재생성|실행)\s*지?\s*(?:마|말고|마세요|말아|않|안\s*해|금지|중단|멈춰)[^.!?。]*(?:[.!?。]|$)/gi, ' ')
    .replace(/(?:추천|제안)\s*해\s*(?:줘|주세요|줘요)/gi, '')
    .replace(/^(?:좋아|좋습니다|오케이|ㅇㅋ|okay|ok)[,\s]*/i, '')
    .replace(/^(?:그걸로|그\s*방향으로|이걸로)[,\s]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeThumbnailChatConversationMessages(messages: ThumbnailChatAgentRequest['conversationMessages']) {
  return (messages ?? [])
    .flatMap((message) => {
      const content = stripThumbnailChatExecutionControls(message.content).slice(0, 280);
      if (!content || isUnsafeThumbnailChatInstructionPrompt(content)) return [];
      return [{
        role: message.role,
        content,
        ...(message.id ? { id: message.id.slice(0, 120) } : {}),
      }];
    })
    .slice(-8);
}

function formatThumbnailChatConversationContext(messages: ReturnType<typeof normalizeThumbnailChatConversationMessages>) {
  return messages
    .map((message, index) => `${index + 1}. ${message.role === 'user' ? '사용자' : '도우미'}: ${message.content}`)
    .join(' / ');
}

function formatThumbnailChatConversationBrief(messages: ReturnType<typeof normalizeThumbnailChatConversationMessages>) {
  return messages
    .map((message) => message.content)
    .join(' ')
    .slice(0, 560);
}

function formatThumbnailChatFocusContext(context: ThumbnailChatAgentRequest['focusContext']) {
  if (!context) return '';
  return [
    context.kind === 'text-layer' ? `선택 문구: ${context.label}` : `캔버스 맥락: ${context.label}`,
    context.detail,
    context.promptContext,
  ].filter(Boolean).join(' · ');
}

function formatThumbnailChatReferenceAttachmentSummary(attachments: ThumbnailChatAgentRequest['referenceImageAttachments']) {
  const safeAttachments = (attachments ?? []).slice(0, 8);
  if (!safeAttachments.length) return '';
  return safeAttachments
    .map((attachment, index) => {
      const parts = [
        `${index + 1}. ${attachment.name}`,
        attachment.role ? `role=${attachment.role}` : '',
        attachment.mime ? `mime=${attachment.mime}` : '',
        typeof attachment.size === 'number' ? `size=${attachment.size}` : '',
        attachment.width && attachment.height ? `${attachment.width}x${attachment.height}` : '',
      ].filter(Boolean);
      return parts.join(' ');
    })
    .join(' / ');
}

function isCasualThumbnailChatMessage(message: string) {
  return /^(?:ㅎㅇ|하이|안녕|안녕하세요|고마워|감사|ㄱㅅ|도움말|help|사용법)$/i.test(message) ||
    /(?:뭐\s*할\s*수|무엇을\s*할\s*수|어떻게\s*쓰|사용법|도움말|help)/i.test(message);
}

function isThumbnailReviewOnlyMessage(message: string) {
  return /(검토|리뷰|평가|어때|괜찮|초보자도\s*이해|왜\s*이렇게|분석|클릭률.*어떻게|가독성.*어때)/i.test(message) &&
    !CHAT_REPLACEMENT_ACTION_PATTERN.test(message) &&
    !isSelectedLayerChatIntent(message);
}

function hasExplicitThumbnailGenerationCommand(message: string) {
  return hasSharedExplicitThumbnailGenerationCommand(message);
}

function isThumbnailChatGuidanceQuestion(message: string) {
  return isSharedThumbnailChatGuidanceQuestion(message);
}

function isThumbnailGeneralConversationMessage(message: string) {
  if (isCasualThumbnailChatMessage(message) || isThumbnailReviewOnlyMessage(message)) return true;
  if (isThumbnailChatGuidanceQuestion(message) && !hasExplicitThumbnailGenerationCommand(message)) return true;
  if (CHAT_REPLACEMENT_ACTION_PATTERN.test(message) || isSelectedLayerChatIntent(message) || isThumbnailChatCanvasOptimizationIntent(message)) return false;
  if (hasExplicitThumbnailGenerationCommand(message)) return false;
  return isThumbnailChatGuidanceQuestion(message);
}

function resolveThumbnailChatIntent(message: string): ThumbnailChatIntent {
  if (isUnsafeThumbnailChatInstructionPrompt(message)) return 'safety';
  if (isCasualThumbnailChatMessage(message)) return 'casual_chat';
  if (isThumbnailReviewOnlyMessage(message)) return 'review';
  if (isThumbnailGeneralConversationMessage(message)) return 'conversation';
  if (wantsReset(message)) return 'reset';
  if (hasExplicitThumbnailGenerationCommand(message) || wantsGeneration(message)) return 'generate';
  return 'edit';
}

function createPreservedThumbnailChatCanvasPatch(request: ThumbnailChatAgentRequest): ThumbnailChatCanvasPatch {
  return {
    topic: normalizeChatRequirement(request.currentTopic ?? '') || '먹방 썸네일',
    headline: sanitizeCanvasChatText(request.currentHeadline ?? '', '역대급 먹방', MAIN_HEADLINE_MAX_LENGTH),
    subHeadline: sanitizeCanvasChatText(request.currentSubHeadline ?? '', '한입만 가능?', SUB_HEADLINE_MAX_LENGTH),
  };
}

function createLocalThumbnailChatAgentPlan(args: {
  status: ThumbnailBackendAgentStatus;
  chatIntent: ThumbnailChatIntent;
  chatRunId?: string;
  chatThreadId: string;
  conversationText: string;
  focusText: string;
  attachmentText: string;
}): ThumbnailAgentPlan {
  return {
    mode: 'local_adapter',
    runtime: args.status.runtime ?? DEFAULT_THUMBNAIL_AGENT_RUNTIME,
    concept: 'thumbnail chat local intent response',
    layoutBrief: '질문·검토·안전 대화는 캔버스와 외부 이미지 생성 경로를 바꾸지 않고 현재 페이지 안에서만 답변',
    promptAddendum: [
      'Thumbnail chat local deterministic response.',
      `Intent: ${args.chatIntent}`,
      args.conversationText ? `Conversation context: ${args.conversationText}` : '',
      args.focusText ? `Canvas focus context: ${args.focusText}` : '',
      args.attachmentText ? `Reference image attachments: ${args.attachmentText}` : '',
    ].filter(Boolean).join('\n'),
    safetyReview: '비밀 정보, 검증 우회, 일반 질문, 검토 요청은 외부 썸네일 에이전트 명령을 호출하지 않고 로컬 응답으로 종료합니다.',
    nextActions: ['채팅 응답 확인', '필요하면 명시적으로 생성 또는 편집 요청'],
    warnings: [],
    diagnostics: {
      chatRunId: args.chatRunId,
      chatThreadId: args.chatThreadId,
      chatIntent: args.chatIntent,
      conversationTurnCount: args.conversationText ? args.conversationText.split(' / ').length : 0,
      conversationSummary: args.conversationText,
      imageAttachmentCount: args.attachmentText ? args.attachmentText.split(' / ').length : 0,
      focusContextUsed: Boolean(args.focusText),
      localDeterministicResponse: true,
      externalAgentInvoked: false,
    },
  };
}

function buildThumbnailConversationResponse(message: string) {
  if (isCasualThumbnailChatMessage(message)) {
    return '안녕하세요! 유튜브 썸네일 도우미입니다. 화면은 바꾸지 않았어요. 음식 주제, 짧은 메인 문구, 참고 이미지 사용 여부를 말해 주면 문구와 배치를 정리하고, “생성해줘”라고 하면 실제 썸네일까지 만들 수 있어요.';
  }
  return [
    '쉽게 답변드릴게요. 화면은 바꾸지 않았어요.',
    '이미지 생성은 참고 이미지 수와 provider 상태에 따라 보통 수십 초에서 몇 분 정도 걸릴 수 있습니다.',
    '지금 바로 만들려면 음식 주제와 짧은 문구를 적고 “생성해줘”라고 입력하세요.',
  ].join(' ');
}

function buildThumbnailReviewResponse(request: ThumbnailChatAgentRequest, focusText: string) {
  const headline = request.currentHeadline || '메인 문구';
  const subHeadline = request.currentSubHeadline || '스티커 문구';
  return [
    '현재 썸네일을 검토했어요. 화면은 바꾸지 않았습니다.',
    `메인 문구 “${headline}”는 짧고 크게 보일수록 좋아요.`,
    `스티커 문구 “${subHeadline}”는 얼굴이나 음식 핵심을 가리지 않는 위치가 좋습니다.`,
    focusText ? `선택한 항목(${focusText})도 함께 참고했어요.` : '수정하고 싶은 문구를 선택한 뒤 “이 문구를 더 크게”처럼 말하면 그 항목만 바꿀 수 있어요.',
  ].join(' ');
}

function createThumbnailChatResult(args: {
  request: ThumbnailChatAgentRequest;
  status: ThumbnailBackendAgentStatus;
  assistantMessage: string;
  canvasPatch: ThumbnailChatCanvasPatch;
  textLayerPatches?: ThumbnailChatTextLayerPatch[];
  providerId?: ThumbnailGeneratorPayload['providerId'];
  generationMode?: ThumbnailGeneratorPayload['generationMode'];
  shouldGenerate: boolean;
  shouldReset: boolean;
  chatIntent: ThumbnailChatIntent;
  chatRunId?: string;
  chatThreadId: string;
  conversationText: string;
  focusText: string;
  attachmentText: string;
  agentPlan?: ThumbnailAgentPlan;
}) {
  const agentPlan = args.agentPlan ?? createLocalThumbnailChatAgentPlan({
    status: args.status,
    chatIntent: args.chatIntent,
    chatRunId: args.chatRunId,
    chatThreadId: args.chatThreadId,
    conversationText: args.conversationText,
    focusText: args.focusText,
    attachmentText: args.attachmentText,
  });
  const conversationTurnCount = args.conversationText ? args.conversationText.split(' / ').length : 0;
  const imageAttachmentCount = args.attachmentText ? args.attachmentText.split(' / ').length : 0;
  const canvasMutation = args.shouldGenerate ||
    args.shouldReset ||
    Boolean(args.textLayerPatches?.length) ||
    !['safety', 'casual_chat', 'conversation', 'review'].includes(args.chatIntent);
  return {
    assistantMessage: args.assistantMessage,
    canvasPatch: args.canvasPatch,
    textLayerPatches: args.textLayerPatches ?? [],
    providerId: args.providerId ?? args.request.providerId ?? 'local-codex',
    generationMode: args.generationMode ?? args.request.generationMode ?? 'direct_provider',
    shouldGenerate: args.shouldGenerate,
    shouldReset: args.shouldReset,
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
        chatRunId: args.chatRunId,
        chatThreadId: args.chatThreadId,
        chatIntent: args.chatIntent,
        codexModel: args.status.codexModel,
        codexEffort: args.status.codexEffort,
        conversationTurnCount,
        conversationSummary: args.conversationText,
        imageAttachmentCount,
        focusContextUsed: Boolean(args.focusText),
        canvasMutation,
      },
    },
    diagnostics: {
      runtime: agentPlan.runtime,
      model: args.status.codexModel,
      effort: args.status.codexEffort,
      streaming: 'sse-progress' as const,
      chatRunId: args.chatRunId,
      chatThreadId: args.chatThreadId,
      conversationTurnCount,
      conversationSummary: args.conversationText,
      imageAttachmentCount,
      focusContextUsed: Boolean(args.focusText),
      chatIntent: args.chatIntent,
      canvasMutation,
    },
  } satisfies ThumbnailChatAgentResult;
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

  const localStatus = createLocalThumbnailChatStatus(env);
  const chatRunId = options.runId ?? request.chatRunId;
  const chatThreadId = normalizeThumbnailChatThreadId(request.chatThreadId);
  const conversationMessages = normalizeThumbnailChatConversationMessages(request.conversationMessages);
  const conversationText = formatThumbnailChatConversationContext(conversationMessages);
  const conversationBrief = formatThumbnailChatConversationBrief(conversationMessages);
  const focusText = formatThumbnailChatFocusContext(request.focusContext);
  const attachmentText = formatThumbnailChatReferenceAttachmentSummary(request.referenceImageAttachments);
  const chatIntent = resolveThumbnailChatIntent(normalizedMessage);
  const preservedCanvasPatch = createPreservedThumbnailChatCanvasPatch(request);

  if (chatIntent === 'safety') {
    return createThumbnailChatResult({
      request,
      status: localStatus,
      assistantMessage: getUnsafeThumbnailChatInstructionMessage(),
      canvasPatch: preservedCanvasPatch,
      textLayerPatches: [],
      shouldGenerate: false,
      shouldReset: false,
      chatIntent,
      chatRunId,
      chatThreadId,
      conversationText,
      focusText,
      attachmentText,
    });
  }

  if (chatIntent === 'casual_chat' || chatIntent === 'conversation') {
    return createThumbnailChatResult({
      request,
      status: localStatus,
      assistantMessage: buildThumbnailConversationResponse(normalizedMessage),
      canvasPatch: preservedCanvasPatch,
      textLayerPatches: [],
      shouldGenerate: false,
      shouldReset: false,
      chatIntent,
      chatRunId,
      chatThreadId,
      conversationText,
      focusText,
      attachmentText,
    });
  }

  if (chatIntent === 'review') {
    return createThumbnailChatResult({
      request,
      status: localStatus,
      assistantMessage: buildThumbnailReviewResponse(request, focusText),
      canvasPatch: preservedCanvasPatch,
      textLayerPatches: [],
      shouldGenerate: false,
      shouldReset: false,
      chatIntent,
      chatRunId,
      chatThreadId,
      conversationText,
      focusText,
      attachmentText,
    });
  }

  if (chatIntent === 'reset') {
    return createThumbnailChatResult({
      request,
      status: localStatus,
      assistantMessage: '입력값을 처음 상태로 되돌릴게요.',
      canvasPatch: preservedCanvasPatch,
      textLayerPatches: [],
      shouldGenerate: false,
      shouldReset: true,
      chatIntent,
      chatRunId,
      chatThreadId,
      conversationText,
      focusText,
      attachmentText,
    });
  }

  const status = getThumbnailBackendAgentStatus(env);

  const shouldUseConversationForFollowup = chatIntent === 'generate' &&
    conversationBrief &&
    /^(?:좋아|좋습니다|오케이|ㅇㅋ|okay|ok|그걸로|그\s*방향으로|이걸로)/i.test(normalizedMessage);
  const orchestrationMessage = shouldUseConversationForFollowup
    ? `${conversationBrief} ${normalizedMessage}`
    : normalizedMessage;
  const orchestrationRequest: ThumbnailChatAgentRequest = orchestrationMessage === request.message
    ? request
    : { ...request, message: orchestrationMessage };

  const canvasPatch = createChatCanvasPatch(orchestrationRequest);
  const textLayerPatches = createChatTextLayerPatches(orchestrationRequest);
  const replacementIntent = parseThumbnailChatTextReplacementIntent(orchestrationRequest);
  const replacementTarget = replacementIntent
    ? resolveThumbnailChatReplacementTarget(orchestrationRequest, replacementIntent)
    : null;
  const optimizationIntent = isThumbnailChatCanvasOptimizationIntent(orchestrationMessage);
  const resolvedProviderId = resolveChatProviderId(orchestrationMessage, request.providerId ?? 'local-codex');
  const resolvedGenerationMode = resolveChatGenerationMode(orchestrationMessage, request.generationMode ?? 'direct_provider');
  const shouldGenerate = chatIntent === 'generate';
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
    conversationText ? `Conversation context: ${conversationText}` : '',
    focusText ? `Canvas focus context: ${focusText}` : '',
    attachmentText ? `Reference image attachments: ${attachmentText}` : '',
    `Resolved topic: ${canvasPatch.topic}`,
    `Resolved headline: ${canvasPatch.headline}`,
    `Resolved subHeadline: ${canvasPatch.subHeadline}`,
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
    `Text layer patch summary: ${JSON.stringify(textLayerPatches)}`,
    'Return orchestration guidance for safe canvas edits, generation, reset/export intent, and safety review.',
  ].filter(Boolean).join('\n');
  const agentPlan = await resolveAgentPlan(agentPayload, [], basePrompt, env, {
    ...options,
    runId: chatRunId,
  });
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
  if (replacementIntent && replacementTarget) {
    canvasSummary = `${describeLayerForChat(replacementTarget.id)}를 “${replacementIntent.newText}”${getKoreanRoroParticle(replacementIntent.newText)} 바꿨어요.`;
  } else if (replacementIntent && !replacementTarget) {
    canvasSummary = '바꿀 문구를 찾지 못해서 캔버스 문구는 그대로 두었어요.';
  } else if (optimizationIntent && textLayerPatches.length) {
    canvasSummary = `문구 ${textLayerPatches.length}개의 위치와 크기를 보기 좋게 정리했어요. 내용은 그대로 두었습니다.`;
  } else if (textLayerPatches.length) {
    canvasSummary = `${describeLayerForChat(textLayerPatches[0]?.id)}를 다듬고, 메인 문구 “${canvasPatch.headline}”와 스티커 문구 “${canvasPatch.subHeadline}”를 확인했어요.`;
  }
  const contextSummary = [
    shouldUseConversationForFollowup ? `최근 대화 ${conversationMessages.length}개도 참고했어요.` : '',
    focusText && textLayerPatches.length ? '선택한 문구도 함께 참고했어요.' : '',
    attachmentText && shouldGenerate ? `참고 이미지 ${request.referenceImageAttachments?.length ?? 0}장도 메타데이터만 참고했어요.` : '',
  ].filter(Boolean).join(' ');

  return createThumbnailChatResult({
    request,
    status,
    assistantMessage: [
      '요청을 이해했어요.',
      canvasSummary,
      contextSummary,
      shouldGenerate ? '이어서 실제 썸네일 이미지까지 만들게요.' : '바로 만들고 싶으면 “생성해줘”라고 입력하세요.',
    ].filter(Boolean).join(' '),
    canvasPatch,
    textLayerPatches,
    providerId: resolvedProviderId,
    generationMode: resolvedGenerationMode,
    shouldGenerate,
    shouldReset: false,
    chatIntent,
    chatRunId,
    chatThreadId,
    conversationText,
    focusText,
    attachmentText,
    agentPlan,
  });
}

const COMMAND_PLAN_FIELDS = new Set([
  'mode',
  'runtime',
  'concept',
  'layoutBrief',
  'promptAddendum',
  'safetyReview',
  'nextActions',
  'warnings',
  'diagnostics',
]);
const COMMAND_PLAN_STRING_LIMITS: Record<string, number> = {
  runtime: 96,
  concept: 600,
  layoutBrief: 1200,
  promptAddendum: 4000,
  safetyReview: 1000,
};
const COMMAND_DIAGNOSTIC_STRING_LIMITS: Record<string, number> = {
  runtime: 96,
  model: 128,
  effort: 32,
  threadPolicy: 128,
  imageModelLabel: 256,
  threadId: 160,
  graph: 96,
  graphRuntime: 128,
  retrievalProof: 1000,
};
const COMMAND_DIAGNOSTIC_NUMBER_LIMITS: Record<string, readonly [number, number]> = {
  referenceImageCount: [0, 8],
  retrievalEvidenceCount: [0, 32],
  basePromptLength: [0, 16_000],
  timeoutSeconds: [5, 600],
};
const COMMAND_DIAGNOSTIC_BOOLEAN_FIELDS = new Set(['graphFallback', 'parseFallback']);
const SUPPRESSED_COMMAND_DIAGNOSTIC_FIELDS = new Set(['stdoutPreview', 'stderrPreview']);
const MAX_COMMAND_PLAN_DIAGNOSTICS = 12;
const MAX_COMMAND_PLAN_WARNINGS = 8;
const MAX_COMMAND_PLAN_NEXT_ACTIONS = 6;
const MAX_COMMAND_PLAN_WARNING_LENGTH = 320;
const MAX_COMMAND_PLAN_NEXT_ACTION_LENGTH = 160;

function isCommandPlanRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBoundedCommandStringArray(value: unknown, maxItems: number, maxItemLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  if (!value.every((item) => typeof item === 'string' && item.length <= maxItemLength)) return null;
  return value;
}

function parseCommandDiagnostics(value: unknown): Record<string, string | number | boolean> | null {
  if (!isCommandPlanRecord(value) || Object.keys(value).length > MAX_COMMAND_PLAN_DIAGNOSTICS) return null;

  const diagnostics: Record<string, string | number | boolean> = {};
  for (const [name, field] of Object.entries(value)) {
    if (SUPPRESSED_COMMAND_DIAGNOSTIC_FIELDS.has(name)) {
      if (field !== '[SUPPRESSED]') return null;
      continue;
    }

    const stringLimit = COMMAND_DIAGNOSTIC_STRING_LIMITS[name];
    if (stringLimit !== undefined) {
      if (typeof field !== 'string' || field.length > stringLimit) return null;
      diagnostics[name] = field;
      continue;
    }

    const numberLimit = COMMAND_DIAGNOSTIC_NUMBER_LIMITS[name];
    if (numberLimit) {
      if (typeof field !== 'number' || !Number.isFinite(field) || field < numberLimit[0] || field > numberLimit[1]) return null;
      diagnostics[name] = field;
      continue;
    }

    if (COMMAND_DIAGNOSTIC_BOOLEAN_FIELDS.has(name) && typeof field === 'boolean') {
      diagnostics[name] = field;
      continue;
    }

    return null;
  }
  return diagnostics;
}

function parseCommandPlan(text: string): Partial<ThumbnailAgentPlan> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isCommandPlanRecord(parsed) || Object.keys(parsed).some((key) => !COMMAND_PLAN_FIELDS.has(key))) return null;
    if (parsed.mode !== undefined && parsed.mode !== 'command') return null;

    const plan: Record<string, unknown> = {};
    for (const [name, maxLength] of Object.entries(COMMAND_PLAN_STRING_LIMITS)) {
      const value = parsed[name];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > maxLength) return null;
      plan[name] = value;
    }

    if (parsed.warnings !== undefined) {
      const warnings = parseBoundedCommandStringArray(
        parsed.warnings,
        MAX_COMMAND_PLAN_WARNINGS,
        MAX_COMMAND_PLAN_WARNING_LENGTH,
      );
      if (!warnings) return null;
      plan.warnings = warnings;
    }
    if (parsed.nextActions !== undefined) {
      const nextActions = parseBoundedCommandStringArray(
        parsed.nextActions,
        MAX_COMMAND_PLAN_NEXT_ACTIONS,
        MAX_COMMAND_PLAN_NEXT_ACTION_LENGTH,
      );
      if (!nextActions) return null;
      plan.nextActions = nextActions;
    }
    if (parsed.diagnostics !== undefined) {
      const diagnostics = parseCommandDiagnostics(parsed.diagnostics);
      if (!diagnostics) return null;
      plan.diagnostics = diagnostics;
    }

    return plan as Partial<ThumbnailAgentPlan>;
  } catch {
    return null;
  }
}

function normalizeCommandPlan(
  parsed: Partial<ThumbnailAgentPlan>,
  fallback: ThumbnailAgentPlan,
  env: NodeJS.ProcessEnv,
): ThumbnailAgentPlan {
  const redact = (value: string) => redactConfiguredSecrets(value, env);
  const warnings = (parsed.warnings ?? []).map(redact);
  const nextActions = (parsed.nextActions ?? fallback.nextActions).map(redact);
  const diagnostics = Object.fromEntries(
    Object.entries(parsed.diagnostics ?? {}).map(([name, value]) => [name, typeof value === 'string' ? redact(value) : value]),
  );
  return {
    mode: 'command',
    runtime: typeof parsed.runtime === 'string' && parsed.runtime.trim() ? redact(parsed.runtime.trim()) : resolveThumbnailAgentRuntime(),
    concept: typeof parsed.concept === 'string' && parsed.concept.trim() ? redact(parsed.concept.trim()) : fallback.concept,
    layoutBrief: typeof parsed.layoutBrief === 'string' && parsed.layoutBrief.trim() ? redact(parsed.layoutBrief.trim()) : fallback.layoutBrief,
    promptAddendum: typeof parsed.promptAddendum === 'string' && parsed.promptAddendum.trim() ? redact(parsed.promptAddendum.trim()) : fallback.promptAddendum,
    safetyReview: typeof parsed.safetyReview === 'string' && parsed.safetyReview.trim() ? redact(parsed.safetyReview.trim()) : fallback.safetyReview,
    nextActions,
    warnings: ['backend_agent_command: thumbnail backend-agent runner가 orchestration brief를 생성했습니다.', ...warnings],
    diagnostics,
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
  const command = resolveThumbnailAgentCommand(env, env.THUMBNAIL_AGENT_COMMAND);
  if (!command.ok) {
    if (env.THUMBNAIL_AGENT_COMMAND?.trim()) {
      throw new ThumbnailGenerationError(
        'provider_unavailable',
        'Thumbnail backend-agent command is unavailable.',
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
      'Thumbnail backend-agent command failed.',
      503,
    );
  }

  const parsed = parseCommandPlan(result.stdout);
  if (!parsed) {
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      'Thumbnail backend-agent returned invalid output.',
      503,
    );
  }

  return normalizeCommandPlan(parsed, fallback, env);
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
