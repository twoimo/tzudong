"use client";

import { useMemo } from "react";
import { hierarchy, treemap, treemapResquarify } from "d3-hierarchy";

import {
  countableConsoleVizPoints,
  getRenderableConsoleVizSeries,
  resolveConsoleVizFormState,
} from "@/lib/admin/console-viz-state";

import { ConsoleVizCard } from "./ConsoleVizCard";
import type { ConsoleVizFormProps } from "./viz-form-props";
import { paintConsoleSeries } from "./viz-paint";
import { useConsoleToneScale } from "@/hooks/use-console-tone-scale";

const WIDTH = 320;
const HEIGHT = 160;

export function TreemapTile({
  binding,
  requestStatus,
  series,
  metaLeft,
  metaRight,
}: ConsoleVizFormProps) {
  const state = resolveConsoleVizFormState(binding, requestStatus, series);
  const scale = useConsoleToneScale();
  const renderable = getRenderableConsoleVizSeries(state, binding.minimumPoints);
  const { paints, requiresNonToneChannel } = paintConsoleSeries(
    renderable.length,
    scale.tones,
    scale.resolved,
  );
  const tiles = useMemo(() => {
    if (renderable.length === 0) return [];
    const root = hierarchy({
      children: renderable.map((item) => ({
        label: item.label,
        value: Math.max(0, countableConsoleVizPoints(item).at(-1) ?? 0),
      })),
    }).sum((node) => ("value" in node ? node.value : 0));
    treemap()
      .tile(treemapResquarify)
      .size([WIDTH, HEIGHT])
      .padding(2)(root);
    return (root.leaves() as Array<{
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      data: { label: string };
    }>).map((leaf, index) => ({
      ...leaf,
      paint: paints[index],
    }));
  }, [paints, renderable]);

  return (
    <ConsoleVizCard
      binding={binding}
      state={state}
      metaLeft={metaLeft}
      metaRight={metaRight}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-40 w-full" focusable="false">
        {tiles.map((tile) => (
          <g key={tile.data.label}>
            <rect
              x={tile.x0}
              y={tile.y0}
              width={Math.max(0, tile.x1 - tile.x0)}
              height={Math.max(0, tile.y1 - tile.y0)}
              fill={tile.paint?.fill}
              stroke={tile.paint?.stroke}
              strokeWidth={tile.paint?.strokeWidth}
            />
            {requiresNonToneChannel || tile.x1 - tile.x0 > 36 ? (
              <text
                x={(tile.x0 + tile.x1) / 2}
                y={(tile.y0 + tile.y1) / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                className="fill-[var(--admin-tone-1)]"
              >
                {tile.data.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </ConsoleVizCard>
  );
}
