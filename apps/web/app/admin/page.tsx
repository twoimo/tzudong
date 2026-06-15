import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { AdminConsoleOverview } from "@/components/admin/AdminConsoleOverview";
import type {
  StoryboardInitialResult,
  StoryboardInitialResultSource,
} from "@/lib/admin/storyboard/initial-result";
import {
  getTrustedStoryboardGeneratedImage,
  stripUntrustedStoryboardGeneratedImages,
} from "@/lib/admin/storyboard/image-trust";
import type { StoryboardGenerationResult } from "@/lib/admin/storyboard/types";
import { getVisibleTrustedStoryboardPageScenes } from "@/lib/admin/storyboard/visible-scenes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORYBOARD_FRAMES_PER_PAGE = 4;
const PUBLIC_DIR = join(process.cwd(), "public");

const STORYBOARD_INITIAL_RESULT_CANDIDATES: Array<{
  source: StoryboardInitialResultSource;
  filePath: string;
  runUrl: string;
}> = [
  {
    source: "latest-history",
    filePath: join(PUBLIC_DIR, "qa-history/storyboard/latest-real-data.json"),
    runUrl: "/qa-history/storyboard/latest-real-data.json",
  },
  {
    source: "shared-seed",
    filePath: join(PUBLIC_DIR, "storyboard-seed/latest-real-data.json"),
    runUrl: "/storyboard-seed/latest-real-data.json",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isStoryboardGenerationResult(
  value: unknown,
): value is StoryboardGenerationResult {
  if (!isRecord(value)) return false;
  const storyboard = value.storyboard;
  const sourceSummary = value.sourceSummary;
  return (
    typeof value.generatedAt === "string" &&
    typeof value.mode === "string" &&
    isRecord(value.request) &&
    isRecord(sourceSummary) &&
    isRecord(storyboard) &&
    typeof storyboard.title === "string" &&
    typeof storyboard.logline === "string" &&
    typeof storyboard.operatorBrief === "string" &&
    typeof storyboard.exportMarkdown === "string" &&
    Array.isArray(storyboard.scenes) &&
    isRecord(value.ahp)
  );
}

function extractStoryboardGenerationResult(
  payload: unknown,
): StoryboardGenerationResult | null {
  if (isStoryboardGenerationResult(payload)) return payload;
  if (!isRecord(payload)) return null;
  return isStoryboardGenerationResult(payload.result) ? payload.result : null;
}

async function isPublicStoryboardImageAvailable(dataUrl: string) {
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl)) return true;
  if (!dataUrl.startsWith("/")) return false;
  const absolutePath = resolve(PUBLIC_DIR, dataUrl.slice(1));
  if (!absolutePath.startsWith(resolve(PUBLIC_DIR))) return false;
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function hasTrustedFirstStoryboardPageImages(
  result: StoryboardGenerationResult,
) {
  const trustedFirstPageScenes = getVisibleTrustedStoryboardPageScenes({
    allScenes: result.storyboard.scenes,
    page: 0,
    pageSize: STORYBOARD_FRAMES_PER_PAGE,
  });
  if (trustedFirstPageScenes.length < STORYBOARD_FRAMES_PER_PAGE) return false;

  const firstPageImageChecks = await Promise.all(
    trustedFirstPageScenes.map((scene) => {
      const image = getTrustedStoryboardGeneratedImage(scene.generatedImage);
      return image ? isPublicStoryboardImageAvailable(image.dataUrl) : false;
    }),
  );

  return firstPageImageChecks.every(Boolean);
}

async function readInitialStoryboardResult(): Promise<StoryboardInitialResult | null> {
  for (const candidate of STORYBOARD_INITIAL_RESULT_CANDIDATES) {
    try {
      const payload = JSON.parse(await readFile(candidate.filePath, "utf8"));
      const parsedResult = extractStoryboardGenerationResult(payload);
      if (!parsedResult) continue;
      const trustedResult = stripUntrustedStoryboardGeneratedImages(parsedResult);
      if (!(await hasTrustedFirstStoryboardPageImages(trustedResult))) continue;
      return {
        result: trustedResult,
        source: candidate.source,
        runUrl: candidate.runUrl,
      };
    } catch {
      // Missing or stale local history is expected; try the next trusted source.
    }
  }

  return null;
}

export default async function AdminPage() {
  const initialStoryboardResult = await readInitialStoryboardResult();

  return <AdminConsoleOverview initialStoryboardResult={initialStoryboardResult} />;
}
