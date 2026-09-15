import { Trophy } from 'lucide-react';
import { DataPending } from '@/components/ui/data-pending';

export default function LeaderboardLoading() {
  return <section className="flex h-full flex-col bg-background">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b px-3 py-3 sm:px-5 sm:py-4">
      <div><h1 className="flex items-center gap-1.5 text-lg font-bold text-primary"><Trophy className="h-5 w-5" aria-hidden="true" />쯔동여지도 랭킹</h1><p className="mt-1 text-xs text-muted-foreground">맛집 리뷰를 작성하고 랭킹을 올려보세요!</p></div>
      <div role="tablist" aria-label="랭킹 기간" className="flex h-8 items-center gap-1 rounded-lg bg-muted p-1">
        <button type="button" role="tab" aria-selected="true" disabled className="rounded-md bg-background px-2 text-xs">전체</button>
        <button type="button" role="tab" aria-selected="false" disabled className="px-2 text-xs">월간</button>
      </div>
    </header>
    <DataPending label="랭킹을 불러오는 중입니다." variant="list" className="min-h-64" />
  </section>;
}
