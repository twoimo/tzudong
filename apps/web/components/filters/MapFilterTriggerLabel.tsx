import type { LucideIcon } from 'lucide-react';

/** Shared columns keep the count aligned across the map's compact filters. */
export function MapFilterTriggerLabel({
    icon: Icon,
    label,
    count,
}: {
    icon: LucideIcon;
    label: string;
    count?: number;
}) {
    return (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left" title={label}>{label}</span>
            {count !== undefined && (
                <span data-map-filter-count className="shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground">
                    ({count}개)
                </span>
            )}
        </span>
    );
}
