"use client";

import { LocalStoryboardWorkspace } from "./LocalStoryboardWorkspace";
import type { StoryboardInitialResult } from "@/lib/admin/storyboard/initial-result";
import Image from "next/image";
import { getTrustedStoryboardGeneratedImage } from "@/lib/admin/storyboard/image-trust";
import { sanitizeStoryboardPublicText } from "@/lib/admin/storyboard/prompt-safety";

/** Gemini-only entrypoint. Previous documents remain readable through the production store. */
export function AdminStoryboardGenerator({ initialStoryboardResult }: { initialStoryboardResult?: StoryboardInitialResult | null } = {}) {
  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-admin-storyboard-workspace="true">
    <div id="admin-storyboard-selected-workspace" className="min-h-0 min-w-0 flex-1 overflow-auto">
      {initialStoryboardResult && <details className="mx-4 mt-4 rounded-xl border border-border bg-card p-4" data-storyboard-archive="read-only">
        <summary className="cursor-pointer text-sm font-medium">이전 스토리보드 기록 · {sanitizeStoryboardPublicText(initialStoryboardResult.result.storyboard.title)}</summary>
        <p className="mt-2 text-xs text-muted-foreground">저장된 결과입니다. 새 생성은 아래 Gemini 작업 공간에서 진행하세요.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {initialStoryboardResult.result.storyboard.scenes.map((scene) => {
            const image = getTrustedStoryboardGeneratedImage(scene.generatedImage);
            return <article key={scene.sceneNo} className="min-w-0 overflow-hidden rounded-lg border border-border">
              {image && <Image src={image.dataUrl} alt={sanitizeStoryboardPublicText(scene.title)} width={1024} height={576}
                unoptimized className="aspect-video w-full object-cover" />}
              <div className="space-y-2 break-words p-3 text-sm [overflow-wrap:anywhere]">
                <h3 className="font-semibold">{scene.sceneNo}. {sanitizeStoryboardPublicText(scene.title)}</h3>
                <p className="text-xs text-muted-foreground">{scene.durationSec}초{image && ` · 기록 모델 ${image.model}`}</p>
                <p>{sanitizeStoryboardPublicText(scene.visualDirection)}</p>
                <p>{sanitizeStoryboardPublicText(scene.hostBeat)}</p>
              </div>
            </article>;
          })}
        </div>
      </details>}
      <LocalStoryboardWorkspace />
    </div>
  </div>;
}
