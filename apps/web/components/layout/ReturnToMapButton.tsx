"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function canUseBrowserBack() {
  if (typeof window === "undefined" || window.history.length <= 1) return false;
  if (!document.referrer) return true;

  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

type ReturnToMapButtonProps = {
  label?: string;
  fallbackHref?: string;
  iconOnly?: boolean;
  className?: string;
};

export function ReturnToMapButton({
  label = "뒤로가기",
  fallbackHref = "/",
  iconOnly = false,
  className,
}: ReturnToMapButtonProps) {
  const router = useRouter();

  const handleReturn = useCallback(() => {
    if (canUseBrowserBack()) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  }, [fallbackHref, router]);

  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? "icon" : "sm"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background/80 text-muted-foreground shadow-sm transition-colors hover:bg-secondary/80 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background",
        iconOnly ? "h-8 w-8" : "h-9 px-3 text-xs font-semibold",
        className,
      )}
      onClick={handleReturn}
      aria-label={iconOnly ? label : undefined}
      title={label}
      data-return-to-map-button="true"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      <span className={cn(iconOnly && "sr-only")}>{label}</span>
    </Button>
  );
}
