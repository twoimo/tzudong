import type { ReactNode } from 'react';
import { DataPending } from '@/components/ui/data-pending';
import { MyPageErrorState } from '@/components/mypage/MyPageSectionFrame';

type MyPageDataRegionProps = {
  pending: boolean;
  hasData: boolean;
  error: boolean;
  label: string;
  errorTitle: string;
  errorDescription: string;
  children: ReactNode;
};

export function MyPageDataRegion({ pending, hasData, error, label, errorTitle, errorDescription, children }: MyPageDataRegionProps) {
  return (
    <div className="min-h-48" aria-busy={pending} data-mypage-data-region="true">
      {error && <div role="alert"><MyPageErrorState title={errorTitle} description={errorDescription} /></div>}
      {!hasData && pending ? <DataPending variant="list" label={label} className="min-h-48" />
        : hasData || !error ? children : null}
    </div>
  );
}
