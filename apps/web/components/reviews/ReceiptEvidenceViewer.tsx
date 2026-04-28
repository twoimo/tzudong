import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Minus, Move, Plus, RotateCcw, X as XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  canPanReceiptEvidence,
  clampReceiptEvidencePan,
  clampReceiptEvidenceScale,
  getReceiptEvidenceTitle,
  nextReceiptEvidenceScale,
  type ReceiptEvidenceSource,
} from '@/lib/ocr/receipt-evidence-viewer';

type ReceiptEvidenceViewerProps = {
  isOpen: boolean;
  imageUrl: string | null;
  fileName?: string;
  openedFrom: ReceiptEvidenceSource;
  onClose: () => void;
};

type Point = { x: number; y: number };

const ZERO_POINT: Point = { x: 0, y: 0 };

export function ReceiptEvidenceViewer({
  isOpen,
  imageUrl,
  fileName,
  openedFrom,
  onClose,
}: ReceiptEvidenceViewerProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState<Point>(ZERO_POINT);
  const [isPanning, setIsPanning] = useState(false);
  const lastPointerRef = useRef<Point | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const previousBodyOverflowRef = useRef<string>('');
  const pushedHistoryEntryRef = useRef(false);
  const closingFromUiRef = useRef(false);
  const title = useMemo(() => getReceiptEvidenceTitle(openedFrom), [openedFrom]);
  const canPan = canPanReceiptEvidence(scale);

  const getViewportBounds = useCallback((nextScale = scale) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return {
      viewportWidth: rect?.width ?? 0,
      viewportHeight: rect?.height ?? 0,
      scale: nextScale,
    };
  }, [scale]);

  const resetView = useCallback(() => {
    setScale(1);
    setTranslate(ZERO_POINT);
    setIsPanning(false);
    lastPointerRef.current = null;
  }, []);

  const closeViewer = useCallback(() => {
    if (pushedHistoryEntryRef.current && typeof window.history.back === 'function') {
      closingFromUiRef.current = true;
      pushedHistoryEntryRef.current = false;
      window.history.back();
    }
    resetView();
    onClose();
  }, [onClose, resetView]);

  useEffect(() => {
    if (!isOpen) resetView();
  }, [isOpen, resetView]);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
      if (!document.activeElement || document.activeElement === document.body) {
        dialogRef.current?.focus({ preventScroll: true });
      }
    });

    if (!pushedHistoryEntryRef.current && typeof window.history.pushState === 'function') {
      window.history.pushState(
        { ...(window.history.state ?? {}), receiptEvidenceViewer: true },
        '',
        window.location.href
      );
      pushedHistoryEntryRef.current = true;
    }

    const handlePopState = () => {
      if (closingFromUiRef.current) {
        closingFromUiRef.current = false;
        return;
      }
      if (!pushedHistoryEntryRef.current) return;
      pushedHistoryEntryRef.current = false;
      resetView();
      onClose();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (pushedHistoryEntryRef.current && typeof window.history.back === 'function') {
        closingFromUiRef.current = true;
        pushedHistoryEntryRef.current = false;
        window.history.back();
      }
      document.body.style.overflow = previousBodyOverflowRef.current;
      const previous = previousActiveElementRef.current;
      if (previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
      previousActiveElementRef.current = null;
    };
  }, [isOpen, onClose, resetView]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeViewer();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeViewer, isOpen]);

  const changeScale = useCallback((direction: 'in' | 'out') => {
    setScale(current => {
      const next = nextReceiptEvidenceScale(current, direction);
      setTranslate(currentTranslate => clampReceiptEvidencePan(currentTranslate, getViewportBounds(next)));
      return next;
    });
  }, [getViewportBounds]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!canPan) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    setIsPanning(true);
  }, [canPan]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isPanning || !lastPointerRef.current) return;

    const previous = lastPointerRef.current;
    const next = { x: event.clientX, y: event.clientY };
    lastPointerRef.current = next;
    setTranslate(current => clampReceiptEvidencePan({
      x: current.x + next.x - previous.x,
      y: current.y + next.y - previous.y,
    }, getViewportBounds()));
  }, [getViewportBounds, isPanning]);

  const stopPanning = useCallback((event?: PointerEvent<HTMLDivElement>) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    lastPointerRef.current = null;
  }, []);

  if (!isOpen || !imageUrl) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[160] flex h-[100dvh] flex-col bg-background/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-evidence-viewer-title"
      tabIndex={-1}
    >
      <div className="flex shrink-0 items-center gap-2 border-b bg-background px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <h2 id="receipt-evidence-viewer-title" className="truncate text-base font-semibold">
            {title}
          </h2>
          {fileName ? <p className="truncate text-xs text-muted-foreground">{fileName}</p> : null}
        </div>
        <Button ref={closeButtonRef} type="button" variant="ghost" size="icon" onClick={closeViewer} aria-label="영수증 증거 뷰어 닫기">
          <XIcon className="h-5 w-5" />
        </Button>
      </div>

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-muted/40 touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
      >
        <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- Blob/object URLs from local file selection cannot use Next Image reliably. */}
          <img
            src={imageUrl}
            alt="영수증 증거 이미지"
            className="max-h-full max-w-full select-none rounded-lg bg-background object-contain shadow-lg"
            draggable={false}
            style={{
              transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${clampReceiptEvidenceScale(scale)})`,
              transition: isPanning ? 'none' : 'transform 160ms ease-out',
              cursor: canPan ? (isPanning ? 'grabbing' : 'grab') : 'default',
            }}
          />
        </div>
        {canPan ? (
          <div className="absolute left-4 top-4 flex items-center gap-1 rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <Move className="h-3.5 w-3.5" />
            드래그해서 위치 조정
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="button" variant="outline" className="flex-1" onClick={() => changeScale('out')} disabled={scale <= 1} aria-label="영수증 축소">
          <Minus className="mr-1 h-4 w-4" />
          축소
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={resetView} disabled={scale === 1 && translate.x === 0 && translate.y === 0} aria-label="영수증 확대 상태 초기화">
          <RotateCcw className="mr-1 h-4 w-4" />
          초기화
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={() => changeScale('in')} disabled={scale >= 4} aria-label="영수증 확대">
          <Plus className="mr-1 h-4 w-4" />
          확대 {scale.toFixed(1)}x
        </Button>
      </div>
    </div>
  );
}
