"use client";

import type { CSSProperties, ReactNode } from "react";
import { Skeleton as MeasuredSkeleton, SkulletProvider } from "skullet/react";
import { cn } from "@/lib/utils";

/** Keep the request nonce; never relax the app's script/style policy for loading UI. */
export function LoadingProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
    return (
        <SkulletProvider
            nonce={nonce}
            debug={false}
            mode="system"
            theme={{
                light: { base: "hsl(var(--muted))", highlight: "hsl(var(--background))" },
                dark: { base: "hsl(var(--muted))", highlight: "hsl(var(--background))" },
                animation: "group-shimmer",
                speed: "slow",
                radius: "4px",
            }}
            reveal={{ duration: 120, hold: 80 }}
        >
            {children}
        </SkulletProvider>
    );
}

/**
 * Measure presentation-only sample markup. Never pass a mounted map, a component
 * that fetches data, or a user's previous record as the sample.
 *
 * An omitted id enables Skullet's automatic persistent HTML shape cache. An
 * explicit empty id disables it, including on private/admin screens. The id is
 * deliberately not exposed to callers: Korean text is not redacted by v0.0.3.
 */
export function LoadingSurface({ children, label, className, style }: {
    children: ReactNode;
    label: string;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <div role="status" aria-live="polite" aria-label={label} className={className} style={style}>
            <MeasuredSkeleton id="" loading label={label}>
                {children}
            </MeasuredSkeleton>
        </div>
    );
}

type PreviewKind = "list" | "cards" | "form" | "profile" | "table" | "dashboard" | "article" | "navigation" | "chart";

function SampleImage({ className }: { className?: string }) {
    // A local SVG supplies intrinsic media geometry without a request or URL.
    return <svg viewBox="0 0 320 180" role="img" aria-label="사진" className={cn("w-full rounded-lg bg-muted", className)}><rect width="320" height="180" fill="currentColor" opacity="0.08" /></svg>;
}

function SampleRow({ compact }: { compact: boolean }) {
    return (
        <div className={cn("flex min-w-0 items-center gap-3", compact ? "py-2" : "py-3")}>
            <svg viewBox="0 0 40 40" role="img" aria-label="프로필" className="h-9 w-9 shrink-0 rounded-full bg-muted"><circle cx="20" cy="20" r="20" fill="currentColor" opacity="0.08" /></svg>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">맛집 이야기</p><p className="truncate text-xs text-muted-foreground">새로운 소식을 확인해 보세요</p></div>
            <span className="shrink-0 text-xs text-muted-foreground">자세히</span>
        </div>
    );
}

/** Safe, static sample layouts shared by route and query fallbacks. */
export function LoadingPreview({ kind = "list", rows = 3, showHeader = true, compact = false, label = "화면을 불러오는 중", className, style }: {
    kind?: PreviewKind;
    rows?: number;
    showHeader?: boolean;
    compact?: boolean;
    label?: string;
    className?: string;
    style?: CSSProperties;
}) {
    const count = Math.min(24, Math.max(1, Number.isFinite(rows) ? Math.floor(rows) : 3));
    return (
        <LoadingSurface label={label} className={className} style={style}>
            <div className={cn("min-w-0 space-y-4", compact ? "p-2" : "p-4")}>
                {showHeader && <div className="space-y-1"><h2 className="text-lg font-semibold">쯔동여지도</h2><p className="text-sm text-muted-foreground">맛집과 방문 이야기를 만나보세요</p></div>}
                {kind === "profile" ? <div className="space-y-4"><SampleRow compact={false} /><div className="grid grid-cols-3 gap-4 text-center">{["리뷰", "도장", "북마크"].map(name => <div key={name}><p className="text-xl font-semibold">00</p><p className="text-sm">{name}</p></div>)}</div></div>
                : kind === "form" ? <div className="space-y-4">{Array.from({ length: count }, (_, index) => <div key={index} className="space-y-2"><p className="text-sm font-medium">입력 항목</p><div className="rounded-md border p-3 text-sm text-muted-foreground">내용을 입력해 주세요</div></div>)}<p className="rounded-md border px-4 py-3 text-center text-sm">확인</p></div>
                : kind === "cards" ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{Array.from({ length: count }, (_, index) => <article key={index} className="min-w-0 space-y-2 rounded-lg border p-3"><SampleImage /><p className="text-sm font-medium">영상 속 맛집</p><p className="text-xs text-muted-foreground">맛있는 여행을 함께해요</p></article>)}</div>
                : kind === "table" ? <div className="overflow-hidden rounded-lg border"><div className="grid grid-cols-3 gap-3 border-b px-3 py-2 text-sm font-medium"><span>항목</span><span>내용</span><span>상태</span></div>{Array.from({ length: count }, (_, index) => <div key={index} className="grid grid-cols-3 gap-3 border-b px-3 py-3 text-sm last:border-0"><span>맛집 정보</span><span>확인 내용</span><span>검토 중</span></div>)}</div>
                : kind === "dashboard" ? <div className="space-y-4"><div className="grid grid-cols-2 gap-3">{["등록 현황", "리뷰", "방문", "새 소식"].map(name => <div key={name} className="rounded-lg border p-4"><p className="text-sm">{name}</p><p className="mt-2 text-2xl font-semibold">000</p></div>)}</div>{Array.from({ length: count }, (_, index) => <SampleRow key={index} compact={compact} />)}</div>
                : kind === "article" ? <article className="space-y-3"><SampleRow compact={compact} /><SampleImage /><p className="text-sm leading-6">영상 속 맛집을 찾아 떠나는 여행. 다양한 음식과 새로운 방문 이야기를 함께 만나보세요.</p></article>
                : kind === "chart" ? <div className="space-y-3"><p className="text-sm font-medium">활동 현황</p><svg viewBox="0 0 320 160" role="img" aria-label="활동 그래프" className="h-40 w-full"><path d="M0 140 L64 100 L128 115 L192 55 L256 70 L320 20" fill="none" stroke="currentColor" strokeWidth="3" /></svg></div>
                : kind === "navigation" ? <div className="flex min-w-0 items-center gap-3 rounded-full border px-4 py-3"><span className="text-sm">쯔동여지도 검색하기</span></div>
                : <div className="divide-y">{Array.from({ length: count }, (_, index) => <SampleRow key={index} compact={compact} />)}</div>}
            </div>
        </LoadingSurface>
    );
}
