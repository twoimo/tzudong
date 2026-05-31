"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type RefreshCandidateStatus =
  | "needs_review"
  | "approved"
  | "rejected"
  | "applied"
  | "superseded";

type RefreshCandidateRow = {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_address: string | null;
  current_phone: string | null;
  candidate_status: RefreshCandidateStatus;
  detected_change_types: string[];
  previous_snapshot: Record<string, unknown>;
  candidate_snapshot: Record<string, unknown>;
  evidence: Record<string, unknown>;
  created_at: string;
  decided_at: string | null;
  applied_at: string | null;
};

type RefreshHistorySummary = {
  approved_restaurants_total: number | null;
  needs_review: number;
  approved: number;
  rejected: number;
  applied: number;
  last_checked_at: string | null;
};

type RefreshHistoryResponse = {
  summary: RefreshHistorySummary;
  candidates: RefreshCandidateRow[];
};

type CandidateDecision = "approved" | "rejected" | "superseded";

const statusLabels: Record<RefreshCandidateStatus, string> = {
  needs_review: "검토 필요",
  approved: "승인됨",
  rejected: "반려됨",
  applied: "적용됨",
  superseded: "대체됨",
};

const statusTone: Record<RefreshCandidateStatus, string> = {
  needs_review: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200",
  rejected: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200",
  applied: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200",
  superseded: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function snapshotText(snapshot: Record<string, unknown>, key: string) {
  const value = snapshot[key];
  return typeof value === "string" && value.trim() ? value : "—";
}

function changeTypeLabel(type: string) {
  if (type === "name") return "상호";
  if (type === "phone") return "전화번호";
  if (type === "closure") return "폐업";
  if (type === "relocation") return "이전";
  if (type === "address") return "주소";
  return type;
}

export function AdminRestaurantRefreshHistoryPanel() {
  const [data, setData] = useState<RefreshHistoryResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<RefreshCandidateStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<RefreshCandidateRow | null>(null);
  const [decision, setDecision] = useState<CandidateDecision>("approved");
  const [applyApprovedChange, setApplyApprovedChange] = useState(false);
  const [operatorNotes, setOperatorNotes] = useState("");
  const [isSavingDecision, setIsSavingDecision] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (query.trim()) params.set("search", query.trim());
      const response = await fetch(`/api/admin/restaurant-refresh-history?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "최신화 이력을 불러오지 못했습니다.");
      }
      setData(payload as RefreshHistoryResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "최신화 이력을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [query, statusFilter]);

  const openReview = useCallback((candidate: RefreshCandidateRow) => {
    setSelectedCandidate(candidate);
    setDecision("approved");
    setApplyApprovedChange(false);
    setOperatorNotes("");
    setDecisionMessage(null);
  }, []);

  const submitDecision = useCallback(async () => {
    if (!selectedCandidate) return;
    setIsSavingDecision(true);
    setDecisionMessage(null);
    try {
      const response = await fetch("/api/admin/restaurant-refresh-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "decide_candidate",
          candidate_id: selectedCandidate.id,
          decision,
          apply: decision === "approved" && applyApprovedChange,
          operator_notes: operatorNotes,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "최신화 후보 결정을 저장하지 못했습니다.");
      }
      setDecisionMessage(
        decision === "approved" && applyApprovedChange
          ? "결정과 guarded apply를 저장했습니다. 적용 후 readback/recrawl로 재확인하세요."
          : "운영자 결정을 이력에 저장했습니다.",
      );
      setSelectedCandidate(null);
      setOperatorNotes("");
      setApplyApprovedChange(false);
      void loadHistory();
    } catch (saveError) {
      setDecisionMessage(saveError instanceof Error ? saveError.message : "최신화 후보 결정을 저장하지 못했습니다.");
    } finally {
      setIsSavingDecision(false);
    }
  }, [applyApprovedChange, decision, loadHistory, operatorNotes, selectedCandidate]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filteredCandidates = useMemo(() => data?.candidates ?? [], [data]);
  const summary = data?.summary;

  return (
    <section
      aria-label="맛집 최신화 기록관리"
      className="flex min-h-full flex-col gap-3 overflow-y-auto bg-background p-3 text-foreground md:p-4"
      data-admin-restaurant-refresh-history="true"
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 text-primary">
              기록 관리
            </Badge>
            <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">
              승인 맛집 대상
            </Badge>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
              맛집 최신화 기록관리
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              승인된 맛집의 상호명·전화번호·폐업·이전 가능성을 주기적으로
              기록하고, 후보 스냅샷과 운영자 결정을 분리해 과거 변경 이력을
              추적합니다. 자동 적용 없이 승인 후 적용·재확인을 거칩니다.
            </p>
          </div>
        </div>
        <Button onClick={loadHistory} disabled={isLoading} className="w-full gap-2 lg:w-auto">
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          최신 이력 새로고침
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border bg-card/95 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Store className="h-4 w-4 text-primary" />승인 맛집</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{summary?.approved_restaurants_total ?? "—"}</CardContent>
        </Card>
        <Card className="border-border bg-card/95 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-600" />검토 필요</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{summary?.needs_review ?? 0}</CardContent>
        </Card>
        <Card className="border-border bg-card/95 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" />적용 완료</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{summary?.applied ?? 0}</CardContent>
        </Card>
        <Card className="border-border bg-card/95 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Clock3 className="h-4 w-4 text-sky-600" />최근 점검</CardTitle></CardHeader>
          <CardContent className="text-sm font-medium">{formatDate(summary?.last_checked_at)}</CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card/95 shadow-sm">
        <CardHeader className="gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5 text-primary" />
              변경 후보 및 결정 이력
            </CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              후보 생성 → 운영자 판단 → guarded apply → readback/recrawl 순서를
              유지합니다.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void loadHistory();
                }}
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
                placeholder="맛집명/전화번호 검색"
                aria-label="맛집 최신화 이력 검색"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as RefreshCandidateStatus | "all")}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="최신화 후보 상태 필터"
            >
              <option value="all">전체 상태</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {decisionMessage ? (
            <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm text-primary">
              {decisionMessage}
            </div>
          ) : null}
          {selectedCandidate ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 shadow-sm">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">운영자 결정 기록</p>
                  <h3 className="mt-1 text-base font-semibold text-foreground">{selectedCandidate.restaurant_name}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    후보를 승인/반려/대체로 기록하고, 승인 후보만 선택적으로 guarded apply 합니다.
                    적용 후에는 반드시 readback/recrawl 후보를 새로 남겨 실제 반영 여부를 교차 확인하세요.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedCandidate(null)} disabled={isSavingDecision}>
                  닫기
                </Button>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1.2fr]">
                <div className="rounded-lg border border-border bg-background/80 p-3 text-xs leading-5">
                  <p className="font-semibold text-foreground">현재 스냅샷</p>
                  <p>상호: {snapshotText(selectedCandidate.previous_snapshot, "name")}</p>
                  <p>전화: {snapshotText(selectedCandidate.previous_snapshot, "phone")}</p>
                  <p>도로명: {snapshotText(selectedCandidate.previous_snapshot, "road_address")}</p>
                  <p>지번: {snapshotText(selectedCandidate.previous_snapshot, "jibun_address")}</p>
                </div>
                <div className="rounded-lg border border-border bg-background/80 p-3 text-xs leading-5">
                  <p className="font-semibold text-foreground">후보 스냅샷</p>
                  <p>상호: {snapshotText(selectedCandidate.candidate_snapshot, "name")}</p>
                  <p>전화: {snapshotText(selectedCandidate.candidate_snapshot, "phone")}</p>
                  <p>도로명: {snapshotText(selectedCandidate.candidate_snapshot, "road_address")}</p>
                  <p>지번: {snapshotText(selectedCandidate.candidate_snapshot, "jibun_address")}</p>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-foreground">
                    결정
                    <select
                      value={decision}
                      onChange={(event) => {
                        const nextDecision = event.target.value as CandidateDecision;
                        setDecision(nextDecision);
                        if (nextDecision !== "approved") setApplyApprovedChange(false);
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="approved">승인됨</option>
                      <option value="rejected">반려됨</option>
                      <option value="superseded">대체됨</option>
                    </select>
                  </label>
                  <label className="flex items-start gap-2 rounded-lg border border-border bg-background/80 p-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={applyApprovedChange}
                      disabled={decision !== "approved"}
                      onChange={(event) => setApplyApprovedChange(event.target.checked)}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      승인과 동시에 현재 맛집 값 guarded apply
                      <span className="block text-[11px]">승인된 맛집 row에만 적용되며 실패 시 이력도 적용됨으로 바뀌지 않습니다.</span>
                    </span>
                  </label>
                  <textarea
                    value={operatorNotes}
                    onChange={(event) => setOperatorNotes(event.target.value)}
                    className="min-h-20 w-full rounded-lg border border-input bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="근거 URL, 전화번호 확인, 폐업/상호변경 판단 메모"
                    aria-label="최신화 후보 운영자 메모"
                  />
                  <Button onClick={submitDecision} disabled={isSavingDecision} className="w-full gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    {isSavingDecision ? "저장 중…" : "결정 저장"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="hidden grid-cols-[1.2fr_1fr_1fr_1fr_120px] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground lg:grid">
              <span>맛집</span><span>현재 → 후보</span><span>변경 유형</span><span>상태/일시</span><span>조치</span>
            </div>
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">이력을 불러오는 중입니다…</div>
            ) : filteredCandidates.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                아직 기록된 최신화 후보가 없습니다. 승인 맛집 점검 job 또는 수동 후보 기록이 생성되면 이곳에서 누적 관리됩니다.
              </div>
            ) : (
              filteredCandidates.map((candidate) => (
                <article key={candidate.id} className="grid gap-3 border-b border-border px-3 py-3 last:border-b-0 lg:grid-cols-[1.2fr_1fr_1fr_1fr_120px] lg:items-center">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{candidate.restaurant_name}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{candidate.restaurant_address || "주소 없음"}</p>
                    <p className="text-xs text-muted-foreground">현재 전화: {candidate.current_phone || "—"}</p>
                  </div>
                  <div className="text-xs leading-5 text-muted-foreground">
                    <p><span className="font-medium text-foreground">상호</span> {snapshotText(candidate.previous_snapshot, "name")} → {snapshotText(candidate.candidate_snapshot, "name")}</p>
                    <p><span className="font-medium text-foreground">전화</span> {snapshotText(candidate.previous_snapshot, "phone")} → {snapshotText(candidate.candidate_snapshot, "phone")}</p>
                    <p><span className="font-medium text-foreground">주소</span> {snapshotText(candidate.previous_snapshot, "road_address")} → {snapshotText(candidate.candidate_snapshot, "road_address")}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {candidate.detected_change_types.map((type) => (
                      <Badge key={type} variant="secondary" className="text-xs">{changeTypeLabel(type)}</Badge>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Badge variant="outline" className={cn("w-fit", statusTone[candidate.candidate_status])}>{statusLabels[candidate.candidate_status]}</Badge>
                    <p className="text-xs text-muted-foreground">기록 {formatDate(candidate.created_at)}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={candidate.candidate_status !== "needs_review"}
                    onClick={() => openReview(candidate)}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    승인 검토
                  </Button>
                </article>
              ))
            )}
          </div>
          <div className="grid gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground md:grid-cols-4">
            {[
              "1. 승인 맛집 스냅샷 수집",
              "2. 외부 후보와 현재값 비교",
              "3. 운영자 승인/반려 기록",
              "4. 적용 후 readback/recrawl",
            ].map((step) => (
              <div key={step} className="rounded-lg bg-background/70 p-2">{step}</div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
