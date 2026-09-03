"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  History,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
} from "lucide-react";

import { ConsoleVizFormRenderer } from "@/components/admin/viz/console-viz-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getConsoleVizBindings } from "@/lib/admin/console-visualization-map";
import type { ConsoleVizSeries } from "@/lib/admin/console-viz-state";
import { cn } from "@/lib/utils";

type RefreshCandidateStatus =
  | "needs_review"
  | "approved"
  | "rejected"
  | "applied"
  | "superseded";

type ReadbackState = {
  status: "not_required" | "pending" | "completed" | "failed";
  checked_at: string | null;
  run_id: string | null;
  notes: string | null;
};

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
  readback_state: ReadbackState;
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
  needs_review:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
  approved:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200",
  rejected:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200",
  applied:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200",
  superseded:
    "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200",
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

function isClosureCandidate(candidate: RefreshCandidateRow | null) {
  return Boolean(candidate?.detected_change_types.includes("closure"));
}

function evidenceText(evidence: Record<string, unknown>, key: string) {
  const value = evidence[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readbackLabel(state: ReadbackState) {
  if (state.status === "completed") return "readback 완료";
  if (state.status === "failed") return "readback 실패";
  if (state.status === "pending") return "readback 대기";
  return "readback 대상 아님";
}

function readbackTone(state: ReadbackState) {
  if (state.status === "completed")
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200";
  if (state.status === "failed")
    return "border-destructive/30 bg-destructive/10 text-destructive";
  if (state.status === "pending")
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200";
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300";
}

function reviewChecklistForCandidate(candidate: RefreshCandidateRow) {
  const types = new Set(candidate.detected_change_types);
  const checklist = new Set<string>();
  if (types.has("name"))
    checklist.add(
      "상호 변경: 후보 상호+지역명+전화번호로 검색해 상호 변경/동일 주소 여부를 확인",
    );
  if (types.has("phone"))
    checklist.add(
      "전화번호 변경: 후보 전화번호를 네이버 지도와 구글/블로그 리뷰에서 역검색",
    );
  if (types.has("address") || types.has("relocation"))
    checklist.add(
      "주소/이전: 도로명·지번·좌표·주변 가게/거리 단서를 영상·지도 리뷰 이미지와 교차 확인",
    );
  if (types.has("closure"))
    checklist.add(
      "폐업 의심: 네이버 미검색만으로 확정하지 말고 전화 확인·외부 리뷰·상호 변경 가능성을 검토",
    );
  if (types.has("readback_mismatch"))
    checklist.add(
      "readback 불일치: 적용 후보와 현재 restaurants row를 비교하고 재점검 후보로 다시 결정",
    );
  if (candidate.candidate_status === "applied")
    checklist.add(
      "적용 완료: readback/recrawl 상태가 완료인지 확인하고, 대기/실패면 재점검 실행",
    );
  if (checklist.size === 0)
    checklist.add(
      "기본 검토: 후보 생성 근거·현재 스냅샷·외부 출처를 확인 후 결정 메모를 남김",
    );
  return [...checklist];
}

type StatusSummaryItem = {
  label: string;
  value: number | string;
  tone: string;
};

function ManagementStatusSummary({ items }: { items: StatusSummaryItem[] }) {
  return (
    <div className="w-full overflow-x-auto scrollbar-hide [scrollbar-width:none] lg:w-auto lg:flex-none lg:overflow-visible [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-1.5">
        {items.map((item) => (
          <div
            key={item.label}
            className="inline-flex shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs whitespace-nowrap"
          >
            <span className="font-medium text-muted-foreground">
              {item.label}
            </span>
            <span className={cn("font-semibold", item.tone)}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RefreshWorkflowSteps() {
  return (
    <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground sm:flex sm:flex-wrap">
      {[
        "1. 승인 맛집 스냅샷 수집",
        "2. 외부 후보와 현재값 비교",
        "3. 운영자 승인/반려 기록",
        "4. 적용 후 readback/recrawl",
      ].map((step) => (
        <span
          key={step}
          className="rounded-md border border-border bg-background/70 px-2 py-1"
        >
          {step}
        </span>
      ))}
    </div>
  );
}

function RefreshCandidateListSkeleton() {
  return (
    <div
      className="space-y-2 p-2 xl:divide-y xl:divide-border xl:space-y-0 xl:p-0"
      role="status"
      aria-busy="true"
      aria-label="맛집 최신화 이력 로딩 중"
    >
      <span className="sr-only">맛집 최신화 후보 목록을 불러오는 중입니다.</span>
      {Array.from({ length: 5 }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-3 shadow-sm xl:rounded-none xl:border-x-0 xl:border-t-0 xl:bg-transparent xl:shadow-none xl:grid-cols-[1.2fr_1fr_0.9fr_0.9fr_110px] xl:items-center"
          aria-hidden="true"
        >
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-36 rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-3 w-48 max-w-full rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-3 w-28 rounded-full motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-10 rounded-lg motion-reduce:animate-none" />
          <Skeleton className="h-7 rounded-full motion-reduce:animate-none" />
          <Skeleton className="h-7 rounded-full motion-reduce:animate-none" />
          <Skeleton className="h-8 rounded-lg motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

type RefreshCandidateListProps = {
  candidates: RefreshCandidateRow[];
  isLoading: boolean;
  selectedCandidateId: string | null;
  onOpenReview: (candidate: RefreshCandidateRow) => void;
};

function RefreshCandidateList({
  candidates,
  isLoading,
  selectedCandidateId,
  onOpenReview,
}: RefreshCandidateListProps) {
  return (
    <div className="flex min-h-[360px] flex-col overflow-hidden rounded-xl bg-card shadow-sm md:border md:border-border lg:min-h-0">
      <div className="flex flex-col gap-2 border-b border-border bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            <History className="h-4 w-4 text-primary" />
            변경 후보 및 결정 이력
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            왼쪽 목록에서 후보를 선택하고 오른쪽 상세 패널에서
            스냅샷·근거·결정을 처리합니다.
          </p>
        </div>
        <RefreshWorkflowSteps />
      </div>

      <div className="hidden grid-cols-[1.2fr_1fr_0.9fr_0.9fr_110px] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground xl:grid">
        <span>맛집</span>
        <span>현재 → 후보</span>
        <span>검토 포인트</span>
        <span>상태/일시</span>
        <span>조치</span>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto scrollbar-hide [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-admin-restaurant-refresh-list="management-like"
      >
        {isLoading ? (
          <RefreshCandidateListSkeleton />
        ) : candidates.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            아직 기록된 최신화 후보가 없습니다. 승인 맛집 점검 job 또는 수동
            후보 기록이 생성되면 이곳에서 누적 관리됩니다.
          </div>
        ) : (
          candidates.map((candidate) => (
            <article
              key={candidate.id}
              className={cn(
                "mx-2 my-2 grid gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-3 shadow-sm last:mb-2 xl:mx-0 xl:my-0 xl:rounded-none xl:border-x-0 xl:border-t-0 xl:border-b xl:bg-transparent xl:shadow-none xl:last:mb-0 xl:last:border-b-0 xl:grid-cols-[1.2fr_1fr_0.9fr_0.9fr_110px] xl:items-center",
                selectedCandidateId === candidate.id && "bg-primary/5",
              )}
            >
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {candidate.restaurant_name}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {candidate.restaurant_address || "주소 없음"}
                </p>
                <p className="text-xs text-muted-foreground">
                  현재 전화: {candidate.current_phone || "—"}
                </p>
              </div>
              <div className="break-words text-xs leading-5 text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">상호</span>{" "}
                  {snapshotText(candidate.previous_snapshot, "name")} →{" "}
                  {snapshotText(candidate.candidate_snapshot, "name")}
                </p>
                <p>
                  <span className="font-medium text-foreground">전화</span>{" "}
                  {snapshotText(candidate.previous_snapshot, "phone")} →{" "}
                  {snapshotText(candidate.candidate_snapshot, "phone")}
                </p>
                <p>
                  <span className="font-medium text-foreground">주소</span>{" "}
                  {snapshotText(candidate.previous_snapshot, "road_address")} →{" "}
                  {snapshotText(candidate.candidate_snapshot, "road_address")}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {candidate.detected_change_types.map((type) => (
                    <Badge key={type} variant="secondary" className="text-xs">
                      {changeTypeLabel(type)}
                    </Badge>
                  ))}
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {reviewChecklistForCandidate(candidate)[0]}
                </p>
              </div>
              <div className="space-y-1">
                <Badge
                  variant="outline"
                  className={cn(
                    "w-fit",
                    statusTone[candidate.candidate_status],
                  )}
                >
                  {statusLabels[candidate.candidate_status]}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "w-fit",
                    readbackTone(candidate.readback_state),
                  )}
                >
                  {readbackLabel(candidate.readback_state)}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  기록 {formatDate(candidate.created_at)}
                </p>
              </div>
              <Button
                variant={
                  selectedCandidateId === candidate.id ? "secondary" : "outline"
                }
                size="sm"
                className="h-8 w-full gap-1.5 text-xs xl:w-auto"
                disabled={candidate.candidate_status !== "needs_review"}
                onClick={() => onOpenReview(candidate)}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                상세 검토
              </Button>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

type RefreshCandidateDetailPanelProps = {
  selectedCandidate: RefreshCandidateRow | null;
  checklist: string[];
  decision: CandidateDecision;
  applyApprovedChange: boolean;
  operatorNotes: string;
  isSavingDecision: boolean;
  canApplySelectedCandidate: boolean;
  selectedCandidateIsClosure: boolean;
  onClose: () => void;
  onDecisionChange: (decision: CandidateDecision) => void;
  onApplyApprovedChange: (checked: boolean) => void;
  onOperatorNotesChange: (notes: string) => void;
  onSubmitDecision: () => void;
};

function RefreshCandidateDetailPanel({
  selectedCandidate,
  checklist,
  decision,
  applyApprovedChange,
  operatorNotes,
  isSavingDecision,
  canApplySelectedCandidate,
  selectedCandidateIsClosure,
  onClose,
  onDecisionChange,
  onApplyApprovedChange,
  onOperatorNotesChange,
  onSubmitDecision,
}: RefreshCandidateDetailPanelProps) {
  return (
    <aside
      className="flex min-h-[360px] flex-col overflow-hidden rounded-xl bg-card shadow-sm md:border md:border-border lg:min-h-0"
      aria-label="맛집 최신화 상세 검토"
      data-admin-restaurant-refresh-detail="management-like"
    >
      {selectedCandidate ? (
        <>
          <div className="flex items-start justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                운영자 결정 기록
              </p>
              <h3 className="mt-0.5 truncate text-base font-bold text-foreground">
                {selectedCandidate.restaurant_name}
              </h3>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                후보를 승인/반려/대체로 기록하고, 승인 후보만 선택적으로 guarded
                apply 합니다.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={onClose}
              disabled={isSavingDecision}
            >
              닫기
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-hide p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="break-words rounded-lg border border-border/70 bg-background/80 p-3 text-xs leading-5">
                <p className="font-semibold text-foreground">현재 스냅샷</p>
                <p>
                  상호:{" "}
                  {snapshotText(selectedCandidate.previous_snapshot, "name")}
                </p>
                <p>
                  전화:{" "}
                  {snapshotText(selectedCandidate.previous_snapshot, "phone")}
                </p>
                <p>
                  도로명:{" "}
                  {snapshotText(
                    selectedCandidate.previous_snapshot,
                    "road_address",
                  )}
                </p>
                <p>
                  지번:{" "}
                  {snapshotText(
                    selectedCandidate.previous_snapshot,
                    "jibun_address",
                  )}
                </p>
              </div>
              <div className="break-words rounded-lg border border-border/70 bg-background/80 p-3 text-xs leading-5">
                <p className="font-semibold text-foreground">후보 스냅샷</p>
                <p>
                  상호:{" "}
                  {snapshotText(selectedCandidate.candidate_snapshot, "name")}
                </p>
                <p>
                  전화:{" "}
                  {snapshotText(selectedCandidate.candidate_snapshot, "phone")}
                </p>
                <p>
                  도로명:{" "}
                  {snapshotText(
                    selectedCandidate.candidate_snapshot,
                    "road_address",
                  )}
                </p>
                <p>
                  지번:{" "}
                  {snapshotText(
                    selectedCandidate.candidate_snapshot,
                    "jibun_address",
                  )}
                </p>
              </div>
            </div>

            <div className="break-words rounded-lg border border-border/70 bg-background/80 p-3 text-xs leading-5 text-muted-foreground">
              <p className="mb-1 flex items-center gap-1 font-semibold text-foreground">
                <ListChecks className="h-3.5 w-3.5 text-primary" />
                유형별 검토 체크리스트
              </p>
              <ul className="list-disc space-y-1 pl-4">
                {checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={cn(
                    "w-fit",
                    readbackTone(selectedCandidate.readback_state),
                  )}
                >
                  {readbackLabel(selectedCandidate.readback_state)}
                </Badge>
                {selectedCandidate.readback_state.checked_at ? (
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(selectedCandidate.readback_state.checked_at)}
                  </span>
                ) : null}
              </div>
              <p
                className="mt-2 text-[11px]"
                data-admin-restaurant-refresh-evidence-summary="true"
              >
                근거:{" "}
                {evidenceText(selectedCandidate.evidence, "source") ||
                  "출처 미기록"}
                {evidenceText(selectedCandidate.evidence, "query")
                  ? ` · ${evidenceText(selectedCandidate.evidence, "query")}`
                  : ""}
              </p>
            </div>

            <label className="block text-xs font-medium text-foreground">
              결정
              <select
                value={decision}
                onChange={(event) =>
                  onDecisionChange(event.target.value as CandidateDecision)
                }
                className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                disabled={!canApplySelectedCandidate}
                onChange={(event) =>
                  onApplyApprovedChange(event.target.checked)
                }
                className="mt-0.5 h-4 w-4"
              />
              <span>
                승인과 동시에 현재 맛집 값 guarded apply
                <span className="block text-[11px]">
                  상호·전화·주소·좌표 변경 후보만 적용됩니다. 폐업 의심 후보는
                  자동 적용할 수 없습니다.
                </span>
              </span>
            </label>

            {selectedCandidateIsClosure ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                폐업 의심 후보는 네이버 미검색 신호일 뿐 폐업 확정이 아니므로
                guarded apply를 막습니다. 결정 메모에 전화 확인·외부
                리뷰·현장/지도 근거를 남긴 뒤 별도 운영 절차로 처리하세요.
              </div>
            ) : null}

            <textarea
              value={operatorNotes}
              onChange={(event) => onOperatorNotesChange(event.target.value)}
              className="min-h-24 w-full rounded-lg border border-input bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="근거 URL, 전화번호 확인, 폐업/상호변경 판단 메모"
              aria-label="최신화 후보 운영자 메모"
            />
          </div>

          <div className="border-t border-border bg-card p-3">
            <Button
              onClick={onSubmitDecision}
              disabled={isSavingDecision}
              className="w-full gap-2"
            >
              <ShieldCheck className="h-4 w-4" />
              {isSavingDecision ? "저장 중…" : "결정 저장"}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground">
          <ShieldCheck className="mb-3 h-8 w-8 text-primary/60" />
          <h3 className="text-base font-semibold text-foreground">
            왼쪽 목록에서 후보를 선택하세요
          </h3>
          <p className="mt-2 max-w-sm leading-6">
            맛집 관리 상세 패널처럼 현재 스냅샷, 후보 스냅샷, 유형별 체크리스트,
            운영자 메모와 guarded apply를 한 곳에서 처리합니다.
          </p>
        </div>
      )}
    </aside>
  );
}

export function AdminRestaurantRefreshHistoryPanel() {
  const [data, setData] = useState<RefreshHistoryResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    RefreshCandidateStatus | "all"
  >("all");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] =
    useState<RefreshCandidateRow | null>(null);
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
      const response = await fetch(
        `/api/admin/restaurant-refresh-history?${params.toString()}`,
        {
          cache: "no-store",
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "최신화 이력을 불러오지 못했습니다.");
      }
      setData(payload as RefreshHistoryResponse);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "최신화 이력을 불러오지 못했습니다.",
      );
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
        throw new Error(
          payload?.error || "최신화 후보 결정을 저장하지 못했습니다.",
        );
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
      setDecisionMessage(
        saveError instanceof Error
          ? saveError.message
          : "최신화 후보 결정을 저장하지 못했습니다.",
      );
    } finally {
      setIsSavingDecision(false);
    }
  }, [
    applyApprovedChange,
    decision,
    loadHistory,
    operatorNotes,
    selectedCandidate,
  ]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filteredCandidates = useMemo(() => data?.candidates ?? [], [data]);
  const selectedCandidateIsClosure = isClosureCandidate(selectedCandidate);
  const selectedCandidateChecklist = selectedCandidate
    ? reviewChecklistForCandidate(selectedCandidate)
    : [];
  const canApplySelectedCandidate =
    decision === "approved" && !selectedCandidateIsClosure;
  const summary = data?.summary;

  const waterfallBinding = getConsoleVizBindings("restaurant-refresh-history").find(
    (binding) => binding.form === "waterfall-delta-step",
  );
  const waterfallSeries: ConsoleVizSeries[] = summary
    ? [
        {
          label: "검토 필요",
          points: [0, summary.needs_review],
          unit: "건",
          fractionDigits: 0,
        },
        {
          label: "승인",
          points: [0, summary.approved],
          unit: "건",
          fractionDigits: 0,
        },
        {
          label: "적용",
          points: [0, summary.applied],
          unit: "건",
          fractionDigits: 0,
        },
        {
          label: "반려",
          points: [0, summary.rejected],
          unit: "건",
          fractionDigits: 0,
        },
      ]
    : [];
  const waterfallStatus = error
    ? "error"
    : isLoading && !data
      ? "loading"
      : "settled";
  const statusSummaryItems: StatusSummaryItem[] = [
    {
      label: "승인 맛집",
      value: summary?.approved_restaurants_total ?? "—",
      tone: "text-primary",
    },
    {
      label: "검토 필요",
      value: summary?.needs_review ?? 0,
      tone: "text-amber-700 dark:text-amber-300",
    },
    {
      label: "승인",
      value: summary?.approved ?? 0,
      tone: "text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "적용",
      value: summary?.applied ?? 0,
      tone: "text-sky-700 dark:text-sky-300",
    },
    {
      label: "반려",
      value: summary?.rejected ?? 0,
      tone: "text-slate-700 dark:text-slate-300",
    },
  ];

  return (
    <section
      aria-labelledby="admin-restaurant-refresh-history-title"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-admin-restaurant-refresh-history="true"
      data-admin-restaurant-refresh-management-structure="header-list-detail"
      data-admin-embedded-module-shell="true"
      data-admin-embedded-module-id="restaurant-refresh-history"
    >
      <div
        className="shrink-0 border-b border-border bg-card px-2 py-1.5"
        aria-label="맛집 최신화 필터 및 상태 도구"
        data-admin-module-header="compact"
        data-admin-module-header-module="restaurant-refresh-history"
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <h2
                id="admin-restaurant-refresh-history-title"
                className="whitespace-nowrap bg-gradient-primary bg-clip-text text-base font-bold text-transparent"
              >
                맛집 최신화 기록관리
              </h2>
            </div>
            <div className="mt-1 grid w-full min-w-0 grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
              <Badge
                variant="outline"
                className="min-w-0 shrink-0 justify-center gap-1 truncate border-primary/30 text-primary sm:justify-start"
              >
                <Store className="h-3.5 w-3.5" />
                기록 관리
              </Badge>
              <Badge
                variant="outline"
                className="min-w-0 shrink-0 justify-center truncate border-primary/30 text-primary sm:justify-start"
              >
                <span className="sm:hidden">동일 구조</span>
                <span className="hidden sm:inline">맛집 관리 동일 구조</span>
              </Badge>
              <Badge
                variant="outline"
                className="min-w-0 shrink-0 justify-center truncate border-emerald-300 text-emerald-700 dark:text-emerald-300 sm:justify-start"
              >
                <span className="sm:hidden">승인 맛집</span>
                <span className="hidden sm:inline">승인 맛집 대상</span>
              </Badge>
              <Badge
                variant="secondary"
                className="min-w-0 shrink-0 justify-center truncate font-normal sm:justify-start"
              >
                <span className="sm:hidden">안전 적용</span>
                <span className="hidden sm:inline">guarded apply · readback/recrawl</span>
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm" data-admin-module-summary="true">
              필터링: {filteredCandidates.length}개 | 검토 필요{" "}
              {summary?.needs_review ?? 0}개 | 최근 점검{" "}
              {formatDate(summary?.last_checked_at)}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground sm:hidden">
              후보 생성 → 운영자 판단 → 안전 적용 → 재확인 순서로 추적합니다.
            </p>
            <p className="mt-0.5 hidden max-w-4xl text-xs leading-5 text-muted-foreground sm:block">
              승인된 맛집의 상호명·전화번호·폐업·이전 가능성을 기록하고, 맛집
              관리와 같은 헤더-목록-상세 구조에서 후보 생성 → 운영자 판단 →
              guarded apply → readback/recrawl 순서로 추적합니다.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center lg:justify-end" data-admin-module-actions="top-right">
            <ManagementStatusSummary items={statusSummaryItems} />
            <div className="flex w-full flex-col gap-1.5 sm:flex-row lg:w-auto">
              <label className="relative block min-w-0 flex-1 lg:w-60">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadHistory();
                  }}
                  className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="맛집명/전화번호"
                  aria-label="맛집 최신화 이력 검색"
                />
              </label>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as RefreshCandidateStatus | "all",
                  )
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
                aria-label="최신화 후보 상태 필터"
              >
                <option value="all">전체 상태</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Button
                onClick={loadHistory}
                disabled={isLoading}
                size="sm"
                className="h-8 w-full gap-1.5 px-2 text-xs sm:w-auto"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
                />
                새로고침
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden scrollbar-hide p-2 [scrollbar-width:none] lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] lg:overflow-hidden [&::-webkit-scrollbar]:hidden" data-admin-module-content="bounded">
        {waterfallBinding ? (
          <div className="lg:col-span-2" data-admin-refresh-waterfall="true">
            <ConsoleVizFormRenderer
              binding={waterfallBinding}
              requestStatus={waterfallStatus}
              series={waterfallSeries}
              metaLeft="최신화 변경 유형"
              metaRight={`${summary?.needs_review ?? 0}건`}
            />
          </div>
        ) : null}
        {error || decisionMessage ? (
          <div className="space-y-2 lg:col-span-2">
            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}
            {decisionMessage ? (
              <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-xs text-primary">
                {decisionMessage}
              </div>
            ) : null}
          </div>
        ) : null}

        <RefreshCandidateList
          candidates={filteredCandidates}
          isLoading={isLoading}
          selectedCandidateId={selectedCandidate?.id ?? null}
          onOpenReview={openReview}
        />

        <RefreshCandidateDetailPanel
          selectedCandidate={selectedCandidate}
          checklist={selectedCandidateChecklist}
          decision={decision}
          applyApprovedChange={applyApprovedChange}
          operatorNotes={operatorNotes}
          isSavingDecision={isSavingDecision}
          canApplySelectedCandidate={canApplySelectedCandidate}
          selectedCandidateIsClosure={selectedCandidateIsClosure}
          onClose={() => setSelectedCandidate(null)}
          onDecisionChange={(nextDecision) => {
            setDecision(nextDecision);
            if (nextDecision !== "approved" || selectedCandidateIsClosure) {
              setApplyApprovedChange(false);
            }
          }}
          onApplyApprovedChange={setApplyApprovedChange}
          onOperatorNotesChange={setOperatorNotes}
          onSubmitDecision={submitDecision}
        />
      </div>
    </section>
  );
}
