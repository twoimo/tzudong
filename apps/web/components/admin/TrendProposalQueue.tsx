"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TrendProposalListItem } from "@/lib/admin/trend-proposals";

type TrendProposalListResponse = {
  ok: boolean;
  items: TrendProposalListItem[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
  asOf: string;
};

type TrendProposalPreviewResponse = {
  ok: boolean;
  proposal: { id: string; proposalHash: string; proposalStatus: string };
  normalizedOverlayPayload: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  warnings: string[];
  confirmation: {
    requiredText: string;
    previewHash: string;
    payloadHash: string;
    expiresAt: string;
  };
};

type TrendProposalReviewResponse = {
  ok: boolean;
  status: string;
  replayed: boolean;
  proposal: {
    id: string;
    proposalStatus: string;
    proposalHash: string;
    reviewedByAdminId: string;
    reviewedAt: string;
    reviewReason: string;
  };
  reviewEvent: {
    eventId: string;
    transition: string;
    fromStatus: string;
    toStatus: string;
    correlationId: string;
    idempotencyKey: string;
    requestHash: string;
  };
};

type TrendProposalApprovalResponse = {
  ok: boolean;
  status: string;
  replayed: boolean;
  proposal: {
    id: string;
    proposalStatus: string;
    proposalHash: string;
    overlayAuditId: string;
    reviewedByAdminId: string;
    reviewedAt: string;
    reviewReason: string;
  };
  audit: { id?: string; auditId?: string };
  readback: {
    matchedPayloadHash: boolean;
    matchedPreviewHash: boolean;
    matchedExpectedProposalHash: boolean;
    replayed: boolean;
  };
};

const proposalStatusLabels: Record<string, string> = {
  pending: "검토 대기",
  approved: "승인됨",
  rejected: "반려됨",
  superseded: "대체됨",
  expired: "만료됨",
};

function createClientRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `proposal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchTrendProposals(): Promise<TrendProposalListResponse> {
  const response = await fetch("/api/admin/trend-proposals?status=pending&limit=5", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as TrendProposalListResponse | null;
  if (!response.ok || !payload?.ok) throw new Error("trend-proposal-list-failed");
  return payload;
}

async function fetchTrendProposalPreview(proposalId: string): Promise<TrendProposalPreviewResponse> {
  const response = await fetch(`/api/admin/trend-proposals/${proposalId}/preview-overlay`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ edits: {} }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as TrendProposalPreviewResponse | null;
  if (!response.ok || !payload?.ok) throw new Error("trend-proposal-preview-failed");
  return payload;
}

async function rejectTrendProposal(input: {
  proposal: TrendProposalListItem;
  reason: string;
}): Promise<TrendProposalReviewResponse> {
  const correlationId = createClientRequestId();
  const idempotencyKey = `trend-proposal-review-${input.proposal.id}-${correlationId}`.slice(0, 128);
  const response = await fetch(`/api/admin/trend-proposals/${input.proposal.id}/reject`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      transition: "rejected",
      reason: input.reason,
      expectedProposalHash: input.proposal.proposalHash,
      correlationId,
      idempotencyKey,
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as TrendProposalReviewResponse | null;
  if (!response.ok || !payload?.ok) throw new Error("trend-proposal-review-failed");
  return payload;
}

async function approveTrendProposal(input: {
  proposal: TrendProposalListItem;
  preview: TrendProposalPreviewResponse;
  confirmationText: string;
}): Promise<TrendProposalApprovalResponse> {
  const correlationId = createClientRequestId();
  const idempotencyKey = `trend-proposal-approve-${input.proposal.id}-${correlationId}`.slice(0, 128);
  const response = await fetch(`/api/admin/trend-proposals/${input.proposal.id}/approve`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      normalizedOverlayPayload: input.preview.normalizedOverlayPayload,
      confirmationText: input.confirmationText,
      expectedProposalHash: input.proposal.proposalHash,
      previewHash: input.preview.confirmation.previewHash,
      payloadHash: input.preview.confirmation.payloadHash,
      previewExpiresAt: input.preview.confirmation.expiresAt,
      correlationId,
      idempotencyKey,
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as TrendProposalApprovalResponse | null;
  if (!response.ok || !payload?.ok) throw new Error("trend-proposal-approval-failed");
  return payload;
}

function formatScore(score: number) {
  return Number.isFinite(score) ? `${score.toFixed(1)}점` : "점수 확인";
}

function formatWindow(proposal: TrendProposalListItem) {
  if (!proposal.activeFrom && !proposal.activeUntil) return "즉시 적용";
  return [proposal.activeFrom, proposal.activeUntil]
    .map((value) => value ? new Date(value).toLocaleDateString("ko-KR") : "열림")
    .join(" ~ ");
}

export function TrendProposalQueue() {
  const queryClient = useQueryClient();
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState("근거가 부족하여 승인하지 않습니다.");
  const [approvalConfirmationText, setApprovalConfirmationText] = useState("");
  const proposalsQuery = useQuery({
    queryKey: ["admin", "trend-proposals", "pending"],
    queryFn: fetchTrendProposals,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const proposals = useMemo(() => proposalsQuery.data?.items ?? [], [proposalsQuery.data?.items]);
  const selectedProposal = useMemo(
    () => proposals.find((proposal) => proposal.id === selectedProposalId) ?? proposals[0] ?? null,
    [proposals, selectedProposalId],
  );
  const previewQuery = useQuery({
    queryKey: ["admin", "trend-proposal-preview", selectedProposal?.id],
    queryFn: () => fetchTrendProposalPreview(selectedProposal?.id ?? ""),
    enabled: Boolean(selectedProposal?.id),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const rejectMutation = useMutation({
    mutationFn: rejectTrendProposal,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "trend-proposals", "pending"] });
    },
  });
  const approveMutation = useMutation({
    mutationFn: approveTrendProposal,
    onSuccess: () => {
      setApprovalConfirmationText("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "trend-proposals", "pending"] });
    },
  });

  return (
    <section
      className="rounded-xl border border-border/70 bg-card/85 p-2.5 shadow-sm"
      aria-label="트렌드 제안 검토"
      data-layout-primitives="list-detail card-grid cluster stack"
      data-scroll-owner="trend-proposal-queue"
      data-admin-trend-proposal-queue="true"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold tracking-[0.12em] text-primary">트렌드 제안</p>
          <h3 className="text-sm font-bold text-foreground">오버레이 제안 검토</h3>
        </div>
        <Badge variant="outline" className="rounded-full border-primary/25 text-primary">
          {proposals.length}건 대기
        </Badge>
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="min-w-0 space-y-1.5" data-scroll-owner="trend-proposal-list">
          {proposalsQuery.isLoading ? (
            <p className="rounded-xl bg-muted/30 p-2 text-xs text-muted-foreground">제안 목록을 불러오는 중입니다.</p>
          ) : proposals.length === 0 ? (
            <p className="rounded-xl bg-muted/30 p-2 text-xs text-muted-foreground">검토 대기 중인 트렌드 제안이 없습니다.</p>
          ) : proposals.map((proposal) => (
            <button
              key={proposal.id}
              type="button"
              className={cn(
                "w-full rounded-xl border bg-background/80 p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                selectedProposal?.id === proposal.id ? "border-primary/40 shadow-sm" : "border-border/60 hover:bg-muted/40",
              )}
              aria-pressed={selectedProposal?.id === proposal.id}
              onClick={() => setSelectedProposalId(proposal.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{proposal.label}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{proposal.restaurant.name}</p>
                </div>
                <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">
                  {formatScore(proposal.score)}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-semibold text-muted-foreground">
                <span className="rounded-full bg-primary/5 px-2 py-0.5 text-primary">{proposal.overlayType}</span>
                <span className="rounded-full bg-muted px-2 py-0.5">{formatWindow(proposal)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5">근거 {proposal.evidenceSummary.observationCount}개</span>
              </div>
            </button>
          ))}
        </div>

        <div
          className="min-w-0 rounded-xl bg-background/75 p-2"
          data-admin-trend-proposal-readback="true"
          data-scroll-owner="trend-proposal-detail"
        >
          {selectedProposal ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground">선택 제안</p>
                  <h4 className="truncate text-base font-bold text-foreground">{selectedProposal.label}</h4>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {proposalStatusLabels[selectedProposal.proposalStatus] ?? selectedProposal.proposalStatus}
                </Badge>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{selectedProposal.description ?? "설명 없음"}</p>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
                <div className="rounded-lg bg-muted/35 p-1.5">
                  <p className="font-bold text-foreground">근거 신선도</p>
                  <p>{selectedProposal.evidenceSummary.freshness}</p>
                </div>
                <div className="rounded-lg bg-muted/35 p-1.5">
                  <p className="font-bold text-foreground">충돌 여부</p>
                  <p>{selectedProposal.conflict.hasActiveOverlay ? "활성 오버레이 있음" : "충돌 없음"}</p>
                </div>
              </div>

              <div
                className="rounded-xl border border-primary/15 bg-primary/5 p-2"
                data-trend-proposal-preview="true"
              >
                <p className="text-xs font-bold text-primary">미리보기 해시</p>
                {previewQuery.isFetching ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">오버레이 미리보기를 계산하는 중입니다.</p>
                ) : previewQuery.data ? (
                  <dl className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                    <div className="min-w-0">
                      <dt className="font-bold text-foreground">previewHash</dt>
                      <dd className="break-all font-mono">{previewQuery.data.confirmation.previewHash}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="font-bold text-foreground">payloadHash</dt>
                      <dd className="break-all font-mono">{previewQuery.data.confirmation.payloadHash}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">미리보기 생성 실패 시 승인하지 않습니다.</p>
                )}
              </div>

              <div className="space-y-1.5" data-trend-proposal-review-readback="true">
                <label className="block text-xs font-bold text-foreground" htmlFor="trend-proposal-review-reason">
                  반려 사유
                </label>
                <textarea
                  id="trend-proposal-review-reason"
                  value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)}
                  className="min-h-16 w-full rounded-xl border border-border bg-background p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => rejectMutation.mutate({ proposal: selectedProposal, reason: reviewReason })}
                    disabled={reviewReason.trim().length < 3 || rejectMutation.isPending}
                  >
                    제안 반려
                  </Button>
                  <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-bold text-foreground" htmlFor="trend-proposal-approval-confirmation">
                    승인 확인 문구
                    <input
                      id="trend-proposal-approval-confirmation"
                      value={approvalConfirmationText}
                      onChange={(event) => setApprovalConfirmationText(event.target.value)}
                      placeholder="오버레이 적용"
                      className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      data-trend-proposal-confirmation-input="true"
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={
                      !previewQuery.data ||
                      approvalConfirmationText !== previewQuery.data.confirmation.requiredText ||
                      approveMutation.isPending
                    }
                    onClick={() => {
                      if (!previewQuery.data) return;
                      approveMutation.mutate({
                        proposal: selectedProposal,
                        preview: previewQuery.data,
                        confirmationText: approvalConfirmationText,
                      });
                    }}
                    data-trend-proposal-approve-action="true"
                    title="미리보기 해시와 제안 해시를 검증한 뒤 원자 승인 RPC를 호출합니다."
                  >
                    제안 승인
                  </Button>
                </div>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  승인하려면 정확히 “오버레이 적용”을 입력합니다. 승인은 오버레이 적용, 감사 이벤트, 제안 상태 변경을 하나의 원자 RPC로 처리합니다.
                </p>
                {rejectMutation.data ? (
                  <p className="rounded-lg bg-emerald-50 p-1.5 text-[11px] font-semibold text-emerald-900">
                    검토 이벤트 {rejectMutation.data.reviewEvent.eventId} 기록 완료 · {rejectMutation.data.status}
                  </p>
                ) : null}
                {approveMutation.data ? (
                  <p className="rounded-lg bg-emerald-50 p-1.5 text-[11px] font-semibold text-emerald-900" data-trend-proposal-approval-readback="true">
                    승인 감사 {approveMutation.data.proposal.overlayAuditId} 기록 완료 · {approveMutation.data.status}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-muted/30 p-2 text-xs text-muted-foreground">제안을 선택하면 미리보기, 해시, 검토 사유를 확인합니다.</p>
          )}
        </div>
      </div>
    </section>
  );
}
