import { memo, type CSSProperties, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export const MAP_OVERLAY_NOTICE_SURFACE_CLASS_NAME =
    '!border !border-border !bg-card/95 !text-foreground !rounded-2xl !px-3 !py-2';
export const MAP_OVERLAY_NOTICE_CLASS_NAME =
    `z-10 inline-flex min-h-8 w-fit max-w-[min(26rem,calc(100vw-2rem))] items-center justify-center ${MAP_OVERLAY_NOTICE_SURFACE_CLASS_NAME} !text-[13px] !font-semibold !leading-4 shadow-sm backdrop-blur-sm sm:!rounded-full`;
export const MAP_OVERLAY_NOTICE_SINGLE_LINE_CLASS_NAME = 'map-overlay-notice-single-line';
export const MAP_OVERLAY_TOAST_CLASS_NAME = MAP_OVERLAY_NOTICE_CLASS_NAME;
export const MAP_OVERLAY_STATUS_DOT_CLASS_NAME = 'h-2 w-2 rounded-full bg-primary/80';

const noticeContentClass = 'grid max-w-full min-w-0 grid-cols-[1rem_minmax(0,max-content)] items-center gap-1.5';
const noticeIconClass = 'flex h-4 w-4 shrink-0 items-center justify-center';
const noticeTextClass = 'min-w-0 whitespace-nowrap break-keep text-center !text-[13px] !font-semibold !leading-4';

export function MapOverlayStatusDot() {
    return <span className={MAP_OVERLAY_STATUS_DOT_CLASS_NAME} />;
}

type MapOverlayNoticeProps = {
    children: ReactNode;
    className?: string;
    contentClassName?: string;
    icon?: ReactNode;
    role?: 'status' | 'alert';
    style?: CSSProperties;
    ariaBusy?: boolean;
    ariaLive?: 'polite' | 'assertive';
};

export const MapOverlayNotice = memo(({
    ariaBusy,
    ariaLive = 'polite',
    children,
    className,
    contentClassName,
    icon = <MapOverlayStatusDot />,
    role = 'status',
    style,
}: MapOverlayNoticeProps) => (
    <div
        style={style}
        className={cn(MAP_OVERLAY_NOTICE_CLASS_NAME, className)}
        role={role}
        aria-live={ariaLive}
        aria-busy={ariaBusy}
    >
        <span className={noticeContentClass}>
            <span className={noticeIconClass} aria-hidden="true">
                {icon}
            </span>
            <span className={cn(noticeTextClass, contentClassName)}>{children}</span>
        </span>
    </div>
));
MapOverlayNotice.displayName = 'MapOverlayNotice';

type MapOverlayNoticeButtonProps = Omit<MapOverlayNoticeProps, 'ariaBusy' | 'role'> & {
    ariaLabel: string;
    onClick?: () => void;
};

export const MapOverlayNoticeButton = memo(({
    ariaLabel,
    ariaLive = 'polite',
    children,
    className,
    contentClassName,
    icon = <MapOverlayStatusDot />,
    onClick,
    style,
}: MapOverlayNoticeButtonProps) => (
    <button
        type="button"
        onClick={onClick}
        style={style}
        className={cn(
            MAP_OVERLAY_NOTICE_CLASS_NAME,
            'appearance-none',
            onClick ? 'cursor-pointer sm:hover:!bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' : '',
            className,
        )}
        aria-label={ariaLabel}
        aria-live={ariaLive}
    >
        <span className={noticeContentClass}>
            <span className={noticeIconClass} aria-hidden="true">
                {icon}
            </span>
            <span className={cn(noticeTextClass, contentClassName)}>{children}</span>
        </span>
    </button>
));
MapOverlayNoticeButton.displayName = 'MapOverlayNoticeButton';
