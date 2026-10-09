"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { useRestaurantManagementHeader } from "@/components/admin/RestaurantManagementWorkspace";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useInitialLoadPending } from '@/lib/use-initial-load-pending';
import { useFilledSkeletonCount } from "@/lib/use-filled-skeleton-count";
import {
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  if (state.status === "completed") return "적용 확인 완료";
  if (state.status === "failed") return "적용 확인 실패";
  if (state.status === "pending") return "적용 확인 대기";
  return "적용 전";
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
      "적용한 정보와 현재 맛집 정보를 비교하고 다시 점검하세요.",
    );
  if (candidate.candidate_status === "applied")
    checklist.add(
      "적용 결과를 확인하고 대기 또는 실패 상태면 다시 점검하세요.",
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
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" data-admin-module-summary="true">
    {items.map(item => <span key={item.label}>{item.label} <strong className={cn("font-medium tabular-nums", item.tone)}>{item.value}</strong></span>)}
  </div>;
}

function canDecideRefreshCandidate(candidate: RefreshCandidateRow | null) {
  return candidate?.candidate_status === "needs_review";
}

function isRefreshDraftDirty(candidate: RefreshCandidateRow | null, decision: CandidateDecision, apply: boolean, notes: string) {
  return Boolean(candidate) && (decision !== "approved" || apply || notes.length > 0);
}

type PendingRefreshReadback = {
  candidateId: string;
  restaurantId: string;
  expectedStatus: CandidateDecision | "applied";
  previousDecidedAt: string | null;
  previousAppliedAt: string | null;
};

function createPendingRefreshReadback(candidate: RefreshCandidateRow, decision: CandidateDecision, apply: boolean): PendingRefreshReadback {
  return {
    candidateId: candidate.id,
    restaurantId: candidate.restaurant_id,
    expectedStatus: decision === "approved" && apply ? "applied" : decision,
    previousDecidedAt: candidate.decided_at,
    previousAppliedAt: candidate.applied_at,
  };
}

function evaluateRefreshReadback(pending: PendingRefreshReadback, candidates: RefreshCandidateRow[]): "confirmed" | "pending" | "conflict" {
  const actual = candidates.find(candidate => candidate.id === pending.candidateId);
  if (!actual) return "pending";
  if (actual.restaurant_id !== pending.restaurantId) return "conflict";
  if (actual.candidate_status === "needs_review") return "pending";
  if (actual.candidate_status !== pending.expectedStatus) return "conflict";
  const hasNewDecision = typeof actual.decided_at === "string" && Number.isFinite(Date.parse(actual.decided_at)) && actual.decided_at !== pending.previousDecidedAt;
  if (!hasNewDecision) return "pending";
  if (pending.expectedStatus === "applied") {
    const hasNewApply = typeof actual.applied_at === "string" && Number.isFinite(Date.parse(actual.applied_at)) && actual.applied_at !== pending.previousAppliedAt;
    // Recrawl can still be pending or failed after a committed apply; do not claim recrawl completion.
    return hasNewApply && ["pending", "completed", "failed"].includes(actual.readback_state?.status) ? "confirmed" : "pending";
  }
  return actual.applied_at === null && actual.readback_state?.status === "not_required" ? "confirmed" : "pending";
}

function RefreshCandidateListSkeleton() {
  const { ref: skeletonRef, count: skeletonCount } = useFilledSkeletonCount(64, 5);
  return <div ref={skeletonRef} className="h-full min-h-0 divide-y" role="status" aria-busy="true" aria-label="맛집 최신화 이력 로딩 중">
    <span className="sr-only">맛집 최신화 후보 목록을 불러오는 중입니다.</span>
    {Array.from({ length: skeletonCount }).map((_, index) => <div key={index} className="flex items-center gap-3 px-3 py-3" aria-hidden="true">
      <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-36 motion-reduce:animate-none" /><Skeleton className="h-3 w-48 max-w-full motion-reduce:animate-none" /></div><Skeleton className="h-5 w-16 rounded-full motion-reduce:animate-none" />
    </div>)}
  </div>;
}

type RefreshCandidateListProps = {
  candidates: RefreshCandidateRow[];
  isLoading: boolean;
  selectedCandidateId: string | null;
  disabled: boolean;
  hasFilters: boolean;
  onOpenReview: (candidate: RefreshCandidateRow, trigger: HTMLButtonElement) => void;
};

function RefreshCandidateList({ candidates, isLoading, selectedCandidateId, disabled, hasFilters, onOpenReview }: RefreshCandidateListProps) {
  return <div className="admin-cms-table-container min-h-0 flex-1" data-admin-restaurant-refresh-list="management-like">
    {isLoading ? <RefreshCandidateListSkeleton /> : candidates.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground" role="status">{hasFilters ? "조건에 맞는 최신화 이력이 없습니다." : "최신화 이력이 없습니다."}</p> : <>
      <ul className="divide-y md:hidden" aria-label="최신화 후보 및 결정 이력">{candidates.map(candidate => <li key={candidate.id}>
        <button type="button" className={cn("w-full min-w-0 px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary", selectedCandidateId === candidate.id && "admin-cms-row-selected")} aria-pressed={selectedCandidateId === candidate.id} aria-label={`${candidate.restaurant_name} 상세 보기`} disabled={disabled} onClick={event => onOpenReview(candidate, event.currentTarget)}>
          <span className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-sm font-medium">{candidate.restaurant_name}</span><Badge variant="outline" className={cn("shrink-0 text-2xs", statusTone[candidate.candidate_status])}>{statusLabels[candidate.candidate_status]}</Badge></span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{candidate.restaurant_address || "주소 없음"}</span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span>{candidate.detected_change_types.map(changeTypeLabel).join(" · ") || "정보 변경"}</span><span className="ml-auto">{readbackLabel(candidate.readback_state)}</span></span>
        </button>
      </li>)}</ul>
      <table className="admin-cms-table hidden table-fixed md:table"><caption className="sr-only">최신화 후보 및 결정 이력</caption>
        <thead className="sticky top-0 z-10 bg-muted"><tr><th scope="col" className="w-[40%]">맛집</th><th scope="col" className="w-[20%]">변경 항목</th><th scope="col" className="w-[20%]">상태</th><th scope="col" className="w-[20%]">적용 확인</th></tr></thead>
        <tbody>{candidates.map(candidate => <tr key={candidate.id} className={cn(selectedCandidateId === candidate.id && "admin-cms-row-selected")} data-selected={selectedCandidateId === candidate.id}>
          <td><button type="button" className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-pressed={selectedCandidateId === candidate.id} aria-label={`${candidate.restaurant_name} 상세 보기`} disabled={disabled} onClick={event => onOpenReview(candidate, event.currentTarget)}><span className="block truncate text-sm font-medium">{candidate.restaurant_name}</span><span className="block truncate text-xs text-muted-foreground">{candidate.restaurant_address || "주소 없음"}</span></button></td>
          <td><span className="text-xs">{candidate.detected_change_types.map(changeTypeLabel).join(" · ") || "정보 변경"}</span></td>
          <td><Badge variant="outline" className={cn("whitespace-nowrap text-2xs", statusTone[candidate.candidate_status])}>{statusLabels[candidate.candidate_status]}</Badge></td>
          <td><span className={cn("text-xs", candidate.readback_state.status === "failed" && "text-destructive")}>{readbackLabel(candidate.readback_state)}</span></td>
        </tr>)}</tbody>
      </table>
    </>}
  </div>;
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
  canSave: boolean;
  selectionLocked: boolean;
  narrow: boolean;
  notice: ReactNode;
  onRefresh: () => void;
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
  canSave, selectionLocked, narrow, notice, onRefresh,
}: RefreshCandidateDetailPanelProps) {
  const readOnly = !canDecideRefreshCandidate(selectedCandidate);
  return (
    <aside
      className={cn("admin-cms-inspector !p-0 flex h-full min-h-0 flex-col overflow-hidden bg-card", narrow && "!w-full !flex-auto")}
      aria-label="맛집 최신화 상세 검토"
      data-admin-restaurant-refresh-detail="management-like"
    >
      {notice}
      {selectedCandidate ? (
        <>
          <div className="flex items-start justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                운영자 결정 기록{readOnly && " · 읽기 전용"}
              </p>
              <h3 id="refresh-detail-heading" tabIndex={-1} className="mt-0.5 truncate text-base font-semibold outline-none">
                {selectedCandidate.restaurant_name}
              </h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={onClose}
              disabled={isSavingDecision || selectionLocked}
            >
              <X className="h-4 w-4" aria-hidden="true" />{narrow ? "목록으로" : "닫기"}
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={statusTone[selectedCandidate.candidate_status]}>{statusLabels[selectedCandidate.candidate_status]}</Badge><span className="text-xs text-muted-foreground">{formatDate(selectedCandidate.decided_at ?? selectedCandidate.created_at)}</span><Button type="button" variant="ghost" size="sm" className="ml-auto h-8 px-2" onClick={onRefresh} disabled={isSavingDecision} aria-label="선택한 최신화 이력 새로고침"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /></Button></div>
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
                  <span className="text-2xs text-muted-foreground">
                    {formatDate(selectedCandidate.readback_state.checked_at)}
                  </span>
                ) : null}
              </div>
              <p
                className="mt-2 text-2xs"
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

            {!readOnly && <fieldset disabled={!canSave} className="space-y-3">
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
                승인과 동시에 맛집 정보 적용
                <span className="block text-2xs">
                  상호·전화·주소·좌표 변경 후보만 적용됩니다. 폐업 의심 후보는
                  자동 적용할 수 없습니다.
                </span>
              </span>
            </label>

            {selectedCandidateIsClosure ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                폐업 의심 후보는 네이버 미검색 신호일 뿐 폐업 확정이 아니므로
                자동 적용을 막습니다. 결정 메모에 전화 확인·외부
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
            </fieldset>}
            {readOnly && <dl className="grid gap-2 border-t pt-3 text-xs"><div><dt className="text-muted-foreground">기록일</dt><dd>{formatDate(selectedCandidate.created_at)}</dd></div><div><dt className="text-muted-foreground">결정일</dt><dd>{formatDate(selectedCandidate.decided_at)}</dd></div><div><dt className="text-muted-foreground">적용일</dt><dd>{formatDate(selectedCandidate.applied_at)}</dd></div></dl>}
          </div>

          <div className="shrink-0 border-t border-border bg-card p-3">
            {readOnly ? <p className="text-xs text-muted-foreground">결정이 끝난 기록은 읽기 전용입니다.</p> : <Button
              onClick={onSubmitDecision}
              disabled={!canSave}
              className="w-full gap-2"
            >
              <ShieldCheck className="h-4 w-4" />
              {isSavingDecision ? "저장 중…" : "결정 저장"}
            </Button>}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground">
          <ShieldCheck className="mb-3 h-8 w-8 text-primary/60" />
          <h3 className="text-base font-semibold text-foreground">
            왼쪽 목록에서 후보를 선택하세요
          </h3>
        </div>
      )}
    </aside>
  );
}

export function AdminRestaurantRefreshHistoryPanel({
  onInitialContentReady,
}: {
  onInitialContentReady?: () => void;
} = {}) {
  const [data, setData] = useState<RefreshHistoryResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    RefreshCandidateStatus | "all"
  >("all");
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [isNarrow, setIsNarrow] = useState(false);
  const managementHeader = useRestaurantManagementHeader();
  const rowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const readGeneration = useRef(0);
  const saveInFlight = useRef(false);
  const pendingReadbackRef = useRef<PendingRefreshReadback | null>(null);
  const [pendingReadback, setPendingReadback] = useState<PendingRefreshReadback | null>(null);
  const [readbackConflict, setReadbackConflict] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{ candidate: RefreshCandidateRow | null; trigger?: HTMLButtonElement } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const initialLoadPending = useInitialLoadPending(!isLoading);
  useLayoutEffect(() => {
    if (!onInitialContentReady || initialLoadPending) return;
    onInitialContentReady();
  }, [isLoading, initialLoadPending, onInitialContentReady]);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] =
    useState<RefreshCandidateRow | null>(null);
  const [decision, setDecision] = useState<CandidateDecision>("approved");
  const [applyApprovedChange, setApplyApprovedChange] = useState(false);
  const [operatorNotes, setOperatorNotes] = useState("");
  const [isSavingDecision, setIsSavingDecision] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (saveInFlight.current) return;
    const pendingAtReadStart = pendingReadbackRef.current;
    const generation = ++readGeneration.current;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (query.trim()) params.set("search", query.trim());
      const [response, exactResponse] = await Promise.all([
        fetch(`/api/admin/restaurant-refresh-history?${params.toString()}`, { cache: "no-store" }),
        pendingAtReadStart ? fetch(`/api/admin/restaurant-refresh-history?${new URLSearchParams({ candidate_id: pendingAtReadStart.candidateId })}`, { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const exactPayload = exactResponse ? await exactResponse.json().catch(() => null) : null;
      if (pendingAtReadStart && (!exactResponse?.ok || !exactPayload || !Array.isArray(exactPayload.candidates) || exactPayload.candidates.length !== 1 || exactPayload.candidates[0].id !== pendingAtReadStart.candidateId)) throw new Error("refresh_readback_unavailable");
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || !Array.isArray(payload.candidates) || !payload.summary) {
        throw new Error("refresh_history_unavailable");
      }
      if (generation !== readGeneration.current) return;
      const nextData = payload as RefreshHistoryResponse;
      setData(nextData);
      setSelectedCandidate(current => current ? (exactPayload?.candidates as RefreshCandidateRow[] | undefined)?.find(candidate => candidate.id === current.id) ?? nextData.candidates.find(candidate => candidate.id === current.id) ?? current : null);
      if (pendingAtReadStart && pendingReadbackRef.current === pendingAtReadStart) {
        const readback = evaluateRefreshReadback(pendingAtReadStart, exactPayload.candidates);
        if (readback === "conflict") setReadbackConflict(true);
        if (readback === "confirmed") {
          setReadbackConflict(false);
          pendingReadbackRef.current = null;
          setPendingReadback(null);
          setOperatorNotes("");
          setDecision("approved");
          setApplyApprovedChange(false);
          setDecisionMessage(pendingAtReadStart.expectedStatus === "applied"
            ? "최신 이력에서 적용된 상태를 확인했습니다. 재점검 결과는 적용 확인 상태를 확인하세요."
            : "최신 이력에서 요청한 결정 상태를 확인했습니다.");

        }
      }
    } catch {
      if (generation === readGeneration.current) setError("최신화 이력을 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (generation === readGeneration.current) setIsLoading(false);
    }
  }, [query, statusFilter]);

  const restoreListFocus = useCallback(() => {
    if (rowTriggerRef.current?.isConnected) rowTriggerRef.current.focus();
    else document.getElementById("refresh-history-search")?.focus();
  }, []);

  const applySelection = (candidate: RefreshCandidateRow | null, trigger?: HTMLButtonElement) => {
    if (saveInFlight.current || pendingReadbackRef.current) return;
    if (trigger) rowTriggerRef.current = trigger;
    setSelectedCandidate(candidate);
    setDecision("approved");
    setApplyApprovedChange(false);
    setOperatorNotes("");
    setDecisionMessage(null);
    setPendingSelection(null);
    requestAnimationFrame(() => candidate ? document.getElementById("refresh-detail-heading")?.focus() : restoreListFocus());
  };

  const requestSelection = (candidate: RefreshCandidateRow | null, trigger?: HTMLButtonElement) => {
    if (saveInFlight.current || pendingReadbackRef.current) return;
    if (candidate && candidate.id === selectedCandidate?.id) {
      document.getElementById("refresh-detail-heading")?.focus();
      return;
    }
    if (isRefreshDraftDirty(selectedCandidate, decision, applyApprovedChange, operatorNotes)) {
      setPendingSelection({ candidate, trigger });
      requestAnimationFrame(() => document.getElementById("refresh-unsaved-changes")?.focus());
    } else applySelection(candidate, trigger);
  };

  const canSave = Boolean(canDecideRefreshCandidate(selectedCandidate)
    && data?.candidates.some(candidate => candidate.id === selectedCandidate?.id && canDecideRefreshCandidate(candidate))
    && !isSavingDecision && !isLoading && !error && !pendingReadback);

  const submitDecision = useCallback(async () => {
    if (!selectedCandidate || !canDecideRefreshCandidate(selectedCandidate) || !canSave || saveInFlight.current || pendingReadbackRef.current || (applyApprovedChange && isClosureCandidate(selectedCandidate))) return;
    const expectedReadback = createPendingRefreshReadback(selectedCandidate, decision, applyApprovedChange);
    saveInFlight.current = true;
    readGeneration.current += 1;
    pendingReadbackRef.current = expectedReadback;
    setPendingReadback(expectedReadback);
    setReadbackConflict(false);
    setPendingSelection(null);
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
      const expectedStatus = expectedReadback.expectedStatus;
      if (!response.ok || payload?.ok !== true || payload?.candidate_status !== expectedStatus) {
        throw new Error("refresh_decision_unconfirmed");
      }
      pendingReadbackRef.current = null;
      setPendingReadback(null);
      setDecisionMessage(
        decision === "approved" && applyApprovedChange
          ? "결정과 변경을 저장했습니다. 적용 결과를 확인하세요."
          : "운영자 결정을 이력에 저장했습니다.",
      );
      setSelectedCandidate(null);
      setOperatorNotes("");
      setApplyApprovedChange(false);
      setPendingSelection(null);
      requestAnimationFrame(restoreListFocus);
    } catch {
      readGeneration.current += 1;
      setDecisionMessage("결정 결과를 확인하지 못했습니다. 최신 이력을 확인하기 전에는 다시 저장하거나 다른 후보로 이동할 수 없습니다.");
    } finally {
      saveInFlight.current = false;
      setIsSavingDecision(false);
    }
    if (!pendingReadbackRef.current) void loadHistory();
  }, [applyApprovedChange, canSave, decision, loadHistory, operatorNotes, restoreListFocus, selectedCandidate]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filteredCandidates = useMemo(() => [...(data?.candidates ?? [])].sort((a, b) => {
    if (sortOrder === "name") return a.restaurant_name.localeCompare(b.restaurant_name, "ko");
    if (sortOrder === "review" && a.candidate_status !== b.candidate_status) {
      if (a.candidate_status === "needs_review") return -1;
      if (b.candidate_status === "needs_review") return 1;
    }
    return b.created_at.localeCompare(a.created_at);
  }), [data, sortOrder]);
  const selectedCandidateIsClosure = isClosureCandidate(selectedCandidate);
  const selectedCandidateChecklist = selectedCandidate
    ? reviewChecklistForCandidate(selectedCandidate)
    : [];
  const canApplySelectedCandidate =
    canSave && decision === "approved" && !selectedCandidateIsClosure;
  const summary = data?.summary;

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

  const detail = <RefreshCandidateDetailPanel
    selectedCandidate={selectedCandidate}
    checklist={selectedCandidateChecklist}
    decision={decision}
    applyApprovedChange={applyApprovedChange}
    operatorNotes={operatorNotes}
    isSavingDecision={isSavingDecision}
    canApplySelectedCandidate={canApplySelectedCandidate}
    selectedCandidateIsClosure={selectedCandidateIsClosure}
    canSave={canSave}
    selectionLocked={Boolean(pendingReadback)}
    narrow={isNarrow}
    onClose={() => requestSelection(null)}
    onRefresh={() => void loadHistory()}
    notice={<>
      {pendingReadback && !isSavingDecision && <div role="alert" className="shrink-0 space-y-2 border-b bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        <p>{readbackConflict ? "요청한 결정과 다른 상태가 확인되었습니다. 충돌을 확인해야 하며 다시 저장할 수 없습니다." : "저장 결과 확인이 필요합니다. 같은 후보의 결정·적용 상태가 확인될 때까지 저장과 후보 이동을 잠급니다."}</p>
        <Button type="button" size="sm" variant="outline" disabled={isLoading} onClick={() => void loadHistory()}>{isLoading ? "확인 중…" : "결정 상태 다시 확인"}</Button>
      </div>}
      {pendingSelection && <div id="refresh-unsaved-changes" tabIndex={-1} role="alert" className="shrink-0 space-y-2 border-b bg-amber-50 p-3 text-xs text-amber-950 outline-none dark:bg-amber-950 dark:text-amber-100">
        <p>저장하지 않은 결정이나 메모가 있습니다.</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setPendingSelection(null); document.getElementById("refresh-detail-heading")?.focus(); }}>계속 검토</Button><Button size="sm" variant="outline" onClick={() => applySelection(pendingSelection.candidate, pendingSelection.trigger)}>변경 버리고 이동</Button></div>
      </div>}
      {decisionMessage && selectedCandidate && <p role="status" className="shrink-0 border-b bg-muted p-3 text-xs">{decisionMessage}</p>}
      {error && selectedCandidate && <p role="alert" className="shrink-0 border-b bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}
      {selectedCandidate && !isLoading && !error && !data?.candidates.some(candidate => candidate.id === selectedCandidate.id) && <p role="status" className="shrink-0 border-b bg-muted p-3 text-xs">선택한 후보가 현재 조회 조건에 없습니다. 필터를 초기화하고 새로고침하면 검토를 계속할 수 있습니다.</p>}
    </>}
    onDecisionChange={nextDecision => {
      setDecision(nextDecision);
      if (nextDecision !== "approved" || selectedCandidateIsClosure) setApplyApprovedChange(false);
    }}
    onApplyApprovedChange={setApplyApprovedChange}
    onOperatorNotesChange={setOperatorNotes}
    onSubmitDecision={submitDecision}
  />;

  return <section
    aria-labelledby="admin-restaurant-refresh-history-title"
    className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
    data-admin-restaurant-refresh-history="true"
    data-admin-restaurant-refresh-management-structure="header-list-detail"
    data-admin-embedded-module-shell="true"
    data-admin-embedded-module-id="restaurant-refresh-history"
  >
    {managementHeader ? <>
      <h2 id="admin-restaurant-refresh-history-title" className="sr-only">맛집 최신화 이력</h2>
      {managementHeader.count && createPortal(<ManagementStatusSummary items={statusSummaryItems} />, managementHeader.count)}
    </> : <AdminPageHeader title="맛집 최신화 이력" titleId="admin-restaurant-refresh-history-title" titleAs="h2" icon={Store} summary={<ManagementStatusSummary items={statusSummaryItems} />} data-admin-module-header="compact" data-admin-module-header-module="restaurant-refresh-history" />}
    {decisionMessage && !selectedCandidate && <p role="status" className="shrink-0 border-b bg-primary/10 px-3 py-2 text-xs">{decisionMessage}</p>}
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]" data-admin-module-content="bounded">
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="admin-cms-toolbar shrink-0" data-admin-module-actions="top-right" aria-label="최신화 이력 검색 및 필터">
          <form className="flex w-full min-w-0 flex-none items-center gap-2 sm:w-auto sm:min-w-48 sm:flex-1" onSubmit={event => { event.preventDefault(); if (pendingReadbackRef.current) return; if (searchInput === query) void loadHistory(); else setQuery(searchInput); }}>
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input id="refresh-history-search" disabled={Boolean(pendingReadback)} value={searchInput} onChange={event => setSearchInput(event.target.value)} className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="맛집명 · 전화번호 검색" aria-label="맛집 최신화 이력 검색" />
            </label>
            <Button type="submit" variant="outline" size="sm" className="h-8 px-2" disabled={isLoading || isSavingDecision || Boolean(pendingReadback)}>검색</Button>
          </form>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as RefreshCandidateStatus | "all")} disabled={isSavingDecision || Boolean(pendingReadback)} className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring" aria-label="최신화 후보 상태 필터">
            <option value="all">전체 상태</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={sortOrder} onChange={event => setSortOrder(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring" aria-label="최신화 이력 정렬"><option value="newest">최신순</option><option value="review">검토 필요 우선</option><option value="name">맛집명순</option></select>
          {(query || statusFilter !== "all") && <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={isSavingDecision || Boolean(pendingReadback)} onClick={() => { setSearchInput(""); setQuery(""); setStatusFilter("all"); }}>필터 초기화</Button>}
          <Button type="button" variant="ghost" size="sm" onClick={() => void loadHistory()} disabled={isLoading || isSavingDecision} className="h-8 w-8 shrink-0 p-0" aria-label="최신화 이력 새로고침"><RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} aria-hidden="true" /></Button>
        </div>
        {error && <div role="alert" className="flex shrink-0 items-center justify-between gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive"><span>{error}{data && " 이전 목록을 표시하고 있습니다."}</span><Button variant="outline" size="sm" disabled={isLoading} onClick={() => void loadHistory()}>다시 시도</Button></div>}
        <RefreshCandidateList candidates={filteredCandidates} isLoading={isLoading && !data} selectedCandidateId={selectedCandidate?.id ?? null} disabled={isSavingDecision || Boolean(pendingReadback)} hasFilters={Boolean(query || statusFilter !== "all")} onOpenReview={requestSelection} />
        <div className="admin-cms-footer flex shrink-0 flex-wrap items-center justify-between gap-1 text-muted-foreground"><span aria-live="polite">{isLoading ? "불러오는 중…" : `${filteredCandidates.length}건 · 최근 최대 100건`}</span><span>최근 점검 {formatDate(summary?.last_checked_at)}</span></div>
      </div>
      {!isNarrow && detail}
    </div>
    <Sheet open={isNarrow && Boolean(selectedCandidate)} onOpenChange={open => { if (!open) requestSelection(null); }}>
      <SheetContent className="flex h-dvh w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[min(640px,100vw)] sm:max-w-none [&>button:last-child]:hidden" onOpenAutoFocus={event => { event.preventDefault(); document.getElementById("refresh-detail-heading")?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); restoreListFocus(); }}>
        <SheetTitle className="sr-only">최신화 이력 상세</SheetTitle><SheetDescription className="sr-only">변경 내용과 결정 기록을 확인합니다.</SheetDescription>
        {detail}
      </SheetContent>
    </Sheet>
  </section>;
}
