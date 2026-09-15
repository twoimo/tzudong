import { MessageSquareText, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataPending } from '@/components/ui/data-pending';

export default function FeedLoading() {
  return <section className="mx-auto flex h-full w-full max-w-2xl flex-col bg-background">
    <header className="flex items-start justify-between gap-3 border-b px-3 py-3 sm:px-5 sm:py-4">
      <div><h1 className="flex items-center gap-1.5 text-lg font-bold text-primary"><MessageSquareText className="h-5 w-5" aria-hidden="true" />쯔동여지도 리뷰</h1>
        <p className="mt-1 text-xs text-muted-foreground">맛집 방문 후기를 공유해보세요!</p></div>
      <Button type="button" variant="ghost" size="icon" disabled aria-label="리뷰 필터 준비 중"><Filter className="h-5 w-5" /></Button>
    </header>
    <DataPending label="리뷰를 불러오는 중입니다." variant="list" className="min-h-64" />
  </section>;
}
