import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { BottomSheet } from '@/components/ui/bottom-sheet';

type BottomSheetPreset = Pick<
    ComponentProps<typeof BottomSheet>,
    'defaultHeight' | 'minHeight' | 'maxHeight' | 'showHandle' | 'enablePeek' | 'hideBottomNavWhenOpen'
>;

export const MOBILE_FULL_FORM_SHEET: BottomSheetPreset = {
    defaultHeight: 100,
    minHeight: 100,
    maxHeight: 100,
    showHandle: false,
    enablePeek: false,
    hideBottomNavWhenOpen: true,
};

export const MOBILE_COMPACT_FORM_SHEET: BottomSheetPreset = {
    defaultHeight: 78,
    minHeight: 64,
    maxHeight: 92,
    showHandle: true,
    enablePeek: true,
    hideBottomNavWhenOpen: true,
};

export const mobileSheetStyles = {
    frame: 'flex min-h-full flex-col bg-background',
    header: 'sticky top-0 z-10 border-b bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur',
    compactHeader: 'border-b bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]',
    title: 'text-2xl font-bold leading-tight tracking-tight bg-gradient-primary bg-clip-text text-transparent',
    compactTitle: 'text-lg font-semibold leading-tight tracking-tight text-foreground',
    description: 'mt-1 text-sm leading-relaxed text-muted-foreground',
    content: 'flex-1 space-y-4 px-4 py-4',
    compactContent: 'space-y-4 px-4 py-4',
    section: 'rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm',
    mutedSection: 'rounded-xl border border-border/70 bg-muted/70 p-4 shadow-sm',
    footer: 'sticky bottom-0 z-10 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur',
    actionRow: 'flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center',
    primaryAction: 'bg-gradient-primary hover:opacity-90',
    meta: 'text-[10px] leading-none text-muted-foreground',
} as const;

type MobileSheetHeaderProps = {
    title: string;
    description?: string;
    icon?: ReactNode;
    titleId?: string;
    descriptionId?: string;
    compact?: boolean;
    className?: string;
    action?: ReactNode;
    children?: ReactNode;
};

export function MobileSheetHeader({
    title,
    description,
    icon,
    titleId,
    descriptionId,
    compact = false,
    className,
    action,
    children,
}: MobileSheetHeaderProps) {
    return (
        <div className={cn(compact ? mobileSheetStyles.compactHeader : mobileSheetStyles.header, className)}>
            {children}
            <div className="flex items-start gap-3">
                {icon ? (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-[var(--shadow-primary)]">
                        {icon}
                    </div>
                ) : null}
                <div className="min-w-0 flex-1">
                    <h2 id={titleId} className={compact ? mobileSheetStyles.compactTitle : mobileSheetStyles.title}>
                        {title}
                    </h2>
                    {description ? (
                        <p id={descriptionId} className={mobileSheetStyles.description}>
                            {description}
                        </p>
                    ) : null}
                </div>
                {action ? <div className="-mr-2 shrink-0">{action}</div> : null}
            </div>
        </div>
    );
}
