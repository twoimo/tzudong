import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin edit restaurant modal persistence contract', () => {
  test('persists editable fields and blocks un-geocoded address drift', () => {
    const modalSource = source('components/admin/EditRestaurantModal.tsx');
    const pageSource = source('app/admin/evaluations/page.tsx');

    expect(pageSource).toContain('const approvedName = getAdminEvaluationApprovalName(record);');
    expect(modalSource).toContain("title: '주소 저장 전 재지오코딩 필요'");
    expect(modalSource).toContain('youtube_link: trimmedYoutubeLink || null');
    expect(modalSource).toContain('tzuyang_review: trimmedTzuyangReview || null');
    expect(modalSource).toContain('youtube_link: formData.youtube_link.trim() || record.youtube_link || null');
    expect(modalSource).not.toContain('let approvedName: string | null = record.naver_name || record.google_name || null');
  });
});
