import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import path from 'node:path';

const FRAME_CAPTION_DATA_RELATIVE_PATH = 'backend/restaurant-crawling/data/tzuyang/frame-caption';
const RUN_DAILY_STALE_HOURS = 36;
const RUN_DAILY_LOG_FILENAME_PREFIX = 'daily_';
const RUN_DAILY_MANIFEST_FILENAME = 'current-summary.json';
const RUN_DAILY_LOG_TAIL_BYTES = 32 * 1024;

function hasNonEmptyValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function pickFirstEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (hasNonEmptyValue(value)) {
      return value!.trim();
    }
  }
  return undefined;
}

function getRuntimeCwd(): string {
  const cwd = Reflect.get(process, 'cwd');
  return typeof cwd === 'function' ? cwd.call(process) : '.';
}

function resolveFromRuntimeCwd(...segments: string[]): string {
  return path.resolve(/* turbopackIgnore: true */ getRuntimeCwd(), ...segments);
}

function resolveConfiguredPath(rawPath: string | undefined): string | undefined {
  if (!hasNonEmptyValue(rawPath)) return undefined;

  try {
    return path.isAbsolute(rawPath!)
      ? rawPath!.trim()
      : resolveFromRuntimeCwd(rawPath!.trim());
  } catch {
    return undefined;
  }
}

export function resolveRunDailyScriptPath(env: NodeJS.ProcessEnv): string | undefined {
  const explicitPath = pickFirstEnvValue(env, ['RUN_DAILY_SCRIPT_PATH', 'RUN_DAILY_SCRIPT']);
  if (explicitPath) {
    try {
      const explicitResolved = path.isAbsolute(explicitPath)
        ? explicitPath
        : resolveFromRuntimeCwd(explicitPath);
      if (!existsSync(/* turbopackIgnore: true */ explicitResolved)) return undefined;
      const explicitStats = statSync(/* turbopackIgnore: true */ explicitResolved);
      return explicitStats.isFile() ? explicitResolved : undefined;
    } catch {
      return undefined;
    }
  }

  const candidatePaths = [
    resolveFromRuntimeCwd('backend', 'run_daily.sh'),
    resolveFromRuntimeCwd('..', 'backend', 'run_daily.sh'),
    resolveFromRuntimeCwd('..', '..', 'backend', 'run_daily.sh'),
  ];

  for (const candidate of candidatePaths) {
    try {
      if (!existsSync(/* turbopackIgnore: true */ candidate)) continue;
      const stats = statSync(/* turbopackIgnore: true */ candidate);
      if (stats.isFile()) return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

export function resolveRunDailyLogInfo(
  env: NodeJS.ProcessEnv,
  scriptPath: string | undefined,
): {
  logPath?: string;
  logUpdatedAt?: string;
  stale: boolean;
} {
  if (!scriptPath) {
    return { stale: false };
  }

  const scriptDir = path.dirname(scriptPath);
  const logDir = path.resolve(/* turbopackIgnore: true */ scriptDir, 'log', 'cron');

  try {
    const entries = readdirSync(/* turbopackIgnore: true */ logDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(RUN_DAILY_LOG_FILENAME_PREFIX))
      .map((entry) => ({
        path: path.resolve(/* turbopackIgnore: true */ logDir, entry.name),
      }));

    if (entries.length === 0) {
      return { stale: true };
    }

    let latestLogPath: string | undefined;
    let latestLogUpdatedAt: string | undefined;
    let latestMtime = Number.NEGATIVE_INFINITY;

    for (const entry of entries) {
      try {
        const stats = statSync(/* turbopackIgnore: true */ entry.path);
        const mtimeMs = stats.mtimeMs;
        if (mtimeMs > latestMtime) {
          latestMtime = mtimeMs;
          latestLogPath = entry.path;
          latestLogUpdatedAt = new Date(mtimeMs).toISOString();
        }
      } catch {
        // Ignore files that cannot be statted.
      }
    }

    if (!latestLogPath || latestLogUpdatedAt === undefined || !Number.isFinite(latestMtime)) {
      return { stale: true };
    }

    const staleThresholdHours = Number(env.RUN_DAILY_LOG_STALE_HOURS || String(RUN_DAILY_STALE_HOURS));
    const staleHours = Number.isFinite(staleThresholdHours) && staleThresholdHours >= 1
      ? staleThresholdHours
      : RUN_DAILY_STALE_HOURS;
    const staleMsThreshold = staleHours * 60 * 60 * 1000;
    const stale = staleMsThreshold > 0 && (Date.now() - latestMtime > staleMsThreshold);

    return {
      logPath: latestLogPath,
      logUpdatedAt: latestLogUpdatedAt,
      stale,
    };
  } catch {
    return { stale: true };
  }
}

export type RunDailyManifestStatus = {
  manifestPath?: string;
  finalStatus?: 'OK' | 'WARN' | 'ERROR' | 'UNKNOWN';
  finalExitCode?: number;
  failedRequiredSteps: string[];
  optionalSkips: string[];
  downstreamSkips: string[];
  noWorkShortCircuit?: boolean;
  policyMode?: string;
  detail?: string;
};

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeFinalStatus(value: unknown): 'OK' | 'WARN' | 'ERROR' | 'UNKNOWN' | undefined {
  return value === 'OK' || value === 'WARN' || value === 'ERROR' || value === 'UNKNOWN'
    ? value
    : undefined;
}

function resolveRunDailyManifestCandidate(env: NodeJS.ProcessEnv, scriptPath: string | undefined): string | undefined {
  const explicitPath = pickFirstEnvValue(env, ['RUN_DAILY_MANIFEST_PATH', 'RUN_DAILY_SUMMARY_MANIFEST_PATH']);
  if (explicitPath) {
    try {
      return path.isAbsolute(explicitPath) ? explicitPath : resolveFromRuntimeCwd(explicitPath);
    } catch {
      return undefined;
    }
  }

  if (!scriptPath) return undefined;
  return path.resolve(/* turbopackIgnore: true */ path.dirname(scriptPath), 'log', 'cron', RUN_DAILY_MANIFEST_FILENAME);
}

export function resolveRunDailyManifestStatus(
  env: NodeJS.ProcessEnv,
  scriptPath: string | undefined,
): RunDailyManifestStatus {
  const manifestPath = resolveRunDailyManifestCandidate(env, scriptPath);
  if (!manifestPath || !existsSync(/* turbopackIgnore: true */ manifestPath)) {
    return {
      failedRequiredSteps: [],
      optionalSkips: [],
      downstreamSkips: [],
    };
  }

  try {
    const raw = readBoundedFileTail(manifestPath, 64 * 1024);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      manifestPath,
      finalStatus: normalizeFinalStatus(parsed.finalStatus),
      finalExitCode: typeof parsed.finalExitCode === 'number' ? parsed.finalExitCode : undefined,
      failedRequiredSteps: toStringList(parsed.failedRequiredSteps),
      optionalSkips: toStringList(parsed.optionalSkips),
      downstreamSkips: toStringList(parsed.downstreamSkips),
      noWorkShortCircuit: typeof parsed.noWorkShortCircuit === 'boolean' ? parsed.noWorkShortCircuit : undefined,
      policyMode: typeof parsed.policyMode === 'string' ? parsed.policyMode : undefined,
    };
  } catch (error) {
    return {
      manifestPath,
      failedRequiredSteps: [],
      optionalSkips: [],
      downstreamSkips: [],
      detail: error instanceof Error ? error.message : 'manifest_parse_failed',
    };
  }
}

export function readBoundedFileTail(filePath: string, maxBytes = RUN_DAILY_LOG_TAIL_BYTES): string {
  const stats = statSync(/* turbopackIgnore: true */ filePath);
  const length = Math.max(0, Math.min(stats.size, Math.max(1024, maxBytes)));
  const offset = Math.max(0, stats.size - length);
  const buffer = Buffer.alloc(length);
  const fd = openSync(/* turbopackIgnore: true */ filePath, 'r');
  try {
    readSync(fd, buffer, 0, length, offset);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8');
}

function parseKoreanSummarySection(text: string, headingPattern: RegExp): string[] {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (headingPattern.test(line)) {
      collecting = true;
      continue;
    }

    if (collecting && /^\[[0-9:]+\]/.test(line) && !line.includes(' - ')) {
      break;
    }

    if (collecting) {
      const match = line.match(/\s-\s(.+)$/);
      if (match?.[1]) output.push(match[1].trim());
    }
  }

  return output;
}

export function parseRunDailyLogTailStatus(logPath: string | undefined): RunDailyManifestStatus {
  if (!logPath || !existsSync(/* turbopackIgnore: true */ logPath)) {
    return {
      failedRequiredSteps: [],
      optionalSkips: [],
      downstreamSkips: [],
    };
  }

  try {
    const tail = readBoundedFileTail(logPath);
    const failedRequiredSteps = parseKoreanSummarySection(tail, /실패한 필수 단계 요약/);
    const optionalSkips = parseKoreanSummarySection(tail, /선택적으로 건너뛴 단계 요약/);
    const downstreamSkips = parseKoreanSummarySection(tail, /연쇄적으로 건너뛴 단계 요약/);
    const finalStatus = failedRequiredSteps.length > 0
      ? 'ERROR'
      : optionalSkips.length > 0 || downstreamSkips.length > 0
        ? 'WARN'
        : undefined;

    return {
      finalStatus,
      failedRequiredSteps,
      optionalSkips,
      downstreamSkips,
    };
  } catch (error) {
    return {
      failedRequiredSteps: [],
      optionalSkips: [],
      downstreamSkips: [],
      detail: error instanceof Error ? error.message : 'log_parse_failed',
    };
  }
}

export function isRunDailyScriptExecutable(scriptPath: string | undefined): boolean {
  if (!scriptPath) return false;

  try {
    const stats = statSync(/* turbopackIgnore: true */ scriptPath);
    return stats.isFile() && (stats.mode & 0o111) > 0;
  } catch {
    return false;
  }
}

export function resolveFrameCaptionDataSource(env: NodeJS.ProcessEnv): {
  configured: boolean;
  available: boolean;
  path?: string;
} {
  const explicitPath = resolveConfiguredPath(pickFirstEnvValue(env, ['INSIGHT_FRAME_CAPTION_BASE_PATH']));
  const fallbackPath = resolveFromRuntimeCwd(FRAME_CAPTION_DATA_RELATIVE_PATH);
  let configured = false;
  let available = false;
  let localPath: string | undefined;

  if (explicitPath) {
    configured = true;
    if (existsSync(/* turbopackIgnore: true */ explicitPath)) {
      const stats = statSync(/* turbopackIgnore: true */ explicitPath);
      if (stats.isDirectory()) {
        available = true;
        localPath = explicitPath;
      }
    }
  } else if (existsSync(/* turbopackIgnore: true */ fallbackPath)) {
    const stats = statSync(/* turbopackIgnore: true */ fallbackPath);
    if (stats.isDirectory()) {
      available = true;
      localPath = fallbackPath;
    }
  }

  return {
    configured,
    available,
    ...(localPath ? { path: localPath } : {}),
  };
}

export function resolveFrameCaptionGdrivePath(env: NodeJS.ProcessEnv): string | undefined {
  const raw = pickFirstEnvValue(env, ['INSIGHT_GDRIVE_FRAME_CAPTION_PATH', 'GDRIVE_REMOTE_PATH']);
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (/^gs:\/\//i.test(trimmed)) {
    const withoutPrefix = trimmed.slice(5).replace(/^\/+|\/+$/g, '');
    if (!withoutPrefix) return undefined;
    const encoded = withoutPrefix.replace(/\/+$/g, '');
    return `https://storage.googleapis.com/${encoded}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return undefined;
    }
  }

  return trimmed;
}
