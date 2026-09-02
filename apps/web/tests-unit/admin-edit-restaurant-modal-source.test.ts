import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin edit restaurant modal persistence contract', () => {
  test('persists editable fields and blocks un-geocoded address drift', () => {
    const modalSource = source('components/admin/EditRestaurantModal.tsx');
    const pageSource = source('app/admin/evaluations/admin-evaluation-page.tsx');

    expect(pageSource).toContain('const approvedName = getAdminEvaluationApprovalName(record);');
    expect(modalSource).toContain("title: '주소 저장 전 재지오코딩 필요'");
    expect(modalSource).toContain('<DialogTitle>맛집 정보 편집</DialogTitle>');
    expect(modalSource).toContain('정보를 수정해 저장하거나, 재지오코딩 후 승인 처리할 수 있습니다.');
    expect(modalSource).not.toContain('보류 레스토랑 편집 및 승인');
    expect(modalSource).toContain('youtube_link: trimmedYoutubeLink || null');
    expect(modalSource).toContain('tzuyang_review: trimmedTzuyangReview || null');
    expect(modalSource).toContain('youtube_link: formData.youtube_link.trim() || record.youtube_link || null');
    expect(modalSource).not.toContain('let approvedName: string | null = record.naver_name || record.google_name || null');
  });
});
