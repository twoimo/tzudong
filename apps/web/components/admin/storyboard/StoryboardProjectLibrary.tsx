"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";

type ProjectStatus = "waiting_worker" | "generating" | "awaiting_import" | "partial" | "ready" | "failed" | "cancelled";
type ProjectSummary = {
  id: string; title: string; status: ProjectStatus; revision: number; updatedAt: string;
};
type Props = {
  projects: ProjectSummary[];
  selectedId: string | null;
  statusLabels: Record<ProjectStatus, string>;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  onStart: () => void;
};
const controlClass = "min-h-11 min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9 sm:py-1.5";

function updatedLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })
    : "날짜 없음";
}

export function StoryboardProjectLibrary({ projects, selectedId, statusLabels, busy, error, onRefresh, onSelect, onStart }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const normalizedQuery = query.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
  const filtered = projects.filter((project) =>
    (status === "all" || project.status === status)
    && project.title.normalize("NFKC").toLocaleLowerCase("ko-KR").includes(normalizedQuery),
  ).sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) || left.id.localeCompare(right.id));
  const hasFilter = normalizedQuery.length > 0 || status !== "all";

  return <section id="local-storyboard-project-library" aria-labelledby="local-library-title" className="min-w-0 rounded-xl border border-border bg-card text-card-foreground">
    <div className="flex items-center justify-between gap-2 px-3 pt-3">
      <h3 id="local-library-title" className="text-sm font-semibold">저장된 프로젝트 <span className="ml-1 font-normal tabular-nums text-muted-foreground">{projects.length}</span></h3>
      <button type="button" className={`${controlClass} inline-flex shrink-0 items-center justify-center !px-2 hover:bg-muted disabled:opacity-50`}
        aria-label="프로젝트 목록 다시 불러오기" disabled={busy} onClick={onRefresh}>
        {busy ? <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" /> : <RefreshCw aria-hidden="true" className="size-4" />}
      </button>
    </div>
    <div className="space-y-2 p-3">
      <label className="relative block">
        <span className="sr-only">프로젝트 검색</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" className={`${controlClass} w-full !pl-9`} placeholder="프로젝트 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="block">
        <span className="sr-only">프로젝트 상태</span>
        <select className={`${controlClass} w-full`} value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus | "all")}>
          <option value="all">모든 상태</option>
          {(Object.keys(statusLabels) as ProjectStatus[]).map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
        </select>
      </label>
    </div>
    <div role="status" aria-live="polite" className="px-3 pb-2 text-xs text-muted-foreground">
      {busy ? "프로젝트 목록 확인 중…" : error ? "목록을 다시 확인해 주세요." : hasFilter ? `${projects.length}개 중 ${filtered.length}개` : "최근 수정 순"}
    </div>
    {error && <p role="alert" className="mx-3 mb-3 break-words text-sm text-destructive">{error}</p>}
    <ul aria-label="저장된 프로젝트 목록" aria-busy={busy} className="max-h-72 overflow-y-auto overscroll-contain border-t border-border lg:max-h-[min(60vh,36rem)]">
      {filtered.map((project) => <li key={project.id} className="border-b border-border last:border-b-0">
        <button type="button" onClick={() => onSelect(project.id)} aria-current={selectedId === project.id ? "true" : undefined}
          className={`block w-full min-w-0 px-3 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${selectedId === project.id ? "bg-primary/10" : "hover:bg-muted/60"}`}>
          <span className="block break-words text-sm font-medium [overflow-wrap:anywhere]">{project.title || "제목 없는 프로젝트"}</span>
          <span className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className={project.status === "failed" ? "text-destructive" : undefined}>{statusLabels[project.status]}</span>
            <span className="tabular-nums">버전 {project.revision} · <time dateTime={project.updatedAt}>{updatedLabel(project.updatedAt)}</time></span>
          </span>
        </button>
      </li>)}
    </ul>
    {!busy && !error && filtered.length === 0 && <div className="space-y-2 p-3 text-sm">
      <p className="text-muted-foreground">{hasFilter ? "검색 조건에 맞는 프로젝트가 없습니다." : "저장된 프로젝트가 없습니다."}</p>
      <button type="button" className={`${controlClass} hover:bg-muted`} onClick={hasFilter ? () => { setQuery(""); setStatus("all"); } : onStart}>
        {hasFilter ? "검색 조건 초기화" : "새 제작 요청 작성"}
      </button>
    </div>}
  </section>;
}
