"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  RESTAURANT_CLAIM_DOCUMENT_KIND,
  RESTAURANT_CLAIM_ERROR,
  type RestaurantClaimOwnerState,
  type RestaurantClaimPublicStatus,
} from '@/lib/claim/contract';

type RestaurantClaimPanelProps = {
  restaurantId: string;
};

const OWNER_LABEL: Record<RestaurantClaimOwnerState, string> = {
  none: '아직 인증되지 않음',
  pending: '소유권 인증 심사 중',
  verified: '인증된 사장님',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStatus(value: unknown): RestaurantClaimPublicStatus | null {
  const record = asRecord(value);
  if (!record || record.ok !== true) return null;
  if (typeof record.restaurantId !== 'string' || typeof record.restaurantName !== 'string') return null;
  if (record.ownerState !== 'none' && record.ownerState !== 'pending' && record.ownerState !== 'verified') {
    return null;
  }
  return {
    restaurantId: record.restaurantId,
    restaurantName: record.restaurantName,
    ownerState: record.ownerState,
    claimId: typeof record.claimId === 'string' ? record.claimId : null,
    canStart: record.canStart === true,
    duplicateBlocked: record.duplicateBlocked === true,
  };
}

function errorCode(value: unknown) {
  const record = asRecord(value);
  return typeof record?.error === 'string' ? record.error : RESTAURANT_CLAIM_ERROR.invalidRequest;
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeFileName(name: string) {
  const trimmed = name.split(/[\\/]/).pop()?.trim() ?? '';
  const normalized = trimmed.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
  return normalized.length > 0 ? normalized : 'business-license.png';
}

export function RestaurantClaimPanel({ restaurantId }: RestaurantClaimPanelProps) {
  const [status, setStatus] = useState<RestaurantClaimPublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [evidenceSubmitted, setEvidenceSubmitted] = useState(false);

  const loadStatus = useCallback(async () => {
    const response = await fetch(`/api/claim/status?restaurantId=${encodeURIComponent(restaurantId)}`, {
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    const next = readStatus(payload);
    if (!next) {
      setError(errorCode(payload));
      return;
    }
    setError(null);
    setStatus(next);
  }, [restaurantId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const startClaim = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/claim/start', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          idempotencyKey: `claim-start-${restaurantId}`,
        }),
      });
      const payload = await response.json().catch(() => null);
      const next = readStatus(payload);
      if (!next) {
        setError(errorCode(payload));
        return;
      }
      setError(null);
      setStatus(next);
    } finally {
      setBusy(false);
    }
  }, [restaurantId]);

  const submitEvidence = useCallback(async () => {
    if (!status?.claimId || !selectedFile) return;
    setBusy(true);
    try {
      const buffer = await selectedFile.arrayBuffer();
      const contentSha256 = await sha256Hex(buffer);
      const response = await fetch('/api/claim/evidence', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          claimId: status.claimId,
          evidence: {
            documentKind: RESTAURANT_CLAIM_DOCUMENT_KIND,
            fileName: safeFileName(selectedFile.name),
            contentSha256,
            byteLength: selectedFile.size,
            mimeType: selectedFile.type === 'image/jpeg' || selectedFile.type === 'application/pdf'
              ? selectedFile.type
              : 'image/png',
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      const next = readStatus(payload);
      if (!next) {
        setError(errorCode(payload));
        return;
      }
      setError(null);
      setStatus(next);
      setEvidenceSubmitted(true);
    } finally {
      setBusy(false);
    }
  }, [selectedFile, status?.claimId]);

  const ownerState = status?.ownerState ?? 'none';
  const showStart = status?.canStart === true;
  const showEvidence = status?.ownerState === 'pending' && Boolean(status.claimId) && !evidenceSubmitted;
  const duplicateMessage = error === RESTAURANT_CLAIM_ERROR.duplicateClaimBlocked
    || (status?.duplicateBlocked === true && ownerState === 'verified');

  const heading = useMemo(() => status?.restaurantName ?? '맛집', [status?.restaurantName]);

  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-muted/30 px-4 py-10 text-foreground">
      <article className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-8">
        <header className="mb-6 border-b pb-5">
          <p className="text-sm font-medium text-primary">쯔동여지도</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{heading}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            사업자등록증으로 이 맛집의 소유권을 인증합니다. 원문 서류는 저장하지 않고 파일 지문만 제출합니다.
          </p>
        </header>

        <section
          className="space-y-4"
          data-claim-page="public"
          data-claim-owner-state={ownerState}
          data-claim-restaurant-id={restaurantId}
        >
          <p data-claim-owner-label="true" className="text-base font-semibold">
            {OWNER_LABEL[ownerState]}
          </p>

          {showStart ? (
            <button
              type="button"
              data-claim-start="true"
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              disabled={busy}
              onClick={() => void startClaim()}
            >
              소유권 인증 시작
            </button>
          ) : null}

          {showEvidence ? (
            <div className="space-y-3 rounded-xl border border-border p-4" data-claim-evidence-form="true">
              <label className="block text-sm font-medium" htmlFor="claim-license-file">
                사업자등록증
              </label>
              <input
                id="claim-license-file"
                data-claim-license-input="true"
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                data-claim-submit-evidence="true"
                className="rounded-full border px-4 py-2 text-sm font-medium disabled:opacity-60"
                disabled={busy || !selectedFile}
                onClick={() => void submitEvidence()}
              >
                소유권 증빙 제출
              </button>
            </div>
          ) : null}

          {evidenceSubmitted && ownerState === 'pending' ? (
            <p data-claim-evidence-submitted="true" className="text-sm text-muted-foreground">
              사업자등록증 지문을 제출했습니다. 관리자 심사를 기다립니다.
            </p>
          ) : null}

          {error ? (
            <p data-claim-error={error} className="text-sm text-destructive">
              {error === RESTAURANT_CLAIM_ERROR.duplicateClaimBlocked
                ? '이미 소유권 인증이 진행 중이거나 완료된 맛집입니다.'
                : '소유권 인증 요청을 완료하지 못했습니다. 원문 오류는 표시하지 않습니다.'}
            </p>
          ) : null}

          {duplicateMessage && ownerState === 'verified' ? (
            <p data-claim-duplicate-blocked="true" className="text-sm text-muted-foreground">
              이미 인증된 사장님이 있어 추가 소유권 인증을 받을 수 없습니다.
            </p>
          ) : null}
        </section>
      </article>
    </main>
  );
}
