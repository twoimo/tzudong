import { memo, type CSSProperties, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

const baseNoticeClass =
    'z-10 flex min-h-9 w-fit max-w-[calc(100vw-2rem)] items-center justify-center rounded-2xl bg-card/95 px-3 py-2 text-sm font-medium leading-5 text-foreground shadow-sm backdrop-blur-sm sm:max-w-[26rem] sm:rounded-full';

const noticeContentClass = 'grid max-w-full min-w-0 grid-cols-[1.25rem_max-content] items-center gap-1.5 pr-1';
const noticeIconClass = 'flex h-5 w-5 shrink-0 items-center justify-center text-[15px] leading-none';
const noticeTextClass = 'min-w-0 whitespace-nowrap break-keep text-center';

type MapOverlayNoticeProps = {
    children: ReactNode;
    className?: string;
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
                <span className={noticeTextClass}>{children}</span>
            </span>
        ) : (
            <span className={cn(noticeTextClass, 'max-w-full')}>{children}</span>
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
            onClick ? 'cursor-pointer hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' : '',
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
                <span className={noticeTextClass}>{children}</span>
            </span>
        ) : (
            <span className={cn(noticeTextClass, 'max-w-full')}>{children}</span>
        )}
    </button>
));
MapOverlayNoticeButton.displayName = 'MapOverlayNoticeButton';
