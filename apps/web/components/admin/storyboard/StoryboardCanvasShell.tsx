import type { CSSProperties, ReactNode } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StoryboardCanvasShellProps = {
  children: ReactNode;
};

export function StoryboardCanvasShell({ children }: StoryboardCanvasShellProps) {
  return (
    <Card
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none max-[1099px]:!overflow-visible max-[1099px]:![grid-row:2]"
      aria-label="스토리보드 이미지 생성 결과"
      role="region"
      data-storyboard-result-panel="image-frames-only"
      data-scroll-owner="storyboard-canvas"
      data-storyboard-pane-role="canvas"
      data-storyboard-scroll-mode="clip-boundary"
      data-layout-primitives="panel-layout frame stack"
      style={{
        gridColumn: "var(--storyboard-result-panel-column, 1)",
        gridRow: "var(--storyboard-result-panel-row, 1)",
        minWidth: 0,
      }}
    >
      {children}
    </Card>
  );
}

export function StoryboardCanvasHeader({ children }: StoryboardCanvasShellProps) {
  return (
    <CardHeader className="flex min-w-0 shrink-0 flex-row items-center gap-2 p-2 pb-1">
      {children}
    </CardHeader>
  );
}

export function StoryboardCanvasContent({
  children,
  isSingleFrame,
}: StoryboardCanvasShellProps & {
  isSingleFrame: boolean;
}) {
  return (
    <CardContent
      className={cn(
        "min-h-0 min-w-0 flex-1 overflow-x-hidden p-3 pt-0 max-[1099px]:!overflow-visible",
        isSingleFrame ? "overflow-hidden" : "overflow-y-auto",
      )}
      data-scroll-owner="storyboard-readback"
      data-storyboard-pane-role="readback"
      data-storyboard-scroll-mode="desktop-readback narrow-parent"
      data-layout-primitives="frame stack"
    >
      {children}
    </CardContent>
  );
}

export function StoryboardFrameGrid({
  children,
  activePage,
  pageSize,
  style,
}: StoryboardCanvasShellProps & {
  activePage: number;
  pageSize: number;
  style: CSSProperties;
}) {
  return (
    <div
      className="relative grid min-h-0 min-w-0 flex-1 gap-2"
      data-storyboard-image-board="true"
      data-storyboard-frame-grid="true"
      data-storyboard-frame-fill="true"
      data-storyboard-frame-page={String(activePage + 1)}
      data-storyboard-frame-page-size={String(pageSize)}
      data-storyboard-frame-view-mode={String(pageSize)}
      style={style}
    >
      {children}
    </div>
  );
}
