"use client";

import { useEffect } from "react";

/** Animate opted-in panels once; never animate table rows or virtualized items. */
export function ScrollEffects() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!window.IntersectionObserver || media.matches) return;

    const seen = new WeakSet<Element>();
    const waiting = new Set<HTMLElement>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        element.dataset.revealState = "visible";
        waiting.delete(element);
        observer.unobserve(element);
      }
    }, { threshold: 0.08 });

    const discover = () => {
      waiting.forEach((element) => {
        if (element.isConnected) return;
        observer.unobserve(element); waiting.delete(element);
      });
      document.querySelectorAll<HTMLElement>("[data-scroll-reveal]").forEach((element) => {
        if (seen.has(element) || waiting.size >= 40 || media.matches) return;
        seen.add(element);
        const rect = element.getBoundingClientRect();
        // Above-fold content appears immediately; off-screen content reveals on entry.
        if (rect.top < window.innerHeight && rect.bottom > 0) return;
        element.dataset.revealState = "waiting";
        waiting.add(element);
        observer.observe(element);
      });
    };
    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => { frame = undefined; discover(); });
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    const stopMotion = () => {
      if (!media.matches) return;
      observer.disconnect();
      waiting.forEach((element) => { delete element.dataset.revealState; });
      waiting.clear();
    };
    media.addEventListener("change", stopMotion);
    discover();
    return () => {
      mutations.disconnect();
      observer.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      media.removeEventListener("change", stopMotion);
      waiting.forEach((element) => { delete element.dataset.revealState; });
    };
  }, []);
  return null;
}
