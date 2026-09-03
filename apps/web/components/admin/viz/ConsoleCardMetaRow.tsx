import { truncateConsoleMetaText } from "@/lib/admin/console-viz-state";

export function ConsoleCardMetaRow({
  left,
  right,
}: {
  left: string;
  right: string;
}) {
  return (
    <div
      className="flex min-h-4 items-center justify-between gap-2 border-t border-[var(--admin-hairline)] pt-1.5 font-mono text-[11px] leading-4"
      data-admin-viz-meta-row="true"
    >
      <span className="min-w-0 flex-1 truncate text-[var(--admin-tone-2)]">
        {truncateConsoleMetaText(left)}
      </span>
      <span className="shrink-0 tabular-nums text-[var(--admin-tone-1)]">
        {right}
      </span>
    </div>
  );
}
