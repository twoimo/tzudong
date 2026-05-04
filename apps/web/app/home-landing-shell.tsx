export function HomeLandingShell() {
    return (
        <section
            aria-labelledby="home-landing-title"
            className="relative isolate flex h-full min-h-[calc(var(--full-height,100vh)-56px)] w-full overflow-hidden bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_34%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--secondary)/0.45))]"
            data-testid="home-landing-shell"
        >
            <div className="absolute inset-0 -z-10 opacity-60" aria-hidden="true">
                <div className="absolute left-[8%] top-[12%] h-36 w-36 rounded-full bg-primary/10 blur-3xl" />
                <div className="absolute bottom-[10%] right-[10%] h-48 w-48 rounded-full bg-amber-500/10 blur-3xl" />
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background/70 to-transparent" />
            </div>

            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-8 px-5 py-8 md:grid-cols-[0.92fr_1.08fr] md:px-8 lg:px-10">
                <div className="max-w-xl space-y-5">
                    <p className="inline-flex rounded-full border border-primary/20 bg-background/75 px-3 py-1 text-sm font-semibold text-primary shadow-sm backdrop-blur">
                        쯔양 맛집 지도
                    </p>
                    <div className="space-y-3">
                        <h1 id="home-landing-title" className="text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl">
                            쯔동여지도
                        </h1>
                        <p className="text-base leading-7 text-muted-foreground md:text-lg">
                            쯔양이 다녀간 맛집을 지역과 카테고리별로 빠르게 찾아보세요. 지도는 첫 화면을 안정적으로 그린 뒤 자동으로 준비됩니다.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-sm text-muted-foreground" aria-label="주요 기능">
                        <span className="rounded-full bg-background/80 px-3 py-1 shadow-sm">전국 맛집</span>
                        <span className="rounded-full bg-background/80 px-3 py-1 shadow-sm">지역 필터</span>
                        <span className="rounded-full bg-background/80 px-3 py-1 shadow-sm">리뷰와 제보</span>
                    </div>
                    <button
                        className="inline-flex items-center rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-primary transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        data-testid="home-launch-map"
                        type="button"
                    >
                        지도 준비하기
                    </button>
                </div>

                <div className="relative min-h-[360px] overflow-hidden rounded-[2rem] border border-border/70 bg-background/80 p-4 shadow-2xl backdrop-blur md:min-h-[520px]">
                    <div className="absolute inset-4 rounded-[1.5rem] bg-[linear-gradient(135deg,hsl(38_30%_96%),hsl(24_6%_90%))]" aria-hidden="true" />
                    <div className="absolute left-[18%] top-[18%] h-24 w-24 rounded-full border border-primary/20 bg-primary/10" aria-hidden="true" />
                    <div className="absolute right-[16%] top-[24%] h-32 w-32 rounded-full border border-amber-600/20 bg-amber-500/10" aria-hidden="true" />
                    <div className="absolute bottom-[18%] left-[24%] h-28 w-28 rounded-full border border-primary/20 bg-primary/10" aria-hidden="true" />
                    <div className="absolute inset-x-10 top-1/2 h-px bg-border/70" aria-hidden="true" />
                    <div className="absolute inset-y-10 left-1/2 w-px bg-border/70" aria-hidden="true" />

                    <div className="absolute left-[28%] top-[34%] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_8px_hsl(var(--primary)/0.14)]" aria-hidden="true" />
                    <div className="absolute right-[30%] top-[42%] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/80 shadow-[0_0_0_7px_hsl(var(--primary)/0.12)]" aria-hidden="true" />
                    <div className="absolute bottom-[28%] left-[46%] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-600 shadow-[0_0_0_7px_rgba(217,119,6,0.15)]" aria-hidden="true" />

                    <div className="absolute bottom-6 left-6 right-6 rounded-2xl border border-border/70 bg-background/90 p-4 shadow-lg backdrop-blur">
                        <p className="text-sm font-bold text-foreground">가벼운 첫 화면을 먼저 표시 중</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            네이버 지도 SDK와 맛집 지도 런타임은 사용자 상호작용 또는 브라우저 유휴 시간 이후 활성화됩니다.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}
