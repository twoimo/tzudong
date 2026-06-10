import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { generateLocalStoryboard } from "./generator";
import type {
  StoryboardBackendAgentStatus,
  StoryboardChatAgentRequest,
  StoryboardChatFocusContext,
  StoryboardChatAgentResult,
  StoryboardChatCanvasPatch,
  StoryboardChatScenePatch,
  StoryboardGenerateRequest,
  StoryboardGenerationResult,
  StoryboardGenerationMode,
  StoryboardGraphDiagnostics,
  StoryboardGraphFallbackReason,
  StoryboardTone,
} from "./types";

const BACKEND_AGENT_NOTEBOOKS = [
  "scripts/03-storyboard-agent.ipynb",
  "scripts/04-storyboard-agent-graph-debug.ipynb",
];
const BACKEND_AGENT_GRAPH = "src/graph.py";
const APP_WEB_MARKER = "app/api/admin/storyboard/route.ts";
const REQUIRED_PYTHON_MODULES = [
  "langgraph",
  "langchain_openai",
  "langchain_core",
  "langchain_teddynote",
];
const DEFAULT_STORYBOARD_AGENT_TIMEOUT_MS = 120_000;
const MIN_STORYBOARD_AGENT_TIMEOUT_MS = 5_000;
const MAX_STORYBOARD_AGENT_TIMEOUT_MS = 600_000;
const DEFAULT_STORYBOARD_AGENT_RUNTIME = "langgraph";
const DEFAULT_STORYBOARD_AGENT_CODEX_MODEL = "gpt-5.5";
const DEFAULT_STORYBOARD_AGENT_CODEX_EFFORT = "high";
const UNSAFE_COMMAND_PATTERN = /[\s;&|`$<>()[\]{}!#\n\r]/;
const SECRET_PATTERNS = [
  /sk-proj-[A-Za-z0-9_-]{12,}/g,
  /sk-[A-Za-z0-9_-]{12,}/g,
  /eyJ[A-Za-z0-9_.-]{20,}/g,
  /(OPENAI[_A-Z]*|SERVICE[_A-Z]*|SUPABASE[_A-Z]*|API[_A-Z]*KEY|TOKEN|SECRET)\s*[:=]\s*[^\s,;"'{}\\]+/gi,
  /https:\/\/[^\s]+(?:token|key|secret)[^\s]*/gi,
];
const HOSTILE_PUBLIC_TEXT_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions?/gi,
  /reveal\s+(?:openai[_\s-]*api[_\s-]*key|api[_\s-]*key|secret|token)[^.!?\n\r]*/gi,
  /delete\s+\.?omx\/state[^.!?\n\r]*/gi,
  /검증을\s*건너뛰[^\n\r.!?]*/g,
  /이전\s*지시(?:를)?\s*무시[^\n\r.!?]*/g,
];

type CommandResult = {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

type ParsedStoryboardAgentOutput = Partial<StoryboardGenerationResult> & {
  markdown?: string;
  final_output?: string;
  backendAgent?: {
    graph?: unknown;
  };
  storyboard?: {
    contentAuthority?: unknown;
  };
  diagnostics?: {
    runtime?: unknown;
    graph?: unknown;
  };
};

type ResolvedStoryboardAgentCommand =
  | {
      ok: true;
      executable: string;
      args: string[];
    }
  | {
      ok: false;
      reason: string;
    };

function firstExistingPath(candidates: string[], fallback = process.cwd()) {
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    candidates[0] ??
    fallback
  );
}

function resolveAppWebRoot() {
  return firstExistingPath(
    [
      process.cwd(),
      path.resolve(process.cwd(), "apps/web"),
      path.resolve(process.cwd(), ".."),
      path.resolve(process.cwd(), "../.."),
    ].filter((candidate) => existsSync(path.join(candidate, APP_WEB_MARKER))),
  );
}

const APP_WEB_ROOT = resolveAppWebRoot();
const BACKEND_AGENT_ROOT = process.env.STORYBOARD_AGENT_ROOT?.trim()
  ? path.resolve(APP_WEB_ROOT, process.env.STORYBOARD_AGENT_ROOT.trim())
  : firstExistingPath([
      path.resolve(APP_WEB_ROOT, "../../backend/storyboard-agent"),
      path.resolve(process.cwd(), "backend/storyboard-agent"),
    ]);

function backendAgentPath(relativePath: string) {
  return path.join(BACKEND_AGENT_ROOT, relativePath);
}

function resolveStoryboardAgentPython() {
  return process.env.STORYBOARD_AGENT_PYTHON?.trim() || "python3";
}

function resolveStoryboardAgentRuntime() {
  const runtime = (
    process.env.STORYBOARD_AGENT_RUNTIME?.trim() ||
    DEFAULT_STORYBOARD_AGENT_RUNTIME
  );
  return runtime === "codex_cli_oauth" || runtime === "codex"
    ? "codex_cli_oauth_legacy"
    : runtime === "local_adapter_fallback"
      ? "local_adapter_fallback"
      : "langgraph";
}

function resolveStoryboardAgentCodexModel(
  env: NodeJS.ProcessEnv = process.env,
) {
  return (
    env.STORYBOARD_AGENT_CODEX_MODEL?.trim() ||
    DEFAULT_STORYBOARD_AGENT_CODEX_MODEL
  );
}

function resolveStoryboardAgentCodexEffort(
  env: NodeJS.ProcessEnv = process.env,
) {
  return (
    env.STORYBOARD_AGENT_CODEX_EFFORT?.trim() ||
    DEFAULT_STORYBOARD_AGENT_CODEX_EFFORT
  );
}

function resolveStoryboardAgentTimeoutMs() {
  const parsed = Number(process.env.STORYBOARD_AGENT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_STORYBOARD_AGENT_TIMEOUT_MS;
  return Math.min(
    MAX_STORYBOARD_AGENT_TIMEOUT_MS,
    Math.max(MIN_STORYBOARD_AGENT_TIMEOUT_MS, Math.floor(parsed)),
  );
}

function sanitizeCommandOutput(raw: string) {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[REDACTED]"),
    raw,
  );
}

function sanitizePublicAgentText(value: string) {
  return HOSTILE_PUBLIC_TEXT_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[SAFETY-REDACTED-INSTRUCTION]"),
    sanitizeCommandOutput(value),
  ).replace(/\s{2,}/g, " ").trim();
}

function resolveStoryboardAgentCommand(
  rawCommand?: string | null,
): ResolvedStoryboardAgentCommand {
  const command = rawCommand?.trim();
  if (!command) return { ok: false, reason: "not-configured" };
  if (UNSAFE_COMMAND_PATTERN.test(command)) {
    return { ok: false, reason: "unsafe-command-string" };
  }
  const executableCandidates = path.isAbsolute(command)
    ? [command]
    : [
        path.resolve(APP_WEB_ROOT, command),
        path.resolve(process.cwd(), command),
        path.resolve(BACKEND_AGENT_ROOT, command),
      ];
  const executable = firstExistingPath(executableCandidates);
  try {
    accessSync(executable, constants.X_OK);
    return { ok: true, executable, args: [] };
  } catch {
    return { ok: false, reason: "command-not-executable" };
  }
}

function listMissingPythonModules() {
  const script = [
    "import importlib, json",
    `mods = ${JSON.stringify(REQUIRED_PYTHON_MODULES)}`,
    "missing = []",
    "for mod in mods:",
    "    try:",
    "        importlib.import_module(mod)",
    "    except Exception:",
    "        missing.append(mod)",
    "print(json.dumps(missing))",
  ].join("\n");
  const result = spawnSync(resolveStoryboardAgentPython(), ["-c", script], {
    cwd: BACKEND_AGENT_ROOT,
    encoding: "utf8",
    timeout: 5_000,
    env: {
      ...process.env,
      PYTHONPATH: [backendAgentPath("src"), process.env.PYTHONPATH]
        .filter(Boolean)
        .join(path.delimiter),
    },
  });
  if (result.error || result.status !== 0) return REQUIRED_PYTHON_MODULES;
  try {
    const parsed = JSON.parse(result.stdout.trim()) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : REQUIRED_PYTHON_MODULES;
  } catch {
    return REQUIRED_PYTHON_MODULES;
  }
}

export function getStoryboardBackendAgentStatus(): StoryboardBackendAgentStatus {
  const commandResolution = resolveStoryboardAgentCommand(
    process.env.STORYBOARD_AGENT_COMMAND,
  );
  const commandConfigured = Boolean(
    process.env.STORYBOARD_AGENT_COMMAND?.trim(),
  );
  const runtime = resolveStoryboardAgentRuntime();
  const notebooks = BACKEND_AGENT_NOTEBOOKS.filter((notebook) =>
    existsSync(backendAgentPath(notebook)),
  );
  const graphEntrypoint = existsSync(backendAgentPath(BACKEND_AGENT_GRAPH))
    ? backendAgentPath(BACKEND_AGENT_GRAPH)
    : null;
  const missingPythonModules =
    commandConfigured && runtime !== "codex_cli_oauth_legacy"
      ? listMissingPythonModules()
      : commandConfigured
        ? []
        : REQUIRED_PYTHON_MODULES;

  const localAdapterAvailable =
    existsSync(BACKEND_AGENT_ROOT) &&
    Boolean(graphEntrypoint) &&
    notebooks.length > 0;
  const commandAvailable = commandResolution.ok;

  return {
    available: localAdapterAvailable || commandAvailable,
    mode: commandConfigured ? "command" : "local_adapter",
    rootPath: BACKEND_AGENT_ROOT,
    notebooks,
    graphEntrypoint,
    commandConfigured,
    commandAvailable,
    commandPath: commandResolution.ok
      ? commandResolution.executable
      : undefined,
    commandRejectionReason: commandResolution.ok
      ? undefined
      : commandResolution.reason,
    localAdapterAvailable,
    missingPythonModules,
    runtime,
    codexModel: resolveStoryboardAgentCodexModel(),
    codexEffort: resolveStoryboardAgentCodexEffort(),
    streamingAvailable: true,
  };
}

function normalizeStoryboardChatRequirement(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 400)
    : "";
}

function normalizeStoryboardChatFocusContext(
  value: unknown,
): StoryboardChatFocusContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StoryboardChatFocusContext>;
  const kind =
    candidate.kind === "cut" || candidate.kind === "action"
      ? candidate.kind
      : null;
  const label = normalizeStoryboardChatRequirement(candidate.label).slice(
    0,
    80,
  );
  const detail = normalizeStoryboardChatRequirement(candidate.detail).slice(
    0,
    180,
  );
  const promptContext = normalizeStoryboardChatRequirement(
    candidate.promptContext,
  ).slice(0, 260);
  if (!kind || !label || !promptContext) return null;
  return {
    kind,
    label,
    detail,
    promptContext,
    sceneNo: Number.isFinite(candidate.sceneNo)
      ? Number(candidate.sceneNo)
      : undefined,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt.slice(0, 80)
        : new Date(0).toISOString(),
  };
}

function formatStoryboardChatFocusContext(
  value: StoryboardChatFocusContext | null,
) {
  if (!value) return "";
  return [
    value.kind === "cut"
      ? `선택 컷: ${value.label}`
      : `최근 액션: ${value.label}`,
    value.detail,
    value.promptContext,
  ]
    .filter(Boolean)
    .join(" · ");
}

function clampStoryboardNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function deriveStoryboardTone(
  message: string,
  fallback: StoryboardTone = "warm",
): StoryboardTone {
  if (/(초반|몰입|강하게|빠르게|에너지|하이라이트|훅)/i.test(message))
    return "energetic";
  if (/(다큐|과정|맥락|설명|차분)/i.test(message)) return "documentary";
  if (/(힐링|편안|잔잔|소리|식감)/i.test(message)) return "comfort";
  return fallback;
}

function deriveStoryboardSegmentCount(message: string, fallback: number) {
  if (deriveExplicitStoryboardSceneNo(message) !== undefined) return fallback;
  const explicit = message.match(
    /(?:총|전체)?\s*(\d{1,2})\s*(?:컷|cut|cuts|장면)\s*(?:으로|짜|구성|생성|만들|스토리보드)/i,
  )?.[1];
  return clampStoryboardNumber(Number(explicit), 4, 10, fallback);
}

function deriveStoryboardTargetLength(message: string, fallback: number) {
  const explicit = message.match(/(\d{1,2})\s*(?:분|minute|minutes|min)/i)?.[1];
  return clampStoryboardNumber(Number(explicit), 6, 60, fallback);
}

function wantsStoryboardGeneration(message: string) {
  return (
    /(생성|만들|짜줘|구성해|구성|실행|뽑아|스토리보드)/i.test(message) &&
    !/(하지\s*마|생성\s*금지|멈춰)/i.test(message)
  );
}

function wantsStoryboardReset(message: string) {
  return /(초기화|리셋|reset)/i.test(message);
}

function wantsSelectedStoryboardImageRegeneration(message: string) {
  return (
    /(?:이|현재|선택)\s*컷\s*만.*(?:재생성|다시\s*생성|이미지)/i.test(
      message,
    ) ||
    /(?:재생성|다시\s*생성).*(?:이|현재|선택)\s*컷\s*만/i.test(message) ||
    /컷만.*(?:재생성|다시\s*생성|이미지)/i.test(message) ||
    (deriveExplicitStoryboardSceneNo(message) !== undefined &&
      /(?:재생성|다시\s*생성|이미지)/i.test(message))
  );
}

function hasExplicitStoryboardScenePatchIntent(message: string) {
  return /(자막|subtitle|문구|카피|caption|오디오|멘트|대사|말|나레이션|감탄사|audio|연출|비주얼|구도|클로즈업|화면|이미지|리액션|표정|음식|visual|제목|타이틀|title|수정|변경|바꿔|바꿔줘|고쳐|보완|짧게|줄여|재생성|다시\s*생성)/i.test(
    message,
  );
}

function hasStoryboardNavigationIntent(message: string) {
  return /(?:보여줘|보여\s*줘|이동|가줘|열어|확인|선택|포커스|focus|show|open|go\s*to)/i.test(
    message,
  );
}

function parseStoryboardSceneNo(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const sceneNo = Math.trunc(parsed);
  return sceneNo >= 1 && sceneNo <= 99 ? sceneNo : undefined;
}

function matchStoryboardSceneNoFromMessage(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized) return undefined;

  const labelPatterns = [
    /\bcut\s*0?(\d{1,2})\b/i,
    /(?:^|[^\d])컷\s*0?(\d{1,2})(?=$|[^\d])/i,
    /(?:^|[^\d])0?(\d{1,2})\s*번\s*컷(?=$|[^\d])/i,
  ];

  for (const pattern of labelPatterns) {
    const matched = normalized.match(pattern)?.[1];
    const sceneNo = parseStoryboardSceneNo(matched);
    if (sceneNo !== undefined) return sceneNo;
  }

  const koreanCut = normalized.match(
    /(?:^|[^\d])0?(\d{1,2})\s*컷(?=\s*(?:만|의|을|를|은|는|에서|로|으로|보기|보여|이동|선택|열어|확인|포커스|자막|오디오|이미지|다시|재생성|수정|변경|바꿔|고쳐|보완|짧게|줄여|$))/i,
  )?.[1];
  return parseStoryboardSceneNo(koreanCut);
}

function deriveExplicitStoryboardSceneNo(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized || !hasExplicitStoryboardScenePatchIntent(normalized)) {
    return undefined;
  }
  return matchStoryboardSceneNoFromMessage(normalized);
}

function deriveStoryboardNavigationSceneNo(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (
    !normalized ||
    !hasStoryboardNavigationIntent(normalized) ||
    hasExplicitStoryboardScenePatchIntent(normalized) ||
    wantsStoryboardGeneration(normalized) ||
    wantsStoryboardReset(normalized)
  ) {
    return undefined;
  }
  return matchStoryboardSceneNoFromMessage(normalized);
}

function createStoryboardScenePatch(
  message: string,
  focusContext: StoryboardChatFocusContext | null,
): StoryboardChatScenePatch | undefined {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized || !hasExplicitStoryboardScenePatchIntent(normalized))
    return undefined;
  const explicitSceneNo = deriveExplicitStoryboardSceneNo(normalized);
  const selectedSceneNo =
    focusContext?.kind === "cut" && Number.isFinite(focusContext.sceneNo)
      ? Number(focusContext.sceneNo)
      : undefined;
  const sceneNo = explicitSceneNo ?? selectedSceneNo;
  if (!sceneNo) return undefined;
  const sceneTargetLabel = explicitSceneNo ? "명시 CUT" : "선택 CUT";

  const patch: StoryboardChatScenePatch = {
    sceneNo,
    targetSource: explicitSceneNo ? "explicit" : "selected",
    operatorIntent: `${sceneTargetLabel} 요청 반영: ${normalized}`,
    productionChecklist: [
      `${sceneTargetLabel}만 채팅 요구사항 기준으로 검토`,
      "필요 시 대상 컷만 GPT Image 2로 재생성",
    ],
  };

  if (/(제목|타이틀|title)/i.test(normalized)) {
    patch.title = `채팅 반영 · ${normalized.slice(0, 42)}`;
  }
  if (/(오디오|멘트|대사|말|나레이션|감탄사|audio)/i.test(normalized)) {
    patch.hostBeat = `요청 반영: ${normalized}`;
  }
  if (/(자막|subtitle|문구|카피|caption)/i.test(normalized)) {
    patch.captionIdea = `요청 반영: ${normalized}`;
  }
  if (
    /(연출|비주얼|구도|클로즈업|화면|이미지|리액션|표정|음식|visual)/i.test(
      normalized,
    )
  ) {
    patch.visualDirection = `요청 반영: ${normalized}`;
  }
  if (wantsSelectedStoryboardImageRegeneration(normalized)) {
    patch.regenerateImage = true;
  }
  if (
    !patch.title &&
    !patch.hostBeat &&
    !patch.captionIdea &&
    !patch.visualDirection &&
    !patch.regenerateImage
  ) {
    patch.captionIdea = `선택 CUT 보완: ${normalized}`;
  }

  return patch;
}

function createStoryboardChatCanvasPatch(
  request: StoryboardChatAgentRequest,
): StoryboardChatCanvasPatch {
  const normalized = normalizeStoryboardChatRequirement(request.message);
  const focusContext = normalizeStoryboardChatFocusContext(
    request.focusContext,
  );
  const focusText = formatStoryboardChatFocusContext(focusContext);
  const scenePatch = createStoryboardScenePatch(normalized, focusContext);
  const requestedFocusSceneNo = scenePatch
    ? undefined
    : deriveStoryboardNavigationSceneNo(normalized);
  const availableSceneCount = clampStoryboardNumber(
    Number(request.currentAvailableSceneCount),
    1,
    99,
    request.currentSegmentCount ?? 8,
  );
  const focusSceneNo =
    requestedFocusSceneNo !== undefined &&
    requestedFocusSceneNo <= availableSceneCount
      ? requestedFocusSceneNo
      : undefined;
  const unavailableFocusSceneNo =
    requestedFocusSceneNo !== undefined &&
    requestedFocusSceneNo > availableSceneCount
      ? requestedFocusSceneNo
      : undefined;
  const isNavigationRequest =
    focusSceneNo !== undefined || unavailableFocusSceneNo !== undefined;
  const shouldIncludeFocusContext =
    !isNavigationRequest && scenePatch?.targetSource !== "explicit";
  const normalizedWithFocus = normalizeStoryboardChatRequirement(
    [
      normalized,
      shouldIncludeFocusContext && focusText
        ? `현재 캔버스 맥락: ${focusText}`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  const fallbackPrompt =
    normalizeStoryboardChatRequirement(request.baselinePrompt) ||
    normalizeStoryboardChatRequirement(request.currentPrompt) ||
    "먹방 피크 기반 스토리보드";
  const promptBasis = isNavigationRequest
    ? fallbackPrompt
    : normalizedWithFocus || fallbackPrompt;
  const derivedSegmentCount = deriveStoryboardSegmentCount(
    promptBasis,
    request.currentSegmentCount ?? 8,
  );
  return {
    prompt: promptBasis,
    tone: deriveStoryboardTone(promptBasis, request.currentTone ?? "warm"),
    targetLengthMinutes: deriveStoryboardTargetLength(
      promptBasis,
      request.currentTargetLengthMinutes ?? 18,
    ),
    segmentCount: isNavigationRequest
      ? availableSceneCount
      : derivedSegmentCount,
    generationMode: request.generationMode ?? "backend_agent",
    focusSceneNo,
    unavailableFocusSceneNo,
    scenePatch,
  };
}

export async function generateStoryboardChatWithBackendAgent(
  request: StoryboardChatAgentRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoryboardChatAgentResult> {
  const normalizedMessage = normalizeStoryboardChatRequirement(request.message);
  if (!normalizedMessage) {
    throw new Error("채팅 요구사항을 입력하세요.");
  }

  const canvasPatch = createStoryboardChatCanvasPatch(request);
  const focusContext = normalizeStoryboardChatFocusContext(
    request.focusContext,
  );
  const focusText = formatStoryboardChatFocusContext(focusContext);
  const isNavigationOnly = Boolean(
    canvasPatch.focusSceneNo && !canvasPatch.scenePatch,
  );
  const isUnavailableNavigation = Boolean(
    canvasPatch.unavailableFocusSceneNo && !canvasPatch.scenePatch,
  );
  const effectiveFocusText =
    canvasPatch.scenePatch?.targetSource === "explicit" ||
    isNavigationOnly ||
    isUnavailableNavigation
      ? ""
      : focusText;
  const status = getStoryboardBackendAgentStatus();
  const shouldReset = wantsStoryboardReset(normalizedMessage);
  const shouldRegenerateSelectedSceneImage = Boolean(
    canvasPatch.scenePatch?.regenerateImage,
  );
  const shouldGenerate =
    wantsStoryboardGeneration(normalizedMessage) &&
    !shouldReset &&
    !shouldRegenerateSelectedSceneImage;
  const runtime = status.runtime ?? DEFAULT_STORYBOARD_AGENT_RUNTIME;
  const model = status.codexModel ?? resolveStoryboardAgentCodexModel(env);
  const effort = status.codexEffort ?? resolveStoryboardAgentCodexEffort(env);

  return {
    assistantMessage: [
      `Codex CLI ${model} ${effort} 작업 완료`,
      shouldReset
        ? "초기화 요청을 반영합니다."
        : `캔버스 반영 · ${canvasPatch.segmentCount}컷 · ${canvasPatch.targetLengthMinutes}분 · ${canvasPatch.tone}`,
      canvasPatch.scenePatch
        ? `CUT ${String(canvasPatch.scenePatch.sceneNo).padStart(2, "0")} 부분 수정 패치를 준비했습니다.`
        : null,
      isNavigationOnly
        ? `CUT ${String(canvasPatch.focusSceneNo).padStart(2, "0")}로 캔버스 포커스를 이동합니다.`
        : null,
      isUnavailableNavigation
        ? `CUT ${String(canvasPatch.unavailableFocusSceneNo).padStart(2, "0")}는 현재 ${canvasPatch.segmentCount}컷 결과에 없어 선택을 해제했습니다.`
        : null,
      effectiveFocusText
        ? `${focusContext?.label} 맥락을 함께 반영했습니다.`
        : null,
      shouldRegenerateSelectedSceneImage
        ? "현재 선택 컷만 GPT Image 2 재생성 대상으로 표시했습니다."
        : null,
      shouldGenerate
        ? "채팅 요청에 따라 실제 스토리보드 생성까지 이어서 실행합니다."
        : "추가로 “생성해줘”라고 입력하면 실제 스토리보드 생성까지 이어집니다.",
    ]
      .filter(Boolean)
      .join(" · "),
    canvasPatch,
    shouldGenerate,
    shouldReset,
    backendAgent: {
      mode: status.mode,
      runtime,
      concept: `${canvasPatch.segmentCount}컷 스토리보드 채팅 요구사항을 실제 히트맵 기반 생성 요청으로 정리`,
      layoutBrief: `좌측 2×2 캔버스 페이지에 ${canvasPatch.tone} 톤으로 ${canvasPatch.targetLengthMinutes}분 분량의 컷 흐름을 반영`,
      promptAddendum: [
        "Storyboard chat agent task.",
        `User chat request: ${normalizedMessage}`,
        effectiveFocusText ? `Canvas focus context: ${effectiveFocusText}` : "",
        `Resolved prompt: ${canvasPatch.prompt}`,
        `Resolved cuts: ${canvasPatch.segmentCount}`,
        `Resolved target length minutes: ${canvasPatch.targetLengthMinutes}`,
        `Resolved tone: ${canvasPatch.tone}`,
        canvasPatch.focusSceneNo
          ? `Navigation focusSceneNo: ${canvasPatch.focusSceneNo}`
          : "",
        canvasPatch.unavailableFocusSceneNo
          ? `Navigation unavailableFocusSceneNo: ${canvasPatch.unavailableFocusSceneNo}`
          : "",
        canvasPatch.scenePatch
          ? `Selected CUT scenePatch: ${JSON.stringify(canvasPatch.scenePatch)}`
          : "",
      ].join("\n"),
      safetyReview:
        "관리자 콘솔 채팅 입력은 스토리보드 생성 요청으로만 반영하며, 실제 이미지 생성은 별도 GPT Image 2 단계에서 검수합니다.",
      nextActions: [
        "채팅 반영 결과 확인",
        "스토리보드 생성 실행",
        "필요 시 현재 페이지 이미지 생성",
      ],
      diagnostics: {
        runtime,
        codexModel: model,
        codexEffort: effort,
        chatIntent: shouldRegenerateSelectedSceneImage
          ? "regenerate_selected_scene"
          : shouldGenerate
            ? "generate"
            : shouldReset
              ? "reset"
              : isNavigationOnly
                ? "navigate"
                : isUnavailableNavigation
                  ? "navigate_unavailable"
                  : "edit",
      },
    },
    diagnostics: {
      runtime,
      model,
      effort,
      streaming: "sse-progress",
    },
  };
}

function runStoryboardAgentCommand(
  command: Extract<ResolvedStoryboardAgentCommand, { ok: true }>,
  payload: Record<string, unknown>,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const timeoutMs = resolveStoryboardAgentTimeoutMs();
    const child = spawn(command.executable, command.args, {
      cwd: existsSync(BACKEND_AGENT_ROOT) ? BACKEND_AGENT_ROOT : process.cwd(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        STORYBOARD_AGENT_JSON: JSON.stringify(payload),
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        exitCode: null,
        timedOut: true,
        stdout: sanitizeCommandOutput(stdout),
        stderr: sanitizeCommandOutput(stderr),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0,
        exitCode,
        timedOut: false,
        stdout: sanitizeCommandOutput(stdout),
        stderr: sanitizeCommandOutput(stderr),
      });
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        timedOut: false,
        stdout: sanitizeCommandOutput(stdout),
        stderr: sanitizeCommandOutput(`${stderr}\n${String(error)}`),
      });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sanitizePublicAgentDiagnostic(value: string, maxLength = 300) {
  return sanitizePublicAgentText(value).slice(0, maxLength);
}

function toPublicDiagnosticStringArray(value: unknown, maxItemLength = 120) {
  return toStringArray(value)
    .map((item) => sanitizePublicAgentDiagnostic(item, maxItemLength))
    .filter(Boolean);
}

function normalizeGraphRuntime(value: unknown): StoryboardGraphDiagnostics["runtime"] {
  return value === "codex_cli_oauth" || value === "codex_cli_oauth_legacy"
    ? "codex_cli_oauth_legacy"
    : value === "local_adapter_fallback"
      ? "local_adapter_fallback"
      : "langgraph";
}

function parseGraphRuntime(
  value: unknown,
): StoryboardGraphDiagnostics["runtime"] | null {
  if (
    value === "langgraph" ||
    value === "codex_cli_oauth" ||
    value === "codex_cli_oauth_legacy" ||
    value === "local_adapter_fallback"
  ) {
    return normalizeGraphRuntime(value);
  }
  return null;
}

function parseGraphStatus(
  value: unknown,
): StoryboardGraphDiagnostics["status"] | null {
  return value === "interrupted_output_ready" ||
    value === "interrupted_needs_resume" ||
    value === "fallback" ||
    value === "legacy" ||
    value === "used"
    ? value
    : null;
}

function normalizeGraphRetrieval(
  value: unknown,
  toolsCalled: string[],
): NonNullable<StoryboardGraphDiagnostics["retrieval"]> {
  if (!isObjectRecord(value)) return { status: "not_used" };
  const status = value.status === "used" || value.status === "failed" ? value.status : "not_used";
  if (status !== "used" || !toolsCalled.includes("search_scene_data")) {
    return { status };
  }
  const models = isObjectRecord(value.usedModels) ? value.usedModels : {};
  const operations = isObjectRecord(value.operations) ? value.operations : {};
  return {
    status: "used",
    usedModels: {
      embedding: models.embedding === "BAAI/bge-m3" ? "BAAI/bge-m3" : undefined,
      reranker:
        models.reranker === "BAAI/bge-reranker-v2-m3"
          ? "BAAI/bge-reranker-v2-m3"
          : undefined,
    },
    operations: {
      supabaseRpc:
        operations.supabaseRpc === "match_documents_hybrid"
          ? "match_documents_hybrid"
          : undefined,
      mmrApplied:
        typeof operations.mmrApplied === "boolean"
          ? operations.mmrApplied
          : undefined,
      captionLookup:
        operations.captionLookup === "get_video_captions_for_range"
          ? "get_video_captions_for_range"
          : undefined,
    },
  };
}

function normalizeGraphInterrupts(
  value: unknown,
): StoryboardGraphDiagnostics["interrupts"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObjectRecord)
    .map((item) => ({
      node:
        typeof item.node === "string"
          ? sanitizePublicAgentDiagnostic(item.node, 120) || "unknown"
          : "unknown",
      resumable: Boolean(item.resumable),
      outputReady: Boolean(item.outputReady),
      summary:
        typeof item.summary === "string"
          ? sanitizePublicAgentDiagnostic(item.summary, 300) || "LangGraph interrupt"
          : "LangGraph interrupt",
    }));
}

function normalizeGraphDiagnostics(
  value: unknown,
): StoryboardGraphDiagnostics | null {
  if (!isObjectRecord(value)) return null;
  const runtime = parseGraphRuntime(value.runtime);
  const parsedStatus = parseGraphStatus(value.status);
  if (!runtime || !parsedStatus) return null;
  if (
    value.mode !== "graph_command" &&
    value.mode !== "legacy_command" &&
    value.mode !== "local_adapter"
  ) {
    return null;
  }
  if (!Array.isArray(value.nodesVisited) || !Array.isArray(value.interrupts)) {
    return null;
  }
  if (!Array.isArray(value.toolsCalled)) return null;
  if (
    value.checkpointer !== "MemorySaver" &&
    value.checkpointerScope === "durable_cross_process"
  ) {
    return null;
  }
  if (runtime === "langgraph") {
    if (typeof value.threadId !== "string" || !value.threadId.trim()) {
      return null;
    }
    if (typeof value.checkpointer !== "string" || !value.checkpointer.trim()) {
      return null;
    }
  }
  const toolsCalled = toPublicDiagnosticStringArray(value.toolsCalled);
  const status =
    runtime === "codex_cli_oauth_legacy"
      ? "legacy"
      : parsedStatus;
  const fallbackReason =
    typeof value.fallbackReason === "string"
      ? normalizeFallbackReason(value.fallbackReason)
      : undefined;
  return {
    status,
    runtime,
    mode:
      value.mode === "legacy_command" || runtime === "codex_cli_oauth_legacy"
        ? "legacy_command"
        : value.mode === "local_adapter" || runtime === "local_adapter_fallback"
          ? "local_adapter"
          : "graph_command",
    threadId:
      typeof value.threadId === "string"
        ? sanitizePublicAgentDiagnostic(value.threadId, 160)
        : undefined,
    checkpointer:
      typeof value.checkpointer === "string"
        ? sanitizePublicAgentDiagnostic(value.checkpointer, 120)
        : undefined,
    checkpointerScope:
      value.checkpointer === "MemorySaver" ||
      value.checkpointerScope === "per_process_only"
        ? "per_process_only"
        : value.checkpointerScope === "durable_cross_process"
          ? "durable_cross_process"
          : undefined,
    graphEntrypoint:
      typeof value.graphEntrypoint === "string"
        ? sanitizePublicAgentDiagnostic(value.graphEntrypoint, 300)
        : undefined,
    nodesVisited: toPublicDiagnosticStringArray(value.nodesVisited),
    interrupts: normalizeGraphInterrupts(value.interrupts),
    toolsCalled,
    retrieval: normalizeGraphRetrieval(value.retrieval, toolsCalled),
    fallbackReason,
    fallbackDetail:
      typeof value.fallbackDetail === "string"
        ? sanitizePublicAgentDiagnostic(value.fallbackDetail, 600)
        : undefined,
  };
}

function normalizeFallbackReason(value: string): StoryboardGraphFallbackReason {
  if (
    value === "not_configured" ||
    value === "dependency_missing" ||
    value === "unsupported_runtime" ||
    value === "graph_timeout" ||
    value === "graph_invalid_output" ||
    value === "graph_execution_failed" ||
    value === "credential_missing" ||
    value === "retrieval_dependency_missing" ||
    value === "retrieval_rpc_unavailable"
  ) {
    return value;
  }
  if (value === "not-configured" || value === "command-not-executable") {
    return "not_configured";
  }
  if (value === "unsafe-command-string") return "unsupported_runtime";
  return "graph_execution_failed";
}

function mapCommandFailureToFallbackReason(
  status: StoryboardBackendAgentStatus,
  command?: CommandResult,
): StoryboardGraphFallbackReason {
  if (!status.commandConfigured) return "not_configured";
  if (!status.commandAvailable) {
    return normalizeFallbackReason(status.commandRejectionReason ?? "not-configured");
  }
  if (command?.timedOut) return "graph_timeout";
  const text = `${command?.stdout ?? ""}\n${command?.stderr ?? ""}`;
  if (/ModuleNotFoundError|ImportError|No module named/i.test(text)) {
    if (/FlagEmbedding|bge|reranker/i.test(text)) {
      return "retrieval_dependency_missing";
    }
    return "dependency_missing";
  }
  if (/OPENAI_API_KEY|SUPABASE|credential|unauthorized|permission/i.test(text)) {
    return "credential_missing";
  }
  if (/match_documents_hybrid|rpc|caption/i.test(text)) {
    return "retrieval_rpc_unavailable";
  }
  return "graph_execution_failed";
}

function createFallbackGraphDiagnostics(
  status: StoryboardBackendAgentStatus,
  reason: StoryboardGraphFallbackReason,
  detail?: string,
): StoryboardGraphDiagnostics {
  return {
    status: "fallback",
    runtime: "local_adapter_fallback",
    mode: "local_adapter",
    graphEntrypoint: status.graphEntrypoint
      ? sanitizePublicAgentDiagnostic(status.graphEntrypoint, 300)
      : undefined,
    nodesVisited: [],
    interrupts: [],
    toolsCalled: [],
    retrieval: { status: "not_used" },
    fallbackReason: reason,
    fallbackDetail: detail ? sanitizePublicAgentDiagnostic(detail, 600) : undefined,
  };
}

function createLegacyGraphDiagnostics(command?: CommandResult): StoryboardGraphDiagnostics {
  return {
    status: "legacy",
    runtime: "codex_cli_oauth_legacy",
    mode: "legacy_command",
    threadId: undefined,
    nodesVisited: [],
    interrupts: [],
    toolsCalled: [],
    retrieval: { status: "not_used" },
    fallbackDetail: command
      ? sanitizePublicAgentDiagnostic(`${command.stdout}\n${command.stderr}`, 600)
      : undefined,
  };
}

function appendBackendAgentAnalysis(
  result: StoryboardGenerationResult,
  status: StoryboardBackendAgentStatus,
  command?: CommandResult,
  graph?: StoryboardGraphDiagnostics,
) {
  result.backendAnalysis.reusedLogic = [
    "backend/storyboard-agent/src/graph.py supervisor→researcher→intern/designer LangGraph 구조",
    "backend/storyboard-agent/src/state/slots.py StoryboardSlots 슬롯 충족 모델",
    "backend/storyboard-agent/src/prompts/designer.py 스토리보드 출력 규칙",
    ...result.backendAnalysis.reusedLogic,
  ];
  result.backendAnalysis.localGapsHandled = [
    command?.ok
      ? "STORYBOARD_AGENT_COMMAND 실행 결과를 관리자 API에서 받아 구조화 결과와 함께 보존"
      : "STORYBOARD_AGENT_COMMAND 미설정 또는 Python/LangGraph 의존성 부족 시 로컬 히트맵 생성기로 안전 폴백",
    ...result.backendAnalysis.localGapsHandled,
  ];
  result.backendAnalysis.backendAgent = {
    ...status,
    runtime: graph?.runtime ?? status.runtime,
    invokedCommand: Boolean(command),
    commandExitCode: command?.exitCode,
    commandTimedOut: command?.timedOut,
    rawOutputPreview: command
      ? sanitizePublicAgentDiagnostic(`${command.stdout}\n${command.stderr}`, 1200)
      : undefined,
    graph,
  };
}

function applyBackendAdapterMode(result: StoryboardGenerationResult) {
  result.mode = "backend_agent_local_adapter";
  result.request.generationMode = "backend_agent";
  result.sourceSummary.dataModeLabel = "백엔드 에이전트 어댑터";
  result.storyboard.operatorBrief =
    "backend/storyboard-agent의 LangGraph 슬롯/디자이너 설계를 관리자 콘솔용 로컬 히트맵 생성 흐름에 연결했습니다.";
}

function parseStoryboardAgentOutput(
  command: CommandResult,
): ParsedStoryboardAgentOutput | null {
  const raw = command.stdout.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedStoryboardAgentOutput;
  } catch {
    return null;
  }
}


function isParsedStoryboardMetadataAuthoritative(
  parsed: ParsedStoryboardAgentOutput,
) {
  const graph =
    normalizeGraphDiagnostics(parsed.backendAgent?.graph) ??
    normalizeGraphDiagnostics(parsed.diagnostics?.graph);
  if (graph?.runtime !== "langgraph") return true;
  return parsed.storyboard?.contentAuthority === "authoritative";
}

function applyBackendCommandOutput(
  result: StoryboardGenerationResult,
  command: CommandResult,
  parsed: ParsedStoryboardAgentOutput | null,
) {
  result.mode = "backend_agent_command";
  result.request.generationMode = "backend_agent";
  result.sourceSummary.dataModeLabel = "백엔드 에이전트 명령 실행";
  const raw = command.stdout.trim();
  if (parsed) {
    const storyboardMetadataAuthoritative =
      isParsedStoryboardMetadataAuthoritative(parsed);
    if (typeof parsed.storyboard?.exportMarkdown === "string") {
      result.storyboard.exportMarkdown = sanitizePublicAgentText(parsed.storyboard.exportMarkdown);
    } else if (typeof parsed.markdown === "string") {
      result.storyboard.exportMarkdown = sanitizePublicAgentText(parsed.markdown);
    } else if (typeof parsed.final_output === "string") {
      result.storyboard.exportMarkdown = sanitizePublicAgentText(parsed.final_output);
    }
    if (
      storyboardMetadataAuthoritative &&
      typeof parsed.storyboard?.title === "string"
    ) {
      result.storyboard.title = sanitizePublicAgentText(parsed.storyboard.title);
    }
    if (
      storyboardMetadataAuthoritative &&
      typeof parsed.storyboard?.logline === "string"
    ) {
      result.storyboard.logline = sanitizePublicAgentText(parsed.storyboard.logline);
    }
    if (
      storyboardMetadataAuthoritative &&
      typeof parsed.storyboard?.operatorBrief === "string"
    ) {
      result.storyboard.operatorBrief = sanitizePublicAgentText(parsed.storyboard.operatorBrief);
    } else if (storyboardMetadataAuthoritative) {
      result.storyboard.operatorBrief =
        "백엔드 storyboard-agent 명령 실행 결과를 회의용 Markdown에 반영했습니다.";
    }
    return;
  }
  if (raw) {
    result.storyboard.exportMarkdown = sanitizePublicAgentText(raw);
    result.storyboard.operatorBrief =
      "백엔드 storyboard-agent 명령의 텍스트 출력을 회의용 Markdown으로 반영했습니다.";
  }
}

function extractGraphDiagnosticsFromParsedOutput(
  parsed: ParsedStoryboardAgentOutput | null,
) {
  return (
    normalizeGraphDiagnostics(parsed?.backendAgent?.graph) ??
    normalizeGraphDiagnostics(parsed?.diagnostics?.graph)
  );
}

export async function generateStoryboardWithBackendAgent(
  input?: Partial<StoryboardGenerateRequest> | null,
): Promise<StoryboardGenerationResult> {
  const sanitizedInput =
    input && typeof input.prompt === "string"
      ? { ...input, prompt: sanitizePublicAgentText(input.prompt) }
      : input;
  const status = getStoryboardBackendAgentStatus();
  const base = generateLocalStoryboard({
    ...sanitizedInput,
    generationMode: "backend_agent",
  });
  applyBackendAdapterMode(base);

  const command = resolveStoryboardAgentCommand(
    process.env.STORYBOARD_AGENT_COMMAND,
  );
  if (command.ok) {
    const commandResult = await runStoryboardAgentCommand(command, {
      request: base.request,
      backendAgentRoot: status.rootPath,
      graphEntrypoint: status.graphEntrypoint,
      localStoryboard: base,
    });
    if (commandResult.ok) {
      const parsed = parseStoryboardAgentOutput(commandResult);
      const graph =
        status.runtime === "codex_cli_oauth_legacy"
          ? createLegacyGraphDiagnostics(commandResult)
          : extractGraphDiagnosticsFromParsedOutput(parsed) ??
            createFallbackGraphDiagnostics(
              status,
              "graph_invalid_output",
              "LangGraph command succeeded but did not return canonical graph diagnostics.",
            );
      if (graph.status === "fallback") {
        applyBackendAdapterMode(base);
      } else {
        applyBackendCommandOutput(base, commandResult, parsed);
      }
      appendBackendAgentAnalysis(base, status, commandResult, graph);
      return base;
    }
    appendBackendAgentAnalysis(
      base,
      status,
      commandResult,
      createFallbackGraphDiagnostics(
        status,
        mapCommandFailureToFallbackReason(status, commandResult),
        `${commandResult.stdout}\n${commandResult.stderr}`,
      ),
    );
    return base;
  }

  appendBackendAgentAnalysis(
    base,
    status,
    undefined,
    createFallbackGraphDiagnostics(
      status,
      mapCommandFailureToFallbackReason(status),
      status.commandRejectionReason,
    ),
  );
  return base;
}
