"use client";

import { useCallback, useEffect, useState } from "react";

export type ConsoleVizValueHint = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
};

export function useVizValueHint() {
  const [hint, setHint] = useState<ConsoleVizValueHint | null>(null);

  const show = useCallback((next: ConsoleVizValueHint) => {
    setHint(next);
  }, []);

  const hide = useCallback((key?: string) => {
    setHint((current) => {
      if (current == null) return null;
      if (key != null && current.key !== key) return current;
      return null;
    });
  }, []);

  useEffect(() => {
    if (hint == null) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setHint(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hint]);

  return { hint, show, hide };
}
