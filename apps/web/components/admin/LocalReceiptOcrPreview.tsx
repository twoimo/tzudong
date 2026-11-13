'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ReceiptOcrData } from '@/lib/ocr/types';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const errorText: Record<string, string> = {
  PREVIEW_BUSY: '다른 미리보기가 실행 중입니다. 완료 후 다시 시도해 주세요.',
  TIMEOUT: '인식 시간이 초과되었습니다. 더 선명하거나 작은 이미지로 다시 시도해 주세요.',
  LOCAL_ENGINE_UNAVAILABLE: '이 서버에는 로컬 OCR이 준비되지 않았습니다. macOS 로컬 서버에서 활성화해 주세요.',
  UNREADABLE_RECEIPT: '영수증 정보를 읽지 못했습니다. 선명한 이미지로 다시 시도해 주세요.',
};

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/** Ephemeral preview only: it cannot create reviews, verify receipts, or release a DB hold. */
export function LocalReceiptOcrPreview() {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<ReceiptOcrData | null>(null);
  const active = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => { active.current?.abort(); }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setAvailable(null);
    void fetch('/api/admin/ocr-receipts/preview', { cache: 'no-store', signal: controller.signal })
      .then(async response => response.ok ? await response.json() as { localAvailable?: boolean } : null)
      .then(body => { if (!controller.signal.aborted) setAvailable(body?.localAvailable === true); })
      .catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, [open]);

  function clearPreview() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setResult(null);
    setMessage('');
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function run() {
    if (!file || busy || !available) return;
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMessage('3MB 이하의 JPG, PNG 또는 WebP 이미지가 필요합니다.');
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setResult(null); setMessage('');
    try {
      const imageBase64 = await fileBase64(file);
      if (controller.signal.aborted) return;
      const response = await fetch('/api/admin/ocr-receipts/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ imageBase64, mimeType: file.type }), signal: controller.signal,
      });
      const body = await response.json() as { code?: string; result?: ReceiptOcrData; manualReviewRequired?: boolean; cloudCalls?: number };
      if (!response.ok || !body.result || body.manualReviewRequired !== true || body.cloudCalls !== 0) {
        throw new Error(body.code ?? 'PREVIEW_FAILED');
      }
      if (!controller.signal.aborted) setResult(body.result);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error && errorText[error.message] ? errorText[error.message] : '미리보기를 완료하지 못했습니다. 이미지와 로컬 엔진 상태를 확인해 주세요.');
    } finally {
      if (active.current === controller) { setBusy(false); active.current = null; }
    }
  }

  return <section className="admin-local-ocr-preview" aria-label="로컬 영수증 미리보기">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm">파일로 인식 결과만 확인하고 싶으신가요?</p>
      <Button variant="outline" size="sm" aria-expanded={open} aria-controls="local-ocr-preview-panel"
        onClick={() => { clearPreview(); setOpen(value => !value); }}> {open ? '미리보기 닫기' : '파일 미리보기'} </Button>
    </div>
    {open && <div id="local-ocr-preview-panel" className="mt-3 space-y-3 border-t border-border pt-3">
      <p className="text-sm text-muted-foreground">macOS 온디바이스 OCR · 외부 모델 호출 없음 · DB/파일 저장 없음. 결과는 검토용이며 영수증 인증에 반영되지 않습니다.</p>
      {available !== true && <p role="status" className="text-sm">{available === null ? '로컬 엔진 설정 확인 중…' : errorText.LOCAL_ENGINE_UNAVAILABLE}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm" htmlFor="local-ocr-file">영수증 이미지 (최대 3MB)
          <input ref={inputRef} id="local-ocr-file" type="file" accept="image/jpeg,image/png,image/webp"
            disabled={busy || available !== true} className="mt-1 block min-h-11 w-full border border-border bg-background p-2 text-base"
            onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); setResult(null); setMessage(''); }} />
        </label>
        <Button onClick={() => void run()} disabled={!file || busy || available !== true}>{busy ? '인식 중…' : '로컬에서 인식'}</Button>
        <Button variant="outline" onClick={clearPreview} disabled={!file && !result && !busy}>비우기</Button>
      </div>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      {result && <div aria-live="polite" className="border-t border-border pt-3">
        <p className="mb-2 text-sm font-medium">검토 필요 · 저장되지 않은 제안</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">상호</dt><dd>{result.store_name ?? '확인 필요'}</dd></div>
          <div><dt className="text-muted-foreground">결제일</dt><dd>{result.date ?? '확인 필요'}</dd></div>
          <div><dt className="text-muted-foreground">합계</dt><dd>{result.total_amount === undefined ? '확인 필요' : `${result.total_amount.toLocaleString('ko-KR')}원`}</dd></div>
        </dl>
        {result.items && result.items.length > 0 && <ul className="mt-3 divide-y divide-border" aria-label="인식된 메뉴">
          {result.items.map((item, index) => <li key={index} className="flex justify-between gap-3 py-2"><span>{item.name ?? '메뉴 확인 필요'}</span><span>{item.price === null ? '금액 확인 필요' : `${item.price.toLocaleString('ko-KR')}원`}</span></li>)}
        </ul>}
      </div>}
    </div>}
  </section>;
}
