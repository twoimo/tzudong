"use client";

import { LocalStoryboardWorkspace } from "./LocalStoryboardWorkspace";
import type { StoryboardInitialResult } from "@/lib/admin/storyboard/initial-result";

/** Gemini-only entrypoint. Previous documents remain readable through the production store. */
export function AdminStoryboardGenerator(_props: { initialStoryboardResult?: StoryboardInitialResult | null } = {}) {
  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-admin-storyboard-workspace="true">
    <div id="admin-storyboard-selected-workspace" className="min-h-0 min-w-0 flex-1 overflow-auto">
      <LocalStoryboardWorkspace />
    </div>
  </div>;
}
