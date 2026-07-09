import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    validateRestaurantSubmission,
    validateRestaurantSubmissionStep,
    type RestaurantSubmissionFormData,
} from '../lib/restaurant-submission-flow';
import {
    canonicalizeRestaurantSubmissionPayload,
    getRestaurantSubmissionPayloadFingerprint,
    normalizeRestaurantSubmissionPhone,
    restaurantSubmissionRequestReadbackMatches,
} from '../lib/restaurant-submission-submit-contract';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

const completeForm: RestaurantSubmissionFormData = {
    restaurant_name: '명동 짜장면',
    address: '서울 중구 명동길 123',
    phone: '02-1234-5678',
    categories: ['중식'],
    youtube_link: 'https://youtube.com/watch?v=abc',
    description: '쯔양이 소개한 리뷰 내용입니다.',
};

describe('restaurant submission flow validation', () => {
    test('step 1 requires restaurant name, address, and category before mobile progression', () => {
        expect(validateRestaurantSubmissionStep(1, 'new', {
            ...completeForm,
            restaurant_name: '',
        })).toBe('맛집 이름, 주소, 카테고리는 필수입니다');

        expect(validateRestaurantSubmissionStep(1, 'new', {
            ...completeForm,
            categories: [],
        })).toBe('맛집 이름, 주소, 카테고리는 필수입니다');

        expect(validateRestaurantSubmissionStep(1, 'new', completeForm)).toBeNull();

        expect(validateRestaurantSubmissionStep(1, 'new', {
            ...completeForm,
            categories: ['   '],
        })).toBe('맛집 이름, 주소, 카테고리는 필수입니다');
    });

    test('new submission step 2 requires a recognized http(s) youtube link', () => {
        expect(validateRestaurantSubmissionStep(2, 'new', {
            ...completeForm,
            youtube_link: '',
        })).toBe('유튜브 영상 링크를 입력해주세요');

        expect(validateRestaurantSubmissionStep(2, 'new', {
            ...completeForm,
            youtube_link: 'youtube.com/watch?v=abc',
        })).toBe('유효한 유튜브 링크를 입력해주세요');

        expect(validateRestaurantSubmissionStep(2, 'new', {
            ...completeForm,
            youtube_link: 'https://example.com/watch?v=abc',
        })).toBe('유효한 유튜브 링크를 입력해주세요');

        expect(validateRestaurantSubmissionStep(2, 'new', {
            ...completeForm,
            youtube_link: 'https://youtu.be/abc',
        })).toBeNull();

        expect(validateRestaurantSubmissionStep(2, 'new', completeForm)).toBeNull();
    });

    test('request submission step 2 requires a recommendation reason of at least 10 characters', () => {
        expect(validateRestaurantSubmissionStep(2, 'request', {
            ...completeForm,
            description: '짧음',
            youtube_link: '',
        })).toBe('추천 이유를 10자 이상 입력해주세요');

        expect(validateRestaurantSubmissionStep(2, 'request', {
            ...completeForm,
            description: '여기는 꼭 추천하고 싶어요',
            youtube_link: '',
        })).toBeNull();
    });

    test('rejects junk input while preserving short Korean names and normal Korean addresses', () => {
        expect(validateRestaurantSubmissionStep(1, 'new', {
            ...completeForm,
            restaurant_name: 'ㅁㄴㅇ',
        })).toBe('맛집 이름, 주소, 카테고리는 필수입니다');

        expect(validateRestaurantSubmissionStep(1, 'new', {
            ...completeForm,
            restaurant_name: 'asdf',
        })).toBe('맛집 이름, 주소, 카테고리는 필수입니다');

        expect(validateRestaurantSubmissionStep(1, 'new', {
            ...completeForm,
            address: 'a/asd',
        })).toBe('맛집 이름, 주소, 카테고리는 필수입니다');

        expect(validateRestaurantSubmissionStep(1, 'new', {
            ...completeForm,
            categories: ['!!!'],
        })).toBe('맛집 이름, 주소, 카테고리는 필수입니다');

        expect(validateRestaurantSubmissionStep(1, 'new', {
            ...completeForm,
            restaurant_name: '스시선',
            address: '서울 중구 명동길 123',
            categories: ['일식'],
        })).toBeNull();
    });

    test('request descriptions reject repeated or symbol-only junk but allow Korean reasons', () => {
        expect(validateRestaurantSubmissionStep(2, 'request', {
            ...completeForm,
            description: '!!!!!!!!!!',
            youtube_link: '',
        })).toBe('추천 이유를 10자 이상 입력해주세요');

        expect(validateRestaurantSubmissionStep(2, 'request', {
            ...completeForm,
            description: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',
            youtube_link: '',
        })).toBe('추천 이유를 10자 이상 입력해주세요');

        expect(validateRestaurantSubmissionStep(2, 'request', {
            ...completeForm,
            description: '국물이 진하고 꼭 추천하고 싶어요',
            youtube_link: '',
        })).toBeNull();
    });

    test('submit validation mirrors the required steps for each mode', () => {
        expect(validateRestaurantSubmission('new', completeForm)).toBeNull();
        expect(validateRestaurantSubmission('request', {
            ...completeForm,
            youtube_link: '',
            description: '여기는 꼭 추천하고 싶어요',
        })).toBeNull();
        expect(validateRestaurantSubmission('new', {
            ...completeForm,
            youtube_link: '',
        })).toBe('유튜브 영상 링크를 입력해주세요');
    });
});

describe('restaurant submission submit contract', () => {
    test('canonical fingerprint is stable for equivalent trimmed payloads', () => {
        const first = getRestaurantSubmissionPayloadFingerprint('request', {
            ...completeForm,
            restaurant_name: '  명동 짜장면  ',
            address: ' 서울 중구 명동길 123 ',
            phone: ' 02-1234-5678 ',
            youtube_link: ' https://youtube.com/watch?v=abc ',
            description: ' 쯔양이 소개한 리뷰 내용입니다. ',
        });
        const second = getRestaurantSubmissionPayloadFingerprint('request', completeForm);

        expect(first).toBe(second);
    });

    test('canonical payload normalizes category order and duplicates', () => {
        expect(canonicalizeRestaurantSubmissionPayload('new', {
            ...completeForm,
            categories: [' 한식 ', '중식', '한식', ''],
        }).categories).toEqual(['중식', '한식']);
    });

    test('phone normalization drives request readback mismatch detection', () => {
        const expected = canonicalizeRestaurantSubmissionPayload('request', completeForm);

        expect(normalizeRestaurantSubmissionPhone(' 02) 1234-5678 ')).toBe('0212345678');
        expect(restaurantSubmissionRequestReadbackMatches(expected, {
            client_request_key: 'request-key-001',
            status: 'pending',
            restaurant_name: expected.restaurant_name,
            origin_address: expected.address,
            phone: '02-9999-5678',
            categories: expected.categories,
            recommendation_reason: expected.description,
            youtube_link: expected.youtube_link,
        }, 'request-key-001')).toBe(false);
    });
});

describe('restaurant submission modal source contract', () => {
    test('posts submissions to the server route instead of browser-side submission inserts', () => {
        const modalSource = source('components/modals/RestaurantSubmissionModal.tsx');

        expect(modalSource).toContain("fetch('/api/mypage/submissions/submit'");
        expect(modalSource).not.toContain(".from('restaurant_submissions')");
        expect(modalSource).not.toContain(".from('restaurant_submission_items')");
        expect(modalSource).not.toContain(".from('restaurant_requests')");
    });

    test('step transitions dispatch local instrumentation without awaiting network', () => {
        const modalSource = source('components/modals/RestaurantSubmissionModal.tsx');
        const handleNextStepSource = modalSource.slice(
            modalSource.indexOf('const handleNextStep = () => {'),
            modalSource.indexOf('const handlePreviousStep = () => {'),
        );

        expect(handleNextStepSource).toContain("restaurant-submission.step-transition");
        expect(handleNextStepSource).toContain('window.dispatchEvent');
        expect(handleNextStepSource).not.toContain('await ');
        expect(handleNextStepSource).not.toContain('fetch(');
    });

    test('draft restore requires an explicit user choice before applying saved form data', () => {
        const modalSource = source('components/modals/RestaurantSubmissionModal.tsx');
        const loadDraftSource = modalSource.slice(
            modalSource.indexOf('const loadDraft = useCallback(async () => {'),
            modalSource.indexOf('const restoreDraft = useCallback(() => {'),
        );
        const restoreDraftSource = modalSource.slice(
            modalSource.indexOf('const restoreDraft = useCallback(() => {'),
            modalSource.indexOf('const discardDraftAndStartNew = useCallback(async () => {'),
        );

        expect(loadDraftSource).toContain('setPendingDraft(draft)');
        expect(loadDraftSource).not.toContain('setFormData(');
        expect(loadDraftSource).not.toContain('setCurrentStep(');
        expect(restoreDraftSource).toContain('setFormData(');
        expect(restoreDraftSource).toContain('pendingDraft.currentStep === 2 ? 2 : 1');
        expect(modalSource).toContain('복원 버튼을 눌러야 입력 내용과 단계가 적용됩니다.');
        expect(modalSource).toContain('삭제하고 새로 작성');
        expect(modalSource).toContain('if (pendingDraft) return;');
    });

    test('server route and migration own idempotency atomicity and bounded readback contracts', () => {
        const routeSource = source('app/api/mypage/submissions/submit/route.ts');
        const migrationSource = source('../../backend/supabase/migrations/20260704000100_restaurant_submission_submit_contract.sql');

        expect(routeSource).toContain('createServerClient');
        expect(routeSource).toContain('createSupabaseServiceRoleClient');
        expect(routeSource).toContain('validateRestaurantSubmission(mode, formPayload)');
        expect(routeSource).toContain('.filter(Boolean)');
        expect(routeSource).toContain('submit_restaurant_submission');
        expect(routeSource).toContain('restaurantSubmissionRequestReadbackMatches');
        expect(routeSource).toContain('return jsonError("제출 처리 중 오류가 발생했습니다. 다시 시도해주세요.", 500)');

        expect(migrationSource).toContain('client_submission_key text');
        expect(migrationSource).toContain('restaurant_submissions_user_type_client_submission_key_idx');
        expect(migrationSource).toContain('create or replace function public.submit_restaurant_submission');
        expect(migrationSource).toContain('on conflict (user_id, submission_type, client_submission_key)');
        expect(migrationSource).toContain('revoke all on function public.submit_restaurant_submission');
        expect(migrationSource).toContain('grant execute on function public.submit_restaurant_submission');
    });
});

