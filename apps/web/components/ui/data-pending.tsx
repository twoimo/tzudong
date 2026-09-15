import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export type DataPendingProps = {
  label?: string;
  className?: string;
  variant?: 'text' | 'list' | 'chart';
};

/** Only the unresolved data slot loads; page headings and controls remain real. */
export function DataPending({ label = '데이터 확인 중', className, variant = 'text' }: DataPendingProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn('flex min-h-12 items-center justify-center px-3 py-4', className)} data-data-pending={variant}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={cn('w-full max-w-56 space-y-2', variant === 'list' && 'max-w-none space-y-3')}>
        {variant === 'list' ? Array.from({ length: 3 }, (_, index) => (
          <div className="flex items-center gap-3" key={index}>
            <Skeleton className="h-8 w-8 shrink-0" />
            <div className="flex-1 space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div>
          </div>
        )) : variant === 'chart' ? <Skeleton className="h-20 w-full" /> : <>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </>}
      </div>
    </div>
  );
}
