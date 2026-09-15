import { DataPending } from '@/components/ui/data-pending';
import { Input } from '@/components/ui/input';

export default function GlobalMapLoading() {
  return <section className="relative h-full min-h-[360px] bg-background">
    <h1 className="sr-only">해외 맛집 지도</h1>
    <DataPending label="해외 맛집 지도를 준비하는 중입니다." className="h-full min-h-[360px]" />
    <div className="absolute bottom-4 left-1/2 grid w-[min(calc(100vw-1rem),72rem)] -translate-x-1/2 gap-2 rounded-lg border bg-background p-3 sm:grid-cols-3">
      <select disabled aria-label="국가 선택 준비 중" className="h-10 rounded-md border px-3 text-sm"><option>튀르키예</option></select>
      <select disabled aria-label="카테고리 선택 준비 중" className="h-10 rounded-md border px-3 text-sm"><option>전체 카테고리</option></select>
      <Input disabled aria-label="맛집 검색 준비 중" placeholder="맛집 검색..." />
    </div>
  </section>;
}
