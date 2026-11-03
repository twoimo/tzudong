import { LoadingSurface } from "@/components/ui/loading-surface";

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

      <LoadingSurface label={label}>

        <header className="mb-6 flex items-center justify-between gap-4">

          <div>

            <h2 className="text-2xl font-semibold">나의 맛집 활동</h2>

            <p className="mt-2 text-sm">저장한 맛집과 활동 내역</p>

          </div>

          <span className="text-sm">목록</span>

        </header>

        <div className="space-y-3">

          {
            Array.from({ length: 3 }, (_, index) => (
              <article
                key={index}
                className="rounded-2xl bg-muted/30 p-4 md:border md:border-border md:bg-card"
                data-mypage-section-skeleton-card="borderless-mobile"
              >

                <div className="flex items-start gap-3">

                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border"
                    aria-hidden="true"
                  >맛집</div>

                  <div className="min-w-0 flex-1">

                    <h3 className="font-medium">맛집 이름</h3>

                    <p className="mt-2 text-sm">맛집 소개와 방문 기록</p>

                    <p className="mt-1 text-xs">활동 내역</p>

                  </div>

                </div>

              </article>
            ))
          }

        </div>

      </LoadingSurface>

    </section>
  );
}
