import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";

import { buildStoryboardAgentGraphFidelity } from "./agent-graph-fidelity";
import {
  createBoundStoryboardAgentTestCommandCapability,
  getStoryboardAgentTestCommandBinding,
  type StoryboardAgentTestCommandCapability,
} from "./test-command-capability";
import {
  generateLocalStoryboard,
  normalizeStoryboardExportMarkdown,
} from "./generator";
import {
  hasUnsafeStoryboardInstructionRequest,
  sanitizeStoryboardPublicText,
} from "./prompt-safety";
import { buildStoryboardRagModelStackDiagnostics, buildStoryboardRagProfileTraceDetail } from "./rag";
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
  StoryboardChatConversationMessage,
  StoryboardChatScenePatch,
  StoryboardGenerateRequest,
  StoryboardGenerationResult,
  StoryboardGenerationMode,
  StoryboardGraphDiagnostics,
  StoryboardGraphFallbackReason,
  StoryboardChatImageAttachment,
  StoryboardThinkingTraceEntry,
  StoryboardTone,
} from "./types";

const BACKEND_AGENT_NOTEBOOKS = [
  "scripts/03-storyboard-agent.ipynb",
  "scripts/04-storyboard-agent-graph-debug.ipynb",
];
const BACKEND_AGENT_GRAPH = "src/graph.py";
const BACKEND_AGENT_RUNNER = "scripts/run-storyboard-agent.py";
const STORYBOARD_AGENT_TEST_FIXTURE_CAPABILITY =
  "checked-in-langgraph-runner-fixture-v1";
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
const REQUIRED_AUTO_RUNNER_PYTHON_MODULES = [
  "langgraph",
  "langchain_core",
  "pydantic",
];
const DEFAULT_STORYBOARD_AGENT_TIMEOUT_MS = 120_000;
const MIN_STORYBOARD_AGENT_TIMEOUT_MS = 5_000;
const MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES = 64 * 1024;
const DEFAULT_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS = 5_000;
const MIN_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS = 25;
const MAX_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS = 15_000;
const WINDOWS_PROCESS_TERMINATION_TIMEOUT_MS = 5_000;
const WINDOWS_JOB_SUPERVISOR_CLEANUP_GRACE_MS = 5_000;
const WINDOWS_JOB_SUPERVISOR_FINAL_CLOSE_TIMEOUT_MS = 5_000;
const LINUX_NAMESPACE_TERMINATION_TIMEOUT_MS = 10_000;
const LINUX_NAMESPACE_SUPERVISOR_DRAIN_TIMEOUT_MS = 7_000;
const LINUX_NAMESPACE_DESCENDANT_TERM_GRACE_MS = 500;
const LINUX_NAMESPACE_INNER_CLEANUP_TIMEOUT_MS = 3_000;
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
const STORYBOARD_CHAT_CONVERSATION_CONTEXT_LIMIT = 8;
const STORYBOARD_CHAT_CONVERSATION_CONTENT_LIMIT = 280;
const UNSAFE_COMMAND_PATTERN = /[\u0000-\u001f\u007f"';&|`$<>()[\]{}!#%^?*]/;
const WINDOWS_UNSAFE_COMMAND_TEXT_PATTERN = /[%^&|<>()!"]/;
const STORYBOARD_AGENT_ENV_ALLOWLIST = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "PATHEXT",
  "PYTHONHOME",
  "PYTHONPATH",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
] as const;

function buildStoryboardAgentEnvironment(
  payload: Record<string, unknown>,
  scopedEnvironment?: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  inheritEnvironment = true,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: scopedEnvironment?.NODE_ENV ?? process.env.NODE_ENV,
  };
  for (const key of STORYBOARD_AGENT_ENV_ALLOWLIST) {
    if (platform === "win32" && key === "PATH") continue;
    const value =
      scopedEnvironment?.[key] ??
      (inheritEnvironment ? process.env[key] : undefined);
    if (typeof value === "string" && value) env[key] = value;
  }

  const inheritedPath = inheritEnvironment
    ? process.env.PATH ?? process.env.Path
    : undefined;
  const pathValue =
    platform === "win32"
      ? scopedEnvironment?.PATH ?? scopedEnvironment?.Path ?? inheritedPath
      : scopedEnvironment?.PATH ?? inheritedPath;
  if (typeof pathValue === "string" && pathValue) {
    env[platform === "win32" ? "Path" : "PATH"] = pathValue;
  }
  env.STORYBOARD_AGENT_JSON = JSON.stringify(payload);
  return env;
}

function hasUnsafeWindowsCommandText(value: string) {
  return WINDOWS_UNSAFE_COMMAND_TEXT_PATTERN.test(value);
}

type CommandResult = {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  lifecycleReason:
    | "exit"
    | "signal"
    | "timeout"
    | "stream_drain"
    | "spawn_error"
    | "cleanup_error";
  cleanupVerified: boolean | null;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
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
      source: "configured" | "auto_runner";
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

function resolveStoryboardAgentPython(env: NodeJS.ProcessEnv = process.env) {
  return resolveStoryboardAgentPythonForPlatform(env, process.platform);
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

function resolveStoryboardAgentPythonCommand(env: NodeJS.ProcessEnv = process.env) {
  return resolveWindowsCommandFromPath(resolveStoryboardAgentPython(env), env);
}

function shouldRunThroughWindowsCommandShell(command: string) {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command.trim());
}
function getWindowsCommandShell() {
  const windowsRoot =
    process.env.SystemRoot?.trim() || process.env.WINDIR?.trim() || "C:\\Windows";
  return path.win32.join(windowsRoot, "System32", "cmd.exe");
}
function quoteWindowsCommandArgument(value: string) {
  if (/[\u0000\r\n]/.test(value)) {
    throw new Error("unsafe Windows command argument");
  }
  return `"${value.replace(/"/g, '""')}"`;
}
function buildWindowsCommandShellSpec(command: string, args: string[]) {
  // cmd parses exactly once. CALL would reparse percent escapes and must not be used.
  const commandLine = `"${[quoteWindowsCommandArgument(path.win32.resolve(command)), ...args.map(quoteWindowsCommandArgument)].join(" ")}"`;
  return {
    executable: getWindowsCommandShell(),
    args: ["/d", "/s", "/v:off", "/c", commandLine],
    windowsVerbatimArguments: true,
  };
}
export function __buildWindowsCommandShellSpecForTests(command: string, args: string[]) {
  return buildWindowsCommandShellSpec(command, args);
}
const WINDOWS_JOB_SUPERVISOR_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;
using System.IO.Pipes;
using System.Collections;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;

public static class TzudongWindowsJobSupervisor
{
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint DISABLE_MAX_PRIVILEGE = 0x1;
    private const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    private const uint TOKEN_DUPLICATE = 0x0002;
    private const uint TOKEN_QUERY = 0x0008;
    private const uint TOKEN_ADJUST_DEFAULT = 0x0080;
    private const uint SE_GROUP_INTEGRITY = 0x00000020;
    private const int TokenIntegrityLevel = 25;
    private const uint SE_FILE_OBJECT = 1;
    private const uint LABEL_SECURITY_INFORMATION = 0x00000010;
    private const uint SDDL_REVISION_1 = 1;
    private const uint OWNER_SECURITY_INFORMATION = 0x00000001;
    private const uint DACL_SECURITY_INFORMATION = 0x00000004;
    private const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF;
    private const int ERROR_FILE_NOT_FOUND = 2;
    private const int ERROR_PATH_NOT_FOUND = 3;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint READ_CONTROL = 0x00020000;
    private const uint WRITE_DAC = 0x00040000;
    private const uint WRITE_OWNER = 0x00080000;
    private const uint DELETE = 0x00010000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST =
        new IntPtr(0x0002000D);
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST =
        new IntPtr(0x00020002);
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int JobObjectBasicAccountingInformation = 1;
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 258;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct SID_AND_ATTRIBUTES
    {
        public IntPtr Sid;
        public uint Attributes;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_MANDATORY_LABEL
    {
        public SID_AND_ATTRIBUTES Label;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public uint CreationTimeLow;
        public uint CreationTimeHigh;
        public uint LastAccessTimeLow;
        public uint LastAccessTimeHigh;
        public uint LastWriteTimeLow;
        public uint LastWriteTimeHigh;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }
    private struct ScratchDirectoryIdentity
    {
        public uint VolumeSerialNumber;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUserW(
        IntPtr token,
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFOEX startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObject(
        IntPtr jobAttributes,
        string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength,
        IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectoryW(string pathName, IntPtr securityAttributes);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFileAttributesW(string fileName);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        IntPtr file,
        out BY_HANDLE_FILE_INFORMATION fileInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(
        IntPtr attributeList);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(
        IntPtr process,
        uint desiredAccess,
        out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CreateRestrictedToken(
        IntPtr existingToken,
        uint flags,
        uint disableSidCount,
        IntPtr sidsToDisable,
        uint deletePrivilegeCount,
        IntPtr privilegesToDelete,
        uint restrictedSidCount,
        IntPtr sidsToRestrict,
        out IntPtr newToken);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetTokenInformation(
        IntPtr token,
        int tokenInformationClass,
        IntPtr tokenInformation,
        uint tokenInformationLength);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool ConvertStringSidToSid(
        string stringSid,
        out IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
        string stringSecurityDescriptor,
        uint stringSDRevision,
        out IntPtr securityDescriptor,
        out uint securityDescriptorSize);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorSacl(
        IntPtr securityDescriptor,
        out bool saclPresent,
        out IntPtr sacl,
        out bool saclDefaulted);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorOwner(
        IntPtr securityDescriptor,
        out IntPtr owner,
        out bool ownerDefaulted);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorDacl(
        IntPtr securityDescriptor,
        out bool daclPresent,
        out IntPtr dacl,
        out bool daclDefaulted);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint SetSecurityInfo(
        IntPtr handle,
        uint objectType,
        uint securityInformation,
        IntPtr owner,
        IntPtr group,
        IntPtr dacl,
        IntPtr sacl);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint SetNamedSecurityInfo(
        string objectName,
        uint objectType,
        uint securityInformation,
        IntPtr owner,
        IntPtr group,
        IntPtr dacl,
        IntPtr sacl);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetNamedSecurityInfo(
        string objectName,
        uint objectType,
        uint securityInformation,
        out IntPtr owner,
        out IntPtr group,
        out IntPtr dacl,
        out IntPtr sacl,
        out IntPtr securityDescriptor);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(
        IntPtr securityDescriptor,
        uint requestedStringSDRevision,
        uint securityInformation,
        out IntPtr stringSecurityDescriptor,
        out uint stringSecurityDescriptorLen);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(
        IntPtr handle,
        uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(
        IntPtr process,
        out uint exitCode);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int standardHandle);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    private static void ThrowLastError(string operation)
    {
        throw new Win32Exception(
            Marshal.GetLastWin32Error(),
            operation + " failed");
    }
    private static void WriteLifecycle(Stream lifecycle, string message)
    {
        byte[] bytes = Encoding.ASCII.GetBytes(message + "\n");
        lifecycle.Write(bytes, 0, bytes.Length);
        lifecycle.Flush();
    }
    private static IntPtr CreateRestrictedLowIntegrityToken()
    {
        IntPtr currentToken = IntPtr.Zero;
        IntPtr restrictedToken = IntPtr.Zero;
        IntPtr lowIntegritySid = IntPtr.Zero;
        IntPtr mandatoryLabel = IntPtr.Zero;
        try
        {
            if (!OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY |
                TOKEN_ADJUST_DEFAULT,
                out currentToken))
            {
                ThrowLastError("OpenProcessToken");
            }
            if (!CreateRestrictedToken(
                currentToken,
                DISABLE_MAX_PRIVILEGE,
                0,
                IntPtr.Zero,
                0,
                IntPtr.Zero,
                0,
                IntPtr.Zero,
                out restrictedToken))
            {
                ThrowLastError("CreateRestrictedToken");
            }
            if (!ConvertStringSidToSid("S-1-16-4096", out lowIntegritySid))
            {
                ThrowLastError("ConvertStringSidToSid(low integrity)");
            }
            TOKEN_MANDATORY_LABEL label = new TOKEN_MANDATORY_LABEL();
            label.Label.Sid = lowIntegritySid;
            label.Label.Attributes = SE_GROUP_INTEGRITY;
            int labelSize = Marshal.SizeOf(typeof(TOKEN_MANDATORY_LABEL)) +
                GetLengthSid(lowIntegritySid);
            mandatoryLabel = Marshal.AllocHGlobal(labelSize);
            Marshal.StructureToPtr(label, mandatoryLabel, false);
            if (!SetTokenInformation(
                restrictedToken,
                TokenIntegrityLevel,
                mandatoryLabel,
                (uint)labelSize))
            {
                ThrowLastError("SetTokenInformation(TokenIntegrityLevel)");
            }
            IntPtr result = restrictedToken;
            restrictedToken = IntPtr.Zero;
            return result;
        }
        finally
        {
            if (mandatoryLabel != IntPtr.Zero) Marshal.FreeHGlobal(mandatoryLabel);
            if (lowIntegritySid != IntPtr.Zero) LocalFree(lowIntegritySid);
            if (restrictedToken != IntPtr.Zero) CloseHandle(restrictedToken);
            if (currentToken != IntPtr.Zero) CloseHandle(currentToken);
        }
    }
    private static bool WaitForJobDrainUntil(IntPtr job, long deadlineMilliseconds)
    {
        IntPtr accounting = IntPtr.Zero;
        try
        {
            int size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            accounting = Marshal.AllocHGlobal(size);
            while (true)
            {
                if (!QueryInformationJobObject(
                    job,
                    JobObjectBasicAccountingInformation,
                    accounting,
                    (uint)size,
                    IntPtr.Zero))
                {
                    return false;
                }
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info =
                    (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(
                        accounting,
                        typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
                if (info.ActiveProcesses == 0) return true;
                long remaining = deadlineMilliseconds -
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (remaining <= 0) return false;
                System.Threading.Thread.Sleep((int)Math.Min(remaining, 10));
            }
        }
        finally
        {
            if (accounting != IntPtr.Zero) Marshal.FreeHGlobal(accounting);
        }
    }
    private static readonly string[] ScratchSubdirectories = new string[]
    {
        "tmp", "cache", "config", "home", "data", "state", "pycache",
        "appdata", "localappdata", "pip", "hf", "transformers",
        "matplotlib", "numba", "npm", "bun", "codex", "python-user",
        "ipython", "jupyter", "cuda", "torch"
    };
    private static void SetLowIntegrityScratchLabel(string scratchRoot)
    {
        IntPtr descriptor = IntPtr.Zero;
        try
        {
            uint descriptorSize;
            if (!ConvertStringSecurityDescriptorToSecurityDescriptor(
                "S:(ML;OICI;NW;;;LW)",
                SDDL_REVISION_1,
                out descriptor,
                out descriptorSize))
            {
                ThrowLastError("ConvertStringSecurityDescriptorToSecurityDescriptor");
            }
            bool saclPresent;
            bool saclDefaulted;
            IntPtr sacl;
            if (!GetSecurityDescriptorSacl(
                descriptor,
                out saclPresent,
                out sacl,
                out saclDefaulted) ||
                !saclPresent || sacl == IntPtr.Zero)
            {
                ThrowLastError("GetSecurityDescriptorSacl");
            }
            uint status = SetNamedSecurityInfo(
                scratchRoot,
                SE_FILE_OBJECT,
                LABEL_SECURITY_INFORMATION,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero,
                sacl);
            if (status != 0)
            {
                throw new Win32Exception(
                    unchecked((int)status),
                    "SetNamedSecurityInfo(low-integrity scratch label) failed");
            }
        }
        finally
        {
            if (descriptor != IntPtr.Zero) LocalFree(descriptor);
        }
    }
    private static string ReadLowIntegrityScratchLabel(string scratchRoot)
    {
        IntPtr descriptor = IntPtr.Zero;
        IntPtr owner;
        IntPtr group;
        IntPtr dacl;
        IntPtr sacl;
        uint status = GetNamedSecurityInfo(
            scratchRoot,
            SE_FILE_OBJECT,
            LABEL_SECURITY_INFORMATION,
            out owner,
            out group,
            out dacl,
            out sacl,
            out descriptor);
        if (status != 0)
        {
            throw new Win32Exception(
                unchecked((int)status),
                "GetNamedSecurityInfo(low-integrity scratch label) failed");
        }
        try
        {
            IntPtr label = IntPtr.Zero;
            try
            {
                uint labelLength;
                if (!ConvertSecurityDescriptorToStringSecurityDescriptor(
                    descriptor,
                    SDDL_REVISION_1,
                    LABEL_SECURITY_INFORMATION,
                    out label,
                    out labelLength))
                {
                    ThrowLastError(
                        "ConvertSecurityDescriptorToStringSecurityDescriptor");
                }
                return Marshal.PtrToStringUni(label) ?? String.Empty;
            }
            finally
            {
                if (label != IntPtr.Zero) LocalFree(label);
            }
        }
        finally
        {
            if (descriptor != IntPtr.Zero) LocalFree(descriptor);
        }
    }
    private static string BuildLowIntegrityScratchDaclSddl(
        SecurityIdentifier owner)
    {
        return "O:" + owner.Value + "D:P(A;OICI;FA;;;" + owner.Value + ")";
    }
    private static void ConfigureLowIntegrityScratchDirectory(
        string scratchRoot,
        SecurityIdentifier owner)
    {
        DirectorySecurity security = new DirectorySecurity();
        security.SetSecurityDescriptorSddlForm(
            BuildLowIntegrityScratchDaclSddl(owner),
            AccessControlSections.Owner | AccessControlSections.Access);
        new DirectoryInfo(scratchRoot).SetAccessControl(security);
        SetLowIntegrityScratchLabel(scratchRoot);
    }
    private static void VerifyLowIntegrityScratchDirectory(
        string scratchRoot,
        SecurityIdentifier owner)
    {
        DirectorySecurity security = new DirectoryInfo(scratchRoot).GetAccessControl(
            AccessControlSections.Owner | AccessControlSections.Access);
        SecurityIdentifier actualOwner = security.GetOwner(
            typeof(SecurityIdentifier)) as SecurityIdentifier;
        if (actualOwner == null || !actualOwner.Equals(owner) ||
            !security.AreAccessRulesProtected)
        {
            throw new InvalidOperationException(
                "low-integrity scratch owner or ACL protection verification failed");
        }
        AuthorizationRuleCollection rules = security.GetAccessRules(
            true,
            true,
            typeof(SecurityIdentifier));
        if (rules.Count != 1)
        {
            throw new InvalidOperationException(
                "low-integrity scratch ACL grants an unexpected principal");
        }
        FileSystemAccessRule rule = rules[0] as FileSystemAccessRule;
        SecurityIdentifier ruleIdentity = rule == null
            ? null
            : rule.IdentityReference as SecurityIdentifier;
        InheritanceFlags requiredInheritance =
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        if (rule == null || ruleIdentity == null || !ruleIdentity.Equals(owner) ||
            rule.IsInherited || rule.AccessControlType != AccessControlType.Allow ||
            rule.FileSystemRights != FileSystemRights.FullControl ||
            rule.InheritanceFlags != requiredInheritance ||
            rule.PropagationFlags != PropagationFlags.None)
        {
            throw new InvalidOperationException(
                "low-integrity scratch ACL verification failed");
        }
        string label = ReadLowIntegrityScratchLabel(scratchRoot);
        if (label.IndexOf("ML;", StringComparison.OrdinalIgnoreCase) < 0 ||
            label.IndexOf("OICI", StringComparison.OrdinalIgnoreCase) < 0 ||
            label.IndexOf(";NW;;;LW", StringComparison.OrdinalIgnoreCase) < 0)
        {
            throw new InvalidOperationException(
                "low-integrity scratch label verification failed");
        }
    }
    private static void VerifyLowIntegrityScratchSubdirectory(
        string scratchSubdirectory)
    {
        uint attributes = GetFileAttributesW(scratchSubdirectory);
        if (attributes == INVALID_FILE_ATTRIBUTES)
        {
            ThrowLastError("GetFileAttributesW(low-integrity scratch subdirectory)");
        }
        if ((attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
            (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw new InvalidOperationException(
                "low-integrity scratch subdirectory verification failed");
        }
        string label = ReadLowIntegrityScratchLabel(scratchSubdirectory);
        if (label.IndexOf("ML;", StringComparison.OrdinalIgnoreCase) < 0 ||
            label.IndexOf(";NW;;;LW", StringComparison.OrdinalIgnoreCase) < 0)
        {
            throw new InvalidOperationException(
                "low-integrity scratch inheritance verification failed");
        }
    }
    private static bool IsInvalidFileHandle(IntPtr handle)
    {
        return handle == IntPtr.Zero || handle == new IntPtr(-1);
    }
    private static IntPtr OpenTrustedScratchDirectoryHandle(string scratchRoot)
    {
        IntPtr handle = CreateFileW(
            scratchRoot,
            FILE_READ_ATTRIBUTES |
                READ_CONTROL |
                WRITE_DAC |
                WRITE_OWNER |
                DELETE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero);
        if (IsInvalidFileHandle(handle))
        {
            ThrowLastError("CreateFileW(low-integrity scratch)");
        }
        return handle;
    }
    private static ScratchDirectoryIdentity ReadScratchDirectoryIdentity(
        IntPtr scratchDirectoryHandle)
    {
        BY_HANDLE_FILE_INFORMATION information;
        if (!GetFileInformationByHandle(
            scratchDirectoryHandle,
            out information))
        {
            ThrowLastError("GetFileInformationByHandle(low-integrity scratch)");
        }
        if ((information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
            (information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw new InvalidOperationException(
                "low-integrity scratch handle is not the original directory");
        }
        ScratchDirectoryIdentity identity = new ScratchDirectoryIdentity();
        identity.VolumeSerialNumber = information.VolumeSerialNumber;
        identity.FileIndexHigh = information.FileIndexHigh;
        identity.FileIndexLow = information.FileIndexLow;
        return identity;
    }
    private static bool HasScratchDirectoryIdentity(
        ScratchDirectoryIdentity actual,
        ScratchDirectoryIdentity expected)
    {
        return actual.VolumeSerialNumber == expected.VolumeSerialNumber &&
            actual.FileIndexHigh == expected.FileIndexHigh &&
            actual.FileIndexLow == expected.FileIndexLow;
    }
    private static void VerifyTrustedScratchDirectoryIdentity(
        IntPtr scratchDirectoryHandle,
        ScratchDirectoryIdentity expectedIdentity)
    {
        if (!HasScratchDirectoryIdentity(
            ReadScratchDirectoryIdentity(scratchDirectoryHandle),
            expectedIdentity))
        {
            throw new InvalidOperationException(
                "low-integrity scratch trusted handle identity changed");
        }
    }
    private static bool IsExactScratchPathAbsent(string scratchRoot)
    {
        uint attributes = GetFileAttributesW(scratchRoot);
        if (attributes != INVALID_FILE_ATTRIBUTES) return false;
        int error = Marshal.GetLastWin32Error();
        if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND)
        {
            return true;
        }
        throw new Win32Exception(
            error,
            "GetFileAttributesW(low-integrity scratch) failed");
    }
    private static bool VerifyScratchPathIdentity(
        string scratchRoot,
        ScratchDirectoryIdentity expectedIdentity)
    {
        if (IsExactScratchPathAbsent(scratchRoot)) return false;
        uint attributes = GetFileAttributesW(scratchRoot);
        if ((attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
            (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw new InvalidOperationException(
                "low-integrity scratch path is not the original directory");
        }
        IntPtr pathHandle = CreateFileW(
            scratchRoot,
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero);
        if (IsInvalidFileHandle(pathHandle))
        {
            ThrowLastError("CreateFileW(low-integrity scratch identity)");
        }
        try
        {
            if (!HasScratchDirectoryIdentity(
                ReadScratchDirectoryIdentity(pathHandle),
                expectedIdentity))
            {
                throw new InvalidOperationException(
                    "low-integrity scratch path identity changed");
            }
        }
        finally
        {
            CloseHandle(pathHandle);
        }
        return true;
    }
    private static bool CloseTrustedScratchDirectoryHandle(
        ref IntPtr scratchDirectoryHandle,
        ref bool scratchDirectoryHandleCloseAttempted)
    {
        if (scratchDirectoryHandleCloseAttempted ||
            IsInvalidFileHandle(scratchDirectoryHandle))
        {
            return false;
        }
        scratchDirectoryHandleCloseAttempted = true;
        if (!CloseHandle(scratchDirectoryHandle)) return false;
        scratchDirectoryHandle = IntPtr.Zero;
        return true;
    }
    private static void RestoreLowIntegrityScratchSecurity(
        IntPtr scratchDirectoryHandle,
        SecurityIdentifier owner)
    {
        IntPtr descriptor = IntPtr.Zero;
        try
        {
            uint descriptorSize;
            if (!ConvertStringSecurityDescriptorToSecurityDescriptor(
                BuildLowIntegrityScratchDaclSddl(owner),
                SDDL_REVISION_1,
                out descriptor,
                out descriptorSize))
            {
                ThrowLastError(
                    "ConvertStringSecurityDescriptorToSecurityDescriptor");
            }
            IntPtr ownerSid;
            bool ownerDefaulted;
            if (!GetSecurityDescriptorOwner(
                descriptor,
                out ownerSid,
                out ownerDefaulted) ||
                ownerSid == IntPtr.Zero)
            {
                ThrowLastError("GetSecurityDescriptorOwner");
            }
            IntPtr dacl;
            bool daclPresent;
            bool daclDefaulted;
            if (!GetSecurityDescriptorDacl(
                descriptor,
                out daclPresent,
                out dacl,
                out daclDefaulted) ||
                !daclPresent || dacl == IntPtr.Zero)
            {
                ThrowLastError("GetSecurityDescriptorDacl");
            }
            uint status = SetSecurityInfo(
                scratchDirectoryHandle,
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION |
                    DACL_SECURITY_INFORMATION |
                    PROTECTED_DACL_SECURITY_INFORMATION,
                ownerSid,
                IntPtr.Zero,
                dacl,
                IntPtr.Zero);
            if (status != 0)
            {
                throw new Win32Exception(
                    unchecked((int)status),
                    "SetSecurityInfo(low-integrity scratch owner and DACL) failed");
            }
        }
        finally
        {
            if (descriptor != IntPtr.Zero) LocalFree(descriptor);
        }
    }
    private static string CreateLowIntegrityScratchDirectory()
    {
        WindowsIdentity identity = WindowsIdentity.GetCurrent();
        SecurityIdentifier owner = identity == null ? null : identity.User;
        if (owner == null)
        {
            throw new InvalidOperationException(
                "current trusted supervisor identity is unavailable");
        }
        string tempRoot = Path.GetFullPath(Path.GetTempPath());
        for (int attempt = 0; attempt < 8; attempt++)
        {
            byte[] nonce = new byte[32];
            using (RandomNumberGenerator random = RandomNumberGenerator.Create())
            {
                random.GetBytes(nonce);
            }
            string scratchRoot = Path.Combine(
                tempRoot,
                "tzudong-storyboard-low-" +
                    BitConverter.ToString(nonce).Replace("-", String.Empty)
                        .ToLowerInvariant());
            if (!CreateDirectoryW(scratchRoot, IntPtr.Zero))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == 183) continue;
                ThrowLastError("CreateDirectoryW(low-integrity scratch)");
            }
            try
            {
                ConfigureLowIntegrityScratchDirectory(scratchRoot, owner);
                foreach (string name in ScratchSubdirectories)
                {
                    Directory.CreateDirectory(Path.Combine(scratchRoot, name));
                }
                VerifyLowIntegrityScratchDirectory(scratchRoot, owner);
                foreach (string name in ScratchSubdirectories)
                {
                    VerifyLowIntegrityScratchSubdirectory(
                        Path.Combine(scratchRoot, name));
                }
                return scratchRoot;
            }
            catch
            {
                TryRemovePreLaunchScratchDirectory(scratchRoot);
                throw;
            }
        }
        throw new IOException(
            "could not allocate a cryptographically random low-integrity scratch directory");
    }
    private static IntPtr BuildLowIntegrityScratchEnvironment(string scratchRoot)
    {
        SortedDictionary<string, string> environment =
            new SortedDictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
        IDictionary inherited = Environment.GetEnvironmentVariables();
        foreach (DictionaryEntry entry in inherited)
        {
            string key = entry.Key as string;
            string value = entry.Value as string;
            if (String.IsNullOrEmpty(key) || String.IsNullOrEmpty(value) ||
                key[0] == '=' ||
                key.StartsWith("TZUDONG_JOB_", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            environment[key] = value;
        }
        string tmp = Path.Combine(scratchRoot, "tmp");
        string cache = Path.Combine(scratchRoot, "cache");
        string config = Path.Combine(scratchRoot, "config");
        string home = Path.Combine(scratchRoot, "home");
        environment["TEMP"] = tmp;
        environment["TMP"] = tmp;
        environment["TMPDIR"] = tmp;
        environment["HOME"] = home;
        environment["USERPROFILE"] = home;
        string homeRoot = Path.GetPathRoot(home);
        if (!String.IsNullOrEmpty(homeRoot) &&
            homeRoot.Length >= 2 && homeRoot[1] == ':')
        {
            environment["HOMEDRIVE"] = homeRoot.Substring(0, 2);
            environment["HOMEPATH"] = home.Substring(2);
        }
        else
        {
            environment["HOMEDRIVE"] = home;
            environment["HOMEPATH"] = String.Empty;
        }
        environment["HOMESHARE"] = home;
        environment["APPDATA"] = Path.Combine(scratchRoot, "appdata");
        environment["LOCALAPPDATA"] = Path.Combine(
            scratchRoot,
            "localappdata");
        environment["XDG_CACHE_HOME"] = cache;
        environment["XDG_CONFIG_HOME"] = config;
        environment["XDG_DATA_HOME"] = Path.Combine(scratchRoot, "data");
        environment["XDG_STATE_HOME"] = Path.Combine(scratchRoot, "state");
        environment["XDG_RUNTIME_DIR"] = tmp;
        environment["PIP_CACHE_DIR"] = Path.Combine(scratchRoot, "pip");
        environment["PYTHONPYCACHEPREFIX"] = Path.Combine(
            scratchRoot,
            "pycache");
        environment["HF_HOME"] = Path.Combine(scratchRoot, "hf");
        environment["TRANSFORMERS_CACHE"] = Path.Combine(
            scratchRoot,
            "transformers");
        environment["MPLCONFIGDIR"] = Path.Combine(
            scratchRoot,
            "matplotlib");
        environment["NUMBA_CACHE_DIR"] = Path.Combine(
            scratchRoot,
            "numba");
        environment["NPM_CONFIG_CACHE"] = Path.Combine(scratchRoot, "npm");
        environment["YARN_CACHE_FOLDER"] = Path.Combine(scratchRoot, "npm");
        environment["BUN_INSTALL_CACHE_DIR"] = Path.Combine(scratchRoot, "bun");
        environment["CODEX_HOME"] = Path.Combine(scratchRoot, "codex");
        environment["PYTHONUSERBASE"] = Path.Combine(
            scratchRoot,
            "python-user");
        environment["IPYTHONDIR"] = Path.Combine(scratchRoot, "ipython");
        environment["JUPYTER_CONFIG_DIR"] = Path.Combine(
            scratchRoot,
            "jupyter");
        environment["JUPYTER_DATA_DIR"] = Path.Combine(
            scratchRoot,
            "jupyter");
        environment["CUDA_CACHE_PATH"] = Path.Combine(scratchRoot, "cuda");
        environment["TORCH_HOME"] = Path.Combine(scratchRoot, "torch");
        StringBuilder block = new StringBuilder();
        foreach (KeyValuePair<string, string> entry in environment)
        {
            block.Append(entry.Key);
            block.Append("=");
            block.Append(entry.Value);
            block.Append('\0');
        }
        block.Append('\0');
        byte[] bytes = Encoding.Unicode.GetBytes(block.ToString());
        IntPtr result = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, result, bytes.Length);
        return result;
    }
    private static void EnsureScratchCleanupDeadline(long deadlineMilliseconds)
    {
        if (deadlineMilliseconds > 0 &&
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >
                deadlineMilliseconds)
        {
            throw new TimeoutException("low-integrity scratch cleanup deadline exceeded");
        }
    }
    private static void RemoveLowIntegrityScratchContents(
        string directory,
        long deadlineMilliseconds)
    {
        EnsureScratchCleanupDeadline(deadlineMilliseconds);
        foreach (string entry in Directory.GetFileSystemEntries(directory))
        {
            EnsureScratchCleanupDeadline(deadlineMilliseconds);
            FileAttributes attributes = File.GetAttributes(entry);
            bool isDirectory =
                (attributes & FileAttributes.Directory) != 0;
            if ((attributes & FileAttributes.ReparsePoint) != 0)
            {
                if (isDirectory) Directory.Delete(entry, false);
                else File.Delete(entry);
                continue;
            }
            if (isDirectory)
            {
                RemoveLowIntegrityScratchContents(entry, deadlineMilliseconds);
                EnsureScratchCleanupDeadline(deadlineMilliseconds);
                Directory.Delete(entry, false);
            }
            else
            {
                File.Delete(entry);
            }
        }
    }
    private static bool TryRemovePreLaunchScratchDirectory(string scratchRoot)
    {
        if (String.IsNullOrEmpty(scratchRoot)) return false;
        try
        {
            if (IsExactScratchPathAbsent(scratchRoot)) return true;
            uint rootAttributes = GetFileAttributesW(scratchRoot);
            if ((rootAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
                (rootAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
            {
                return false;
            }
            RemoveLowIntegrityScratchContents(scratchRoot, 0);
            Directory.Delete(scratchRoot, false);
            return IsExactScratchPathAbsent(scratchRoot);
        }
        catch
        {
            return false;
        }
    }
    private static bool TryRemoveLowIntegrityScratchDirectory(
        string scratchRoot,
        ref IntPtr scratchDirectoryHandle,
        ref bool scratchDirectoryHandleCloseAttempted,
        ScratchDirectoryIdentity expectedIdentity,
        SecurityIdentifier owner,
        long deadlineMilliseconds)
    {
        if (String.IsNullOrEmpty(scratchRoot) ||
            IsInvalidFileHandle(scratchDirectoryHandle) ||
            owner == null)
        {
            return false;
        }
        try
        {
            EnsureScratchCleanupDeadline(deadlineMilliseconds);
            VerifyTrustedScratchDirectoryIdentity(
                scratchDirectoryHandle,
                expectedIdentity);
            if (!VerifyScratchPathIdentity(scratchRoot, expectedIdentity))
            {
                return false;
            }
            RestoreLowIntegrityScratchSecurity(
                scratchDirectoryHandle,
                owner);
            VerifyTrustedScratchDirectoryIdentity(
                scratchDirectoryHandle,
                expectedIdentity);
            if (!VerifyScratchPathIdentity(scratchRoot, expectedIdentity))
            {
                return false;
            }
            SetLowIntegrityScratchLabel(scratchRoot);
            VerifyLowIntegrityScratchDirectory(scratchRoot, owner);
            EnsureScratchCleanupDeadline(deadlineMilliseconds);
            RemoveLowIntegrityScratchContents(
                scratchRoot,
                deadlineMilliseconds);
            EnsureScratchCleanupDeadline(deadlineMilliseconds);
            VerifyTrustedScratchDirectoryIdentity(
                scratchDirectoryHandle,
                expectedIdentity);
            if (!VerifyScratchPathIdentity(scratchRoot, expectedIdentity))
            {
                return false;
            }
            if (!CloseTrustedScratchDirectoryHandle(
                ref scratchDirectoryHandle,
                ref scratchDirectoryHandleCloseAttempted))
            {
                return false;
            }
            EnsureScratchCleanupDeadline(deadlineMilliseconds);
            Directory.Delete(scratchRoot, false);
            EnsureScratchCleanupDeadline(deadlineMilliseconds);
            return IsExactScratchPathAbsent(scratchRoot);
        }
        catch
        {
            return false;
        }
    }

    public static int Run(
        string executable,
        string commandLine,
        string currentDirectory,
        long deadlineMilliseconds,
        long cleanupDeadlineMilliseconds,
        Stream lifecycle,
        Stream parentLifetime)
    {
        IntPtr job = IntPtr.Zero;
        IntPtr information = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr jobListValue = IntPtr.Zero;
        IntPtr inheritedHandleList = IntPtr.Zero;
        IntPtr restrictedToken = IntPtr.Zero;
        IntPtr targetEnvironment = IntPtr.Zero;
        IntPtr scratchDirectoryHandle = IntPtr.Zero;
        bool scratchDirectoryHandleCloseAttempted = false;
        ScratchDirectoryIdentity scratchDirectoryIdentity =
            new ScratchDirectoryIdentity();
        SecurityIdentifier scratchOwner = null;
        int parentDisconnected = 0;
        int supervisorStopping = 0;
        bool completed = false;
        bool jobDrained = false;
        bool scratchCleanupAttempted = false;
        bool attributeListInitialized = false;
        string scratchRoot = null;
        System.Threading.Thread parentLifetimeMonitor = null;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        try
        {
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) ThrowLastError("CreateJobObject");

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits =
                new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int informationSize =
                Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            information = Marshal.AllocHGlobal(informationSize);
            Marshal.StructureToPtr(limits, information, false);
            if (!SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                information,
                (uint)informationSize))
            {
                ThrowLastError("SetInformationJobObject");
            }

            IntPtr attributeListSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(
                IntPtr.Zero,
                2,
                0,
                ref attributeListSize);
            if (attributeListSize == IntPtr.Zero)
            {
                ThrowLastError("InitializeProcThreadAttributeList(size)");
            }
            attributeList = Marshal.AllocHGlobal(attributeListSize);
            if (!InitializeProcThreadAttributeList(
                attributeList,
                2,
                0,
                ref attributeListSize))
            {
                ThrowLastError("InitializeProcThreadAttributeList");
            }
            attributeListInitialized = true;
            jobListValue = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobListValue, job);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST,
                jobListValue,
                new IntPtr(IntPtr.Size),
                IntPtr.Zero,
                IntPtr.Zero))
            {
                ThrowLastError("UpdateProcThreadAttribute");
            }

            STARTUPINFOEX startup = new STARTUPINFOEX();
            startup.StartupInfo.cb =
                Marshal.SizeOf(typeof(STARTUPINFOEX));
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
            startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
            startup.lpAttributeList = attributeList;
            inheritedHandleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(inheritedHandleList, 0 * IntPtr.Size, startup.StartupInfo.hStdInput);
            Marshal.WriteIntPtr(inheritedHandleList, 1 * IntPtr.Size, startup.StartupInfo.hStdOutput);
            Marshal.WriteIntPtr(inheritedHandleList, 2 * IntPtr.Size, startup.StartupInfo.hStdError);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                inheritedHandleList,
                new IntPtr(IntPtr.Size * 3),
                IntPtr.Zero,
                IntPtr.Zero))
            {
                ThrowLastError("UpdateProcThreadAttribute(handle list)");
            }

            restrictedToken = CreateRestrictedLowIntegrityToken();
            WindowsIdentity trustedIdentity = WindowsIdentity.GetCurrent();
            scratchOwner = trustedIdentity == null ? null : trustedIdentity.User;
            if (scratchOwner == null)
            {
                throw new InvalidOperationException(
                    "current trusted supervisor identity is unavailable");
            }
            scratchRoot = CreateLowIntegrityScratchDirectory();
            try
            {
                scratchDirectoryHandle =
                    OpenTrustedScratchDirectoryHandle(scratchRoot);
                scratchDirectoryIdentity = ReadScratchDirectoryIdentity(
                    scratchDirectoryHandle);
            }
            catch
            {
                if (IsInvalidFileHandle(scratchDirectoryHandle) ||
                    CloseTrustedScratchDirectoryHandle(
                        ref scratchDirectoryHandle,
                        ref scratchDirectoryHandleCloseAttempted))
                {
                    TryRemovePreLaunchScratchDirectory(scratchRoot);
                }
                scratchRoot = null;
                throw;
            }
            targetEnvironment = BuildLowIntegrityScratchEnvironment(scratchRoot);
            parentLifetimeMonitor =
                new System.Threading.Thread(delegate()
                {
                    try
                    {
                        if (parentLifetime.ReadByte() == -1 &&
                            System.Threading.Interlocked.CompareExchange(
                                ref supervisorStopping,
                                0,
                                0) == 0)
                        {
                            System.Threading.Interlocked.Exchange(
                                ref parentDisconnected,
                                1);
                            TerminateJobObject(job, 125);
                        }
                    }
                    catch
                    {
                        if (System.Threading.Interlocked.CompareExchange(
                            ref supervisorStopping,
                            0,
                            0) == 0)
                        {
                            System.Threading.Interlocked.Exchange(
                                ref parentDisconnected,
                                1);
                            TerminateJobObject(job, 125);
                        }
                    }
                });
            parentLifetimeMonitor.IsBackground = true;
            parentLifetimeMonitor.Start();
            if (!CreateProcessAsUserW(
                restrictedToken,
                executable,
                new StringBuilder(commandLine),
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                CREATE_NO_WINDOW |
                    EXTENDED_STARTUPINFO_PRESENT |
                    CREATE_UNICODE_ENVIRONMENT,
                targetEnvironment,
                currentDirectory,
                ref startup,
                out process))
            {
                ThrowLastError("CreateProcessAsUserW(restricted low-integrity token)");
            }

            if (process.hThread != IntPtr.Zero)
            {
                CloseHandle(process.hThread);
                process.hThread = IntPtr.Zero;
            }
            while (true)
            {
                long remaining = deadlineMilliseconds -
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (remaining <= 0) throw new TimeoutException("Job deadline exceeded");
                if (System.Threading.Interlocked.CompareExchange(
                    ref parentDisconnected,
                    0,
                    0) != 0)
                    throw new InvalidOperationException("Job parent lifetime channel closed");
                uint wait = WaitForSingleObject(
                    process.hProcess,
                    (uint)Math.Min(remaining, 50));
                if (wait == WAIT_OBJECT_0) break;
                if (wait != WAIT_TIMEOUT) ThrowLastError("WaitForSingleObject(process)");
            }
            uint exitCode;
            if (!GetExitCodeProcess(process.hProcess, out exitCode))
            {
                ThrowLastError("GetExitCodeProcess");
            }
            if (!TerminateJobObject(job, 0))
            {
                ThrowLastError("TerminateJobObject(drain)");
            }
            if (!WaitForJobDrainUntil(job, deadlineMilliseconds))
            {
                throw new TimeoutException("Job drain deadline exceeded");
            }
            jobDrained = true;
            scratchCleanupAttempted = true;
            if (!TryRemoveLowIntegrityScratchDirectory(
                scratchRoot,
                ref scratchDirectoryHandle,
                ref scratchDirectoryHandleCloseAttempted,
                scratchDirectoryIdentity,
                scratchOwner,
                deadlineMilliseconds))
            {
                throw new IOException(
                    "low-integrity scratch cleanup could not be verified");
            }
            scratchRoot = null;
            completed = true;
            WriteLifecycle(lifecycle, "COMPLETE");
            return unchecked((int)exitCode);
        }
        finally
        {
            if (job != IntPtr.Zero && !completed)
            {
                try
                {
                    if (!jobDrained)
                    {
                        if (!TerminateJobObject(job, 125))
                        {
                            ThrowLastError("TerminateJobObject(cleanup)");
                        }
                        jobDrained = WaitForJobDrainUntil(
                            job,
                            cleanupDeadlineMilliseconds);
                    }
                    if (jobDrained && scratchRoot != null &&
                        !scratchCleanupAttempted)
                    {
                        scratchCleanupAttempted = true;
                        if (TryRemoveLowIntegrityScratchDirectory(
                            scratchRoot,
                            ref scratchDirectoryHandle,
                            ref scratchDirectoryHandleCloseAttempted,
                            scratchDirectoryIdentity,
                            scratchOwner,
                            cleanupDeadlineMilliseconds))
                        {
                            scratchRoot = null;
                            WriteLifecycle(lifecycle, "DRAIN");
                        }
                    }
                }
                catch
                {
                    // Cleanup proof remains absent when Job drain or scratch removal fails.
                }
            }
            System.Threading.Interlocked.Exchange(ref supervisorStopping, 1);
            try { lifecycle.Dispose(); } catch { }
            try { parentLifetime.Dispose(); } catch { }
            if (parentLifetimeMonitor != null) parentLifetimeMonitor.Join(100);
            if (targetEnvironment != IntPtr.Zero) Marshal.FreeHGlobal(targetEnvironment);
            if (!scratchDirectoryHandleCloseAttempted &&
                !IsInvalidFileHandle(scratchDirectoryHandle))
            {
                scratchDirectoryHandleCloseAttempted = true;
                if (CloseHandle(scratchDirectoryHandle))
                {
                    scratchDirectoryHandle = IntPtr.Zero;
                }
            }
            if (inheritedHandleList != IntPtr.Zero) Marshal.FreeHGlobal(inheritedHandleList);
            if (restrictedToken != IntPtr.Zero) CloseHandle(restrictedToken);
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            if (attributeListInitialized)
            {
                DeleteProcThreadAttributeList(attributeList);
            }
            if (jobListValue != IntPtr.Zero) Marshal.FreeHGlobal(jobListValue);
            if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
            if (information != IntPtr.Zero) Marshal.FreeHGlobal(information);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
$executable = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($env:TZUDONG_JOB_EXECUTABLE_B64))
$commandLine = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($env:TZUDONG_JOB_COMMAND_LINE_B64))
$currentDirectory = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($env:TZUDONG_JOB_CWD_B64))
$pipeName = $env:TZUDONG_JOB_PIPE_NAME
$parentLifetimePipeName = $env:TZUDONG_JOB_PARENT_LIFETIME_PIPE_NAME
$deadlineMilliseconds = 0
$cleanupDeadlineMilliseconds = 0
if ($pipeName -notmatch '^tzudong-storyboard-proof-[0-9a-f]{64}$') { exit 125 }
if ($parentLifetimePipeName -notmatch '^tzudong-storyboard-parent-[0-9a-f]{64}$') { exit 125 }
if (-not [int64]::TryParse($env:TZUDONG_JOB_DEADLINE_MS, [ref]$deadlineMilliseconds)) { exit 125 }
if (-not [int64]::TryParse($env:TZUDONG_JOB_CLEANUP_DEADLINE_MS, [ref]$cleanupDeadlineMilliseconds)) { exit 125 }
if ($cleanupDeadlineMilliseconds -le $deadlineMilliseconds) { exit 125 }
$remaining = $deadlineMilliseconds - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if ($remaining -le 0) { exit 125 }
$proofPipe = [IO.Pipes.NamedPipeClientStream]::new(
  '.', $pipeName, [IO.Pipes.PipeDirection]::Out, [IO.Pipes.PipeOptions]::None)
$parentLifetimePipe = [IO.Pipes.NamedPipeClientStream]::new(
  '.', $parentLifetimePipeName, [IO.Pipes.PipeDirection]::In, [IO.Pipes.PipeOptions]::None)
try {
  $proofPipe.Connect([int][Math]::Min($remaining, 5000))
  $parentLifetimePipe.Connect([int][Math]::Min($remaining, 5000))
  Get-ChildItem Env: | Where-Object { $_.Name -like 'TZUDONG_JOB_*' } |
    ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }
  $exitCode = [TzudongWindowsJobSupervisor]::Run(
    $executable,
    $commandLine,
    $currentDirectory,
    $deadlineMilliseconds,
    $cleanupDeadlineMilliseconds,
    $proofPipe,
    $parentLifetimePipe)
  exit $exitCode
} catch {
  exit 125
} finally {
  $proofPipe.Dispose()
  $parentLifetimePipe.Dispose()
}
`;

const WINDOWS_JOB_SUPERVISOR_BOOTSTRAP = String.raw`
$ErrorActionPreference = 'Stop'
$encoded = $env:TZUDONG_JOB_SCRIPT_GZIP_B64
Remove-Item Env:TZUDONG_JOB_SCRIPT_GZIP_B64 -ErrorAction SilentlyContinue
if (-not $encoded) { exit 125 }
$compressed = [Convert]::FromBase64String($encoded)
$inputStream = [IO.MemoryStream]::new($compressed, $false)
$gzip = [IO.Compression.GzipStream]::new(
  $inputStream,
  [IO.Compression.CompressionMode]::Decompress)
$reader = [IO.StreamReader]::new($gzip, [Text.Encoding]::UTF8, $true)
try {
  $script = $reader.ReadToEnd()
} finally {
  $reader.Dispose()
  $gzip.Dispose()
  $inputStream.Dispose()
}
& ([ScriptBlock]::Create($script))
`;

function quoteWindowsCreateProcessArgument(value: string) {
  if (!value || /[\s"]/.test(value)) {
    let quoted = '"';
    let backslashes = 0;
    for (const character of value) {
      if (character === "\\") {
        backslashes += 1;
        continue;
      }
      if (character === '"') {
        quoted += `${"\\".repeat(backslashes * 2 + 1)}"`;
        backslashes = 0;
        continue;
      }
      quoted += `${"\\".repeat(backslashes)}${character}`;
      backslashes = 0;
    }
    return `${quoted}${"\\".repeat(backslashes * 2)}"`;
  }
  return value;
}

function resolveTrustedWindowsPowerShell() {
  const windowsRoot =
    process.env.SystemRoot?.trim() ||
    process.env.WINDIR?.trim() ||
    "C:\\Windows";
  const executable = path.win32.join(
    windowsRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!path.win32.isAbsolute(executable) || !existsSync(executable)) {
    throw new Error("trusted Windows PowerShell is unavailable");
  }
  return executable;
}

function buildWindowsJobSupervisorSpec({
  executable,
  args,
  cwd,
  env,
  windowsVerbatimArguments,
  deadline,
  cleanupDeadline,
  pipeName,
  parentLifetimePipeName,
}: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsVerbatimArguments: boolean;
  deadline: number;
  cleanupDeadline: number;
  pipeName: string;
  parentLifetimePipeName: string;
}) {
  const commandLine = [
    quoteWindowsCreateProcessArgument(executable),
    windowsVerbatimArguments
      ? args.join(" ")
      : args.map(quoteWindowsCreateProcessArgument).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  return {
    executable: resolveTrustedWindowsPowerShell(),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(WINDOWS_JOB_SUPERVISOR_BOOTSTRAP, "utf16le").toString("base64"),
    ],
    env: {
      ...env,
      TZUDONG_JOB_SCRIPT_GZIP_B64: gzipSync(
        Buffer.from(WINDOWS_JOB_SUPERVISOR_SCRIPT, "utf8"),
      ).toString("base64"),
      TZUDONG_JOB_EXECUTABLE_B64: Buffer.from(executable, "utf8").toString(
        "base64",
      ),
      TZUDONG_JOB_COMMAND_LINE_B64: Buffer.from(commandLine, "utf8").toString(
        "base64",
      ),
      TZUDONG_JOB_CWD_B64: Buffer.from(cwd, "utf8").toString("base64"),
      TZUDONG_JOB_PIPE_NAME: pipeName,
      TZUDONG_JOB_PARENT_LIFETIME_PIPE_NAME: parentLifetimePipeName,
      TZUDONG_JOB_DEADLINE_MS: String(deadline),
      TZUDONG_JOB_CLEANUP_DEADLINE_MS: String(cleanupDeadline),
    },
  };
}

type DiagnosticCapture = {
  value: string;
  byteCount: number;
  truncated: boolean;
};
type WindowsLifecycleChannel = {
  pipeName: string;
  socket: Promise<net.Socket>;
  close: () => void;
};

function createWindowsLifecycleChannel(
  purpose: "proof" | "parent",
): WindowsLifecycleChannel {
  const pipeName = `tzudong-storyboard-${purpose}-${randomBytes(32).toString("hex")}`;
  let resolveSocket!: (socket: net.Socket) => void;
  let activeSocket: net.Socket | null = null;
  const server = net.createServer((socket) => {
    if (activeSocket) {
      socket.destroy();
      return;
    }
    activeSocket = socket;
    server.close();
    resolveSocket(socket);
  });
  server.once("error", () => {
    // An unconnected lifecycle channel fails closed at the absolute deadline.
  });
  const socket = new Promise<net.Socket>((resolve) => {
    resolveSocket = resolve;
  });
  server.listen(`\\\\.\\pipe\\${pipeName}`);
  return {
    pipeName,
    socket,
    close: () => {
      server.close();
      activeSocket?.destroy();
    },
  };
}
function appendCommandDiagnostic(capture: DiagnosticCapture, chunk: unknown, budget: number) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
  capture.byteCount += bytes.length;
  const remaining = Math.max(0, budget - Buffer.byteLength(capture.value, "utf8"));
  if (bytes.length > remaining) capture.truncated = true;
  if (remaining > 0) {
    // Buffer decoding keeps only complete UTF-8 sequences; never manufacture a marker
    // from untrusted output or use one as state.
    capture.value += bytes.subarray(0, remaining).toString("utf8");
  }
}
function appendTrustedLifecycleDiagnostic(current: string, diagnostic: string) {
  const trusted = `\n[trusted lifecycle: ${diagnostic.slice(0, 240)}]`;
  const prefixBudget = Math.max(
    0,
    MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES - Buffer.byteLength(trusted),
  );
  const prefix = Buffer.from(current, "utf8")
    .subarray(0, prefixBudget)
    .toString("utf8");
  return `${prefix}${trusted}`;
}

type WindowsHelperResult = {
  status: "success" | "failed" | "timed_out";
  stdout: string;
  truncated: boolean;
};

type ProcessControl = {
  platform: NodeJS.Platform;
  spawnProcess: typeof spawn;
  commandTimeoutMs?: number;
  helperTimeoutMs?: number;
  streamDrainTimeoutMs?: number;
};

const defaultProcessControl: ProcessControl = {
  platform: process.platform,
  spawnProcess: spawn,
};

const MAX_WINDOWS_CAPTURED_PROCESS_COUNT = 4096;

function remainingCleanupMs(deadline: number) {
  return Math.max(0, deadline - Date.now());
}

function runWindowsHelper(
  command: string,
  args: string[],
  processControl: ProcessControl,
  deadline: number,
) {
  return new Promise<WindowsHelperResult>((resolve) => {
    const remaining = remainingCleanupMs(deadline);
    if (remaining === 0) {
      resolve({ status: "timed_out", stdout: "", truncated: false });
      return;
    }
    let settled = false;
    let stdout = "";
    let truncated = false;
    let helper: ReturnType<typeof spawn> | null = null;
    const settle = (status: WindowsHelperResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, truncated });
    };
    const timer = setTimeout(() => {
      helper?.kill("SIGKILL");
      settle("timed_out");
    }, Math.min(processControl.helperTimeoutMs ?? WINDOWS_PROCESS_TERMINATION_TIMEOUT_MS, remaining));
    try {
      helper = processControl.spawnProcess(command, args, {
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      helper.stdout?.on("data", (chunk) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(String(chunk)) > MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES) {
          truncated = true;
          return;
        }
        stdout += String(chunk);
      });
      helper.once("error", () => settle("failed"));
      helper.once("close", (code) => settle(code === 0 ? "success" : "failed"));
    } catch {
      settle("failed");
    }
  });
}

async function captureWindowsProcessTree(
  pid: number,
  processControl: ProcessControl,
  deadline: number,
) {
  const result = await runWindowsHelper(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$root = ${pid}; $all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $live = @{}; foreach ($process in $all) { $live[[int]$process.ProcessId] = $true }; $seen = @{}; $pending = @($root); while ($pending.Count) { $current = [int]$pending[0]; if ($seen.ContainsKey($current)) { $pending = @($pending | Select-Object -Skip 1); continue }; $seen[$current] = $true; if ($seen.Count -gt ${MAX_WINDOWS_CAPTURED_PROCESS_COUNT}) { exit 91 }; $pending = @($pending | Select-Object -Skip 1) + @($all | Where-Object { [int]$_.ParentProcessId -eq $current } | ForEach-Object { [int]$_.ProcessId }) }; $seen.Keys | Where-Object { $live.ContainsKey([int]$_) } | Sort-Object | ForEach-Object { $_ }`,
    ],
    processControl,
    deadline,
  );
  if (result.status !== "success" || result.truncated) return null;
  const values = result.stdout.trim().split(/\r?\n/);
  if (!values.length || values.some((value) => !/^(?:0|[1-9]\d*)$/.test(value))) return null;
  const pids = new Set(values.map(Number));
  return pids.size <= MAX_WINDOWS_CAPTURED_PROCESS_COUNT ? [...pids] : null;
}

function runWindowsTaskkill(pid: number, processControl: ProcessControl, deadline: number) {
  return runWindowsHelper(
    "taskkill.exe",
    ["/PID", String(pid), "/T", "/F"],
    processControl,
    deadline,
  ).then((result) => result.status);
}

async function verifyWindowsProcessTreeGone(
  pids: number[],
  processControl: ProcessControl,
  deadline: number,
) {
  const survivors = new Set<number>();
  for (const pid of pids) {
    const result = await runWindowsHelper(
      "tasklist.exe",
      ["/FI", `PID eq ${pid}`, "/NH"],
      processControl,
      deadline,
    );
    if (result.status !== "success" || result.truncated) return null;
    if (new RegExp(`\\b${pid}\\b`).test(result.stdout)) survivors.add(pid);
  }
  return survivors;
}

async function terminateWindowsProcessTree(
  pid: number,
  processControl: ProcessControl,
  knownPids: number[] = [],
) {
  const helperTimeoutMs =
    processControl.helperTimeoutMs ?? WINDOWS_PROCESS_TERMINATION_TIMEOUT_MS;
  const deadline = Date.now() + helperTimeoutMs * 4;
  let pids: number[] | null = null;

  for (let attempt = 0; attempt < 2 && !pids; attempt += 1) {
    const captureDeadline = Math.min(deadline, Date.now() + helperTimeoutMs);
    pids = await captureWindowsProcessTree(pid, processControl, captureDeadline);
  }

  const primary = await runWindowsTaskkill(pid, processControl, deadline);
  const capturedLiveDescendant = Boolean(
    pids?.some((capturedPid) => capturedPid !== pid),
  );
  const knownLiveDescendant = knownPids.some((knownPid) => knownPid !== pid);
  const captureSucceeded = Boolean(pids || knownLiveDescendant);
  const trackedPids = [...new Set([pid, ...knownPids, ...(pids ?? [])])];
  let survivors = await verifyWindowsProcessTreeGone(
    trackedPids,
    processControl,
    deadline,
  );
  if (survivors?.size) {
    for (const survivor of survivors) {
      await runWindowsTaskkill(survivor, processControl, deadline);
    }
    survivors = await verifyWindowsProcessTreeGone(
      trackedPids,
      processControl,
      deadline,
    );
  }

  const gone = Boolean(
    captureSucceeded &&
      (primary === "success" ||
        capturedLiveDescendant ||
        knownLiveDescendant) &&
      survivors?.size === 0,
  );
  return {
    gone,
    diagnostic: gone
      ? ""
      : !pids
        ? `windows process-tree capture failed; taskkill fallback=${primary}`
        : `windows process-tree cleanup incomplete (primary=${primary})`,
  };
}
export function __terminateWindowsProcessTreeForTests(
  pid: number,
  processControl: ProcessControl,
) {
  return terminateWindowsProcessTree(pid, processControl);
}
type LinuxNamespaceContainment = {
  available: boolean;
  launcher?: string;
  python?: string;
  diagnostic: string;
};

const LINUX_NAMESPACE_INIT_SUPERVISOR = String.raw`
import base64, ctypes, json, os, select, signal, sys, time
libc = ctypes.CDLL(None)
event_fd = int(os.environ["TZUDONG_NS_EVENT_FD"])
command_fd = int(os.environ["TZUDONG_NS_COMMAND_FD"])
nonce = os.environ["TZUDONG_NS_NONCE"].encode("ascii")
if len(nonce) != 64 or any(character not in b"0123456789abcdef" for character in nonce):
    raise RuntimeError("protocol nonce rejected")
os.set_inheritable(event_fd, False)
os.set_inheritable(command_fd, False)
if libc.prctl(4, 0, 0, 0, 0) != 0 or libc.prctl(38, 1, 0, 0, 0) != 0:
    raise RuntimeError("target hardening failed")
class CapHeader(ctypes.Structure):
    _fields_ = [("version", ctypes.c_uint), ("pid", ctypes.c_int)]
class CapData(ctypes.Structure):
    _fields_ = [("effective", ctypes.c_uint), ("permitted", ctypes.c_uint), ("inheritable", ctypes.c_uint)]
header = CapHeader(0x20080522, 0)
caps = (CapData * 2)()
if libc.capset(ctypes.byref(header), ctypes.byref(caps)) != 0:
    raise RuntimeError("capset failed")
for capability in range(64):
    libc.prctl(24, capability, 0, 0, 0)
target = json.loads(base64.b64decode(os.environ["TZUDONG_NS_TARGET_B64"]))
def send(message):
    data = (message + "\n").encode("ascii")
    if len(data) > 128:
        raise RuntimeError("protocol overflow")
    os.write(event_fd, data)
def receive_line(deadline):
    buffer = b""
    while time.monotonic() < deadline:
        readable, _, _ = select.select([command_fd], [], [], min(.05, max(0, deadline - time.monotonic())))
        if not readable:
            continue
        data = os.read(command_fd, 64)
        if not data:
            raise RuntimeError("protocol closed")
        buffer += data
        if len(buffer) > 128:
            raise RuntimeError("protocol overflow")
        if b"\n" in buffer:
            line, remainder = buffer.split(b"\n", 1)
            if remainder:
                raise RuntimeError("protocol trailing data")
            return line
    raise RuntimeError("protocol timeout")
def members():
    own = os.stat("/proc/self/ns/pid").st_ino
    result = []
    for name in os.listdir("/proc"):
        if name.isdigit():
            try:
                if os.stat("/proc/" + name + "/ns/pid").st_ino != own:
                    continue
                with open("/proc/" + name + "/status", encoding="ascii") as status_file:
                    state_line = next(
                        (line for line in status_file if line.startswith("State:")),
                        "",
                    )
                if state_line.split()[1:2] == ["Z"]:
                    continue
                result.append(int(name))
            except OSError:
                pass
    return sorted(result)
send("READY " + nonce.decode("ascii"))
if receive_line(time.monotonic() + 5.0) != b"ACK " + nonce:
    raise RuntimeError("protocol acknowledgement rejected")
target_environment = {
    key: value
    for key, value in os.environ.items()
    if not key.startswith("TZUDONG_NS_")
}
target_pid = os.fork()
if target_pid == 0:
    os.close(event_fd)
    os.close(command_fd)
    os.execvpe(target[0], target, target_environment)
target_status = None
cleaning = False
cleanup_started = None
cleanup_term_sent = False
control = b""
while True:
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            break
        if pid == 0:
            break
        if pid == target_pid and target_status is None:
            target_status = status
            cleaning = True
    readable, _, _ = select.select([command_fd], [], [], .02)
    if readable:
        data = os.read(command_fd, 64)
        if not data:
            cleaning = True
        else:
            control += data
            if len(control) > 64:
                send("FAIL protocol")
                sys.exit(125)
            while b"\n" in control:
                line, control = control.split(b"\n", 1)
                if line != b"STOP":
                    send("FAIL protocol")
                    sys.exit(125)
                cleaning = True
    if cleaning:
        if cleanup_started is None:
            cleanup_started = time.monotonic()
        elapsed = time.monotonic() - cleanup_started
        live_members = members()
        if target_status is not None and live_members == [1]:
            code = os.waitstatus_to_exitcode(target_status)
            normalized = code if code >= 0 else 128 - code
            send("DONE " + nonce.decode("ascii") + " " + str(normalized))
            os.close(event_fd)
            os.close(command_fd)
            sys.exit(normalized)
        if not cleanup_term_sent:
            try:
                os.kill(-1, signal.SIGTERM)
            except ProcessLookupError:
                pass
            cleanup_term_sent = True
        elif elapsed >= ${LINUX_NAMESPACE_DESCENDANT_TERM_GRACE_MS} / 1000.0:
            try:
                os.kill(-1, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if elapsed >= ${LINUX_NAMESPACE_INNER_CLEANUP_TIMEOUT_MS} / 1000.0:
            send("FAIL cleanup")
            sys.exit(125)
`;
const LINUX_NAMESPACE_OUTER_SUPERVISOR = String.raw`
import base64, ctypes, os, select, signal, subprocess, sys, time
libc = ctypes.CDLL(None)
node_parent_pid = os.getppid()
outer_pid = os.getpid()
nonce = os.environ["TZUDONG_NS_NONCE"].encode("ascii")
if len(nonce) != 64 or any(character not in b"0123456789abcdef" for character in nonce):
    sys.exit(125)
if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or libc.prctl(36, 1, 0, 0, 0) != 0 or os.getppid() != node_parent_pid:
    sys.exit(125)
lifetime_fd = os.environ.get("TZUDONG_NS_NODE_LIFETIME_FD")
if lifetime_fd is not None:
    lifetime_fd = int(lifetime_fd)
    os.set_inheritable(lifetime_fd, False)
deadline = time.monotonic() + float(os.environ["TZUDONG_NS_DEADLINE_MILLISECONDS"]) / 1000.0
def child_pdeath():
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or os.getppid() != outer_pid:
        os._exit(125)
launcher = os.environ["TZUDONG_NS_UNSHARE"]
python = os.environ["TZUDONG_NS_PYTHON"]
inner = base64.b64decode(os.environ["TZUDONG_NS_INNER_B64"]).decode("utf-8")
event_read, event_write = os.pipe2(os.O_CLOEXEC)
command_read, command_write = os.pipe2(os.O_CLOEXEC)
os.set_inheritable(event_write, True)
os.set_inheritable(command_read, True)
environment = os.environ.copy()
environment["TZUDONG_NS_EVENT_FD"] = str(event_write)
environment["TZUDONG_NS_COMMAND_FD"] = str(command_read)
proc = subprocess.Popen(
    [launcher, "--user", "--map-root-user", "--pid", "--fork", "--kill-child=SIGKILL", "--mount-proc", "--", python, "-c", inner],
    env=environment,
    pass_fds=(event_write, command_read),
    preexec_fn=child_pdeath,
)
try:
    pidfd = os.pidfd_open(proc.pid, 0)
except (AttributeError, OSError):
    proc.kill()
    sys.exit(125)
os.close(event_write)
os.close(command_read)
ready = False
done = False
done_code = None
failed = False
stop_requested = False
stop_sent = False
stop_deadline = None
buffer = b""
def request_stop(*_):
    global stop_requested, stop_deadline
    stop_requested = True
    if stop_deadline is None:
        stop_deadline = time.monotonic() + 7.0
signal.signal(signal.SIGTERM, request_stop)
signal.signal(signal.SIGINT, request_stop)
while True:
    if time.monotonic() >= deadline and not stop_requested:
        request_stop()
    if stop_requested and ready and not stop_sent:
        try:
            os.write(command_write, b"STOP\n")
            stop_sent = True
        except OSError:
            failed = True
    if stop_deadline is not None and time.monotonic() >= stop_deadline:
        failed = True
        break
    watched_fds = [event_read]
    if lifetime_fd is not None:
        watched_fds.append(lifetime_fd)
    readable, _, _ = select.select(watched_fds, [], [], .05)
    if lifetime_fd is not None and lifetime_fd in readable:
        if not os.read(lifetime_fd, 1):
            request_stop()
        readable.remove(lifetime_fd)
    if readable:
        data = os.read(event_read, 128)
        if not data:
            if proc.poll() is None:
                failed = True
            break
        buffer += data
        if len(buffer) > 256:
            failed = True
            break
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            if line == b"READY " + nonce and not ready and not done:
                ready = True
                os.write(command_write, b"ACK " + nonce + b"\n")
            elif line.startswith(b"DONE " + nonce + b" ") and ready and not done:
                encoded_code = line[len(b"DONE ") + len(nonce) + 1:]
                if not encoded_code.isdigit():
                    failed = True
                    break
                done_code = int(encoded_code)
                if done_code < 0 or done_code > 255:
                    failed = True
                    break
                done = True
            elif line.startswith(b"FAIL "):
                failed = True
                break
            else:
                failed = True
                break
    if failed or done:
        break
    if proc.poll() is not None:
        break
if (failed or not done) and ready and not stop_sent:
    try:
        os.write(command_write, b"STOP\n")
        stop_sent = True
    except OSError:
        pass
try:
    os.close(command_write)
except OSError:
    pass
try:
    os.close(event_read)
except OSError:
    pass
if done and not failed:
    try:
        return_code = proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        failed = True
else:
    try:
        return_code = proc.wait(timeout=7)
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            return_code = proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
            return_code = proc.wait()
if done and not failed and return_code == done_code:
    ready_pidfd, _, _ = select.select([pidfd], [], [], 0)
    os.close(pidfd)
    if ready_pidfd:
        os.write(2, b"\nTZUDONG_NS_COMPLETE " + nonce + b"\n")
        sys.exit(return_code)
sys.exit(125)
`;

let linuxNamespaceContainmentProbe: LinuxNamespaceContainment | undefined;
const LINUX_NAMESPACE_PROBE_CAPTURE_BYTES = 128;

function linuxNamespaceCompletionMarker(nonce: string) {
  return Buffer.from(`\nTZUDONG_NS_COMPLETE ${nonce}\n`, "ascii");
}

function probeLinuxNamespaceContainment(): LinuxNamespaceContainment {
  if (linuxNamespaceContainmentProbe) return linuxNamespaceContainmentProbe;
  const launcher = ["/usr/bin/unshare", "/bin/unshare"].find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  const python = ["/usr/bin/python3", "/bin/python3"].find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!launcher || !python) {
    return (linuxNamespaceContainmentProbe = {
      available: false,
      diagnostic: "linux namespace containment supervisor is unavailable",
    });
  }
  const nonce = "0".repeat(64);
  try {
    const probe = spawnSync(
      python,
      ["-c", LINUX_NAMESPACE_OUTER_SUPERVISOR],
      {
        env: {
          NODE_ENV: process.env.NODE_ENV,
          TZUDONG_NS_NONCE: nonce,
          TZUDONG_NS_UNSHARE: launcher,
          TZUDONG_NS_PYTHON: python,
          TZUDONG_NS_INNER_B64: Buffer.from(
            LINUX_NAMESPACE_INIT_SUPERVISOR,
            "utf8",
          ).toString("base64"),
          TZUDONG_NS_TARGET_B64: Buffer.from(JSON.stringify(["/bin/true"]), "utf8").toString("base64"),
          TZUDONG_NS_DEADLINE_MILLISECONDS: "1500",
        },
        stdio: ["ignore", "ignore", "pipe"],
        maxBuffer: LINUX_NAMESPACE_PROBE_CAPTURE_BYTES,
        timeout: 3_000,
        shell: false,
      },
    );
    const completionCapture = Buffer.isBuffer(probe.stderr)
      ? probe.stderr
      : Buffer.alloc(0);
    const expectedCompletion = linuxNamespaceCompletionMarker(nonce);
    if (
      probe.status === 0 &&
      !probe.error &&
      !probe.signal &&
      completionCapture.equals(expectedCompletion)
    ) {
      return (linuxNamespaceContainmentProbe = {
        available: true,
        launcher,
        python,
        diagnostic: "",
      });
    }
  } catch {
    // Fall through to the bounded, trusted diagnostic below.
  }
  return (linuxNamespaceContainmentProbe = {
    available: false,
    diagnostic: "linux namespace containment preflight failed",
  });
}

export function __probeLinuxNamespaceContainmentForTests() {
  return probeLinuxNamespaceContainment();
}

async function terminateLinuxNamespaceScope(
  child: ReturnType<typeof spawn> | null,
  hasExited: () => boolean,
) {
  if (!child) {
    return { gone: false, diagnostic: "linux namespace containment handle is unavailable" };
  }
  if (hasExited()) return { gone: true, diagnostic: "" };

  const deadline = Date.now() + LINUX_NAMESPACE_TERMINATION_TIMEOUT_MS;
  const waitForExit = async (until: number) => {
    while (!hasExited() && remainingCleanupMs(until) > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS),
      );
    }
    return hasExited();
  };

  try {
    child.kill("SIGTERM");
  } catch {
    return { gone: false, diagnostic: "linux namespace supervisor termination failed" };
  }
  if (await waitForExit(deadline)) {
    return { gone: true, diagnostic: "" };
  }
  // A forced outer-supervisor exit cannot establish that PID 1 reaped every
  // namespace member, so it is deliberately reported as incomplete.
  try {
    child.kill("SIGKILL");
  } catch {
    return { gone: false, diagnostic: "linux namespace supervisor escalation failed" };
  }
  await waitForExit(deadline);
  return { gone: false, diagnostic: "linux namespace containment cleanup incomplete" };
}

function resolveStoryboardAgentRuntime(env: NodeJS.ProcessEnv = process.env) {
  const runtime = (
    env.STORYBOARD_AGENT_RUNTIME?.trim() ||
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
function resolveStoryboardAgentStreamDrainTimeoutMs() {
  const parsed = Number(process.env.STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS;
  return Math.min(
    MAX_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS,
    Math.max(MIN_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS, Math.floor(parsed)),
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
    accessSync(
      executable,
      executable.endsWith(".py") ? constants.R_OK : constants.X_OK,
    );
    return { ok: true, executable, args: [], source: "configured" };
  } catch {
    return { ok: false, reason: "command-not-executable" };
  }
}

function resolveDefaultStoryboardAgentRunnerCommand(
  runtime: StoryboardBackendAgentStatus["runtime"] = resolveStoryboardAgentRuntime(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedStoryboardAgentCommand {
  if (runtime !== "langgraph") {
    return { ok: false, reason: "auto-runner-runtime-disabled" };
  }
  if (env.STORYBOARD_AGENT_DISABLE_AUTO_RUNNER === "1") {
    return { ok: false, reason: "auto-runner-disabled" };
  }
  const executable = backendAgentPath(BACKEND_AGENT_RUNNER);
  if (!existsSync(executable)) {
    return { ok: false, reason: "auto-runner-missing" };
  }
  try {
    accessSync(executable, constants.R_OK);
    return { ok: true, executable, args: [], source: "auto_runner" };
  } catch {
    return { ok: false, reason: "auto-runner-not-readable" };
  }
}

function resolveEffectiveStoryboardAgentCommand(
  rawCommand?: string | null,
  runtime: StoryboardBackendAgentStatus["runtime"] = resolveStoryboardAgentRuntime(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedStoryboardAgentCommand {
  const configured = resolveStoryboardAgentCommand(rawCommand);
  if (configured.ok || rawCommand?.trim()) return configured;
  return resolveDefaultStoryboardAgentRunnerCommand(runtime, env);
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

export function isPythonRuntimeUnavailableDiagnostic(value: string | null | undefined) {
  return /enoent|executable not found in \$path|is not recognized as an internal or external command|cannot find the file specified|no such file or directory|python was not found|no python at|unable to create process/i.test(
    value ?? "",
  );
}

type PythonModuleProbeResult = {
  missingModules: string[];
  runtimeAvailable: boolean;
  runtimeError?: string;
};
function buildPythonProbeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed = new Set([
    "COMSPEC",
    "HOME",
    "PATH",
    "PATHEXT",
    "PYTHONHOME",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "VIRTUAL_ENV",
    "WINDIR",
  ]);
  const probeEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: env.NODE_ENV,
  };
  for (const [key, value] of Object.entries(env)) {
    if (allowed.has(key.toUpperCase()) && typeof value === "string" && value) {
      probeEnvironment[key] = value;
    }
  }
  return probeEnvironment;
}

async function probePythonModules(
  modules: string[] = REQUIRED_PYTHON_MODULES,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PythonModuleProbeResult> {
  const probeSource = [
    "import importlib.util, json",
    `mods = ${JSON.stringify(modules)}`,
    "missing = [mod for mod in mods if importlib.util.find_spec(mod) is None]",
    "print(json.dumps(missing))",
  ].join("\n");
  const script = `import base64;exec(base64.b64decode('${Buffer.from(probeSource, "utf8").toString("base64")}'))`;
  const pythonCommand = resolveStoryboardAgentPythonCommand(env);
  const result = await runStoryboardAgentCommand(
    {
      ok: true,
      executable: pythonCommand,
      args: ["-c", script],
      source: "configured",
    },
    {},
    {
      ...defaultProcessControl,
      commandTimeoutMs: 15_000,
    },
    {
      cwd: BACKEND_AGENT_ROOT,
      inheritEnv: false,
      env: {
        ...buildPythonProbeEnvironment(env),
        PYTHONPATH: [backendAgentPath("src"), env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
      },
    },
  );
  if (!result.ok) {
    const probeText = `${result.stdout}\n${result.stderr}`.trim();
    const fallbackMessage = result.timedOut
      ? "python dependency probe timed out"
      : isPythonRuntimeUnavailableDiagnostic(probeText)
        ? "python runtime is unavailable"
        : "python dependency probe failed closed";
    return {
      missingModules: [],
      runtimeAvailable: false,
      runtimeError: sanitizePublicAgentDiagnostic(
        probeText || fallbackMessage,
        600,
      ),
    };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim()) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (item) => typeof item !== "string" || !modules.includes(item),
      ) ||
      new Set(parsed).size !== parsed.length
    ) {
      return {
        missingModules: [],
        runtimeAvailable: false,
        runtimeError: "python dependency probe returned invalid output",
      };
    }
    return {
      missingModules: parsed as string[],
      runtimeAvailable: true,
    };
  } catch {
    return {
      missingModules: [],
      runtimeAvailable: false,
      runtimeError: "python dependency probe returned invalid output",
    };
  }
}
let pythonModuleProbeCache:
  | {
      key: string;
      result: Promise<PythonModuleProbeResult>;
    }
  | undefined;

function probePythonModulesCached(
  modules: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  const key = JSON.stringify({
    modules,
    python: resolveStoryboardAgentPythonCommand(env),
    path: getPathEnvironmentValue(env),
    pythonPath: env.PYTHONPATH ?? "",
    root: BACKEND_AGENT_ROOT,
  });
  if (pythonModuleProbeCache?.key === key) {
    return pythonModuleProbeCache.result;
  }
  const result = probePythonModules(modules, env);
  pythonModuleProbeCache = { key, result };
  return result;
}

export async function getStoryboardBackendAgentStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoryboardBackendAgentStatus> {
  const commandConfigured = Boolean(
    env.STORYBOARD_AGENT_COMMAND?.trim(),
  );
  const runtime = resolveStoryboardAgentRuntime(env);
  const commandResolution = resolveEffectiveStoryboardAgentCommand(
    env.STORYBOARD_AGENT_COMMAND,
    runtime,
    env,
  );
  const notebooks = BACKEND_AGENT_NOTEBOOKS.filter((notebook) =>
    existsSync(backendAgentPath(notebook)),
  );
  const graphEntrypoint = existsSync(backendAgentPath(BACKEND_AGENT_GRAPH))
    ? backendAgentPath(BACKEND_AGENT_GRAPH)
    : null;
  const pythonProbe =
    commandResolution.ok && runtime !== "codex_cli_oauth_legacy"
      ? await probePythonModulesCached(
          commandResolution.source === "auto_runner"
            ? REQUIRED_AUTO_RUNNER_PYTHON_MODULES
            : REQUIRED_PYTHON_MODULES,
          env,
        )
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
    mode: commandAvailable ? "command" : "local_adapter",
    rootPath: BACKEND_AGENT_ROOT,
    notebooks,
    graphEntrypoint,
    commandConfigured,
    commandAvailable,
    commandSource: commandResolution.ok ? commandResolution.source : undefined,
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

function stripStoryboardExecutionControls(value: string) {
  return value
    .replace(
      /(?:아직|지금은|우선|먼저|일단|당장은)?\s*(?:이미지|컷\s*이미지|스토리보드\s*이미지)[^.!?。]{0,48}(?:만들|생성|재생성|실행)\s*지?\s*(?:마|말고|마세요|말아|않|안\s*해|금지|중단|멈춰|나중)[^.!?。]*(?:[.!?。]|$)/gi,
      " ",
    )
    .replace(
      /(?:아직|지금은|우선|먼저|일단|당장은)?\s*(?:이미지|컷\s*이미지|스토리보드\s*이미지)(?:는|은|를|을)?[^.!?。]{0,48}(?:나중|다음에|추후|후에|아직)[^.!?。]{0,48}(?:만들|생성|재생성|실행|하자|할게|해|진행)?[^.!?。]*(?:[.!?。]|$)/gi,
      " ",
    )
    .replace(
      /(?:화면|캔버스)은?\s*(?:아직|지금은|우선|먼저|일단|당장은)?\s*(?:바꾸지|변경하지|수정하지)\s*않고[^.!?。]*(?:[.!?。]|$)/gi,
      " ",
    )
    .replace(
      /마음에\s*들면[^.!?。]{0,48}(?:스토리보드|컷|구성)?[^.!?。]{0,48}(?:생성|만들|반영)[^.!?。]*(?:됩니다|돼요|하세요|하면\s*됩니다)[^.!?。]*(?:[.!?。]|$)/gi,
      " ",
    )
    .replace(
      /(?:방향|아이디어|흐름)\s*만\s*(?:먼저\s*)?(?:추천|제안)\s*해\s*(?:줘|주세요|줘요)?/gi,
      "방향",
    )
    .replace(/(?:추천|제안)\s*해\s*(?:줘|주세요|줘요)/gi, "")
    .replace(
      /(?:스토리보드|컷|장면|구성|이미지)?\s*(?:생성|만들|구성|작성|뽑|실행)\s*(?:해\s*)?(?:줘|주세요|줘요|주라|줘라)/gi,
      " ",
    )
    .replace(/만들어\s*(?:줘|주세요|줘요|주라|줘라)/gi, " ")
    .replace(/(?:짜\s*줘|짜\s*주세요|뽑아\s*(?:줘|주세요|줘요)?)/gi, " ")
    .replace(/^(?:좋아|좋습니다|오케이|ㅇㅋ|okay|ok)[,\s]*/i, "")
    .replace(/^(?:그걸로|그\s*방향으로|이걸로)[,\s]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStoryboardChatPromptBrief(value: unknown) {
  const normalized = normalizeStoryboardChatRequirement(value);
  if (!normalized) return "";
  return stripStoryboardExecutionControls(normalized);
}

function normalizeStoryboardChatConversationContent(value: unknown) {
  const normalized = normalizeStoryboardChatRequirement(value);
  if (!normalized) return "";
  return stripStoryboardExecutionControls(normalized).slice(
    0,
    STORYBOARD_CHAT_CONVERSATION_CONTENT_LIMIT,
  );
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
  const sceneNos = Array.isArray(candidate.sceneNos)
    ? candidate.sceneNos
        .map((sceneNo) => Number(sceneNo))
        .filter((sceneNo) => Number.isFinite(sceneNo) && sceneNo >= 1 && sceneNo <= 99)
        .slice(0, 12)
    : [];
  if (!kind || !label || !promptContext) return null;
  return {
    kind,
    label,
    detail,
    promptContext,
    sceneNo: Number.isFinite(candidate.sceneNo)
      ? Number(candidate.sceneNo)
      : sceneNos[0],
    ...(sceneNos.length ? { sceneNos } : {}),
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

function normalizeStoryboardChatThreadId(value: unknown) {
  return typeof value === "string"
    ? sanitizePublicAgentText(value).replace(/[^\w:.-]/g, "").slice(0, 120)
    : "";
}

function isStoryboardConversationReadbackMessage(
  message: StoryboardChatConversationMessage,
) {
  if (message.role === "user") return false;

  return (
    message.id?.startsWith("assistant-history-load") ||
    message.content.includes("공용 기본 스토리보드") ||
    message.content.startsWith("선택한 스토리보드를 불러왔어요") ||
    message.content.startsWith("준비된 스토리보드를 불러왔어요")
  );
}

function normalizeStoryboardChatConversationMessages(
  value: unknown,
): StoryboardChatConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item): StoryboardChatConversationMessage[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const candidate = item as Partial<StoryboardChatConversationMessage>;
      const role =
        candidate.role === "user" || candidate.role === "assistant"
          ? candidate.role
          : null;
      const content = normalizeStoryboardChatConversationContent(
        candidate.content,
      );
      if (!role || !content) return [];
      const id = normalizeStoryboardChatThreadId(candidate.id);
      const message: StoryboardChatConversationMessage = {
        role,
        content,
        ...(id ? { id } : {}),
        ...(typeof candidate.createdAt === "string"
          ? { createdAt: candidate.createdAt.slice(0, 80) }
          : {}),
      };
      return isStoryboardConversationReadbackMessage(message) ? [] : [message];
    })
    .slice(-STORYBOARD_CHAT_CONVERSATION_CONTEXT_LIMIT);
}

function formatStoryboardChatConversationContext(
  messages: StoryboardChatConversationMessage[],
) {
  if (!messages.length) return "";
  return messages
    .map((message, index) => {
      const roleLabel = message.role === "user" ? "사용자" : "도우미";
      return `${index + 1}. ${roleLabel}: ${message.content}`;
    })
    .join(" / ");
}

function formatStoryboardChatConversationBrief(
  messages: StoryboardChatConversationMessage[],
) {
  if (!messages.length) return "";
  return messages
    .map((message) => message.content)
    .filter(Boolean)
    .join(" ")
    .slice(0, STORYBOARD_CHAT_CONVERSATION_CONTENT_LIMIT * 2);
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

function hasStoryboardFullGenerationNegation(message: string) {
  const compact = message.replace(/[\s!?.,。~…]+/g, "").toLowerCase();
  return (
    /^(하지마|하지말아|생성하지마|생성하지말아|만들지마|만들지말아|구성하지마|구성하지말아|생성금지|멈춰|중단|stop|cancel)$/.test(compact) ||
    /(?:스토리보드|컷|cut|장면|구성|흐름|전체)[^.!?\n]{0,36}(?:생성|만들|구성|작성|뽑|실행|반영)\s*지?\s*(?:마|말|말고|마세요|말아|않|안\s*해|금지|중단|멈춰)/i.test(
      message,
    )
  );
}

function hasStoryboardImageGenerationNegation(message: string) {
  return (
    /(?:이미지|컷\s*이미지|스토리보드\s*이미지)[^.!?\n]{0,36}(?:만들|생성|재생성|실행)\s*지?\s*(?:마|말|말고|마세요|말아|않|안\s*해|금지|중단|멈춰|나중)/i.test(
      message,
    ) ||
    /(?:이미지|컷\s*이미지|스토리보드\s*이미지)(?:는|은|를|을)?[^.!?\n]{0,28}(?:나중|다음에|추후|후에|아직)[^.!?\n]{0,28}(?:만들|생성|재생성|실행|하자|할게|해|진행)?/i.test(
      message,
    ) ||
    /(?:이미지|컷\s*이미지|스토리보드\s*이미지)\s*(?:없이|빼고|제외|나중|아직\s*말고|필요\s*없)/i.test(
      message,
    )
  );
}

function wantsStoryboardGeneration(message: string) {
  if (hasUnsafeStoryboardInstructionRequest(message)) return false;
  if (hasStoryboardFullGenerationNegation(message)) return false;
  const explicitCommand =
    /(?:생성|만들|구성|작성|뽑|실행)\s*(?:해\s*)?(?:줘|주세요|줘요|주라|줘라)/i.test(message) ||
    /(?:짜\s*줘|짜\s*주세요|만들어\s*(?:줘|주세요|줘요|주라|줘라)|뽑아\s*(?:줘|주세요|줘요|주라|줘라)?|반영해\s*(?:줘|주세요|줘요)?)/i.test(message);
  if (explicitCommand) return true;
  if (hasStoryboardImageGenerationNegation(message)) return false;
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
function isStoryboardRagProcessQuestionLike(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized) return false;
  if (wantsStoryboardGeneration(normalized) || wantsStoryboardReset(normalized)) {
    return false;
  }

  return (
    /(?:rag|r\.a\.g|검색\s*과정|retrieval|retrieve|랭스미스|langsmith|trace|추적|컨텍스트|contextual|임베딩|embedding|리랭커|reranker|bge|llava|캡셔닝|captioning|ollama|올라마|exaone|eeve|qwen|solar|모델\s*스택|model\s*stack)/i.test(
      normalized,
    ) &&
    /(?:과정|작동|동작|보여|알려|설명|왜|어떻게|무슨|뭐|무엇|trace|추적|stack|스택|model|모델|langsmith|랭스미스|\?)/i.test(
      normalized,
    )
  );
}


function hasStoryboardMutationCommand(message: string) {
  return (
    !isStoryboardRagProcessQuestionLike(message) &&
    (wantsStoryboardGeneration(message) ||
      wantsStoryboardReset(message) ||
      /(?:수정|변경|바꿔|바꿔줘|고쳐|보완|짧게|줄여|재생성|다시\s*생성|보여줘|이동|가줘|열어|선택|포커스|focus|show|open)/i.test(
        message,
      ))
  );
}

function isStoryboardRuntimeMetaQuestion(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized || hasStoryboardMutationCommand(normalized)) return false;
  if (isStoryboardRagProcessQuestionLike(normalized)) return true;
  const hasMetaSubject =
    /(?:rag|r\.a\.g|검색|검색\s*과정|retrieval|retrieve|랭스미스|langsmith|trace|추적|컨텍스트|contextual|캡셔닝|captioning|llava|ollama|올라마|exaone|eeve|qwen|solar|임베딩|embedding|리랭커|reranker|rerank|bge|모델|model|gpt|openai|langgraph|랭그래프|그래프|graph|에이전트|agent|supervisor|researcher|intern|designer|로컬\s*어댑터|폴백|fallback|런타임|runtime|브릿지|bridge|프로세스|process|메모리|memory|node\.?exe|bun\.?exe)/i.test(
      normalized,
    );
  const hasQuestionIntent =
    /(?:사용|쓰|붙|지원|동작|연결|상태|어떤|무슨|뭐|무엇|가능|되나|되나요|돼|돼요|인가|인지|알려|설명|왜|어떻게|\?)/i.test(
      normalized,
    );
  return hasMetaSubject && hasQuestionIntent;
}

function isStoryboardAttachmentCapabilityQuestion(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized || hasStoryboardMutationCommand(normalized)) return false;
  return (
    /(?:사진|첨부|업로드|reference|레퍼런스|참고\s*이미지)/i.test(
      normalized,
    ) &&
    /(?:가능|지원|되나|되나요|돼|돼요|어떻게|방법|어디|알려|설명|\?)/i.test(
      normalized,
    )
  );
}

function hasStoryboardDirectPatchCommandLanguage(message: string) {
  return /(?:수정|변경|바꿔|바꿔줘|고쳐|보완|짧게|줄여|교체|재작성|다시\s*써|반영해|반영해\s*줘)/i.test(
    message,
  );
}

function isStoryboardSuggestionConversation(message: string) {
  if (/(검토|리뷰|평가|피드백)/i.test(message)) return false;
  if (
    hasStoryboardDirectPatchCommandLanguage(message) &&
    !/(?:추천|아이디어|예시|후보|방법|어떻게|어떤|뭐가\s*좋)/i.test(message)
  ) {
    return false;
  }
  if (
    /(?:스토리보드|컷|cut|장면|구성|흐름).*(?:생성해|생성\s*해|만들어|구성해|작성해|반영해|짜줘|짜\s*줘|뽑아)/i.test(
      message,
    ) ||
    /(?:생성해|생성\s*해|만들어|구성해|작성해|반영해|짜줘|짜\s*줘|뽑아).*(?:스토리보드|컷|cut|장면|구성|흐름)/i.test(
      message,
    )
  ) {
    return false;
  }
  return (
    /(?:추천|아이디어|메뉴|소재|주제|컨셉|방향|흐름|분위기|스타일|톤|무드|레퍼런스|자막|문구|카피|오디오|멘트|대사|나레이션|후킹|훅|샷|장면|비주얼|맛|식감|조명|색감).*(?:해줘|줘|있|좋|어때|뭐|궁금|알려|추천|예시|후보)/i.test(message) ||
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
  return /(?:자막|subtitle|문구|카피|caption|오디오|멘트|대사|나레이션|이미지|컷|cut|스토리보드|PNG|저장|다운로드|복사|장면|음식|구도|화면|비주얼|리액션|표정|훅|맛있|먹음직|식감|조명|색감|분위기|톤|무드)/i.test(message);
}

export function isGeneralStoryboardConversationMessage(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized || isCasualStoryboardChatMessage(normalized)) return false;

  const compact = normalized.replace(/[\s!?.,。~…]+/g, "").toLowerCase();
  if (hasUnsafeStoryboardInstructionRequest(normalized)) return true;

  if (/^(고마워|고맙|감사|감사해|땡큐|thanks|thankyou|ok|okay|ㅇㅋ|오케이|좋아|좋습니다|괜찮아|ㅋㅋ+|ㅎㅎ+|굿|nice)$/.test(compact)) {
    return true;
  }

  if (/^(멈춰|중단|취소|그만|stop|cancel)$/.test(compact)) {
    return true;
  }

  if (/(뭐\s*할\s*수|무엇을\s*할\s*수|사용법|도움말|도와줘|처음(?:인데|이면)?|시작(?:하려면|하는\s*법)?|뭘\s*입력|무슨\s*말|help|what can you do|how do i use)/i.test(normalized)) {
    return true;
  }

  if (/(?:오류|에러|실패|안\s*돼|안됨|문제|멈췄|느려|느림|작동|권한|permission|denied|clipboard|클립보드|복사).*(?:왜|뭐|어떻게|가능|해결|확인|알려|설명|\?)/i.test(normalized)) {
    return true;
  }

  if (
    isStoryboardRuntimeMetaQuestion(normalized) ||
    isStoryboardAttachmentCapabilityQuestion(normalized)
  ) {
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
  if (/^(과정|이유|왜|근거|추적|trace|rag|랭스미스|langsmith|why|how)$/.test(compact)) {
    return true;
  }
  return /(왜\s*(?:이렇게|이런|이 컷|이 장면|이 순서|나왔|됐|선택|골랐)|어떻게\s*(?:만들|구성|나왔)|이유가\s*뭐|무슨\s*근거|어떤\s*과정|선택\s*이유|근거.*(?:뭐|알려|설명)|rag|r\.a\.g|검색\s*과정|retrieval|랭스미스|langsmith|trace|추적|why|how)/i.test(
    normalized,
  );
}

function wantsStoryboardReviewOnly(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized) return false;
  if (isStoryboardRagProcessQuestionLike(normalized)) return false;
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
  const conversationMessages = normalizeStoryboardChatConversationMessages(
    request.conversationMessages,
  );
  const conversationText =
    formatStoryboardChatConversationContext(conversationMessages);
  const conversationBrief =
    formatStoryboardChatConversationBrief(conversationMessages);
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
  const promptBrief = normalizeStoryboardChatPromptBrief(normalized);
  const normalizedWithFocus = normalizeStoryboardChatRequirement(
    [
      promptBrief,
      conversationBrief,
      shouldIncludeFocusContext && focusText ? focusText : "",
      imageAttachmentText,
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

function isStoryboardRagProcessQuestion(message: string) {
  const normalized = normalizeStoryboardChatRequirement(message);
  if (!normalized) return false;
  return /(?:rag|r\.a\.g|검색\s*과정|retrieval|retrieve|랭스미스|langsmith|trace|추적|컨텍스트|contextual|임베딩|embedding|리랭커|reranker|bge|llava|캡셔닝|captioning|ollama|올라마|exaone|eeve|qwen|solar|모델\s*스택|model\s*stack)/i.test(
    normalized,
  );
}

function createStoryboardChatRagTraceEntry(
  id: string,
  label: string,
  detail: string,
): StoryboardThinkingTraceEntry {
  return {
    id,
    label,
    status: "done",
    detail,
    timestamp: new Date().toISOString(),
  };
}

function buildStoryboardChatRagTraceEntries({
  message,
  shouldGenerate,
  shouldGenerateImages,
  conversationTurnCount,
  imageAttachmentCount,
}: {
  message: string;
  shouldGenerate: boolean;
  shouldGenerateImages: boolean;
  conversationTurnCount: number;
  imageAttachmentCount: number;
}): StoryboardThinkingTraceEntry[] {
  const modelStack = buildStoryboardRagModelStackDiagnostics();
  const profileTraceDetail = buildStoryboardRagProfileTraceDetail(modelStack.executionProfile);
  const requiredModelIds = modelStack.models.map((model) => model.id);
  return [
    createStoryboardChatRagTraceEntry(
      "rag-policy",
      "RAG 정책 확인",
      `LangSmith 대신 채팅 말풍선 trace에 공개합니다 · 모든 RAG 모델은 required live stack으로 실행하며 누락 시 생성이 실패합니다.`,
    ),
    createStoryboardChatRagTraceEntry(
      "rag-execution-profile",
      "현재 실행 프로파일",
      profileTraceDetail,
    ),
    createStoryboardChatRagTraceEntry(
      "rag-model-stack",
      "모델 스택 등록",
      `${modelStack.models.length}개 필수 모델 역할: ${requiredModelIds.join(", ")}`,
    ),
    createStoryboardChatRagTraceEntry(
      "rag-contextual-retrieval",
      "Contextual Retrieval",
      `a.x-4.0-light-imatrix:Q8_0로 요청/대화 ${conversationTurnCount}개/첨부 ${imageAttachmentCount}개의 contextual retrieval 문맥을 생성해야 합니다.`,
    ),
    createStoryboardChatRagTraceEntry(
      "rag-embedding-rerank",
      "Embedding · Rerank",
      "BAAI/bge-m3 dense/sparse와 BAAI/bge-reranker-v2-m3는 필수 검색 경로입니다. 모델·RPC·rerank 근거가 없으면 fail-closed 처리합니다.",
    ),
    createStoryboardChatRagTraceEntry(
      "rag-caption-judge",
      "Captioning · Judge",
      "LLaVA-NeXT-Video-7B-hf와 Gemini/OpenAI/Ollama judge 계열은 필수 caption/judge 후보입니다. 사용 근거가 없으면 성공으로 표시하지 않습니다.",
    ),
    createStoryboardChatRagTraceEntry(
      "rag-decision",
      "채팅 반영 결정",
      shouldGenerate
        ? shouldGenerateImages
          ? `RAG 추적 후 스토리보드 구성과 CUT 이미지 생성을 이어갈 수 있음 · 요청: ${message.slice(0, 90)}`
          : `RAG 추적 후 컷 구성만 반영하고 이미지 생성은 생략 · 요청: ${message.slice(0, 90)}`
        : `화면 변경 없이 RAG/채팅 답변 또는 부분 수정으로 처리 · 요청: ${message.slice(0, 90)}`,
    ),
    createStoryboardChatRagTraceEntry(
      "rag-steer-contract",
      "중간 Steer 계약",
      "사용자가 답변 중 새 메시지를 보내면 현재 스트림을 중단하고 새 요청으로 재실행해 이전 trace를 숨기지 않고 이어서 기록",
    ),
  ];
}

function buildStoryboardConversationMessage(message: string, forceSafety = false) {
  const raw = typeof message === "string" ? message : "";
  const normalized = normalizeStoryboardChatRequirement(message);
  const compact = normalized.replace(/[\s!?.,。~…]+/g, "").toLowerCase();
  if (
    forceSafety ||
    hasUnsafeStoryboardInstructionRequest(raw) ||
    hasUnsafeStoryboardInstructionRequest(normalized)
  ) {
    return [
      "안전상 운영 지시, 비밀값, 내부 상태 삭제 요청은 처리하지 않아요.",
      "화면은 바꾸지 않고, 스토리보드 주제·CUT 구성·자막·오디오·이미지 진행 상태처럼 작업에 필요한 범위만 도와드릴게요.",
    ].join(" ");
  }

  if (/(고마워|고맙|감사|땡큐|thanks|thank)/i.test(message)) {
    return [
      "천만에요. 지금 화면은 그대로 두고 대화만 이어갈게요.",
      "필요하면 특정 CUT 수정, 전체 생성, 이미지 상태 확인까지 이어서 도와드릴 수 있어요.",
    ].join(" ");
  }

  if (/^(멈춰|중단|취소|그만|stop|cancel)$/.test(compact)) {
    return [
      "중단 요청으로 이해했어요. 지금 말풍선 답변에서는 화면을 바꾸지 않을게요.",
      "이미지 생성이나 채팅 스트림이 진행 중일 때는 입력창 오른쪽 중지 버튼으로 현재 작업을 멈출 수 있어요.",
    ].join(" ");
  }

  if (/(뭐\s*할\s*수|무엇을\s*할\s*수|사용법|도움말|도와줘|처음(?:인데|이면)?|시작(?:하려면|하는\s*법)?|뭘\s*입력|무슨\s*말|help|what can you do|how do i use|너.*(?:누구|뭐야|무엇|가능|할 수|답변|대화)|도우미.*(?:누구|뭐야|무엇|가능|할 수|답변|대화)|챗봇.*(?:누구|뭐야|무엇|가능|할 수|답변|대화))/i.test(normalized)) {
    return [
      "저는 이 스토리보드 화면을 보면서 대화하는 도우미예요.",
      "일반 질문에는 화면을 바꾸지 않고 답하고, “3컷 자막 짧게”, “이미지 다시 생성”, “10컷으로 생성해줘”처럼 말하면 필요한 작업만 화면에 반영할게요.",
    ].join(" ");
  }

  if (isStoryboardRagProcessQuestion(normalized)) {
    return [
      "RAG 작동 과정 질문으로 이해했어요. 화면은 바꾸지 않고 현재 구조만 설명할게요.",
      "LangSmith 대신 답변 말풍선의 “생각 중 · RAG 추적” 패널에 정책, 모델 스택, contextual retrieval, embedding/rerank, caption/judge, 화면 반영 결정을 단계별로 남깁니다.",
      buildStoryboardRagProfileTraceDetail(buildStoryboardRagModelStackDiagnostics().executionProfile),
      "스토리보드 생성/RAG 경로는 a.x-4.0-light-imatrix:Q8_0, BAAI/bge-m3 dense/sparse, BAAI/bge-reranker-v2-m3, LLaVA-NeXT-Video-7B-hf, Gemini/OpenAI OAuth, Ollama judge 모델(exaone3.5:7.8b, EEVE-Korean-Instruct-10.8B, qwen3:8b, solar:10.7b-instruct-v1-q5_0)을 required provider로 다룹니다. 필요한 worker·모델·OAuth가 없으면 성공처럼 꾸미지 않고 fail-closed로 중단합니다.",
      "실패 trace에는 cause code, 한국어 설명, 중단 단계, 다음 조치를 함께 남기며, 답변이 나오는 중 새 메시지를 보내면 현재 스트림을 멈추고 새 요청으로 다시 실행해 Steer로 처리합니다.",
    ].join(" ");
  }

  if (/(?:오류|에러|실패|안\s*돼|안됨|문제|멈췄|느려|느림|작동|권한|permission|denied|clipboard|클립보드|복사).*(?:왜|뭐|어떻게|가능|해결|확인|알려|설명|\?)/i.test(normalized)) {
    return [
      "문제 확인 질문으로 이해했어요. 화면은 바꾸지 않고 점검 순서만 안내할게요.",
      "먼저 로컬 브릿지 연결 아이콘, 이미지 라우터 설정, 브라우저 권한을 확인하세요. 복사 실패는 클립보드 권한이나 포커스 상태 때문에 생길 수 있어 다시 눌러도 실패하면 브라우저 권한을 확인하는 흐름이 안전합니다.",
    ].join(" ");
  }
  if (/(?:임베딩|embedding|리랭커|reranker|rerank|bge|모델|model|gpt|openai)/i.test(normalized)) {
    return [
      "모델 사용 여부 질문으로 이해했어요. 화면은 바꾸지 않고 현재 구조 기준으로 답할게요.",
      "현재 구조는 Python RAG worker가 BAAI/bge-m3 임베딩과 BAAI/bge-reranker-v2-m3 재정렬을 담당합니다. worker/model/OAuth가 준비되지 않으면 로컬 키워드 결과를 모델 사용처럼 표시하지 않고 오류로 중단합니다.",
    ].join(" ");
  }

  if (
    !isStoryboardSuggestionConversation(normalized) &&
    /(?:langgraph|랭그래프|그래프|graph|에이전트|agent|supervisor|researcher|intern|designer|로컬\s*어댑터|폴백|fallback)/i.test(
      normalized,
    )
  ) {
    return [
      "에이전트 구조 질문으로 이해했어요. 화면은 바꾸지 않고 구조만 설명할게요.",
      "정식 경로는 Supervisor가 Researcher·Intern·Designer 역할을 나눠 지시하고, 로컬 폴백도 같은 상태 이름과 감사 이벤트를 남겨 캔버스 결과가 그래프 흐름을 따라갔는지 확인할 수 있게 설계되어 있습니다.",
    ].join(" ");
  }

  if (isStoryboardAttachmentCapabilityQuestion(normalized)) {
    return [
      "사진 첨부 질문으로 이해했어요. 화면은 바꾸지 않고 사용 방법만 안내할게요.",
      "입력창의 + 버튼에서 참고 이미지를 첨부할 수 있고, 첨부 이미지는 스토리보드 방향이나 특정 CUT 수정 요청의 맥락으로만 요약해서 사용합니다.",
    ].join(" ");
  }

  if (/(?:재생성|다시\s*생성|다시\s*만들|이미지.*다시).*(?:방법|어떻게|알려|설명)|(?:방법|어떻게).*(?:재생성|다시\s*생성|다시\s*만들|이미지)/i.test(normalized)) {
    return [
      "이미지 다시 만들기 방법 질문으로 이해했어요. 지금은 화면을 바꾸지 않고 안내만 드릴게요.",
      "특정 CUT을 선택한 뒤 “현재 컷 이미지만 다시 생성해줘”라고 입력하면 그 컷만 다시 만들고, 전체를 새로 만들고 싶으면 “전체 이미지 다시 생성해줘”처럼 말하면 됩니다.",
    ].join(" ");
  }

  if (/(?:장면|음식|구도|화면|비주얼|리액션|표정|맛있|먹음직|식감|조명|색감|분위기|톤|무드).*(?:잘\s*보|괜찮|어때|방법|어떻게|\?)/i.test(normalized)) {
    return [
      "시각 확인 질문으로 이해했어요. 지금은 선택한 CUT을 수정하지 않고 기준만 설명할게요.",
      "음식은 첫눈에 메뉴가 구분되고, 손동작이나 젓가락이 맛 포인트를 가리지 않으며, 자막 영역과 겹치지 않으면 안정적으로 보입니다.",
    ].join(" ");
  }

  if (/(?:자막|문구|카피|오디오|멘트|대사|나레이션|후킹|훅).*(?:추천|예시|후보|아이디어|몇\s*개|뭐가\s*좋)/i.test(normalized)) {
    return [
      "후보 요청으로 이해했어요. 지금은 선택한 CUT을 수정하지 않고 말풍선으로만 제안할게요.",
      "짧은 자막은 기대감, 메뉴명, 첫 입 반응, 조합 포인트처럼 한 가지 정보만 담는 편이 좋아요. 마음에 드는 후보가 있으면 그 문구로 바꿔달라고 이어서 말해 주세요.",
    ].join(" ");
  }

  if (
    /(?:추천|아이디어|메뉴|소재|주제|컨셉|방향|흐름|분위기|스타일|톤|무드|레퍼런스|자막|문구|카피|오디오|멘트|대사|나레이션|후킹|훅|샷|장면|비주얼|맛|식감|조명|색감).*(?:해줘|줘|있|좋|어때|뭐|궁금|알려|추천|예시|후보)/i.test(normalized) ||
    /(?:뭐\s*먹(?:지|을까|으면|을지)?|무슨\s*메뉴|어떤\s*(?:주제|소재|컨셉|방향)).*(?:좋|추천|있|어때|\?)/i.test(normalized)
  ) {
    return [
      "좋아요. 화면은 아직 바꾸지 않고 아이디어만 드릴게요.",
      "먹방 흐름이라면 매운 메뉴 도전, 시장 골목 코스, 해산물 한상, 디저트 투어처럼 첫 CUT에서 기대감을 만들기 쉬운 주제가 잘 맞아요.",
      "마음에 드는 방향을 고르면 그때 스토리보드로 생성해도 됩니다.",
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
  const rawMessage = typeof request.message === "string" ? request.message : "";
  const isRawSafetyConversation =
    hasUnsafeStoryboardInstructionRequest(rawMessage);
  const normalizedMessage = normalizeStoryboardChatRequirement(request.message);
  if (!normalizedMessage) {
    throw new Error("채팅 요구사항을 입력하세요.");
  }

  const canvasPatch = createStoryboardChatCanvasPatch(
    isRawSafetyConversation ? { ...request, message: "" } : request,
  );
  const focusContext = normalizeStoryboardChatFocusContext(
    request.focusContext,
  );
  const focusText = formatStoryboardChatFocusContext(focusContext);
  const imageAttachments = normalizeStoryboardChatImageAttachments(
    request.imageAttachments,
  );
  const imageAttachmentText =
    formatStoryboardChatImageAttachmentSummary(imageAttachments);
  const conversationMessages = normalizeStoryboardChatConversationMessages(
    request.conversationMessages,
  );
  const conversationText =
    formatStoryboardChatConversationContext(conversationMessages);
  const chatThreadId =
    normalizeStoryboardChatThreadId(request.chatThreadId) ||
    `storyboard-chat-${Date.now().toString(36)}`;
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
  const status = await getStoryboardBackendAgentStatus()
  const isSafetyConversation =
    isRawSafetyConversation ||
    hasUnsafeStoryboardInstructionRequest(normalizedMessage);
  const shouldReset =
    !isSafetyConversation && wantsStoryboardReset(normalizedMessage);
  const isReviewOnly = wantsStoryboardReviewOnly(normalizedMessage);
  const isCasualChat = isCasualStoryboardChatMessage(normalizedMessage);
  const isGeneralConversation =
    isSafetyConversation ||
    (!isReviewOnly && isGeneralStoryboardConversationMessage(normalizedMessage));
  const shouldRegenerateSelectedSceneImage = Boolean(
    canvasPatch.scenePatch?.regenerateImage,
  );
  const shouldGenerate =
    !isSafetyConversation &&
    wantsStoryboardGeneration(normalizedMessage) &&
    !shouldReset &&
    !isGeneralConversation &&
    !isReviewOnly &&
    !shouldRegenerateSelectedSceneImage;
  const shouldGenerateImages =
    shouldGenerate && !hasStoryboardImageGenerationNegation(normalizedMessage);
  const runtime = status.runtime ?? DEFAULT_STORYBOARD_AGENT_RUNTIME;
  const model = status.codexModel ?? resolveStoryboardAgentCodexModel(env);
  const effort = status.codexEffort ?? resolveStoryboardAgentCodexEffort(env);
  const safeNormalizedMessage = sanitizeStoryboardPublicText(normalizedMessage);
  const ragTrace = buildStoryboardChatRagTraceEntries({
    message: safeNormalizedMessage,
    shouldGenerate,
    shouldGenerateImages,
    conversationTurnCount: conversationMessages.length,
    imageAttachmentCount: imageAttachments.length,
  });

  return {
    assistantMessage: isCasualChat
      ? [
          "안녕하세요! 스토리보드 도우미입니다.",
          "화면은 바꾸지 않고 사용 방법만 안내할게요.",
          "원하는 음식이나 장면, 컷 수, 꼭 보여주고 싶은 순간을 적어 주면 바로 스토리보드를 만들 수 있어요.",
          "예시가 필요하면 “예시 만들기”를 누르거나, 바로 만들려면 “생성해줘”라고 입력하세요.",
        ].join(" ")
      : isSafetyConversation
      ? buildStoryboardConversationMessage(rawMessage || normalizedMessage, true)
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
          conversationText
            ? `최근 대화 ${conversationMessages.length}개도 참고했어요.`
            : null,
          shouldRegenerateSelectedSceneImage
            ? "현재 선택한 컷의 이미지만 다시 만들 준비를 했어요."
            : null,
          shouldGenerate
            ? shouldGenerateImages
              ? "이어서 실제 스토리보드 만들기와 CUT 이미지 생성까지 진행할게요."
              : "이어서 컷 구성만 먼저 화면에 반영하고 이미지는 만들지 않을게요."
            : "바로 만들고 싶으면 “생성해줘”라고 입력하세요.",
        ]
          .filter(Boolean)
          .join(" · "),
    canvasPatch,
    shouldGenerate,
    shouldGenerateImages,
    shouldReset,
    backendAgent: {
      mode: status.mode,
      runtime,
      concept: `${canvasPatch.segmentCount}컷 스토리보드 채팅 요구사항을 실제 히트맵 기반 생성 요청으로 정리`,
      layoutBrief: `좌측 2×2 캔버스 페이지에 ${canvasPatch.tone} 톤으로 ${canvasPatch.targetLengthMinutes}분 분량의 컷 흐름을 반영`,
      promptAddendum: [
        "Storyboard chat agent task.",
        `User chat request: ${safeNormalizedMessage}`,
        conversationText ? `Conversation context: ${conversationText}` : "",
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
        chatThreadId,
        conversationTurnCount: conversationMessages.length,
        conversationSummary: conversationText,
        checkpointScope: "response_payload_state",
        langGraphResumeContract:
          "chatThreadId and bounded conversationMessages are forwarded so future Command(resume=...) integration can bind UI turns to a graph thread without trusting hidden client instructions.",
        ragTrace,
        ragTraceSurface: "storyboard_chat_thinking_panel",
        ragTraceSteerContract:
          "mid-stream user message aborts the current SSE turn and replays as a new steer request",
        imageGenerationAction: shouldGenerateImages
          ? "auto_generate_after_storyboard"
          : shouldGenerate
            ? "skip_image_generation_by_user_directive"
            : "none",
        imageAttachmentCount: imageAttachments.length,
        chatIntent: isCasualChat
          ? "casual_chat"
          : isSafetyConversation
            ? "safety"
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

type StoryboardCommandRunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  inheritEnv?: boolean;
  testCommandCapability?: StoryboardAgentTestCommandCapability;
};

export type StoryboardBackendAgentExecutionOptions = {
  env?: NodeJS.ProcessEnv;
  testCommandCapability?: StoryboardAgentTestCommandCapability;
};


export function createStoryboardAgentTestCommandCapability(
  commandPath: string,
  fixture: string,
): StoryboardAgentTestCommandCapability {
  const command = resolveStoryboardAgentCommand(commandPath);
  if (!command.ok || !fixture.trim()) {
    throw new Error("invalid storyboard test fixture command binding");
  }

  return createBoundStoryboardAgentTestCommandCapability({
    executable: path.resolve(command.executable),
    args: [...command.args],
    fixture,
  });
}

function isTrustedLangGraphFixtureCommand(
  command: Extract<ResolvedStoryboardAgentCommand, { ok: true }>,
  capability: StoryboardAgentTestCommandCapability | undefined,
) {
  const binding = capability
    ? getStoryboardAgentTestCommandBinding(capability)
    : undefined;
  if (!binding || !binding.fixture) return false;
  if (binding.executable !== path.resolve(command.executable)) return false;
  if (binding.args.length !== command.args.length) return false;
  return binding.args.every((arg, index) => arg === command.args[index]);
}


function runStoryboardAgentCommand(
  command: Extract<ResolvedStoryboardAgentCommand, { ok: true }>,
  payload: Record<string, unknown>,
  processControl: ProcessControl = defaultProcessControl,
  options: StoryboardCommandRunOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const timeoutMs =
      processControl.commandTimeoutMs ?? resolveStoryboardAgentTimeoutMs();
    const streamDrainTimeoutMs =
      processControl.streamDrainTimeoutMs ??
      resolveStoryboardAgentStreamDrainTimeoutMs();
    const fixtureBinding = options.testCommandCapability
      ? getStoryboardAgentTestCommandBinding(options.testCommandCapability)
      : undefined;
    const effectiveCommand = command;
    const shouldUseConfiguredPython = effectiveCommand.executable.endsWith(".py");
    const shouldUseShellScriptOnWindows =
      processControl.platform === "win32" && effectiveCommand.executable.endsWith(".sh");
    const shellScriptRunner = shouldUseShellScriptOnWindows
      ? resolveWindowsShellScriptRunner()
      : null;
    const executable = shouldUseConfiguredPython
      ? resolveStoryboardAgentPythonCommand(options.env)
      : shellScriptRunner ?? effectiveCommand.executable;
    const args =
      shouldUseConfiguredPython || shouldUseShellScriptOnWindows
        ? [effectiveCommand.executable, ...effectiveCommand.args]
        : effectiveCommand.args;
    const shouldUseWindowsCommandShell =
      processControl.platform === "win32" &&
      /\.(?:cmd|bat)$/i.test(executable.trim());
    const windowsCommandSpec = shouldUseWindowsCommandShell
      ? buildWindowsCommandShellSpec(executable, args)
      : null;
    const commandCwd =
      options.cwd ??
      (existsSync(/* turbopackIgnore: true */ BACKEND_AGENT_ROOT)
        ? BACKEND_AGENT_ROOT
        : getRuntimeCwd());
    const commandEnv = buildStoryboardAgentEnvironment(
      payload,
      options.env,
      processControl.platform,
      options.inheritEnv !== false,
    );
    const deadlineEpochMs = Date.now() + timeoutMs;
    const windowsSupervisorCleanupDeadlineEpochMs =
      deadlineEpochMs + WINDOWS_JOB_SUPERVISOR_CLEANUP_GRACE_MS;
    const remainingDeadlineMs = () => Math.max(0, deadlineEpochMs - Date.now());
    const unsafeWindowsLaunch =
      processControl.platform === "win32" &&
      [executable, commandCwd, ...args].some(hasUnsafeWindowsCommandText);
    const isNativeProcessControl =
      processControl.platform === process.platform &&
      processControl.spawnProcess === spawn;
    const trustedLangGraphFixture = isTrustedLangGraphFixtureCommand(
      effectiveCommand,
      options.testCommandCapability,
    );
    if (trustedLangGraphFixture && fixtureBinding) {
      commandEnv.STORYBOARD_AGENT_LANGGRAPH_FIXTURE = fixtureBinding.fixture;
      commandEnv.STORYBOARD_AGENT_TEST_FIXTURE_CAPABILITY =
        STORYBOARD_AGENT_TEST_FIXTURE_CAPABILITY;
    }
    if (trustedLangGraphFixture && isNativeProcessControl && processControl.platform !== "win32") {
      const synchronousResult = spawnSync(executable, args, {
        cwd: commandCwd,
        env: commandEnv,
        input: JSON.stringify(payload),
        encoding: "utf8",
        maxBuffer: MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES * 2,
        shell: false,
        timeout: timeoutMs,
      });
      const syncStdoutCapture: DiagnosticCapture = {
        value: "",
        byteCount: 0,
        truncated: false,
      };
      const syncStderrCapture: DiagnosticCapture = {
        value: "",
        byteCount: 0,
        truncated: false,
      };
      appendCommandDiagnostic(syncStdoutCapture, synchronousResult.stdout ?? "", MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES);
      appendCommandDiagnostic(syncStderrCapture, synchronousResult.stderr ?? "", MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES);
      const syncError = synchronousResult.error;
      const syncTimedOut =
        Boolean(syncError) &&
        (syncError as NodeJS.ErrnoException).code === "ETIMEDOUT";
      const syncSignal = synchronousResult.signal ?? null;
      const syncExitCode =
        typeof synchronousResult.status === "number"
          ? synchronousResult.status
          : null;
      const syncLifecycleReason = syncTimedOut
        ? "timeout"
        : syncError
          ? "spawn_error"
          : syncSignal
            ? "signal"
            : "exit";
      const syncStderr = syncError
        ? appendTrustedLifecycleDiagnostic(
            syncStderrCapture.value,
            sanitizePublicAgentDiagnostic(String(syncError), 160),
          )
        : syncStderrCapture.value;
      resolve({
        ok:
          !syncError &&
          !syncSignal &&
          synchronousResult.status === 0 &&
          !syncTimedOut,
        exitCode: syncExitCode,
        timedOut: syncTimedOut,
        stdout: syncStdoutCapture.value,
        stderr: syncStderr,
        lifecycleReason: syncLifecycleReason,
        cleanupVerified: !syncError && !syncTimedOut,
        stdoutTruncated: syncStdoutCapture.truncated,
        stderrTruncated: syncStderrCapture.truncated,
      });
      return;
    }
    const useWindowsJobSupervisor =
      processControl.platform === "win32" && isNativeProcessControl;
    const useLinuxNamespaceSupervisor =
      processControl.platform === "linux" &&
      isNativeProcessControl &&
      !trustedLangGraphFixture;
    const lifecycleStreamDrainTimeoutMs =
      useLinuxNamespaceSupervisor && processControl.streamDrainTimeoutMs === undefined
        ? Math.max(streamDrainTimeoutMs, LINUX_NAMESPACE_SUPERVISOR_DRAIN_TIMEOUT_MS)
        : streamDrainTimeoutMs;
    const linuxSupervisorNonce = useLinuxNamespaceSupervisor
      ? randomBytes(32).toString("hex")
      : "";

    let child: ReturnType<typeof spawn> | null = null;
    const stdoutCapture: DiagnosticCapture = { value: "", byteCount: 0, truncated: false };
    const stderrCapture: DiagnosticCapture = { value: "", byteCount: 0, truncated: false };
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exitObserved = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let stdoutClosed = false;
    let stderrClosed = false;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let samplerTimer: ReturnType<typeof setInterval> | undefined;
    let samplerInFlight = false;
    let cleanupPromise: Promise<void> | null = null;
    const streamWaiters = new Set<() => void>();
    const trackedWindowsPids = new Set<number>();
    let windowsJobContained = false;
    let windowsSupervisorComplete = false;
    let windowsSupervisorDrain = false;
    let windowsSupervisorControlClosed = !useWindowsJobSupervisor;
    let windowsSupervisorProtocolInvalid = false;
    let windowsSupervisorControlBuffer = Buffer.alloc(0);
    let linuxSupervisorComplete = false;
    let linuxSupervisorProtocolInvalid = false;
    let linuxSupervisorStderrTail = Buffer.alloc(0);
    const linuxSupervisorExpectedCompletion = useLinuxNamespaceSupervisor
      ? linuxNamespaceCompletionMarker(linuxSupervisorNonce)
      : Buffer.alloc(0);
    let windowsLifecycle: WindowsLifecycleChannel | null = null;
    let windowsParentLifetime: WindowsLifecycleChannel | null = null;

    const notifyStreamWaiters = () => {
      if (!stdoutClosed || !stderrClosed) return;
      for (const waiter of streamWaiters) waiter();
      streamWaiters.clear();
    };
    const settle = (
      result: Omit<CommandResult, "stdoutTruncated" | "stderrTruncated">,
    ) => {
      if (settled) return;
      const deadlineExpired = Date.now() >= deadlineEpochMs;
      const finalResult =
        deadlineExpired
          ? {
              ...result,
              ok: false,
              timedOut: true,
              stderr: appendTrustedLifecycleDiagnostic(
                result.stderr,
                "command completion arrived after the absolute deadline",
              ),
              lifecycleReason: "timeout" as const,
            }
          : result;
      settled = true;
      windowsLifecycle?.close();
      windowsParentLifetime?.close();
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (drainTimer) clearTimeout(drainTimer);
      if (samplerTimer) clearInterval(samplerTimer);
      for (const waiter of streamWaiters) waiter();
      streamWaiters.clear();
      resolve({
        ...finalResult,
        stdoutTruncated: stdoutCapture.truncated,
        stderrTruncated: stderrCapture.truncated,
      });
    };
    const waitForStreams = () =>
      new Promise<void>((resolveDrain) => {
        if (stdoutClosed && stderrClosed) {
          resolveDrain();
          return;
        }
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          streamWaiters.delete(finish);
          resolveDrain();
        };
        const timer = setTimeout(() => {
          appendCommandDiagnostic(
            stderrCapture,
            "\n[diagnostic stream drain deadline exceeded]",
            MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES,
          );
          stderr = stderrCapture.value;
          finish();
        }, lifecycleStreamDrainTimeoutMs);
        streamWaiters.add(finish);
      });
    const terminateTree = async (awaitWindowsCleanupGrace = false) => {
      if (windowsJobContained && child?.pid) {
        const cleanupDeadline = awaitWindowsCleanupGrace
          ? windowsSupervisorCleanupDeadlineEpochMs
          : Date.now();
        while (!exitObserved && Date.now() < cleanupDeadline) {
          await new Promise((resolveWait) =>
            setTimeout(resolveWait, MIN_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS),
          );
        }
        if (!exitObserved) child.kill("SIGKILL");
        const finalCloseDeadline =
          Date.now() + WINDOWS_JOB_SUPERVISOR_FINAL_CLOSE_TIMEOUT_MS;
        while (
          (!exitObserved || !windowsSupervisorControlClosed) &&
          Date.now() < finalCloseDeadline
        ) {
          await new Promise((resolveWait) =>
            setTimeout(resolveWait, MIN_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS),
          );
        }
        const complete =
          exitObserved &&
          windowsSupervisorControlClosed &&
          (windowsSupervisorComplete || windowsSupervisorDrain) &&
          !windowsSupervisorProtocolInvalid;
        return {
          gone: complete,
          diagnostic: complete
            ? ""
            : "Windows Job Object private lifecycle completion proof is missing",
        };
      }
      if (processControl.platform === "win32" && child?.pid) {
        return terminateWindowsProcessTree(
          child.pid,
          processControl,
          [...trackedWindowsPids],
        );
      }
      if (useLinuxNamespaceSupervisor) {
        return terminateLinuxNamespaceScope(
          child,
          () =>
            exitObserved &&
            stderrClosed &&
            linuxSupervisorComplete &&
            !linuxSupervisorProtocolInvalid,
        );
      }
      if (trustedLangGraphFixture && exitObserved) {
        return { gone: true, diagnostic: "" };
      }
      child?.kill("SIGTERM");
      return {
        gone: false,
        diagnostic: "process containment verification unavailable",
      };
    };
    const cleanupAndSettle = (
      timedOut: boolean,
      diagnostic: string,
      resultExitCode: number | null = exitCode,
    ) => {
      if (cleanupPromise || settled) return cleanupPromise;
      cleanupPromise = (async () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (drainTimer) clearTimeout(drainTimer);
        const termination = await terminateTree(timedOut);
        const lifecycleReason = timedOut
          ? "timeout"
          : diagnostic.startsWith("diagnostic stream drain")
            ? "stream_drain"
            : diagnostic.startsWith("spawn error")
              ? "spawn_error"
              : "cleanup_error";
        const lifecycleDiagnostic = [
          diagnostic,
          termination.diagnostic,
          termination.gone ? "" : "process cleanup incomplete",
        ]
          .filter(Boolean)
          .join("; ");
        await waitForStreams();
        settle({
          ok: false,
          exitCode: resultExitCode,
          timedOut,
          stdout,
          stderr: appendTrustedLifecycleDiagnostic(
            stderr,
            lifecycleDiagnostic || "command cleanup failed closed",
          ),
          lifecycleReason,
          cleanupVerified: termination.gone,
        });
      })().catch((error) => {
        settle({
          ok: false,
          exitCode: resultExitCode,
          timedOut,
          stdout,
          stderr: appendTrustedLifecycleDiagnostic(
            stderr,
            `process cleanup failed: ${sanitizePublicAgentDiagnostic(String(error), 160)}`,
          ),
          lifecycleReason: "cleanup_error",
          cleanupVerified: false,
        });
      });
      return cleanupPromise;
    };
    const cleanupPosixExitAndSettle = () => {
      if (cleanupPromise || settled) return cleanupPromise;
      cleanupPromise = (async () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (drainTimer) clearTimeout(drainTimer);
        const termination = await terminateTree();
        if (!termination.gone) {
          settle({
            ok: false,
            exitCode,
            timedOut: false,
            stdout,
            stderr: appendTrustedLifecycleDiagnostic(
              stderr,
              [termination.diagnostic, "process cleanup incomplete"]
                .filter(Boolean)
                .join("; "),
            ),
            lifecycleReason: "cleanup_error",
            cleanupVerified: false,
          });
          return;
        }
        settle({
          ok: exitCode === 0 && exitSignal === null,
          exitCode,
          timedOut: false,
          stdout,
          stderr: exitSignal
            ? appendTrustedLifecycleDiagnostic(
                stderr,
                `process exited by ${exitSignal}`,
              )
            : stderr,
          lifecycleReason: exitSignal ? "signal" : "exit",
          cleanupVerified: true,
        });
      })().catch((error) => {
        settle({
          ok: false,
          exitCode,
          timedOut: false,
          stdout,
          stderr: appendTrustedLifecycleDiagnostic(
            stderr,
            `process cleanup failed: ${sanitizePublicAgentDiagnostic(String(error), 160)}`,
          ),
          lifecycleReason: "cleanup_error",
          cleanupVerified: false,
        });
      });
      return cleanupPromise;
    };
    const settleAfterDrain = () => {
      if (settled || cleanupPromise || !exitObserved) return;
      if (
        stdoutClosed &&
        stderrClosed &&
        windowsSupervisorControlClosed
      ) {
        if (processControl.platform !== "win32") {
          if (
            child?.pid &&
            Number.isSafeInteger(child.pid) &&
            child.pid > 0
          ) {
            void cleanupPosixExitAndSettle();
            return;
          }
          settle({
            ok: false,
            exitCode,
            timedOut: false,
            stdout,
            stderr: appendTrustedLifecycleDiagnostic(
              stderr,
              "POSIX containment cleanup could not be verified",
            ),
            lifecycleReason: "cleanup_error",
            cleanupVerified: false,
          });
          return;
        }
        if (exitSignal) {
          stderr = appendTrustedLifecycleDiagnostic(
            stderr,
            `process exited by ${exitSignal}`,
          );
        }
        const windowsProofRequired = windowsJobContained;
        const windowsProofValid =
          !windowsProofRequired ||
          ((windowsSupervisorComplete || windowsSupervisorDrain) &&
            !windowsSupervisorProtocolInvalid);
        settle({
          ok: exitCode === 0 && exitSignal === null && windowsProofValid,
          exitCode,
          timedOut: false,
          stdout,
          stderr: windowsProofValid
            ? stderr
            : appendTrustedLifecycleDiagnostic(
                stderr,
                "Windows Job Object private lifecycle completion proof is missing",
              ),
          lifecycleReason: exitSignal ? "signal" : "exit",
          cleanupVerified: windowsProofValid,
        });
        return;
      }
      if (!drainTimer) {
        drainTimer = setTimeout(() => {
          void cleanupAndSettle(
            false,
            "diagnostic stream drain deadline exceeded",
            exitCode,
          );
        }, lifecycleStreamDrainTimeoutMs);
      }
    };

    timeoutTimer = setTimeout(() => {
      void cleanupAndSettle(true, "command timeout exceeded", null);
    }, remainingDeadlineMs());

    try {
      const linuxContainment = useLinuxNamespaceSupervisor
        ? probeLinuxNamespaceContainment()
        : null;
      if (
        isNativeProcessControl &&
        processControl.platform !== "win32" &&
        processControl.platform !== "linux"
      ) {
        settle({
          ok: false,
          exitCode: null,
          timedOut: false,
          stdout,
          stderr: appendTrustedLifecycleDiagnostic(
            stderr,
            "unsupported POSIX platform: Linux namespace containment is required",
          ),
          lifecycleReason: "spawn_error",
          cleanupVerified: false,
        });
        return;
      }
      if (
        isNativeProcessControl &&
        processControl.platform === "linux" &&
        useLinuxNamespaceSupervisor &&
        (!linuxContainment?.available || !linuxContainment.launcher)
      ) {
        settle({
          ok: false,
          exitCode: null,
          timedOut: false,
          stdout,
          stderr: appendTrustedLifecycleDiagnostic(
            stderr,
            linuxContainment?.diagnostic ?? "Linux containment boundary is unavailable",
          ),
          lifecycleReason: "spawn_error",
          cleanupVerified: false,
        });
        return;
      }
      if (unsafeWindowsLaunch) {
        settle({
          ok: false,
          exitCode: null,
          timedOut: false,
          stdout,
          stderr: appendTrustedLifecycleDiagnostic(
            stderr,
            "Windows command executable, root, or argument contains a cmd metacharacter",
          ),
          lifecycleReason: "spawn_error",
          cleanupVerified: false,
        });
        return;
      }
      const commandExecutable = windowsCommandSpec?.executable ?? executable;
      const commandArgs = windowsCommandSpec?.args ?? args;
      const commandWindowsVerbatimArguments =
        windowsCommandSpec?.windowsVerbatimArguments ?? false;
      windowsLifecycle = useWindowsJobSupervisor
        ? createWindowsLifecycleChannel("proof")
        : null;
      windowsParentLifetime = useWindowsJobSupervisor
        ? createWindowsLifecycleChannel("parent")
        : null;
      const supervisorSpec =
        useWindowsJobSupervisor && windowsLifecycle && windowsParentLifetime
          ? buildWindowsJobSupervisorSpec({
              executable: commandExecutable,
              args: commandArgs,
              cwd: commandCwd,
              env: commandEnv,
              windowsVerbatimArguments: commandWindowsVerbatimArguments,
              deadline: deadlineEpochMs,
              cleanupDeadline: windowsSupervisorCleanupDeadlineEpochMs,
              pipeName: windowsLifecycle.pipeName,
              parentLifetimePipeName: windowsParentLifetime.pipeName,
            })
          : null;
      windowsJobContained = Boolean(supervisorSpec);
      const linuxSpawnBudgetMs = useLinuxNamespaceSupervisor
        ? remainingDeadlineMs()
        : null;
      if (linuxSpawnBudgetMs !== null && linuxSpawnBudgetMs <= 0) {
        settle({
          ok: false,
          exitCode: null,
          timedOut: true,
          stdout,
          stderr: appendTrustedLifecycleDiagnostic(
            stderr,
            "Linux containment deadline exhausted before supervisor spawn",
          ),
          lifecycleReason: "timeout",
          cleanupVerified: false,
        });
        return;
      }
      const linuxSupervisorSpec =
        linuxContainment?.launcher && linuxContainment.python
          ? {
              executable: linuxContainment.python,
              args: ["-c", LINUX_NAMESPACE_OUTER_SUPERVISOR],
              env: {
                ...commandEnv,
                TZUDONG_NS_NONCE: linuxSupervisorNonce,
                TZUDONG_NS_UNSHARE: linuxContainment.launcher,
                TZUDONG_NS_PYTHON: linuxContainment.python,
                TZUDONG_NS_INNER_B64: Buffer.from(
                  LINUX_NAMESPACE_INIT_SUPERVISOR,
                  "utf8",
                ).toString("base64"),
                TZUDONG_NS_TARGET_B64: Buffer.from(
                  JSON.stringify([commandExecutable, ...commandArgs]),
                  "utf8",
                ).toString("base64"),
                TZUDONG_NS_DEADLINE_MILLISECONDS: String(linuxSpawnBudgetMs),
              },
            }
          : null;
      child = processControl.spawnProcess(
        supervisorSpec?.executable ??
          linuxSupervisorSpec?.executable ??
          commandExecutable,
        supervisorSpec?.args ?? linuxSupervisorSpec?.args ?? commandArgs,
        {
          cwd: commandCwd,
          shell: false,
          windowsVerbatimArguments: supervisorSpec
            ? false
            : commandWindowsVerbatimArguments,
          windowsHide: useWindowsJobSupervisor,
          detached:
            processControl.platform !== "win32" && !useLinuxNamespaceSupervisor,
          stdio: ["pipe", "pipe", "pipe"],
          env: supervisorSpec?.env ?? linuxSupervisorSpec?.env ?? commandEnv,
        },
      );
    } catch (error) {
      settle({
        ok: false,
        exitCode: null,
        timedOut: false,
        stdout,
        stderr: appendTrustedLifecycleDiagnostic(
          stderr,
          `spawn failed: ${sanitizePublicAgentDiagnostic(String(error), 160)}`,
        ),
        lifecycleReason: "spawn_error",
        cleanupVerified: false,
      });
      return;
    }

    const spawned = child;
    if (!spawned) return;
    stdoutClosed = !spawned.stdout;
    stderrClosed = !spawned.stderr;
    if (spawned.pid) trackedWindowsPids.add(spawned.pid);

    if (
      processControl.platform === "win32" &&
      isNativeProcessControl &&
      !windowsJobContained &&
      spawned.pid
    ) {
      const sampleTree = async () => {
        if (settled || samplerInFlight || !spawned.pid) return;
        samplerInFlight = true;
        try {
          const sampleDeadline =
            Date.now() +
            (processControl.helperTimeoutMs ??
              WINDOWS_PROCESS_TERMINATION_TIMEOUT_MS);
          const pids = await captureWindowsProcessTree(
            spawned.pid,
            processControl,
            sampleDeadline,
          );
          for (const pid of pids ?? []) trackedWindowsPids.add(pid);
        } finally {
          samplerInFlight = false;
        }
      };
      void sampleTree();
      samplerTimer = setInterval(
        () => void sampleTree(),
        Math.max(
          MIN_STORYBOARD_AGENT_STREAM_DRAIN_TIMEOUT_MS,
          Math.min(
            250,
            (processControl.helperTimeoutMs ??
              WINDOWS_PROCESS_TERMINATION_TIMEOUT_MS) / 2,
          ),
        ),
      );
    }

    if (useWindowsJobSupervisor && (!windowsLifecycle || !windowsParentLifetime)) {
      windowsSupervisorProtocolInvalid = true;
      windowsSupervisorControlClosed = true;
    }
    void windowsLifecycle?.socket.then((windowsSupervisorControl) => {
      windowsSupervisorControl.on("data", (chunk) => {
        if (windowsSupervisorComplete || windowsSupervisorDrain || windowsSupervisorProtocolInvalid) {
          windowsSupervisorProtocolInvalid = true;
          return;
        }
        windowsSupervisorControlBuffer = Buffer.concat([
          windowsSupervisorControlBuffer,
          Buffer.from(chunk),
        ]);
        if (
          windowsSupervisorControlBuffer.length > 16 ||
          (windowsSupervisorControlBuffer.includes(10) &&
            windowsSupervisorControlBuffer.indexOf(10) !==
              windowsSupervisorControlBuffer.length - 1)
        ) {
          windowsSupervisorProtocolInvalid = true;
          return;
        }
        if (windowsSupervisorControlBuffer.at(-1) !== 10) return;
        if (windowsSupervisorControlBuffer.equals(Buffer.from("COMPLETE\n", "ascii"))) {
          windowsSupervisorComplete = true;
        } else if (windowsSupervisorControlBuffer.equals(Buffer.from("DRAIN\n", "ascii"))) {
          windowsSupervisorDrain = true;
        } else {
          windowsSupervisorProtocolInvalid = true;
        }
      });
      windowsSupervisorControl.once("error", () => {
        windowsSupervisorProtocolInvalid = true;
        windowsSupervisorControlClosed = true;
        settleAfterDrain();
      });
      windowsSupervisorControl.once("close", () => {
        windowsSupervisorControlClosed = true;
        if (!windowsSupervisorComplete && !windowsSupervisorDrain) {
          windowsSupervisorProtocolInvalid = true;
        }
        settleAfterDrain();
      });
    });
    spawned.stdout?.on("data", (chunk) => {
      appendCommandDiagnostic(
        stdoutCapture,
        chunk,
        Math.max(0, MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES - Buffer.byteLength(stderrCapture.value, "utf8")),
      );
      stdout = stdoutCapture.value;
    });
    spawned.stderr?.on("data", (chunk) => {
      if (useLinuxNamespaceSupervisor) {
        const combined = Buffer.concat([
          linuxSupervisorStderrTail,
          Buffer.from(chunk),
        ]);
        const diagnosticBytes = Math.max(
          0,
          combined.length - linuxSupervisorExpectedCompletion.length,
        );
        if (diagnosticBytes > 0) {
          appendCommandDiagnostic(
            stderrCapture,
            combined.subarray(0, diagnosticBytes),
            Math.max(
              0,
              MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES -
                Buffer.byteLength(stdoutCapture.value, "utf8"),
            ),
          );
        }
        linuxSupervisorStderrTail = Buffer.from(
          combined.subarray(diagnosticBytes),
        );
        stderr = stderrCapture.value;
        return;
      }
      appendCommandDiagnostic(
        stderrCapture,
        chunk,
        Math.max(0, MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES - Buffer.byteLength(stdoutCapture.value, "utf8")),
      );
      stderr = stderrCapture.value;
    });
    spawned.stderr?.once("error", () => {
      if (useLinuxNamespaceSupervisor) linuxSupervisorProtocolInvalid = true;
    });
    spawned.stdout?.once("close", () => {
      stdoutClosed = true;
      notifyStreamWaiters();
      settleAfterDrain();
    });
    spawned.stderr?.once("close", () => {
      if (useLinuxNamespaceSupervisor) {
        if (
          linuxSupervisorStderrTail.equals(
            linuxSupervisorExpectedCompletion,
          )
        ) {
          linuxSupervisorComplete = true;
        } else {
          linuxSupervisorProtocolInvalid = true;
          appendCommandDiagnostic(
            stderrCapture,
            linuxSupervisorStderrTail,
            Math.max(
              0,
              MAX_STORYBOARD_AGENT_DIAGNOSTIC_BYTES -
                Buffer.byteLength(stdoutCapture.value, "utf8"),
            ),
          );
        }
        linuxSupervisorStderrTail = Buffer.alloc(0);
        stderr = stderrCapture.value;
      }
      stderrClosed = true;
      notifyStreamWaiters();
      settleAfterDrain();
    });
    spawned.once("exit", (code, signal) => {
      exitObserved = true;
      exitCode = code;
      exitSignal = signal;
      settleAfterDrain();
    });
    spawned.once("close", (code, signal) => {
      if (!exitObserved) {
        exitObserved = true;
        exitCode = code;
        exitSignal = signal;
      }
      settleAfterDrain();
    });
    spawned.once("error", (error) => {
      if (spawned.pid) {
        void cleanupAndSettle(false, `spawn error: ${String(error)}`);
        return;
      }
      settle({
        ok: false,
        exitCode: null,
        timedOut: false,
        stdout,
        stderr: appendTrustedLifecycleDiagnostic(
          stderr,
          `spawn failed: ${sanitizePublicAgentDiagnostic(String(error), 160)}`,
        ),
        lifecycleReason: "spawn_error",
        cleanupVerified: false,
      });
    });
    spawned.stdin?.on("error", () => {
      // The command may exit before it consumes stdin. Process lifecycle events
      // remain authoritative and cleanup is serialized above.
    });
    spawned.stdin?.end(JSON.stringify(payload));
  });
}

export function __runStoryboardAgentCommandForTests(
  command: Extract<ResolvedStoryboardAgentCommand, { ok: true }>,
  payload: Record<string, unknown>,
  processControl: ProcessControl = defaultProcessControl,
  options: StoryboardCommandRunOptions = {},
) {
  return runStoryboardAgentCommand(command, payload, processControl, options);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

const SENSITIVE_DIAGNOSTIC_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|credential|authorization|service[_-]?role|database[_-]?url|private[_-]?key|access[_-]?key|session(?:[_-]?key)?|cookie)/i;

function redactSensitiveAgentDiagnostic(value: string) {
  let redacted = value;
  const configuredSecrets = Object.entries(process.env)
    .flatMap(([key, configuredValue]) =>
      SENSITIVE_DIAGNOSTIC_KEY_PATTERN.test(key) &&
      typeof configuredValue === "string" &&
      configuredValue.length > 0
        ? [configuredValue]
        : [],
    )
    .sort((left, right) => right.length - left.length);
  for (const configuredValue of configuredSecrets) {
    redacted = redacted.split(configuredValue).join("[REDACTED]");
  }
  return redacted
    .replace(
      /((?:[A-Z][A-Z0-9_]*?(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|SERVICE_ROLE|DATABASE_URL|PRIVATE_KEY|ACCESS_KEY|SESSION(?:_KEY)?|COOKIE)[A-Z0-9_]*)\s*=\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /("(?:api[_-]?key|token|secret|password|credential|authorization|service[_-]?role|database[_-]?url|private[_-]?key|access[_-]?key|session(?:[_-]?key)?|cookie)"\s*:\s*)"[^"\r\n]*"/gi,
      "$1\"[REDACTED]\"",
    )
    .replace(/\b(authorization\s*:\s*)[^\r\n]*/gi, "$1[REDACTED]")
    .replace(/\b(cookie\s*:\s*)[^\r\n]*/gi, "$1[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\/\s:@]+:[^\/\s@]+@/gi, "$1[REDACTED]@");
}
function sanitizePublicAgentOutput(value: string) {
  return sanitizePublicAgentText(redactSensitiveAgentDiagnostic(value));
}


function sanitizePublicAgentDiagnostic(value: string, maxLength = 300) {
  return sanitizePublicAgentOutput(value).slice(0, maxLength);
}
export function __sanitizePublicAgentDiagnosticForTests(value: string) {
  return sanitizePublicAgentDiagnostic(value, 1200);
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
      .map(([key, item]) => {
        // Inspect original keys before recursion so key sanitization cannot erase
        // the context which makes a nested value secret.
        if (SENSITIVE_DIAGNOSTIC_KEY_PATTERN.test(key)) {
          return [sanitizePublicAgentDiagnostic(key, 120), "[REDACTED]"];
        }
        return [
          sanitizePublicAgentDiagnostic(key, 120),
          sanitizePublicJson(item, depth + 1),
        ];
      })
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
  const status: NonNullable<StoryboardGraphDiagnostics["retrieval"]>["status"] =
    value.status === "used" || value.status === "failed" ? value.status : "not_used";
  const caption = normalizeCaptionRetrievalDiagnostics(value.caption);
  const base: NonNullable<StoryboardGraphDiagnostics["retrieval"]> = {
    status,
    ...(value.requiredModelStack === true ? { requiredModelStack: true } : {}),
    ...(typeof value.failureReason === "string"
      ? { failureReason: sanitizePublicAgentDiagnostic(value.failureReason, 160) }
      : {}),
    ...(caption ? { caption } : {}),
  };
  if (status !== "used" || !toolsCalled.includes("search_scene_data")) {
    return base;
  }
  const models = isObjectRecord(value.usedModels) ? value.usedModels : {};
  const embeddingModel = models.embedding === "BAAI/bge-m3" ? "BAAI/bge-m3" : undefined;
  const rerankerModel =
    models.reranker === "BAAI/bge-reranker-v2-m3"
      ? "BAAI/bge-reranker-v2-m3"
      : undefined;
  if (!embeddingModel || !rerankerModel) {
    return {
      status: "failed",
      requiredModelStack: true,
      failureReason: "required_bge_retrieval_models_missing",
      ...(caption ? { caption } : {}),
    };
  }
  const operations = isObjectRecord(value.operations) ? value.operations : {};
  return {
    status: "used",
    requiredModelStack: true,
    usedModels: {
      embedding: embeddingModel,
      reranker: rerankerModel,
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
  if (isPythonRuntimeUnavailableDiagnostic(text)) {
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

function summarizeLocalAdapterSceneData(result: StoryboardGenerationResult) {
  return result.storyboard.scenes.slice(0, STORYBOARD_MAX_SEGMENT_COUNT).map((scene) => ({
    cut: scene.sceneNo,
    title: sanitizePublicAgentDiagnostic(scene.title, 160),
    role: sanitizePublicAgentDiagnostic(scene.operatorIntent, 220),
    scene: sanitizePublicAgentDiagnostic(scene.visualDirection, 260),
    caption: sanitizePublicAgentDiagnostic(scene.captionIdea, 220),
    evidence: {
      videoId: sanitizePublicAgentDiagnostic(scene.heatmapEvidence.videoId, 120),
      peakTime: sanitizePublicAgentDiagnostic(scene.heatmapEvidence.peakTime, 40),
      replayScore: scene.heatmapEvidence.replayScore,
      reason: sanitizePublicAgentDiagnostic(scene.heatmapEvidence.reason, 300),
    },
  }));
}

function buildLocalAdapterResearchQueries(result: StoryboardGenerationResult) {
  const prompt = sanitizePublicAgentDiagnostic(result.request.prompt, 240);
  const keywordQuery =
    result.planner?.topicProfile.keywords.slice(0, 5).join(" ") ||
    result.planner?.topicProfile.label ||
    "먹방 반복시청 피크";
  const arcQuery = result.planner?.arcPlan.roles
    .slice(0, 5)
    .map((role) => String(role).replace(/_/g, " "))
    .join(" → ");
  return [
    prompt,
    `topic:${sanitizePublicAgentDiagnostic(keywordQuery, 180)}`,
    `arc:${sanitizePublicAgentDiagnostic(arcQuery || "intro → first bite → review", 180)}`,
  ].filter(Boolean);
}

function buildLocalAdapterResearchWebSummary(result: StoryboardGenerationResult) {
  return result.sourceSummary.isFallbackData
    ? "required_worker_unavailable: external search data is missing; Designer must not claim live RAG provider use."
    : "required_worker: local heatmap evidence is only a seed; live BGE/reranker/RPC evidence must come from the required worker.";
}

function createLocalAdapterInternRequest() {
  return {
    tool: "search_scene_data",
    rpc: "match_documents_hybrid",
    policy: "review_only_required_worker_contract",
    reason:
      "Researcher requires scene evidence before Designer finalization; local adapter reviews the Tool/RPC contract without mutating production tools.",
  };
}

function runLocalAdapterSupervisorStep(args: {
  sceneData: ReturnType<typeof summarizeLocalAdapterSceneData>;
  researchWebSummary: string;
  promptFeedback: string;
  internResult?: Record<string, unknown>;
}) {
  return {
    research_sufficient: args.sceneData.length > 0,
    agent_instructions: {
      researcher:
        "Run bounded self-RAG over local heatmap/caption-equivalent evidence before storyboard design.",
      intern:
        "Review search_scene_data Tool/RPC safety and block mutation without human approval.",
      designer:
        "Create a storyboard only from Researcher evidence and keep the operator feedback loop open.",
    },
    is_approved: { researcher: true, designer: true },
    research_scene_data: args.sceneData,
    research_web_summary: args.researchWebSummary,
    human_feedback: [args.promptFeedback || "operator prompt"],
    intern_result: args.internResult ?? { status: "pending_intern_review" },
    messages: [
      "Supervisor extracted slots from the operator request.",
      "Supervisor delegated evidence gathering to Researcher.",
      "Supervisor required Intern review before Designer trusts the evidence path.",
      args.internResult
        ? "Supervisor approved Designer after Researcher sufficiency passed."
        : "Supervisor is waiting for Intern review before final Designer approval.",
    ],
  };
}

function runLocalAdapterResearcherStep(args: {
  result: StoryboardGenerationResult;
  sceneData: ReturnType<typeof summarizeLocalAdapterSceneData>;
  previousQueries: string[];
  internRequest: ReturnType<typeof createLocalAdapterInternRequest>;
  internResult?: Record<string, unknown>;
  localRag?: StoryboardGenerationResult["backendAnalysis"]["localRag"];
}) {
  return {
    agent_instructions: [
      "Think about the needed scene evidence.",
      "Call search_scene_data against local heatmap evidence.",
      "Evaluate whether each planned cut has evidence before Designer handoff.",
    ],
    research_sufficient: args.sceneData.length > 0,
    research_summary: [
      `Researcher completed required self-RAG planning with ${args.sceneData.length} scene evidence rows and ${args.result.sourceSummary.totalMarkers} heatmap markers.`,
      args.localRag
        ? `Required RAG diagnostics ${args.localRag.status}: ${args.localRag.selectedCount} selected / ${args.localRag.documentCount} documents; ${args.localRag.modelStack.models.length} required provider roles registered fail-closed.`
        : '',
    ].filter(Boolean).join(' '),
    previous_queries: args.previousQueries,
    researcher_stall_summary:
      "No stall: local adapter had enough heatmap-backed scene evidence for Designer.",
    intern_request: args.internRequest,
    intern_result: args.internResult ?? { status: "pending_intern_review" },
    researcher_think_count: Math.max(1, Math.min(5, args.previousQueries.length)),
    local_rag: args.localRag,
    messages: [
      "think: identify missing scene/caption evidence.",
      "tools: search_scene_data local adapter read-only lookup.",
      "evaluate: sufficient evidence for storyboard draft.",
    ],
    loop: { think: true, tools: true, evaluate: true },
  };
}

function runLocalAdapterInternStep(
  internRequest: ReturnType<typeof createLocalAdapterInternRequest>,
) {
  const internResult = {
    status: "reviewed",
    decision: "approved_read_only_local_adapter",
    execution: "guarded_noop",
    notes:
      "Tool/RPC creation or deletion is blocked in local adapter mode until an operator approves a generated patch.",
  };
  const state = {
    intern_request: internRequest,
    agent_instructions: [
      "Plan before any Tool/RPC mutation.",
      "Review generated search_scene_data contract before execution.",
      "Keep mutation blocked unless a human approves the generated patch.",
    ],
    intern_action: "create_modify_tool_rpc_review_only",
    pending_execute_calls: ["create_tool_rpc_patch"],
    intern_result: internResult,
    modified_tool_calls: ["search_scene_data"],
    plan_update_events: [
      "plan",
      "review_create",
      "human_interrupt_before_mutation",
      "execute_guarded_noop",
    ],
    messages: [
      "Intern drafted a Tool/RPC review plan.",
      "Intern reviewed search_scene_data as read-only local evidence.",
      "Intern blocked unapproved mutation and returned a safe review result.",
    ],
    planCreated: true,
    review: { planApproved: true, reviewer: "local_adapter_safety_gate" },
    toolRpcMutation: true,
    searchSceneDataReviewed: true,
    humanInterrupts: {
      beforeCreateDelete: true,
      afterToolRpcGeneration: true,
      blocksUnapprovedExecution: true,
      recordsHumanDecision: true,
      reviewBeforeTrust: true,
    },
  };
  return { state, internResult };
}

function runLocalAdapterDesignerStep(args: {
  result: StoryboardGenerationResult;
  sceneData: ReturnType<typeof summarizeLocalAdapterSceneData>;
  researchWebSummary: string;
  promptFeedback: string;
}) {
  return {
    research_scene_data: args.sceneData,
    research_web_summary: args.researchWebSummary,
    final_output: args.result.storyboard.exportMarkdown,
    storyboard_history: [
      "draft_from_research_scene_data",
      "operator_prompt_feedback_classified",
      "final_storyboard_export",
    ],
    human_feedback: [args.promptFeedback || "operator prompt"],
    conversation_summary:
      "Designer transformed Researcher evidence into cuts and remains ready to revise from operator feedback.",
    feedback_action: "revise_or_finalize_from_operator_feedback",
    messages: [
      "Designer consumed Researcher scene evidence.",
      "Designer produced storyboard export markdown.",
      "Designer kept feedback state for follow-up revisions.",
    ],
  };
}

function createLocalAdapterGraphDiagnostics(
  status: StoryboardBackendAgentStatus,
  result: StoryboardGenerationResult,
): StoryboardGraphDiagnostics {
  const localRag = result.backendAnalysis.localRag;
  const localRagRetrievalStatus =
    localRag?.status === "used"
      ? "used"
      : localRag?.status === "failed"
        ? "failed"
        : "not_used";
  return {
    status: "used",
    runtime: "local_adapter_fallback",
    mode: "local_adapter",
    graphEntrypoint: status.graphEntrypoint
      ? sanitizePublicAgentDiagnostic(status.graphEntrypoint, 300)
      : "apps/web/lib/admin/storyboard/backend-agent.ts",
    nodesVisited: [
      "extract_slots",
      "supervisor",
      "researcher",
      "intern",
      "designer",
    ],
    interrupts: [
      {
        node: "intern.review_create",
        resumable: true,
        outputReady: false,
        summary:
          "Local adapter reviewed the read-only search_scene_data contract and blocked Tool/RPC mutation without operator approval.",
      },
      {
        node: "designer_node",
        resumable: true,
        outputReady: true,
        summary:
          "Designer output is ready and can be revised by the operator prompt feedback loop.",
      },
    ],
    toolsCalled: [
      "search_scene_data",
      "rank_heatmap_markers",
      "review_tool_rpc_plan",
      "designer_feedback_classifier",
    ],
    retrieval: {
      status: localRagRetrievalStatus,
      operations: {
        mmrApplied: Boolean(localRag?.operations.mmrApplied),
      },
      caption: {
        lookupStatus: "unavailable",
        provider: "unknown_legacy",
        authMode: "unknown_legacy",
        fallbackReason:
          localRag?.status === "used"
            ? "Required worker caption/RPC retrieval is attached to this graph diagnostic."
            : `Required worker RAG failed closed: ${localRag?.providerUnavailableReason ?? "not_used"}.`,
      },
    },
    fallbackDetail:
      "Command runner unavailable; required backend generation aborts before this legacy diagnostic can be treated as product output.",
  };
}

function buildLocalAdapterReferenceGraph(
  result: StoryboardGenerationResult,
  graph: StoryboardGraphDiagnostics,
) {
  const sceneData = summarizeLocalAdapterSceneData(result);
  const previousQueries = buildLocalAdapterResearchQueries(result);
  const promptFeedback = sanitizePublicAgentDiagnostic(result.request.prompt, 240);
  const researchWebSummary = buildLocalAdapterResearchWebSummary(result);
  const internRequest = createLocalAdapterInternRequest();
  const supervisorPlan = runLocalAdapterSupervisorStep({
    sceneData,
    researchWebSummary,
    promptFeedback,
  });
  const researcherPlan = runLocalAdapterResearcherStep({
    result,
    sceneData,
    previousQueries,
    internRequest,
    localRag: result.backendAnalysis.localRag,
  });
  const internRun = runLocalAdapterInternStep(internRequest);
  const researcher = runLocalAdapterResearcherStep({
    result,
    sceneData,
    previousQueries,
    internRequest,
    internResult: internRun.internResult,
    localRag: result.backendAnalysis.localRag,
  });
  const supervisor = runLocalAdapterSupervisorStep({
    sceneData,
    researchWebSummary,
    promptFeedback,
    internResult: internRun.internResult,
  });
  const designer = runLocalAdapterDesignerStep({
    result,
    sceneData,
    researchWebSummary,
    promptFeedback,
  });

  return {
    lifecycle: {
      start: true,
      extractSlots: true,
      supervisor: true,
      researcherDelegated: true,
      internRoutedByResearcher: true,
      designerDelegated: true,
      end: true,
      order: [
        "start",
        "extract_slots",
        "supervisor",
        "researcher",
        "intern",
        "researcher.evaluate",
        "designer",
        "end",
      ],
      executionTrace: [
        "extractLocalAdapterSlots",
        "runLocalAdapterSupervisorStep",
        "runLocalAdapterResearcherStep",
        "runLocalAdapterInternStep",
        "runLocalAdapterResearcherStep:after_intern",
        "runLocalAdapterSupervisorStep:approve_designer",
        "runLocalAdapterDesignerStep",
      ],
    },
    supervisor: {
      ...supervisor,
      messages: [
        ...supervisorPlan.messages,
        ...supervisor.messages.slice(-1),
      ],
    },
    researcher: {
      ...researcher,
      messages: [
        ...researcherPlan.messages,
        "evaluate_after_intern: Intern review result accepted.",
      ],
    },
    intern: internRun.state,
    designer,
    audit: {
      persisted: true,
      persistenceScope: "response_payload",
      perAgentStateVisible: true,
      messagesCaptured: true,
      eventsOrdered: true,
      safeForPublicUi: true,
      evidencePointers: [
        "apps/web/lib/admin/storyboard/backend-agent.ts",
        "apps/web/lib/admin/storyboard/generator.ts",
        "backend/storyboard-agent/src/graph.py",
        ...graph.toolsCalled,
      ],
    },
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
  candidateOverride?: unknown,
) {
  const candidate =
    candidateOverride !== undefined
      ? candidateOverride
      : canUseReferenceAgentGraphCandidate(result, graph)
        ? extractReferenceAgentGraphCandidate(parsed ?? null)
        : null;
  result.agentGraphFidelity = buildStoryboardAgentGraphFidelity({
    mode: result.mode,
    graph,
    candidate,
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
  if (command.stdoutTruncated || command.stderrTruncated) return null;
  const raw = command.stdout.trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) return null;
    const typed = parsed as ParsedStoryboardAgentOutput;
    const storyboard = isObjectRecord(parsed.storyboard) ? parsed.storyboard : null;
    const output =
      storyboard?.exportMarkdown ?? parsed.markdown ?? parsed.final_output;
    if (typeof output === "string" && output.trim()) return typed;
    const graph =
      normalizeGraphDiagnostics(typed.backendAgent?.graph) ??
      normalizeGraphDiagnostics(typed.diagnostics?.graph);
    const hasPendingResumableInterrupt =
      graph?.status === "interrupted_needs_resume" &&
      graph.interrupts?.some(
        (interrupt) => interrupt.resumable && !interrupt.outputReady,
      );
    return hasPendingResumableInterrupt ? typed : null;
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
  parsed: ParsedStoryboardAgentOutput,
) {
  result.mode = "backend_agent_command";
  result.request.generationMode = "backend_agent";
  result.sourceSummary.dataModeLabel = "백엔드 에이전트 명령 실행";
  const storyboardMetadataAuthoritative =
    isParsedStoryboardMetadataAuthoritative(parsed);
  const commandOutput =
    parsed.storyboard?.exportMarkdown ?? parsed.markdown ?? parsed.final_output;
  if (typeof commandOutput === "string" && commandOutput.trim()) {
    result.storyboard.exportMarkdown = sanitizePublicAgentOutput(commandOutput);
  }
  if (
    storyboardMetadataAuthoritative &&
    typeof parsed.storyboard?.title === "string"
  ) {
    result.storyboard.title = sanitizePublicAgentOutput(parsed.storyboard.title);
  }
  if (
    storyboardMetadataAuthoritative &&
    typeof parsed.storyboard?.logline === "string"
  ) {
    result.storyboard.logline = sanitizePublicAgentOutput(parsed.storyboard.logline);
  }
  if (
    storyboardMetadataAuthoritative &&
    typeof parsed.storyboard?.operatorBrief === "string"
  ) {
    result.storyboard.operatorBrief = sanitizePublicAgentOutput(parsed.storyboard.operatorBrief);
  } else if (storyboardMetadataAuthoritative) {
    result.storyboard.operatorBrief =
      "백엔드 storyboard-agent 명령 실행 결과를 회의용 Markdown에 반영했습니다.";
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
  options: StoryboardBackendAgentExecutionOptions = {},
): Promise<StoryboardGenerationResult> {
  const sanitizedInput =
    input && typeof input.prompt === "string"
      ? { ...input, prompt: sanitizePublicAgentText(input.prompt) }
      : input;
  const env = options.env ?? process.env;
  const status = await getStoryboardBackendAgentStatus(env)
  const base = generateLocalStoryboard({
    ...sanitizedInput,
    generationMode: "backend_agent",
  });
  applyBackendAdapterMode(base);

  const command = resolveEffectiveStoryboardAgentCommand(
    env.STORYBOARD_AGENT_COMMAND,
    status.runtime,
    env,
  );
  if (command.ok) {
    const commandResult = await runStoryboardAgentCommand(command, {
      request: base.request,
      backendAgentRoot: status.rootPath,
      graphEntrypoint: status.graphEntrypoint,
      localStoryboard: base,
    }, defaultProcessControl, {
      env,
      testCommandCapability: options.testCommandCapability,
    });
    if (commandResult.ok) {
      const parsed = parseStoryboardAgentOutput(commandResult);
      if (!parsed) {
        throw new Error(
          "required_storyboard_backend_output_invalid: command output must be non-empty, untruncated JSON with a storyboard export.",
        );
      }
      const graph = status.runtime === "codex_cli_oauth_legacy"
        ? createLegacyGraphDiagnostics(commandResult)
        : extractGraphDiagnosticsFromParsedOutput(parsed);
      if (!graph || graph.status === "fallback") {
        throw new Error(
          "required_storyboard_backend_graph_unavailable: LangGraph command did not return usable required RAG diagnostics.",
        );
      }
      applyBackendCommandOutput(base, parsed);
      normalizeStoryboardExportMarkdown(base, base.storyboard.exportMarkdown);
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
    throw new Error(
      [
        "required_storyboard_backend_graph_failed",
        mapCommandFailureToFallbackReason(status, commandResult),
        `lifecycle=${commandResult.lifecycleReason};cleanup=${
          commandResult.cleanupVerified === null
            ? "not-required"
            : commandResult.cleanupVerified
              ? "verified"
              : "incomplete"
        }`,
        sanitizeCommandOutput(commandResult.stdout, 600),
        sanitizeCommandOutput(commandResult.stderr, 600),
      ]
        .filter(Boolean)
        .join(": ")
        .slice(0, 1200),
    );
  }

  throw new Error(
    [
      "required_storyboard_backend_command_unavailable",
      status.commandRejectionReason,
      "Configure STORYBOARD_AGENT_COMMAND or keep the bundled auto-runner readable, and run with STORYBOARD_AGENT_PYTHON pointing at the installed RAG runtime.",
    ]
      .filter(Boolean)
      .join(": "),
  );
}
