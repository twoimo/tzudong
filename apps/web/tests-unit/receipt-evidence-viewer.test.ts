import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ReceiptEvidenceViewer } from '../components/reviews/ReceiptEvidenceViewer';
import {
  canPanReceiptEvidence,
  clampReceiptEvidencePan,
  clampReceiptEvidenceScale,
  getReceiptEvidenceMaxPan,
  getReceiptEvidenceTitle,
  nextReceiptEvidenceScale,
} from '../lib/ocr/receipt-evidence-viewer';

describe('receipt evidence viewer helpers', () => {
  test('clamps zoom scale to a safe mobile range', () => {
    expect(clampReceiptEvidenceScale(0.25)).toBe(1);
    expect(clampReceiptEvidenceScale(2.5)).toBe(2.5);
    expect(clampReceiptEvidenceScale(9)).toBe(4);
    expect(clampReceiptEvidenceScale(Number.NaN)).toBe(1);
  });

  test('zooms in fixed steps and enables panning only when enlarged', () => {
    expect(nextReceiptEvidenceScale(1, 'in')).toBe(1.5);
    expect(nextReceiptEvidenceScale(4, 'in')).toBe(4);
    expect(nextReceiptEvidenceScale(1, 'out')).toBe(1);
    expect(canPanReceiptEvidence(1)).toBe(false);
    expect(canPanReceiptEvidence(1.5)).toBe(true);
  });

  test('clamps pan to the scaled viewport bounds', () => {
    expect(getReceiptEvidenceMaxPan({ viewportWidth: 360, viewportHeight: 640, scale: 1 })).toEqual({ x: 0, y: 0 });
    expect(getReceiptEvidenceMaxPan({ viewportWidth: 360, viewportHeight: 640, scale: 2 })).toEqual({ x: 180, y: 320 });
    expect(clampReceiptEvidencePan(
      { x: 999, y: -999 },
      { viewportWidth: 360, viewportHeight: 640, scale: 2 }
    )).toEqual({ x: 180, y: -320 });
    expect(clampReceiptEvidencePan(
      { x: 999, y: -999 },
      { viewportWidth: Number.NaN, viewportHeight: 640, scale: 2 }
    )).toEqual({ x: 0, y: 0 });
  });

  test('labels OCR fields as actionable receipt evidence', () => {
    expect(getReceiptEvidenceTitle('receipt')).toBe('영수증 사진 크게 보기');
    expect(getReceiptEvidenceTitle('restaurant')).toBe('방문 맛집 AI 입력 근거 확인');
    expect(getReceiptEvidenceTitle('review')).toBe('리뷰 내용 AI 입력 근거 확인');
  });
});

describe('ReceiptEvidenceViewer', () => {
  test('renders an accessible full-screen dialog with zoom controls', () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptEvidenceViewer, {
        isOpen: true,
        imageUrl: 'blob:http://localhost/receipt',
        fileName: 'receipt.jpg',
        openedFrom: 'date',
        onClose: () => undefined,
      })
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('방문 날짜 AI 입력 근거 확인');
    expect(html).toContain('receipt.jpg');
    expect(html).toContain('영수증 축소');
    expect(html).toContain('영수증 확대');
    expect(html).toContain('영수증 증거 이미지');
  });

  test('stays unmounted when closed or missing an image URL', () => {
    const closed = renderToStaticMarkup(
      createElement(ReceiptEvidenceViewer, {
        isOpen: false,
        imageUrl: 'blob:http://localhost/receipt',
        openedFrom: 'receipt',
        onClose: () => undefined,
      })
    );
    const missingImage = renderToStaticMarkup(
      createElement(ReceiptEvidenceViewer, {
        isOpen: true,
        imageUrl: null,
        openedFrom: 'receipt',
        onClose: () => undefined,
      })
    );

    expect(closed).toBe('');
    expect(missingImage).toBe('');
  });
});
