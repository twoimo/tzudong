export function StoryboardWorkspaceSkeleton() {
  return <section aria-label="스토리보드 작업 공간 불러오는 중" aria-busy="true" className="min-w-0 space-y-4 p-4">
    <p role="status" className="text-sm text-muted-foreground">작업 공간을 불러오고 있어요.</p>
    <div aria-hidden="true" className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
      <div className="grid aspect-square max-h-[min(60vh,600px)] min-h-[280px] w-full grid-cols-2 grid-rows-2 gap-3">
        {[1, 2, 3, 4].map(cut => <div key={cut} className="min-h-0 rounded-xl border border-border bg-muted/40 p-3">
          <div className="h-3 w-16 rounded bg-muted" /><div className="mt-4 h-2/3 rounded-lg bg-muted/60" />
        </div>)}
      </div>
      <div className="hidden rounded-xl border border-border bg-card p-4 lg:flex lg:flex-col lg:gap-4">
        <div className="h-4 w-24 rounded bg-muted" /><div className="h-16 rounded-lg bg-muted/50" />
        <div className="mt-auto h-28 rounded-lg border border-border bg-background" />
      </div>
    </div>
  </section>;
}
