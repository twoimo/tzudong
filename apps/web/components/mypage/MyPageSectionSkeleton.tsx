import { Skeleton } from "@/components/ui/skeleton";

export function MyPageSectionSkeleton({
  label = "마이페이지 내용을 불러오는 중…",
}: {
  label?: string;
}) {
  return (
    <section
      className="space-y-6"
      aria-label={label}
      data-mypage-section-loading="true"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-8 w-40 rounded-lg" />
          <Skeleton className="h-4 w-56 max-w-full rounded-full" />
        </div>
        <Skeleton className="h-7 w-16 shrink-0 rounded-full" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3 rounded-full" />
                <Skeleton className="h-3 w-full rounded-full" />
                <Skeleton className="h-3 w-1/2 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
