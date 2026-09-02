"use client";

import { useCallback, useEffect, useState } from 'react';

import {
  RESTAURANT_CLAIM_CONFIRMATION_TEXT,
  RESTAURANT_CLAIM_ERROR,
  RESTAURANT_CLAIM_GUARD_STEPS,
  type RestaurantClaimAdminListItem,
  type RestaurantClaimReadback,
} from '@/lib/claim/contract';

type PreviewState = {
  claimId: string;
  operationId: string;
  previewHash: string;
  expiresAt: string;
  requiredConfirmation: string;
};

type ReceiptState = {
  claimId: string;
  ownerState: 'verified';
  auditId: string;
  replayed: boolean;
  readback: RestaurantClaimReadback;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readClaims(value: unknown): RestaurantClaimAdminListItem[] {
  const record = asRecord(value);
  const rows = Array.isArray(record?.claims) ? record.claims : [];
  return rows.flatMap((row) => {
    const item = asRecord(row);
    if (!item) return [];
    if (typeof item.claimId !== 'string' || typeof item.restaurantId !== 'string') return [];
    if (typeof item.restaurantName !== 'string' || typeof item.status !== 'string') return [];
    return [{
      claimId: item.claimId,
      restaurantId: item.restaurantId,
      restaurantName: item.restaurantName,
      status: item.status as RestaurantClaimAdminListItem['status'],
      evidenceKind: item.evidenceKind === 'business_license' ? 'business_license' : null,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    }];
  });
}

export default function AdminClaimsPage() {
  const [claims, setClaims] = useState<RestaurantClaimAdminListItem[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [receipt, setReceipt] = useState<ReceiptState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadClaims = useCallback(async () => {
    const response = await fetch('/api/admin/claims', { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(typeof asRecord(payload)?.error === 'string' ? String(asRecord(payload)?.error) : RESTAURANT_CLAIM_ERROR.unauthorized);
      return;
    }
    setError(null);
    setClaims(readClaims(payload));
  }, []);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  const createPreview = useCallback(async (claimId: string) => {
    setBusy(true);
    setReceipt(null);
    try {
      const response = await fetch('/api/admin/claims/preview', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimId }),
      });
      const payload = asRecord(await response.json().catch(() => null));
      if (!response.ok || payload?.ok !== true) {
        setError(typeof payload?.error === 'string' ? payload.error : RESTAURANT_CLAIM_ERROR.invalidRequest);
        return;
      }
      setSelectedClaimId(claimId);
      setPreview({
        claimId,
        operationId: String(payload.operationId),
        previewHash: String(payload.previewHash),
        expiresAt: String(payload.expiresAt),
        requiredConfirmation: String(payload.requiredConfirmation),
      });
      setConfirmationText('');
      setError(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const applyPreview = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/claims/apply', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          claimId: preview.claimId,
          operationId: preview.operationId,
          previewHash: preview.previewHash,
          confirmationText,
          idempotencyKey: `claim-apply-${preview.claimId}`,
        }),
      });
      const payload = asRecord(await response.json().catch(() => null));
      const readback = asRecord(payload?.readback);
      if (!response.ok || payload?.ok !== true || !readback) {
        setError(typeof payload?.error === 'string' ? payload.error : RESTAURANT_CLAIM_ERROR.invalidRequest);
        return;
      }
      setReceipt({
        claimId: String(payload.claimId),
        ownerState: 'verified',
        auditId: String(payload.auditId),
        replayed: payload.replayed === true,
        readback: {
          passed: readback.passed === true,
          checks: {
            claimApproved: asRecord(readback.checks)?.claimApproved === true,
            ownerBound: asRecord(readback.checks)?.ownerBound === true,
            evidencePresent: asRecord(readback.checks)?.evidencePresent === true,
            restaurantOwnerMatches: asRecord(readback.checks)?.restaurantOwnerMatches === true,
          },
        },
      });
      setError(null);
      await loadClaims();
    } finally {
      setBusy(false);
    }
  }, [confirmationText, loadClaims, preview]);

  const currentStep = receipt
    ? 'Audit'
    : preview && confirmationText === RESTAURANT_CLAIM_CONFIRMATION_TEXT
      ? 'Apply'
      : preview
        ? 'Confirm'
        : 'Preview';

  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-muted/30 px-4 py-10 text-foreground">
      <article className="mx-auto w-full min-w-0 max-w-4xl overflow-x-hidden rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-8">
        <header className="mb-6 border-b pb-5">
          <p className="text-sm font-medium text-primary">관리자</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">맛집 소유권 인증 심사</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Preview → Confirm → Apply → Readback → Audit 순서로만 승인합니다.
          </p>
        </header>

        <ol className="mb-6 flex flex-wrap gap-2" data-claim-guard-steps="true">
          {RESTAURANT_CLAIM_GUARD_STEPS.map((step) => (
            <li
              key={step}
              data-claim-guard-step={step}
              data-claim-guard-step-active={currentStep === step ? 'true' : 'false'}
              className="rounded-full border px-3 py-1 text-xs"
            >
              {step}
            </li>
          ))}
        </ol>

        <section className="space-y-3" data-claim-admin-queue="true">
          {claims.length === 0 ? (
            <p className="text-sm text-muted-foreground">심사 대기 중인 소유권 인증이 없습니다.</p>
          ) : (
            claims.map((claim) => (
              <div key={claim.claimId} className="rounded-xl border border-border p-4" data-claim-admin-item={claim.claimId} data-claim-restaurant-id={claim.restaurantId}>
                <p className="font-medium">{claim.restaurantName}</p>
                <p className="text-sm text-muted-foreground">사업자등록증 지문만 제출됨</p>
                <button
                  type="button"
                  data-claim-admin-preview="true"
                  className="mt-3 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void createPreview(claim.claimId)}
                >
                  미리보기
                </button>
              </div>
            ))
          )}
        </section>

        {preview ? (
          <section className="mt-6 space-y-3 rounded-xl border border-border p-4" data-claim-admin-preview-card="true">
            <p className="text-sm">확인 문구를 입력한 뒤 적용합니다.</p>
            <input
              data-claim-admin-confirmation="true"
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              placeholder={RESTAURANT_CLAIM_CONFIRMATION_TEXT}
            />
            <button
              type="button"
              data-claim-admin-apply="true"
              className="rounded-full border px-4 py-2 text-sm disabled:opacity-60"
              disabled={busy || confirmationText !== RESTAURANT_CLAIM_CONFIRMATION_TEXT}
              onClick={() => void applyPreview()}
            >
              적용
            </button>
          </section>
        ) : null}

        {receipt ? (
          <section className="mt-6 space-y-2 rounded-xl border border-border p-4" data-claim-admin-receipt="true">
            <p data-claim-readback={receipt.readback.passed ? 'passed' : 'failed'}>
              {receipt.readback.passed ? '읽기검증 통과' : '읽기검증 실패'}
            </p>
            <p data-claim-audit="recorded">감사 기록이 저장되었습니다.</p>
          </section>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm text-destructive" data-claim-admin-error={error}>
            소유권 인증 심사를 완료하지 못했습니다. 원문 오류는 표시하지 않습니다.
          </p>
        ) : null}

        {selectedClaimId ? <span className="hidden" data-claim-selected-id="true" /> : null}
      </article>
    </main>
  );
}
