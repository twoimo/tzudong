"use client";

import { useEffect, useRef, useState } from "react";
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from "three";

import {
  badgeViewerClosesOnKey,
  createBadgeViewerSession,
} from "@/lib/evidence-engineering/badge-viewer-session";

const TIER_COLOR = { fire: 0xff6a00, rainbow: 0x7c5cff } as const;

export default function Badge3DViewer({
  tier,
  onClose,
  lowPower = false,
}: {
  tier: "fire" | "rainbow";
  onClose: () => void;
  lowPower?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [staticFallback, setStaticFallback] = useState(lowPower);

  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return;
    const session = createBadgeViewerSession();
    let disposed = false;
    let renderer: WebGLRenderer | null = null;
    let geometry: SphereGeometry | null = null;
    let material: MeshBasicMaterial | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let frame = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const teardownRenderer = () => {
      cancelAnimationFrame(frame);
      geometry?.dispose();
      material?.dispose();
      renderer?.dispose();
      geometry = null;
      material = null;
      renderer = null;
      canvas?.remove();
      canvas = null;
    };

    const showStaticFallback = () => {
      root.setAttribute("data-badge-viewer", "fallback");
      setStaticFallback(true);
    };

    const mount = () => {
      if (disposed) return;
      if (lowPower) {
        root.setAttribute("data-badge-viewer", session.open(true));
        showStaticFallback();
        return;
      }
      try {
        root.setAttribute("data-badge-viewer", session.open(false));
      } catch (error) {
        if (error instanceof Error && error.message === "duplicate_badge_renderer") {
          showStaticFallback();
          return;
        }
        throw error;
      }
      canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 120;
      canvas.setAttribute("aria-hidden", "true");
      host.appendChild(canvas);
      try {
        renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false });
        if (renderer.getContext() == null) throw new Error("webgl_unavailable");
      } catch {
        session.loseContext();
        teardownRenderer();
        showStaticFallback();
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(120, 120, false);
      const scene = new Scene();
      const camera = new PerspectiveCamera(40, 1, 0.1, 10);
      camera.position.z = 2.6;
      geometry = new SphereGeometry(0.62, 32, 20);
      material = new MeshBasicMaterial({ color: TIER_COLOR[tier] });
      const mesh = new Mesh(geometry, material);
      scene.add(mesh);
      const draw = () => {
        if (!reducedMotion) mesh.rotation.y += 0.015;
        renderer?.render(scene, camera);
        frame = requestAnimationFrame(draw);
      };
      draw();
      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        session.loseContext();
        teardownRenderer();
        mount();
      });
    };

    mount();
    root.focus();
    return () => {
      disposed = true;
      teardownRenderer();
      session.release();
    };
  }, [lowPower, tier]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="3D 배지"
      tabIndex={0}
      data-badge-3d={tier}
      data-badge-viewer={lowPower ? "fallback" : "viewer"}
      onKeyDown={(event) => {
        if (badgeViewerClosesOnKey(event.key)) onClose();
      }}
    >
      <div ref={hostRef} />
      {staticFallback ? <p>정적 배지로 표시합니다.</p> : null}
      <button type="button" onClick={onClose}>닫기</button>
    </div>
  );
}
