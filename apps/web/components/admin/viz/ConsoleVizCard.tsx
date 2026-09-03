"use client";

import type { ReactNode } from "react";

import type { ConsoleVizBinding } from "@/lib/admin/console-visualization-map";
import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";
import type { ConsoleVizState } from "@/lib/admin/console-viz-state";
import { cn } from "@/lib/utils";

import { ConsoleCardMetaRow } from "./ConsoleCardMetaRow";
import { ConsoleVizSummary } from "./ConsoleVizSummary";
import { useVizValueHint } from "./use-viz-value-hint";

export function ConsoleVizCard({
  binding,
  state,
  metaLeft,
  metaRight,
  children,
  extraMessage,
}: {
  binding: ConsoleVizBinding;
  state: ConsoleVizState;
  metaLeft: string;
  metaRight: string;
  children?: ReactNode;
  extraMessage?: string;
}) {
  const { hint, show, hide } = useVizValueHint();
  const canRenderShape = state.kind === "ready";
  const summarySeries =
    state.kind === "ready" || state.kind === "insufficient" ? state.series : [];
  const sparseSeriesLabels =
    state.kind === "ready" ? state.sparseSeriesLabels : [];

  let statusMessage: string | null = null;
  if (state.kind === "error") {
    statusMessage = CONSOLE_FIXED_MESSAGES.vizFailed;
  } else if (state.kind === "empty") {
    statusMessage = CONSOLE_FIXED_MESSAGES.vizEmpty;
  } else if (state.kind === "insufficient") {
    statusMessage = CONSOLE_FIXED_MESSAGES.vizInsufficient;
  }

  return (
    <section
      className="flex min-w-0 flex-col gap-2 border border-[var(--admin-hairline)] bg-[var(--card)] p-3"
      style={{ borderRadius: "var(--admin-card-radius)" }}
      data-admin-viz-card="true"
      data-admin-viz-menu={binding.menuId}
      data-admin-viz-form={binding.form}
      data-admin-viz-state={state.kind}
    >
      <p className="text-sm font-semibold text-[var(--admin-tone-1)]">
        {binding.question}
      </p>
      <p className="text-[11px] text-[var(--admin-tone-2)]">
        {binding.sourceLabel}
      </p>
      {canRenderShape ? (
        <div aria-hidden="true" data-admin-viz-shape="true">
          {children}
        </div>
      ) : null}
      {statusMessage ? (
        <p className="text-xs text-[var(--admin-tone-2)]">{statusMessage}</p>
      ) : null}
      {extraMessage ? (
        <p className="text-xs text-[var(--admin-tone-2)]">{extraMessage}</p>
      ) : null}
      {summarySeries.length > 0 || sparseSeriesLabels.length > 0 ? (
        <ConsoleVizSummary
          series={summarySeries}
          sparseSeriesLabels={sparseSeriesLabels}
          activeKey={hint?.key ?? null}
          onShow={show}
          onHide={hide}
        />
      ) : null}
      {hint ? (
        <p
          className={cn(
            "rounded-[var(--admin-control-radius)] bg-[var(--admin-tone-6)] px-2 py-1 text-[11px] text-[var(--admin-tone-1)]",
          )}
          data-admin-viz-value-hint="true"
        >
          {hint.label} {hint.value}
        </p>
      ) : null}
      <ConsoleCardMetaRow left={metaLeft} right={metaRight} />
    </section>
  );
}
