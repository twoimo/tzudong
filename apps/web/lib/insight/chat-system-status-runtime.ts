import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const FRAME_CAPTION_DATA_RELATIVE_PATH = 'backend/restaurant-crawling/data/tzuyang/frame-caption';
const RUN_DAILY_STALE_HOURS = 36;
const RUN_DAILY_LOG_FILENAME_PREFIX = 'daily_';

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
