import { memo, type CSSProperties, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export const MAP_OVERLAY_NOTICE_SURFACE_CLASS_NAME =
    '!border !border-border !bg-card/95 !text-foreground !rounded-2xl !px-3 !py-2';
export const MAP_OVERLAY_NOTICE_CLASS_NAME =
    `z-10 flex min-h-9 w-fit max-w-[calc(100vw-2rem)] items-center justify-center ${MAP_OVERLAY_NOTICE_SURFACE_CLASS_NAME} text-sm font-medium leading-5 shadow-sm backdrop-blur-sm sm:max-w-[26rem] sm:!rounded-full`;
export const MAP_OVERLAY_NOTICE_SINGLE_LINE_CLASS_NAME = 'map-overlay-notice-single-line';
export const MAP_OVERLAY_TOAST_CLASS_NAME =
    `pointer-events-auto relative flex w-[min(360px,calc(100vw-1.5rem))] max-w-[min(360px,calc(100vw-1.5rem))] items-start justify-start ${MAP_OVERLAY_NOTICE_SURFACE_CLASS_NAME} text-left text-sm font-medium leading-5 shadow-lg backdrop-blur-sm sm:w-max sm:max-w-[min(42rem,calc(100vw-2rem))]`;

const baseNoticeClass = MAP_OVERLAY_NOTICE_CLASS_NAME;
const noticeContentClass = 'grid max-w-full min-w-0 grid-cols-[1.25rem_max-content] items-center gap-1.5 pr-1';
const noticeIconClass = 'flex h-5 w-5 shrink-0 items-center justify-center text-[15px] leading-none';
const noticeTextClass = 'min-w-0 whitespace-nowrap break-keep text-center';

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
    icon,
    role = 'status',
    style,
}: MapOverlayNoticeProps) => (
    <div
        style={style}
        className={cn(baseNoticeClass, className)}
        role={role}
        aria-live={ariaLive}
        aria-busy={ariaBusy}
    >
        {icon ? (
            <span className={noticeContentClass}>
                <span className={noticeIconClass} aria-hidden="true">
                    {icon}
                </span>
                <span className={cn(noticeTextClass, contentClassName)}>{children}</span>
            </span>
        ) : (
            <span className={cn(noticeTextClass, contentClassName, 'max-w-full')}>{children}</span>
        )}
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
    icon,
    onClick,
    style,
}: MapOverlayNoticeButtonProps) => (
    <button
        type="button"
        onClick={onClick}
        style={style}
        className={cn(
            baseNoticeClass,
            'appearance-none',
            onClick ? 'cursor-pointer sm:hover:!bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' : '',
            className,
        )}
        aria-label={ariaLabel}
        aria-live={ariaLive}
    >
        {icon ? (
            <span className={noticeContentClass}>
                <span className={noticeIconClass} aria-hidden="true">
                    {icon}
                </span>
                <span className={cn(noticeTextClass, contentClassName)}>{children}</span>
            </span>
        ) : (
            <span className={cn(noticeTextClass, contentClassName, 'max-w-full')}>{children}</span>
        )}
    </button>
));
MapOverlayNoticeButton.displayName = 'MapOverlayNoticeButton';
