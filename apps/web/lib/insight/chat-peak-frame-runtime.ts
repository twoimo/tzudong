import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { InsightChatSource } from '@/types/insight';

const FRAME_CAPTION_DEFAULT_RELATIVE_PATH = 'backend/restaurant-crawling/data/tzuyang/frame-caption';

type PeakFrameEvidenceVideo = {
  videoId: string;
  title: string;
  youtubeLink: string;
};

function resolveFrameCaptionBasePath(): string {
  const explicit = process.env.INSIGHT_FRAME_CAPTION_BASE_PATH?.trim();
  if (explicit) {
    return path.isAbsolute(explicit)
      ? explicit
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), explicit);
  }
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    FRAME_CAPTION_DEFAULT_RELATIVE_PATH,
  );
}

export function resolveFrameCaptionGdriveHintPath(): string | null {
  const raw = process.env.INSIGHT_GDRIVE_FRAME_CAPTION_PATH?.trim() || process.env.GDRIVE_REMOTE_PATH?.trim() || '';
  return raw || null;
}

function normalizeEvidenceLink(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) return undefined;
  return value;
}

function formatPeakFrameTimestamp(startSec: unknown, endSec: unknown): string {
  const start = typeof startSec === 'number' && Number.isFinite(startSec) ? Math.max(0, Math.floor(startSec)) : null;
  const end = typeof endSec === 'number' && Number.isFinite(endSec) ? Math.max(0, Math.floor(endSec)) : null;
  if (start == null || end == null || end < start) return '-';

  const toClock = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  return `${toClock(start)}~${toClock(end)}`;
}

export async function loadPeakFrameEvidenceSources(
  videos: PeakFrameEvidenceVideo[],
): Promise<{ sources: InsightChatSource[]; hasAnyFile: boolean }> {
  const basePath = resolveFrameCaptionBasePath();
  let hasAnyFile = false;
  const sources: InsightChatSource[] = [];

  for (const video of videos.slice(0, 4)) {
    const filePath = path.resolve(/* turbopackIgnore: true */ basePath, `${video.videoId}.jsonl`);
    if (!existsSync(/* turbopackIgnore: true */ filePath)) continue;
    hasAnyFile = true;

    let payload = '';
    try {
      payload = await readFile(/* turbopackIgnore: true */ filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = payload.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let row: Record<string, unknown> | null = null;
      try {
        row = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!row) continue;

      const rowVideoId = typeof row.video_id === 'string' ? row.video_id : video.videoId;
      if (rowVideoId !== video.videoId) continue;

      const rawCaption = typeof row.raw_caption === 'string' ? row.raw_caption.trim() : '';
      const parsedJson = row.parsed_json && typeof row.parsed_json === 'object'
        ? row.parsed_json as Record<string, unknown>
        : null;
      const parsedCaption = parsedJson && typeof parsedJson.chronological_analysis === 'string'
        ? parsedJson.chronological_analysis.trim()
        : '';
      const text = rawCaption || parsedCaption;
      if (!text) continue;

      const files = Array.isArray(row.file_names) ? row.file_names : [];
      const frameLink = normalizeEvidenceLink(files[0]);
      const assetLink = normalizeEvidenceLink(files[1]) || frameLink;

      sources.push({
        videoTitle: video.title || video.videoId,
        youtubeLink: video.youtubeLink,
        timestamp: formatPeakFrameTimestamp(row.start_sec, row.end_sec),
        text: text.slice(0, 320),
        ...(frameLink ? { frameLink } : {}),
        ...(assetLink ? { assetLink } : {}),
      });
    }
  }

  return {
    sources,
    hasAnyFile,
  };
}
