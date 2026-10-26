'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { readMyPageRouteState, writeMyPageRouteState } from '@/lib/mypage-route-state';

export function useMyPageScrollRestoration(ref: RefObject<HTMLDivElement | null>, path: string | null, ready: boolean) {
  const restoring = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!ready || !path || !element) return;
    const target = readMyPageRouteState(path).scrollTop ?? 0;
    restoring.current = true;
    let stopped = false;
    const stop = () => { stopped = true; restoring.current = false; observer.disconnect(); };
    const restore = () => {
      if (stopped) return;
      element.scrollTop = target;
      if (element.scrollHeight - element.clientHeight >= target) stop();
    };
    // Cached content may arrive after the layout commits. Stop once its height
    // can accommodate the saved position, or when the user starts interacting.
    const observer = new MutationObserver(restore);
    observer.observe(element, { childList: true, subtree: true });
    const frame = requestAnimationFrame(restore);
    element.addEventListener('wheel', stop, { passive: true });
    element.addEventListener('touchstart', stop, { passive: true });
    element.addEventListener('pointerdown', stop);
    element.addEventListener('keydown', stop);
    return () => {
      stop(); cancelAnimationFrame(frame);
      element.removeEventListener('wheel', stop); element.removeEventListener('touchstart', stop);
      element.removeEventListener('pointerdown', stop); element.removeEventListener('keydown', stop);
    };
  }, [path, ready, ref]);
  return (element: HTMLDivElement) => {
    if (path && ready && !restoring.current) writeMyPageRouteState(path, { scrollTop: element.scrollTop });
  };
}
