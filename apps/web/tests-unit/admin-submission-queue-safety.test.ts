import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  adminSubmissionQueueSummaryMatchesFilter,
  ADMIN_SUBMISSION_QUEUE_REASON_FILTERS,
  getAdminSubmissionQueueSafetySummary,
  type AdminSubmissionQueueSubmissionInput,
} from '../lib/admin/submission-queue-safety';

const webRoot = path.resolve(import.meta.dir, '..');

function source(relativePath: string) {
  return readFileSync(path.join(webRoot, relativePath), 'utf8');
}

function baseSubmission(overrides: Partial<AdminSubmissionQueueSubmissionInput> = {}): AdminSubmissionQueueSubmissionInput {
  return {
    submission_type: 'new',
    status: 'pending',
    restaurant_name: '명동 짜장면',
    restaurant_address: '서울 중구 명동길 123',
    restaurant_phone: '02-1234-5678',
    restaurant_categories: ['중식'],
    items: [{
      youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      tzuyang_review: '쯔양이 소개한 맛집입니다.',
      item_status: 'pending',
    }],
    ...overrides,
  };
}

describe('admin submission queue safety badges', () => {
  test('reuses shared submission validation for missing required fields and invalid youtube links', () => {
    const missingRequired = getAdminSubmissionQueueSafetySummary(baseSubmission({
      restaurant_name: 'asdf',
      restaurant_categories: [],
    }));
    const invalidYoutube = getAdminSubmissionQueueSafetySummary(baseSubmission({
      items: [{ youtube_link: 'https://example.com/watch?v=abc', tzuyang_review: '리뷰', item_status: 'pending' }],
    }));
    const laterInvalidYoutube = getAdminSubmissionQueueSafetySummary(baseSubmission({
      items: [
        { youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', tzuyang_review: '정상 리뷰입니다.', item_status: 'pending' },
        { youtube_link: 'https://example.com/watch?v=bad', tzuyang_review: '나중 항목입니다.', item_status: 'pending' },
      ],
    }));
    const laterJunkRecommendation = getAdminSubmissionQueueSafetySummary(baseSubmission({
      submission_type: 'recommend',
      recommendation_reason: '충분히 정상적인 추천 이유입니다',
      items: [
        { youtube_link: '', tzuyang_review: '충분히 정상적인 추천 이유입니다', item_status: 'pending' },
        { youtube_link: '', tzuyang_review: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ', item_status: 'pending' },
      ],
    }));


    expect(missingRequired.validationMessage).toBe('맛집 이름, 주소, 카테고리는 필수입니다');
    expect(missingRequired.reasons.map((reason) => reason.code)).toContain('missing-required');
    expect(invalidYoutube.validationMessage).toBe('유효한 유튜브 링크를 입력해주세요');
    expect(invalidYoutube.reasons.map((reason) => reason.code)).toContain('invalid-youtube');
    expect(laterInvalidYoutube.validationMessage).toBeNull();
    expect(laterInvalidYoutube.reasons.map((reason) => reason.code)).toContain('invalid-youtube');
    expect(laterJunkRecommendation.validationMessage).toBeNull();
    expect(laterJunkRecommendation.reasons.map((reason) => reason.code)).toContain('junk-text');
  });

  test('does not require recommendation review text for edit queue items', () => {
    const editSummary = getAdminSubmissionQueueSafetySummary(baseSubmission({
      submission_type: 'edit',
      items: [{
        youtube_link: 'https://youtu.be/dQw4w9WgXcQ',
        tzuyang_review: '',
        item_status: 'pending',
      }],
    }));
    const invalidEditYoutube = getAdminSubmissionQueueSafetySummary(baseSubmission({
      submission_type: 'edit',
      items: [{
        youtube_link: 'https://example.com/watch?v=abc',
        tzuyang_review: '',
        item_status: 'pending',
      }],
    }));

    expect(editSummary.validationMessage).toBeNull();
    expect(editSummary.reasons.map((reason) => reason.code)).not.toContain('junk-text');
    expect(editSummary.filterCodes).toEqual([]);
    expect(invalidEditYoutube.reasons.map((reason) => reason.code)).toContain('invalid-youtube');
  });

  test('marks duplicate candidates and missing pending items without mutating the queue', () => {
    const summary = getAdminSubmissionQueueSafetySummary(baseSubmission({
      items: [{
        youtube_link: 'https://youtu.be/dQw4w9WgXcQ',
        tzuyang_review: '쯔양이 소개한 맛집입니다.',
        item_status: 'approved',
        duplicate_check_result: { isDuplicate: true, existingRestaurantName: '기존 맛집' },
      }],
    }));

    expect(summary.reasons.map((reason) => reason.code)).toEqual(['no-pending-items', 'duplicate-candidate']);
    expect(adminSubmissionQueueSummaryMatchesFilter(summary, 'needs-review')).toBe(true);
    expect(adminSubmissionQueueSummaryMatchesFilter(summary, 'duplicate-candidate')).toBe(true);
    expect(adminSubmissionQueueSummaryMatchesFilter(summary, 'all')).toBe(true);
  });
  test('exposes fallback shared-validation reasons as a direct filter option', () => {
    const values = ADMIN_SUBMISSION_QUEUE_REASON_FILTERS.map((option) => option.value);

    expect(values).toContain('shared-validation');
  });

  test('exposes non-destructive source hooks for reason filters and badges', () => {
    const helperSource = source('lib/admin/submission-queue-safety.ts');
    const listSource = source('components/admin/SubmissionListView.tsx');

    const filterMarkup = listSource.slice(
      listSource.indexOf('data-admin-submission-queue-reason-filter="true"'),
      listSource.indexOf('{filteredSubmissions.length === 0 ?'),
    );

    expect(helperSource).toContain('validateRestaurantSubmission(mode, formData)');
    expect(helperSource).toContain('validateRestaurantSubmissionStep(1, \'request\', formData)');
    expect(helperSource).not.toContain('supabase');
    expect(listSource).toContain('data-admin-submission-queue-reason-filter="true"');
    expect(listSource).toContain('data-admin-submission-queue-reason-filter-option={option.value}');
    expect(listSource).toContain('data-admin-submission-safety-badge={reason.code}');
    expect(filterMarkup).toContain('handleQueueReasonFilterChange(option.value)');
    expect(filterMarkup).not.toContain('onApprove');
    expect(filterMarkup).not.toContain('onReject');
    expect(filterMarkup).not.toContain('fetch(');
  });
});
