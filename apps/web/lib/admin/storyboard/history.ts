import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { stripUntrustedStoryboardGeneratedImages } from './image-trust';
import type { StoryboardGenerationResult } from './types';

export const STORYBOARD_LOCAL_HISTORY_WRITE_ENV = 'STORYBOARD_LOCAL_HISTORY_WRITE';
const STORYBOARD_HISTORY_DIR = 'public/qa-history/storyboard';
const HISTORY_LIMIT = 40;

let localHistoryWriteQueue: Promise<unknown> = Promise.resolve();

type StoryboardHistoryEnv = Pick<NodeJS.ProcessEnv, 'NODE_ENV'> & Record<string, string | undefined>;

type PersistStoryboardHistoryOptions = {
  historyDir?: string;
  now?: Date;
};

type StoryboardHistoryEntry = {
  generatedAt: string;
  jsonPath: string;
  mode: StoryboardGenerationResult['mode'];
  title: string;
  scenes: number;
  trustedImages: number;
};

function isLocalHistoryWriteEnabled(env: StoryboardHistoryEnv) {
  return env.NODE_ENV !== 'production' && env[STORYBOARD_LOCAL_HISTORY_WRITE_ENV] === '1';
}

function safeHistoryTimestamp(value: string) {
  const parsed = Number.isFinite(Date.parse(value)) ? new Date(value) : new Date();
  return parsed.toISOString().replace(/[:.]/g, '-');
}

function assertSafeHistoryPath(root: string, target: string) {
  const safeRoot = resolve(root);
  const safeTarget = resolve(target);
  const pathFromRoot = relative(safeRoot, safeTarget);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new Error('storyboard_history_path_escape');
  }
  return safeTarget;
}

function countTrustedImages(result: StoryboardGenerationResult) {
  return result.storyboard.scenes.filter((scene) => scene.generatedImage).length;
}

function toHistoryEntry(result: StoryboardGenerationResult, jsonPath: string): StoryboardHistoryEntry {
  return {
    generatedAt: result.generatedAt,
    jsonPath,
    mode: result.mode,
    title: result.storyboard.title,
    scenes: result.storyboard.scenes.length,
    trustedImages: countTrustedImages(result),
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function readHistoryEntries(historyPath: string): Promise<StoryboardHistoryEntry[]> {
  try {
    const payload = JSON.parse(await readFile(historyPath, 'utf8')) as { runs?: unknown };
    return Array.isArray(payload.runs)
      ? payload.runs.filter((run): run is StoryboardHistoryEntry => {
        if (!run || typeof run !== 'object') return false;
        const entry = run as Partial<StoryboardHistoryEntry>;
        return typeof entry.generatedAt === 'string' && typeof entry.jsonPath === 'string';
      })
      : [];
  } catch {
    return [];
  }
}

async function persistLocalStoryboardHistoryNow(
  result: StoryboardGenerationResult,
  options: PersistStoryboardHistoryOptions,
) {
  const historyRoot = resolve(options.historyDir ?? join(process.cwd(), STORYBOARD_HISTORY_DIR));
  const timestamp = safeHistoryTimestamp(result.generatedAt || options.now?.toISOString() || new Date().toISOString());
  const jsonFileName = `${timestamp}.json`;
  const latestJsonPath = assertSafeHistoryPath(historyRoot, join(historyRoot, 'latest-real-data.json'));
  const runJsonPath = assertSafeHistoryPath(historyRoot, join(historyRoot, jsonFileName));
  const historyJsonPath = assertSafeHistoryPath(historyRoot, join(historyRoot, 'history-real-data.json'));
  const latestHtmlPath = assertSafeHistoryPath(historyRoot, join(historyRoot, 'latest-real-data.html'));
  const runHtmlPath = assertSafeHistoryPath(historyRoot, join(historyRoot, `${timestamp}.html`));
  const sanitized = stripUntrustedStoryboardGeneratedImages(result);
  const persistedAt = (options.now ?? new Date()).toISOString();
  const wrapped = {
    generatedAt: persistedAt,
    result: sanitized,
    provenance: {
      persistedBy: 'admin-storyboard-route',
      localOnly: true,
      trustPolicy: 'stripUntrustedStoryboardGeneratedImages',
    },
  };
  const rawJson = `${JSON.stringify(wrapped, null, 2)}\n`;

  await mkdir(dirname(runJsonPath), { recursive: true });
  await writeFile(runJsonPath, rawJson, 'utf8');
  await writeFile(latestJsonPath, rawJson, 'utf8');

  const previousRuns = await readHistoryEntries(historyJsonPath);
  const nextEntry = toHistoryEntry(sanitized, `./${jsonFileName}`);
  const runs = [
    nextEntry,
    ...previousRuns.filter((entry) => entry.jsonPath !== nextEntry.jsonPath),
  ].slice(0, HISTORY_LIMIT);
  await writeFile(
    historyJsonPath,
    `${JSON.stringify({ updatedAt: persistedAt, runs }, null, 2)}\n`,
    'utf8',
  );

  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>스토리보드 히스토리</title><body><main><h1>스토리보드 히스토리</h1><p>${escapeHtml(sanitized.storyboard.title)}</p><p>${sanitized.storyboard.scenes.length}컷 · 신뢰 이미지 ${nextEntry.trustedImages}</p><p><a href="./${escapeHtml(jsonFileName)}">raw JSON</a></p></main></body>`;
  await writeFile(runHtmlPath, html, 'utf8');
  await writeFile(latestHtmlPath, `<!doctype html><meta http-equiv="refresh" content="0; url=./${timestamp}.html"><a href="./${timestamp}.html">latest</a>`, 'utf8');

  return {
    persisted: true as const,
    latestJsonPath,
    runJsonPath,
    historyJsonPath,
    trustedImages: nextEntry.trustedImages,
  };
}


export async function persistLocalStoryboardHistory(
  result: StoryboardGenerationResult,
  env: StoryboardHistoryEnv = process.env,
  options: PersistStoryboardHistoryOptions = {},
) {
  if (!isLocalHistoryWriteEnabled(env)) {
    return { persisted: false as const, reason: 'disabled' as const };
  }

  const writeTask = localHistoryWriteQueue.then(() =>
    persistLocalStoryboardHistoryNow(result, options),
  );
  localHistoryWriteQueue = writeTask.catch(() => undefined);
  return writeTask;
}
