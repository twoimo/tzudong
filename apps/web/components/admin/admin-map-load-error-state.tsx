import { Button } from '@/components/ui/button';

export function AdminMapLoadErrorState({ onRetry, isRetrying = false }: { onRetry: () => void; isRetrying?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-card/85 p-4 text-center backdrop-blur-sm" role="alert">
      <div className="max-w-sm rounded-2xl bg-card/95 p-4 shadow-sm">
        <p className="text-sm font-bold text-foreground">네이버 지도를 불러오지 못했습니다</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
        <Button className="mt-3" variant="outline" aria-disabled={isRetrying || undefined} aria-busy={isRetrying || undefined} onClick={() => { if (!isRetrying) onRetry(); }}>다시 시도</Button>
      </div>
    </div>
  );
}
