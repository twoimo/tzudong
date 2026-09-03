"use client";

import { useEffect, useState } from "react";

import { CONSOLE_TONE_STEP_IDS } from "@/lib/admin/console-tone-scale";

export type ConsoleToneScaleValue = {
  readonly tones: readonly string[];
  readonly statusError: string;
  readonly hairline: string;
  readonly axis: string;
  readonly resolved: boolean;
};

const UNRESOLVED_SCALE: ConsoleToneScaleValue = {
  tones: ["", "", "", "", "", ""],
  statusError: "",
  hairline: "",
  axis: "",
  resolved: false,
};

function readToneScale(host: Element): ConsoleToneScaleValue {
  const style = getComputedStyle(host);
  const tones = CONSOLE_TONE_STEP_IDS.map((step) =>
    style.getPropertyValue(`--admin-tone-${step}`).trim(),
  );
  const statusError = style.getPropertyValue("--admin-status-error").trim();
  const hairline = style.getPropertyValue("--admin-hairline").trim();
  const axis =
    style.getPropertyValue("--muted-foreground").trim().length > 0
      ? `hsl(${style.getPropertyValue("--muted-foreground").trim()})`
      : hairline;

  return {
    tones,
    statusError,
    hairline,
    axis,
    resolved:
      tones.every((tone) => tone.length > 0) &&
      statusError.length > 0 &&
      hairline.length > 0,
  };
}

export function useConsoleToneScale(): ConsoleToneScaleValue {
  const [scale, setScale] = useState<ConsoleToneScaleValue>(UNRESOLVED_SCALE);

  useEffect(() => {
    const host =
      document.querySelector('[data-admin-console-tone-scale="v1"]') ??
      document.documentElement;

    const refresh = () => {
      setScale(readToneScale(host));
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return scale;
}
