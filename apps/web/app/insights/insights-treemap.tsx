'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { PopoverAnchor } from '@radix-ui/react-popover';
import { Treemap, type ChartEvent, type TreemapProps } from 'ztd-charts';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent } from '@/components/ui/popover';

type InsightsTreemapProps<T> = Omit<TreemapProps<T>, 'tooltip'> & {
    previewContent: (datum: T) => ReactNode;
    previewDisabled?: boolean;
};

// Allow the pointer to cross the small gap into the scrollable preview.
// Chart and preview share one cancellable timer, including unmount cleanup.
const PREVIEW_CLOSE_DELAY_MS = 120;

export function InsightsTreemap<T>({
    previewContent, previewDisabled = false, onHover, onClick, ...chartProps
}: InsightsTreemapProps<T>) {
    const [preview, setPreview] = useState<ChartEvent<T> | null>(null);
    const chartRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const pointerRef = useRef<{ x: number; y: number } | null>(null);
    const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
    const dismissedPointRef = useRef<{ x: number; y: number } | null>(null);
    const dismissedEventRef = useRef<ChartEvent<T> | null>(null);
    const anchorRef = useRef<{ getBoundingClientRect: () => DOMRect } | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pointerInPreviewRef = useRef(false);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
    }, []);

    const closePreview = useCallback(() => {
        clearCloseTimer();
        restoreFocusRef.current = previewRef.current?.contains(document.activeElement)
            ? previousFocusRef.current : null;
        pointerInPreviewRef.current = false;
        setPreview(null);
    }, [clearCloseTimer]);

    const scheduleClose = useCallback(() => {
        clearCloseTimer();
        closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            if (!pointerInPreviewRef.current && !previewRef.current?.contains(document.activeElement)) closePreview();
        }, PREVIEW_CLOSE_DELAY_MS);
    }, [clearCloseTimer, closePreview]);

    const endPointerPreview = useCallback(() => {
        dismissedPointRef.current = lastPointerRef.current;
        dismissedEventRef.current = null;
        pointerRef.current = null;
        closePreview();
    }, [closePreview]);

    useEffect(() => {
        endPointerPreview();
    }, [chartProps.data, chartProps.height, previewDisabled, endPointerPreview]);

    useEffect(() => {
        const rememberPointer = (event: globalThis.PointerEvent) => {
            // The detail portal can move the pointer without entering the chart.
            // Keep its last real position so closing it cannot reopen a preview
            // through boundary events at a stationary pointer.
            if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
                lastPointerRef.current = { x: event.clientX, y: event.clientY };
            }
        };
        const handleScroll = (event: Event) => {
            // Preview scrolling reads its remaining fields. An outside scroll
            // invalidates the captured pointer anchor instead.
            if (event.target instanceof Node && previewRef.current?.contains(event.target)) return;
            endPointerPreview();
        };
        window.addEventListener('pointermove', rememberPointer, { capture: true, passive: true });
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', endPointerPreview);
        const viewport = window.visualViewport;
        viewport?.addEventListener('resize', endPointerPreview);
        return () => {
            clearCloseTimer();
            window.removeEventListener('pointermove', rememberPointer, true);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', endPointerPreview);
            viewport?.removeEventListener('resize', endPointerPreview);
        };
    }, [clearCloseTimer, endPointerPreview]);

    const showPreview = (event: ChartEvent<T>, point: { x: number; y: number }) => {
        if (previewDisabled) return;
        clearCloseTimer();
        if (!preview) previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // A new virtual anchor per tile is supported by Radix. It stays still
        // while the pointer moves from the chart into the preview.
        anchorRef.current = { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) };
        setPreview(event);
    };

    const observePointer = (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
            endPointerPreview();
            return;
        }
        const point = { x: event.clientX, y: event.clientY };
        lastPointerRef.current = point;
        pointerRef.current = point;
        clearCloseTimer();
        const dismissed = dismissedPointRef.current;
        // Removing the portal can expose another tile under a stationary
        // pointer. Do not reopen until the user actually moves the pointer.
        if (dismissed && Math.abs(dismissed.x - point.x) <= 1 && Math.abs(dismissed.y - point.y) <= 1) return;
        dismissedPointRef.current = null;
        const pending = dismissedEventRef.current;
        dismissedEventRef.current = null;
        if (pending?.datum && event.type === 'pointermove') showPreview(pending, point);
    };

    const handleHover = (event: ChartEvent<T> | null) => {
        // Preserve keyboard selection/live announcement and the parent's active
        // tile even when no pointer preview is opened.
        onHover?.(event);
        if (!event?.datum) {
            dismissedEventRef.current = null;
            scheduleClose();
            return;
        }
        const point = pointerRef.current;
        if (!point || previewDisabled) return;
        if (dismissedPointRef.current) {
            // ztd-charts emits onHover only when its active tile changes. Keep
            // this real event so moving within that tile can resume its preview.
            dismissedEventRef.current = event;
            return;
        }
        showPreview(event, point);
    };

    const activate = (event: ChartEvent<T>) => {
        endPointerPreview();
        onClick?.(event);
    };

    return (
        <Popover open={preview !== null && !previewDisabled} modal={false} onOpenChange={(open) => { if (!open) endPointerPreview(); }}>
            <PopoverAnchor virtualRef={anchorRef} />
            <div
                ref={chartRef}
                data-insights-chart="true"
                onPointerMoveCapture={observePointer}
                onPointerEnter={observePointer}
                onPointerLeave={scheduleClose}
                onPointerDownCapture={endPointerPreview}
                onKeyDownCapture={endPointerPreview}
            >
                <Treemap {...chartProps} tooltip={false} onHover={handleHover} onClick={activate} />
            </div>
            <PopoverContent
                ref={previewRef}
                aria-label="영상 미리보기"
                data-insights-hover-preview="true"
                side="top" sideOffset={8} collisionPadding={8}
                className="flex w-80 max-w-[calc(100vw-1rem)] max-h-[min(calc(100dvh-1rem),var(--radix-popover-content-available-height))] flex-col p-3 text-xs leading-[18px]"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    const target = restoreFocusRef.current;
                    restoreFocusRef.current = null;
                    // Never take focus from an outside control/new detail dialog.
                    if (target?.isConnected && document.activeElement === document.body) target.focus({ preventScroll: true });
                }}
                onPointerMoveCapture={(event) => { lastPointerRef.current = { x: event.clientX, y: event.clientY }; }}
                onPointerEnter={(event) => { lastPointerRef.current = { x: event.clientX, y: event.clientY }; pointerInPreviewRef.current = true; clearCloseTimer(); }}
                onPointerLeave={() => { pointerInPreviewRef.current = false; scheduleClose(); }}
                onFocusCapture={clearCloseTimer}
                onInteractOutside={(event) => {
                    if (event.detail.originalEvent.type === 'focusin' && event.target instanceof Node && chartRef.current?.contains(event.target)) event.preventDefault();
                }}
            >
                <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                    <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { if (preview) activate(preview); }}>영상 상세 열기</Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="영상 미리보기 닫기" onClick={endPointerPreview}><X className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
                <div data-insights-preview-body="true" className="min-h-0 overflow-y-auto overscroll-contain whitespace-normal [overflow-wrap:anywhere]">
                    {preview?.datum ? previewContent(preview.datum) : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}
