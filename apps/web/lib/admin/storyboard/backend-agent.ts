import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { buildStoryboardAgentGraphFidelity } from "./agent-graph-fidelity";
import {
  generateLocalStoryboard,
  normalizeStoryboardExportMarkdown,
} from "./generator";
import { sanitizeStoryboardPublicText } from "./prompt-safety";
import {
  STORYBOARD_CHAT_MIN_SEGMENT_COUNT,
  STORYBOARD_MAX_SEGMENT_COUNT,
} from "./types";
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
  StoryboardChatImageAttachment,
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
  "FlagEmbedding",
  "supabase",
  "dotenv",
  "numpy",
  "pydantic",
];
const DEFAULT_STORYBOARD_AGENT_TIMEOUT_MS = 120_000;
const MIN_STORYBOARD_AGENT_TIMEOUT_MS = 5_000;
const MAX_STORYBOARD_AGENT_TIMEOUT_MS = 600_000;
function getRuntimeCwd() {
  const cwd = Reflect.get(process, "cwd");
  return typeof cwd === "function" ? cwd.call(process) : ".";
}

function resolveFromRuntimeCwd(...segments: string[]) {
  return path.resolve(/* turbopackIgnore: true */ getRuntimeCwd(), ...segments);
}

function getDefaultStoryboardAgentPython(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? "python" : "python3";
}
const DEFAULT_STORYBOARD_AGENT_RUNTIME = "langgraph";
const DEFAULT_STORYBOARD_AGENT_CODEX_MODEL = "gpt-5.5";
const DEFAULT_STORYBOARD_AGENT_CODEX_EFFORT = "low";
const DEFAULT_STORYBOARD_CHAT_SEGMENT_COUNT = 10;
const UNSAFE_COMMAND_PATTERN = /[\s;&|`$<>()[\]{}!#\n\r]/;

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
    referenceGraph?: unknown;
    agentGraphFidelity?: unknown;
  };
  agentGraphFidelity?: unknown;
  referenceGraph?: unknown;
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

function firstExistingPath(candidates: string[], fallback = getRuntimeCwd()) {
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    candidates[0] ??
    fallback
  );
}

function resolveAppWebRoot() {
  return firstExistingPath(
    [
      getRuntimeCwd(),
      resolveFromRuntimeCwd("apps/web"),
      resolveFromRuntimeCwd(".."),
      resolveFromRuntimeCwd("../.."),
    ].filter((candidate) => existsSync(/* turbopackIgnore: true */ path.join(candidate, APP_WEB_MARKER))),
  );
}

const APP_WEB_ROOT = resolveAppWebRoot();

function loadStoryboardAgentEnvFromAppWebRoot() {
  if (process.env.STORYBOARD_AGENT_LOAD_ENV_LOCAL !== "1") return;
  const envPath = path.join(/* turbopackIgnore: true */ APP_WEB_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  try {
    for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [rawKey, ...rawValueParts] = line.split("=");
      const key = rawKey.trim();
      if (!key.startsWith("STORYBOARD_AGENT_")) continue;
      if (process.env[key]) continue;
      process.env[key] = rawValueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // Next normally loads .env.local; this is only a dev/runtime fallback.
  }
}

loadStoryboardAgentEnvFromAppWebRoot();

const BACKEND_AGENT_ROOT = process.env.STORYBOARD_AGENT_ROOT?.trim()
  ? path.resolve(/* turbopackIgnore: true */ APP_WEB_ROOT, process.env.STORYBOARD_AGENT_ROOT.trim())
  : firstExistingPath([
      path.resolve(/* turbopackIgnore: true */ APP_WEB_ROOT, "../../backend/storyboard-agent"),
      resolveFromRuntimeCwd("backend/storyboard-agent"),
    ]);

function backendAgentPath(relativePath: string) {
  return path.join(BACKEND_AGENT_ROOT, relativePath);
}

export function resolveStoryboardAgentPythonForPlatform(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  return env.STORYBOARD_AGENT_PYTHON?.trim() || getDefaultStoryboardAgentPython(platform);
}

function resolveStoryboardAgentPython() {
  return resolveStoryboardAgentPythonForPlatform(process.env, process.platform);
}

function getPathEnvironmentValue(env: NodeJS.ProcessEnv = process.env) {
  return env.PATH || env.Path || env.path || "";
}

function resolveWindowsCommandFromPath(command: string, env: NodeJS.ProcessEnv = process.env) {
  if (process.platform !== "win32" || command.includes("/") || command.includes("\\")) {
    return command;
  }

  const pathExts = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  const lowerCommand = command.toLowerCase();
  const hasKnownExtension = pathExts.some((extension) =>
    lowerCommand.endsWith(extension),
  );
  const pathEntries = getPathEnvironmentValue(env)
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    const candidates = hasKnownExtension
      ? [path.join(entry, command)]
      : pathExts.map((extension) => path.join(entry, `${command}${extension}`));
    const resolved = candidates.find((candidate) => existsSync(candidate));
    if (resolved) return resolved;
  }

  return command;
}

function resolveStoryboardAgentPythonCommand() {
  return resolveWindowsCommandFromPath(resolveStoryboardAgentPython());
}

function shouldRunThroughWindowsCommandShell(command: string) {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command.trim());
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

function sanitizePublicAgentText(value: string) {
  return sanitizeStoryboardPublicText(value);
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
        path.resolve(/* turbopackIgnore: true */ APP_WEB_ROOT, command),
        resolveFromRuntimeCwd(command),
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
function resolveWindowsShellScriptRunner() {
  return firstExistingPath(
    [
      process.env.GJC_BASH_PATH ?? "",
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      "C:\\Program Files\\Git\\bin\\sh.exe",
      "C:\\Program Files\\Git\\usr\\bin\\sh.exe",
    ].filter(Boolean),
    "bash",
  );
}

function isPythonRuntimeUnavailableText(value: string | null | undefined) {
  return /enoent|executable not found in \$path|is not recognized as an internal or external command|cannot find the file specified|no such file or directory|python was not found|no python at|unable to create process/i.test(
    value ?? "",
  );
}

type PythonModuleProbeResult = {
  missingModules: string[];
  runtimeAvailable: boolean;
  runtimeError?: string;
};

function probePythonModules(): PythonModuleProbeResult {
  const script = [
    "import importlib.util, json",
    `mods = ${JSON.stringify(REQUIRED_PYTHON_MODULES)}`,
    "missing = [mod for mod in mods if importlib.util.find_spec(mod) is None]",
    "print(json.dumps(missing))",
  ].join("\n");
  const pythonCommand = resolveStoryboardAgentPythonCommand();
  const result = spawnSync(pythonCommand, ["-c", script], {
    cwd: BACKEND_AGENT_ROOT,
    encoding: "utf8",
    timeout: 15_000,
    shell: shouldRunThroughWindowsCommandShell(pythonCommand),
    env: {
      ...process.env,
      PYTHONPATH: [backendAgentPath("src"), process.env.PYTHONPATH]
        .filter(Boolean)
        .join(path.delimiter),
    },
  });
  if (result.error) {
    return {
      missingModules: [],
      runtimeAvailable: false,
      runtimeError: String(result.error),
    };
  }
  if (result.status !== 0) {
    const probeText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (isPythonRuntimeUnavailableText(probeText)) {
      return {
        missingModules: [],
        runtimeAvailable: false,
        runtimeError: probeText.trim() || `python exited with status ${result.status}`,
      };
    }
    return {
      missingModules: REQUIRED_PYTHON_MODULES,
      runtimeAvailable: true,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim()) as unknown;
    return {
      missingModules: Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : REQUIRED_PYTHON_MODULES,
      runtimeAvailable: true,
    };
  } catch {
    return {
      missingModules: REQUIRED_PYTHON_MODULES,
      runtimeAvailable: true,
    };
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
  const pythonProbe =
    commandConfigured && runtime !== "codex_cli_oauth_legacy"
      ? probePythonModules()
      : null;
  const missingPythonModules = pythonProbe
    ? pythonProbe.missingModules
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
    pythonRuntimeAvailable: pythonProbe?.runtimeAvailable,
    pythonRuntimeError: pythonProbe?.runtimeError,
    runtime,
    codexModel: resolveStoryboardAgentCodexModel(),
    codexEffort: resolveStoryboardAgentCodexEffort(),
    streamingAvailable: true,
  };
}

function normalizeStoryboardChatRequirement(value: unknown) {
  return typeof value === "string"
    ? sanitizePublicAgentText(value).replace(/\s+/g, " ").slice(0, 400)
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
    /(?:총|전체)?\s*(\d{1,2})\s*(?:컷|cut|cuts|장면)\s*(?:정도|내외|가량|쯤)?\s*(?:로|으로|짜|구성|생성|만들|스토리보드)?/i,
  )?.[1];
  return clampStoryboardNumber(
    Number(explicit),
    STORYBOARD_CHAT_MIN_SEGMENT_COUNT,
    STORYBOARD_MAX_SEGMENT_COUNT,
    fallback,
  );
}

function deriveStoryboardTargetLength(message: string, fallback: number) {
  const explicit = message.match(/(\d{1,2})\s*(?:분|minute|minutes|min)/i)?.[1];
  return clampStoryboardNumber(Number(explicit), 6, 60, fallback);
}

function isStoryboardGenerationQuestion(message: string) {
  return /[?？]/.test(message) || /(?:얼마나|언제|어떻게|왜|무엇|뭐|뭔가|어디|가능|필요|되나|되나요|돼|돼요|될까|걸려|걸리|알려|설명|방법|하려면|하면\s*돼)/i.test(message);
}

function wantsStoryboardGeneration(message: string) {
  if (/(하지\s*마|생성\s*금지|멈춰)/i.test(message)) return false;
  const explicitCommand =
    /(?:생성|만들|구성|작성|뽑|실행)\s*(?:해\s*)?(?:줘|주세요|줘요|주라|줘라)/i.test(message) ||
    /(?:짜\s*줘|짜\s*주세요|만들어\s*(?:줘|주세요|줘요|주라|줘라)|뽑아\s*(?:줘|주세요|줘요|주라|줘라)?)/i.test(message);
  if (explicitCommand) return true;
  if (isStoryboardGenerationQuestion(message)) return false;
  return (
    /(?:예시\s*만들기|예시\s*(?:보여줘|보여\s*줘|보여주세요)|생성\s*시작|생성\s*실행|스토리보드\s*실행|이미지\s*실행)/i.test(message) ||
    /(?:스토리보드|컷|cut|이미지).*(?:생성|만들|짜|구성|뽑|작성|실행)|(?:생성|만들|짜|구성|뽑|작성|실행).*(?:스토리보드|컷|cut|이미지)/i.test(message) ||
    /(?:생성해|만들어|구성해|작성해|뽑아|실행해|짜줘|짜\s*줘)$/i.test(message.trim())
  );
}

function wantsStoryboardReset(message: string) {
  return /(초기화|리셋|reset)/i.test(message);
}

export function isCasualStoryboardChatMessage(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized) return false;
  const compact = normalized.replace(/[\s!?.,。~…]+/g, "").toLowerCase();
  return /^(ㅎㅇ+|하이+|안녕|안녕하세(?:요|여)|안뇽|hi|hello|hey|yo)$/.test(compact);
}

function hasStoryboardMutationCommand(message: string) {
  return (
    wantsStoryboardGeneration(message) ||
    wantsStoryboardReset(message) ||
    /(?:수정|변경|바꿔|바꿔줘|고쳐|보완|짧게|줄여|재생성|다시\s*생성|보여줘|이동|가줘|열어|선택|포커스|focus|show|open)/i.test(
      message,
    )
  );
}

function isStoryboardSuggestionConversation(message: string) {
  if (/(검토|리뷰|평가|피드백)/i.test(message)) return false;
  return (
    /(?:추천|아이디어|메뉴|소재|주제|컨셉|방향|흐름).*(?:해줘|줘|있|좋|어때|뭐|궁금|알려|추천)/i.test(message) ||
    /(?:뭐\s*먹(?:지|을까|으면|을지)?|무슨\s*메뉴|어떤\s*(?:주제|소재|컨셉|방향|흐름)).*(?:좋|추천|있|어때|\?)/i.test(message) ||
    /(?:영상|스토리보드).*(?:어떤|무슨).*(?:흐름|방향).*(?:좋|어때|\?)/i.test(message)
  );
}

function isStoryboardFieldQuestion(message: string) {
  if (/(검토|리뷰|평가|피드백)/i.test(message)) return false;
  if (!/[?？]|(?:해야|해도|넣어야|필요|가능|되나|되나요|돼|돼요|될까|어디|어떻게|방법|알려|설명|꼭|잘\s*보)/i.test(message)) {
    return false;
  }
  const directCommand =
    /(?:수정|변경|바꿔|바꿔줘|고쳐|보완|짧게|줄여|줄여줘|보이게\s*바꿔|생성해줘|만들어줘|만들어\s*줘)$/i.test(
      message.trim(),
    );
  const explanationIntent =
    /(?:해야|해도|넣어야|필요|가능|되나|되나요|돼|돼요|될까|어디|어떻게|방법|알려|설명|꼭|잘\s*보)/i.test(
      message,
    );
  if (directCommand && !explanationIntent) return false;
  return /(?:자막|subtitle|문구|카피|caption|오디오|멘트|대사|나레이션|이미지|컷|cut|스토리보드|PNG|저장|다운로드|복사|장면|음식|구도|화면|비주얼|리액션|표정|훅)/i.test(message);
}

export function isGeneralStoryboardConversationMessage(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized || isCasualStoryboardChatMessage(normalized)) return false;

  const compact = normalized.replace(/[\s!?.,。~…]+/g, "").toLowerCase();
  if (/^(고마워|고맙|감사|감사해|땡큐|thanks|thankyou|ok|okay|ㅇㅋ|오케이|좋아|좋습니다|괜찮아|ㅋㅋ+|ㅎㅎ+|굿|nice)$/.test(compact)) {
    return true;
  }

  if (/(뭐\s*할\s*수|무엇을\s*할\s*수|사용법|도움말|도와줘|help|what can you do|how do i use)/i.test(normalized)) {
    return true;
  }

  if (/(?:얼마나|언제|대기|기다|진행|상태|설정|연결|브릿지|토큰|키|provider|이미지|컷|cut).*(?:걸려|걸리|돼|되나|가능|필요|어디|뭐|뭔가|알려|설명|\?)/i.test(normalized)) {
    return true;
  }

  if (isStoryboardSuggestionConversation(normalized)) return true;

  if (isStoryboardFieldQuestion(normalized)) return true;

  if (/(?:너|도우미|챗봇).*(?:누구|뭐야|무엇|가능|할 수|답변|대화)/i.test(normalized)) {
    return true;
  }

  if (hasStoryboardMutationCommand(normalized)) return false;

  return /[?？]$/.test(normalized) && !hasExplicitStoryboardScenePatchIntent(normalized) && !hasStoryboardNavigationIntent(normalized);
}

function wantsStoryboardTraceExplanation(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  const compact = normalized.replace(/[\s?!?.。~]/g, "").toLowerCase();
  if (!normalized) return false;
  if (
    /(초기화|리셋|reset|clear|재생성|다시\s*생성|이미지\s*(?:만들|생성|재생성)|생성해|만들어\s*줘|만들어줘|구성해|짜줘|뽑아)/i.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/^(과정|이유|왜|근거|추적|trace|why|how)$/.test(compact)) {
    return true;
  }
  return /(왜\s*(?:이렇게|이런|이 컷|이 장면|이 순서|나왔|됐|선택|골랐)|어떻게\s*(?:만들|구성|나왔)|이유가\s*뭐|무슨\s*근거|어떤\s*과정|선택\s*이유|근거.*(?:뭐|알려|설명)|trace|why|how)/i.test(
    normalized,
  );
}

function wantsStoryboardReviewOnly(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized) return false;
  if (wantsStoryboardTraceExplanation(normalized)) return true;
  if (wantsStoryboardGeneration(normalized) || wantsStoryboardReset(normalized)) {
    return false;
  }
  if (isStoryboardSuggestionConversation(normalized) || isStoryboardFieldQuestion(normalized)) {
    return false;
  }
  const asksForReview =
    /(검토|리뷰|평가|피드백|설명|알려줘|요약|정리|괜찮|어때|확인)/i.test(
      normalized,
    );
  if (!asksForReview) return false;
  return !/(수정|변경|바꿔|바꿔줘|고쳐|보완|재생성|다시\s*생성|이미지\s*만들|자막\s*(?:수정|변경|바꿔|고쳐)|오디오\s*(?:수정|변경|바꿔|고쳐))/i.test(
    normalized,
  );
}

function wantsSelectedStoryboardImageRegeneration(message: string) {
  return (
    /(?:이|현재|선택|선택한)\s*컷\s*만.*(?:재생성|다시\s*생성|다시\s*만들|이미지)/i.test(
      message,
    ) ||
    /(?:이|현재|선택|선택한)\s*컷.*이미지\s*만.*(?:재생성|다시\s*생성|다시\s*만들|생성|만들)/i.test(
      message,
    ) ||
    /(?:이|현재|선택|선택한)\s*컷.*이미지.*(?:재생성|다시\s*생성|다시\s*만들|다시\s*만들어|다시\s*만들어줘)/i.test(
      message,
    ) ||
    /(?:재생성|다시\s*생성|다시\s*만들).*(?:이|현재|선택|선택한)\s*컷\s*만/i.test(message) ||
    /컷만.*(?:재생성|다시\s*생성|다시\s*만들|이미지)/i.test(message) ||
    (deriveExplicitStoryboardSceneNo(message) !== undefined &&
      /(?:재생성|다시\s*생성|다시\s*만들|이미지)/i.test(message))
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
  if (wantsStoryboardReviewOnly(normalized)) return undefined;
  if (isStoryboardFieldQuestion(normalized)) return undefined;
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
  const imageAttachmentText = formatStoryboardChatImageAttachmentSummary(
    request.imageAttachments,
  );
  const isReviewOnly = wantsStoryboardReviewOnly(normalized);
  const isCasualChat = isCasualStoryboardChatMessage(normalized);
  const isGeneralConversation =
    !isReviewOnly && isGeneralStoryboardConversationMessage(normalized);
  const isConversationOnly = isCasualChat || isGeneralConversation;
  const focusContext = normalizeStoryboardChatFocusContext(
    request.focusContext,
  );
  const focusText = formatStoryboardChatFocusContext(focusContext);
  const scenePatch = isReviewOnly || isConversationOnly
    ? undefined
    : createStoryboardScenePatch(normalized, focusContext);
  const requestedFocusSceneNo = scenePatch
    ? undefined
    : deriveStoryboardNavigationSceneNo(normalized);
  const availableSceneCount = clampStoryboardNumber(
    Number(request.currentAvailableSceneCount),
    1,
    99,
    request.currentSegmentCount ?? DEFAULT_STORYBOARD_CHAT_SEGMENT_COUNT,
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
    !isConversationOnly && !isNavigationRequest && scenePatch?.targetSource !== "explicit";
  const normalizedWithFocus = normalizeStoryboardChatRequirement(
    [
      normalized,
      shouldIncludeFocusContext && focusText
        ? `현재 캔버스 맥락: ${focusText}`
        : "",
      imageAttachmentText ? `첨부 사진 맥락: ${imageAttachmentText}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  const fallbackPrompt =
    normalizeStoryboardChatRequirement(request.baselinePrompt) ||
    normalizeStoryboardChatRequirement(request.currentPrompt) ||
    "먹방 피크 기반 스토리보드";
  const promptBasis = isReviewOnly || isConversationOnly
    ? fallbackPrompt
    : isNavigationRequest
    ? fallbackPrompt
    : normalizedWithFocus || fallbackPrompt;
  const derivedSegmentCount = deriveStoryboardSegmentCount(
    promptBasis,
    request.currentSegmentCount ?? DEFAULT_STORYBOARD_CHAT_SEGMENT_COUNT,
  );
  return {
    prompt: promptBasis,
    tone: deriveStoryboardTone(promptBasis, request.currentTone ?? "warm"),
    targetLengthMinutes: isReviewOnly || isConversationOnly
      ? clampStoryboardNumber(
          Number(request.currentTargetLengthMinutes),
          6,
          60,
          18,
        )
      : deriveStoryboardTargetLength(
          promptBasis,
          request.currentTargetLengthMinutes ?? 18,
        ),
    segmentCount: isReviewOnly || isConversationOnly
      ? availableSceneCount
      : isNavigationRequest
      ? availableSceneCount
      : derivedSegmentCount,
    generationMode: request.generationMode ?? "backend_agent",
    focusSceneNo,
    unavailableFocusSceneNo,
    scenePatch,
  };
}

function buildStoryboardConversationMessage(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (/(고마워|고맙|감사|땡큐|thanks|thank)/i.test(message)) {
    return [
      "천만에요. 지금 화면은 그대로 두고 대화만 이어갈게요.",
      "필요하면 특정 CUT 수정, 전체 생성, 이미지 상태 확인까지 이어서 도와드릴 수 있어요.",
    ].join(" ");
  }

  if (/(뭐\s*할\s*수|무엇을\s*할\s*수|사용법|도움말|도와줘|help|what can you do|how do i use|너.*(?:누구|뭐야|무엇|가능|할 수|답변|대화)|도우미.*(?:누구|뭐야|무엇|가능|할 수|답변|대화)|챗봇.*(?:누구|뭐야|무엇|가능|할 수|답변|대화))/i.test(normalized)) {
    return [
      "저는 이 스토리보드 화면을 보면서 대화하는 도우미예요.",
      "일반 질문에는 화면을 바꾸지 않고 답하고, “3컷 자막 짧게”, “이미지 다시 생성”, “10컷으로 생성해줘”처럼 말하면 필요한 작업만 화면에 반영할게요.",
    ].join(" ");
  }

  if (/(?:재생성|다시\s*생성|다시\s*만들|이미지.*다시).*(?:방법|어떻게|알려|설명)|(?:방법|어떻게).*(?:재생성|다시\s*생성|다시\s*만들|이미지)/i.test(normalized)) {
    return [
      "이미지 다시 만들기 방법 질문으로 이해했어요. 지금은 화면을 바꾸지 않고 안내만 드릴게요.",
      "특정 CUT을 선택한 뒤 “현재 컷 이미지만 다시 생성해줘”라고 입력하면 그 컷만 다시 만들고, 전체를 새로 만들고 싶으면 “전체 이미지 다시 생성해줘”처럼 말하면 됩니다.",
    ].join(" ");
  }

  if (/(?:장면|음식|구도|화면|비주얼|리액션|표정).*(?:잘\s*보|괜찮|어때|\?)/i.test(normalized)) {
    return [
      "시각 확인 질문으로 이해했어요. 지금은 선택한 CUT을 수정하지 않고 기준만 설명할게요.",
      "음식은 첫눈에 메뉴가 구분되고, 손동작이나 젓가락이 맛 포인트를 가리지 않으며, 자막 영역과 겹치지 않으면 안정적으로 보입니다.",
    ].join(" ");
  }

  if (/(얼마나|언제|대기|기다|진행|상태|이미지|브릿지|연결|설정|토큰|키|provider)/i.test(message)) {
    return [
      "이미지는 로컬 브릿지나 이미지 처리기가 연결된 뒤 CUT별로 순차 진행돼요.",
      "진행 중에는 완료된 CUT부터 캔버스에 반영되고, 설정이 필요하면 먼저 연결 상태를 안내할게요.",
    ].join(" ");
  }

  if (/(?:저장|PNG|내보내기|다운로드|복사)/i.test(normalized)) {
    return [
      "저장 방법 질문으로 이해했어요. 화면은 바꾸지 않고 안내만 드릴게요.",
      "캔버스 상단의 PNG 저장으로 현재 페이지를 이미지로 받을 수 있고, 기획서 복사로 컷별 오디오·자막·촬영 포인트를 바로 복사할 수 있어요.",
    ].join(" ");
  }

  if (/(?:자막|subtitle|문구|카피|caption|오디오|멘트|대사|나레이션).*(?:꼭|필요|해야|넣어야|가능|되나|돼|될까|\?)/i.test(normalized)) {
    return [
      "질문으로 이해했어요. 지금은 선택한 CUT을 수정하지 않고 기준만 설명할게요.",
      "자막은 모든 컷에 길게 넣기보다 첫 기대감, 메뉴 확인, 한입 반응, 마무리 포인트처럼 시청자가 놓치면 아쉬운 순간에 짧게 쓰는 편이 좋아요.",
    ].join(" ");
  }

  if (/(?:생성|만들|스토리보드).*(?:어떻게|방법|필요|가능|하려면|하면\s*돼)|(?:어떻게|방법|필요|가능|하려면).*(?:생성|만들|스토리보드)/i.test(normalized)) {
    return [
      "생성 방법 질문으로 이해했어요. 지금은 화면을 바꾸지 않고 설명만 드릴게요.",
      "주제나 음식, 원하는 CUT 수, 꼭 보여줄 장면을 한두 문장으로 적은 뒤 “생성해줘”라고 말하면 캔버스에 반영하고 이미지를 순서대로 만들 수 있어요.",
    ].join(" ");
  }

  if (
    /(?:추천|아이디어|메뉴|소재|주제|컨셉|방향).*(?:해줘|줘|있|좋|어때|뭐|궁금|알려|추천)/i.test(normalized) ||
    /(?:뭐\s*먹(?:지|을까|으면|을지)?|무슨\s*메뉴|어떤\s*(?:주제|소재|컨셉|방향)).*(?:좋|추천|있|어때|\?)/i.test(normalized)
  ) {
    return [
      "좋아요. 화면은 아직 바꾸지 않고 아이디어만 드릴게요.",
      "먹방 흐름이라면 매운 메뉴 도전, 시장 골목 코스, 해산물 한상, 디저트 투어처럼 첫 CUT에서 기대감을 만들기 쉬운 주제가 잘 맞아요.",
      "마음에 드는 방향을 고르면 그때 스토리보드로 생성해도 됩니다.",
    ].join(" ");
  }

  if (/(?:영상|스토리보드|흐름).*(?:어떤|무슨|어떻게).*(?:흐름|방향|좋|어때|\?)/i.test(normalized)) {
    return [
      "흐름 질문으로 이해했어요. 화면은 바꾸지 않고 의견만 드릴게요.",
      "먹방 영상은 초반 기대감, 메뉴 확인, 첫 입 반응, 조합 변화, 클라이맥스 한상, 마무리 한줄평 순서가 안정적이에요.",
    ].join(" ");
  }

  if (/[?？]$/.test(normalized)) {
    return [
      "질문으로 이해했어요. 화면은 바꾸지 않고 답변만 이어갈게요.",
      "스토리보드 흐름, CUT 구성, 이미지 생성 상태, 자막/오디오 방향처럼 궁금한 점을 물어보면 현재 화면 기준으로 짧게 정리해드릴게요.",
    ].join(" ");
  }

  return [
    "네, 대화로 이어갈게요.",
    "지금 화면은 바꾸지 않고 답변만 드립니다.",
    "원하는 주제, CUT 수, 수정할 장면, 이미지 생성 상태처럼 궁금한 점을 편하게 말해 주세요.",
  ].join(" ");
}

function normalizeStoryboardChatImageAttachments(
  attachments: StoryboardChatAgentRequest["imageAttachments"],
): StoryboardChatImageAttachment[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.filter((attachment): attachment is StoryboardChatImageAttachment => {
    if (!attachment || typeof attachment !== "object") return false;
    return (
      typeof attachment.id === "string" &&
      typeof attachment.name === "string" &&
      typeof attachment.dataUrl === "string" &&
      typeof attachment.size === "number" &&
      (attachment.mimeType === "image/png" ||
        attachment.mimeType === "image/jpeg" ||
        attachment.mimeType === "image/webp")
    );
  });
}

function formatStoryboardBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "크기 미상";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function formatStoryboardChatImageAttachmentSummary(
  attachments: StoryboardChatAgentRequest["imageAttachments"],
) {
  const normalizedAttachments =
    normalizeStoryboardChatImageAttachments(attachments);
  if (!normalizedAttachments.length) return "";
  return normalizedAttachments
    .map((attachment, index) => {
      const dimensions =
        attachment.width && attachment.height
          ? `${attachment.width}x${attachment.height}`
          : "해상도 미상";
      return `${index + 1}. ${attachment.name} (${dimensions}, ${attachment.mimeType}, ${formatStoryboardBytes(attachment.size)})`;
    })
    .join("; ");
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
  const imageAttachments = normalizeStoryboardChatImageAttachments(
    request.imageAttachments,
  );
  const imageAttachmentText =
    formatStoryboardChatImageAttachmentSummary(imageAttachments);
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
  const isReviewOnly = wantsStoryboardReviewOnly(normalizedMessage);
  const isCasualChat = isCasualStoryboardChatMessage(normalizedMessage);
  const isGeneralConversation =
    !isReviewOnly && isGeneralStoryboardConversationMessage(normalizedMessage);
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
    assistantMessage: isCasualChat
      ? [
          "안녕하세요! 스토리보드 도우미입니다.",
          "화면은 바꾸지 않고 사용 방법만 안내할게요.",
          "원하는 음식이나 장면, 컷 수, 꼭 보여주고 싶은 순간을 적어 주면 바로 스토리보드를 만들 수 있어요.",
          "예시가 필요하면 “예시 만들기”를 누르거나, 바로 만들려면 “생성해줘”라고 입력하세요.",
        ].join(" ")
      : isGeneralConversation
      ? buildStoryboardConversationMessage(normalizedMessage)
      : isReviewOnly
      ? [
          "검토 결과를 쉽게 정리했어요.",
          `현재 보이는 ${canvasPatch.segmentCount}컷 흐름을 기준으로 보면, 앞부분은 관심을 끌고 중간 컷은 맛과 반응을 이어주며 마지막 컷은 다시 보고 싶은 포인트를 잡는 구조예요.`,
          "바꾸고 싶은 컷이 있으면 “2컷 자막을 더 짧게”처럼 말해 주세요.",
        ].join(" ")
      : [
          "요청을 이해했어요",
          shouldReset
            ? "입력값을 처음 상태로 되돌릴게요."
            : `캔버스에 ${canvasPatch.segmentCount}컷, 약 ${canvasPatch.targetLengthMinutes}분짜리 흐름으로 정리했어요.`,
          canvasPatch.scenePatch
            ? `CUT ${String(canvasPatch.scenePatch.sceneNo).padStart(2, "0")}만 수정할 준비를 했어요.`
            : null,
          isNavigationOnly
            ? `화면을 CUT ${String(canvasPatch.focusSceneNo).padStart(2, "0")} 쪽으로 맞춰둘게요.`
            : null,
          isUnavailableNavigation
            ? `CUT ${String(canvasPatch.unavailableFocusSceneNo).padStart(2, "0")}는 지금 결과에 없어서 선택을 풀었어요.`
            : null,
          effectiveFocusText
            ? `지금 선택한 항목(${focusContext?.label})도 함께 참고했어요.`
            : null,
          imageAttachmentText
            ? `첨부 사진 ${imageAttachments.length}장도 함께 참고했어요.`
            : null,
          shouldRegenerateSelectedSceneImage
            ? "현재 선택한 컷의 이미지만 다시 만들 준비를 했어요."
            : null,
          shouldGenerate
            ? "이어서 실제 스토리보드 만들기까지 진행할게요."
            : "바로 만들고 싶으면 “생성해줘”라고 입력하세요.",
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
        imageAttachmentText ? `Image attachments: ${imageAttachmentText}` : "",
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
        imageAttachmentCount: imageAttachments.length,
        chatIntent: isCasualChat
          ? "casual_chat"
          : isGeneralConversation
            ? "conversation"
            : shouldRegenerateSelectedSceneImage
            ? "regenerate_selected_scene"
            : shouldGenerate
              ? "generate"
              : shouldReset
                ? "reset"
                : isReviewOnly
                  ? "review"
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
    const shouldUseConfiguredPython = command.executable.endsWith(".py");
    const shouldUseShellScriptOnWindows =
      process.platform === "win32" && command.executable.endsWith(".sh");
    const shellScriptRunner = shouldUseShellScriptOnWindows
      ? resolveWindowsShellScriptRunner()
      : null;
    const child = spawn(
      shouldUseConfiguredPython
        ? resolveStoryboardAgentPythonCommand()
        : shellScriptRunner
          ? shellScriptRunner
          : command.executable,
      shouldUseConfiguredPython
        ? [command.executable, ...command.args]
        : shouldUseShellScriptOnWindows
          ? [command.executable, ...command.args]
          : command.args,
    {
      cwd: existsSync(/* turbopackIgnore: true */ BACKEND_AGENT_ROOT) ? BACKEND_AGENT_ROOT : getRuntimeCwd(),
      shell: shouldUseConfiguredPython
        ? shouldRunThroughWindowsCommandShell(resolveStoryboardAgentPythonCommand())
        : false,
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
        stdout,
        stderr,
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
        stdout,
        stderr,
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
        stdout,
        stderr: `${stderr}\n${String(error)}`,
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

function sanitizeCommandOutput(value: string, maxLength = 1200) {
  return sanitizePublicAgentDiagnostic(value, maxLength);
}

function sanitizePublicJson(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizePublicAgentDiagnostic(value, 600);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizePublicJson(item, depth + 1));
  }
  if (!isObjectRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 80)
      .map(([key, item]) => [
        sanitizePublicAgentDiagnostic(key, 120),
        sanitizePublicJson(item, depth + 1),
      ])
      .filter(([, item]) => item !== undefined),
  );
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
  const caption = normalizeCaptionRetrievalDiagnostics(value.caption);
  if (status !== "used" || !toolsCalled.includes("search_scene_data")) {
    return caption ? { status, caption } : { status };
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
    ...(caption ? { caption } : {}),
  };
}

function normalizeCaptionRetrievalDiagnostics(
  value: unknown,
): NonNullable<NonNullable<StoryboardGraphDiagnostics["retrieval"]>["caption"]> | null {
  if (!isObjectRecord(value)) return null;
  const lookupStatus =
    value.lookupStatus === "used" ||
    value.lookupStatus === "unavailable" ||
    value.lookupStatus === "not_reported"
      ? value.lookupStatus
      : undefined;
  const provider =
    value.provider === "llava_next_video" ||
    value.provider === "openai_vision_gpt55" ||
    value.provider === "codex_cli_vision_gpt55" ||
    value.provider === "unknown_legacy"
      ? value.provider
      : undefined;
  const authMode =
    value.authMode === "platform_api_key" ||
    value.authMode === "codex_cli_oauth_local" ||
    value.authMode === "offline_local" ||
    value.authMode === "unknown_legacy"
      ? value.authMode
      : undefined;
  const normalized: NonNullable<NonNullable<StoryboardGraphDiagnostics["retrieval"]>["caption"]> = {
    lookupStatus,
    provider,
    model:
      typeof value.model === "string"
        ? sanitizePublicAgentDiagnostic(value.model, 120)
        : undefined,
    authMode,
    schemaVersion:
      typeof value.schemaVersion === "number" && Number.isFinite(value.schemaVersion)
        ? Math.max(1, Math.min(99, Math.trunc(value.schemaVersion)))
        : undefined,
    frameCount:
      typeof value.frameCount === "number" && Number.isFinite(value.frameCount)
        ? Math.max(0, Math.min(10_000, Math.trunc(value.frameCount)))
        : undefined,
    truncatedFrames:
      typeof value.truncatedFrames === "number" && Number.isFinite(value.truncatedFrames)
        ? Math.max(0, Math.min(10_000, Math.trunc(value.truncatedFrames)))
        : undefined,
    requestHash:
      typeof value.requestHash === "string"
        ? sanitizePublicAgentDiagnostic(value.requestHash, 80)
        : undefined,
    parserStatus:
      typeof value.parserStatus === "string"
        ? sanitizePublicAgentDiagnostic(value.parserStatus, 80)
        : undefined,
    latencyMs:
      typeof value.latencyMs === "number" && Number.isFinite(value.latencyMs)
        ? Math.max(0, Math.min(600_000, Math.trunc(value.latencyMs)))
        : undefined,
    responseId:
      typeof value.responseId === "string"
        ? sanitizePublicAgentDiagnostic(value.responseId, 120)
        : undefined,
    fallbackReason:
      typeof value.fallbackReason === "string"
        ? sanitizePublicAgentDiagnostic(value.fallbackReason, 160)
        : undefined,
  };
  return Object.values(normalized).some((item) => item !== undefined)
    ? normalized
    : null;
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
  if (isPythonRuntimeUnavailableText(text)) {
    return "unsupported_runtime";
  }
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
      ? sanitizeCommandOutput(`${command.stdout}\n${command.stderr}`, 600)
      : undefined,
  };
}


function extractReferenceAgentGraphCandidate(
  parsed: ParsedStoryboardAgentOutput | null,
) {
  return (
    parsed?.referenceGraph ??
    parsed?.agentGraphFidelity ??
    parsed?.backendAgent?.referenceGraph ??
    parsed?.backendAgent?.agentGraphFidelity ??
    null
  );
}

function extractReferenceGraphCandidate(
  parsed: ParsedStoryboardAgentOutput | null,
) {
  return parsed?.referenceGraph ?? parsed?.backendAgent?.referenceGraph ?? null;
}

function canUseReferenceAgentGraphCandidate(
  result: StoryboardGenerationResult,
  graph?: StoryboardGraphDiagnostics,
) {
  return (
    result.mode === "backend_agent_command" &&
    graph?.runtime === "langgraph" &&
    graph.mode === "graph_command" &&
    graph.status !== "fallback"
  );
}

function applyAgentGraphFidelityReport(
  result: StoryboardGenerationResult,
  graph?: StoryboardGraphDiagnostics,
  parsed?: ParsedStoryboardAgentOutput | null,
) {
  result.agentGraphFidelity = buildStoryboardAgentGraphFidelity({
    mode: result.mode,
    graph,
    candidate: canUseReferenceAgentGraphCandidate(result, graph)
      ? extractReferenceAgentGraphCandidate(parsed ?? null)
      : null,
    finalOutputReady: Boolean(result.storyboard.exportMarkdown || result.storyboard.scenes.length),
  });
}

function appendBackendAgentAnalysis(
  result: StoryboardGenerationResult,
  status: StoryboardBackendAgentStatus,
  command?: CommandResult,
  graph?: StoryboardGraphDiagnostics,
  referenceGraph?: unknown,
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
      ? sanitizeCommandOutput(`${command.stdout}\n${command.stderr}`, 1200)
      : undefined,
    graph,
    referenceGraph: referenceGraph
      ? sanitizePublicJson(referenceGraph)
      : undefined,
  };
}

function applyBackendAdapterMode(result: StoryboardGenerationResult) {
  result.mode = "backend_agent_local_adapter";
  result.request.generationMode = "backend_agent";
  result.sourceSummary.dataModeLabel = "백엔드 에이전트 어댑터";
  if (result.planner) {
    result.planner.sourceTrace = {
      ...result.planner.sourceTrace,
      dataModeLabel: "백엔드 에이전트 어댑터",
      evidenceLabel: "백엔드 에이전트 근거",
    };
  }
  result.storyboard.scenes = result.storyboard.scenes.map((scene) => {
    const reason = scene.heatmapEvidence.reason.includes("백엔드 에이전트 근거")
      ? scene.heatmapEvidence.reason
      : `백엔드 에이전트 근거 · ${scene.heatmapEvidence.reason}`;
    const captionIdea = scene.captionIdea.includes("백엔드 에이전트 근거")
      ? scene.captionIdea
      : scene.captionIdea.replace(
          /(로컬 히트맵 근거|데모\/샘플 근거)/,
          "백엔드 에이전트 근거",
        );
    return {
      ...scene,
      captionIdea,
      heatmapEvidence: {
        ...scene.heatmapEvidence,
        reason,
      },
    };
  });
  result.storyboard.operatorBrief =
    "backend/storyboard-agent의 LangGraph 슬롯/디자이너 설계를 관리자 콘솔용 로컬 히트맵 생성 흐름에 연결했습니다.";
  normalizeStoryboardExportMarkdown(result);
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
        normalizeStoryboardExportMarkdown(base, base.storyboard.exportMarkdown);
      }
      appendBackendAgentAnalysis(
        base,
        status,
        commandResult,
        graph,
        canUseReferenceAgentGraphCandidate(base, graph)
          ? extractReferenceGraphCandidate(parsed)
          : null,
      );
      applyAgentGraphFidelityReport(base, graph, parsed);
      return base;
    }
    const fallbackGraph = createFallbackGraphDiagnostics(
      status,
      mapCommandFailureToFallbackReason(status, commandResult),
      `${commandResult.stdout}\n${commandResult.stderr}`,
    );
    appendBackendAgentAnalysis(
      base,
      status,
      commandResult,
      fallbackGraph,
    );
    applyAgentGraphFidelityReport(base, fallbackGraph, null);
    return base;
  }

  const fallbackGraph = createFallbackGraphDiagnostics(
    status,
    mapCommandFailureToFallbackReason(status),
    status.commandRejectionReason,
  );
  appendBackendAgentAnalysis(
    base,
    status,
    undefined,
    fallbackGraph,
  );
  applyAgentGraphFidelityReport(base, fallbackGraph, null);
  return base;
}
