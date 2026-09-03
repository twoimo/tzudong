"use client";

import type { ComponentType } from "react";

import type { ConsoleVizForm } from "@/lib/admin/console-visualization-map";

import { ActivityHeatmap } from "./ActivityHeatmap";
import { BulletBar } from "./BulletBar";
import { CompactSparklineRow } from "./CompactSparklineRow";
import { KpiSparklineCard } from "./KpiSparklineCard";
import { RangeBandArea } from "./RangeBandArea";
import { SemicircleGaugeArc } from "./SemicircleGaugeArc";
import { StageFunnel } from "./StageFunnel";
import { ToneStackedBar } from "./ToneStackedBar";
import { TreemapTile } from "./TreemapTile";
import { WaterfallDeltaStep } from "./WaterfallDeltaStep";
import type { ConsoleVizFormProps } from "./viz-form-props";

export const CONSOLE_VIZ_FORM_COMPONENTS = {
  "kpi-sparkline-card": KpiSparklineCard,
  "semicircle-gauge-arc": SemicircleGaugeArc,
  "treemap-tile": TreemapTile,
  "range-band-area": RangeBandArea,
  "tone-stacked-bar": ToneStackedBar,
  "waterfall-delta-step": WaterfallDeltaStep,
  "stage-funnel": StageFunnel,
  "bullet-bar": BulletBar,
  "activity-heatmap": ActivityHeatmap,
  "compact-sparkline-row": CompactSparklineRow,
} as const satisfies Record<ConsoleVizForm, ComponentType<ConsoleVizFormProps>>;

export function ConsoleVizFormRenderer(props: ConsoleVizFormProps) {
  const Form = CONSOLE_VIZ_FORM_COMPONENTS[props.binding.form];
  return <Form {...props} />;
}
