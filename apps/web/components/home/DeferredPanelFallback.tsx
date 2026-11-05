"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { LoadingPreview } from "@/components/ui/loading-surface";
import { MapPanelHeader } from "@/components/home/map-panel-chrome";

/** Keep the selected destination visible while its code is loading or unavailable. */
export function DeferredPanelFallback({ title, failed, onRetry, onClose }: {
  title: string;
  failed: boolean;
  onRetry: () => void;
  onClose?: () => void;
}) {
  const statusRef = useRef<HTMLDivElement>(null);
  const wasFailed = useRef(false);
  useEffect(() => {
    if (wasFailed.current && !failed) statusRef.current?.focus();
    wasFailed.current = failed;
  }, [failed]);
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`${title} 패널`}>
      <MapPanelHeader title={title} onClose={onClose} />
      <div ref={statusRef} tabIndex={-1} role={failed ? "alert" : undefined}
        aria-live={failed ? "polite" : undefined} aria-busy={!failed} className="space-y-4 p-4 outline-none"
        data-deferred-panel-state={failed ? "error" : "loading"}>
        {failed ? (
          <>
            <p className="text-sm text-muted-foreground">화면을 불러오지 못했어요. 다시 시도해 주세요.</p>
            <Button variant="outline" onClick={onRetry}>다시 시도</Button>
          </>
        ) : (
          <LoadingPreview
            kind="list"
            rows={3}
            showHeader={false}
            label={title + " 불러오는 중"}
            className="min-h-60"
          />
        )}
      </div>
    </section>
  );
}
