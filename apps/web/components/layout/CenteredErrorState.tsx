"use client";

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CenteredErrorStateProps = {
  title: string;
  description: string;
  reset: () => void;
  icon?: LucideIcon;
  homeHref?: string;
  homeLabel?: string;
  retryLabel?: string;
  className?: string;
  "data-root-error-boundary"?: string;
};

export function CenteredErrorState({
  title,
  description,
  reset,
  icon: Icon = AlertTriangle,
  homeHref = "/",
  homeLabel = "홈으로 이동",
  retryLabel = "다시 시도",
  className,
  "data-root-error-boundary": rootBoundary,
}: CenteredErrorStateProps) {
  return (
    <main
      className={cn(
        "fixed inset-0 z-[100] flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background px-4 py-8",
        className,
      )}
      data-centered-error-state="viewport"
      data-root-error-boundary={rootBoundary}
    >
      <section
        className="w-full max-w-[360px] rounded-2xl border border-border/70 bg-card/95 p-6 text-center shadow-[0_18px_60px_hsl(24_10%_10%/0.10)] backdrop-blur-sm"
        aria-labelledby="centered-error-title"
        aria-describedby="centered-error-description"
      >
        <div
          className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </div>
        <h2 id="centered-error-title" className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p id="centered-error-description" className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button type="button" onClick={reset} className="h-9 rounded-lg px-3">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {retryLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg px-3"
            onClick={() => {
              window.location.assign(homeHref);
            }}
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            {homeLabel}
          </Button>
        </div>
      </section>
    </main>
  );
}
