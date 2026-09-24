import { useLayoutEffect, useRef, useState } from "react";

export function useFilledSkeletonCount(rowPx: number, minimum: number, headerPx = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const [count, setCount] = useState(minimum);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      if (locked.current) return;
      const pane = findHeightPane(node);
      if (!pane) return;
      const paneRect = pane.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const offset = Math.max(0, nodeRect.top - paneRect.top);
      const available = Math.max(0, pane.clientHeight - offset - headerPx);
      if (available <= 0) return;
      locked.current = true;
      setCount(Math.max(minimum, Math.ceil(available / rowPx)));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    const pane = findHeightPane(node);
    if (pane && pane !== node) observer.observe(pane);
    return () => observer.disconnect();
  }, [headerPx, minimum, rowPx]);

  return { ref, count };
}

function findHeightPane(node: HTMLElement) {
  let current: HTMLElement | null = node;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    const clips = overflowY === "auto" || overflowY === "hidden" || overflowY === "scroll";
    if (current === document.body || current === document.documentElement) return null;
    if (clips && current.clientHeight > 0) return current;
    current = current.parentElement;
  }
  return null;
}
