import { describe, expect, test } from 'bun:test';

import {
    CLOSED_RESTAURANT_REQUEST_ADMIN_NOTE,
    EDIT_RESTAURANT_REQUEST_CLOSURE_HELPER_TEXT,
    EDIT_RESTAURANT_REQUEST_EDIT_HELPER_TEXT,
    EDIT_RESTAURANT_REQUEST_KIND_OPTIONS,
    getEditRestaurantRequestAdminNote,
    validateEditRestaurantRequest,
    validateEditRestaurantRequestStep,
    type EditRestaurantRequestFormData,
} from '../lib/edit-restaurant-request-flow';

const validFormData: EditRestaurantRequestFormData = {
    requestKind: 'edit',
    name: '데일리픽스 강남본점',
    address: '서울특별시 강남구 논현로85길 70',
    phone: '02-1234-5678',
    category: ['패스트푸드'],
    youtube_reviews: [
        {
            youtube_link: 'https://www.youtube.com/watch?v=example',
            tzuyang_review: '쯔양 리뷰 메모',
            restaurant_id: 'restaurant-1',
        },
    ],
};

describe('edit restaurant request flow validation', () => {
    test('validates basic info before moving past step 1', () => {
        expect(validateEditRestaurantRequestStep(1, { ...validFormData, name: '' })).toBe('맛집 이름을 입력해주세요.');
        expect(validateEditRestaurantRequestStep(1, { ...validFormData, address: '' })).toBe('주소를 입력해주세요.');
        expect(validateEditRestaurantRequestStep(1, { ...validFormData, category: [] })).toBe('카테고리를 1개 이상 선택해주세요.');
    });

    test('validates youtube review links before moving past step 2', () => {
        expect(validateEditRestaurantRequestStep(2, { ...validFormData, youtube_reviews: [] })).toBe('최소 1개의 영상 정보가 필요합니다.');
        expect(validateEditRestaurantRequestStep(2, {
            ...validFormData,
            youtube_reviews: [{ ...validFormData.youtube_reviews[0], youtube_link: '' }],
        })).toBe('영상 1의 유튜브 링크를 입력해주세요.');
    });

    test('accepts a complete three-step edit request', () => {
        expect(validateEditRestaurantRequest(validFormData)).toBeNull();
    });

    test('allows closure reports to skip all edit-only basic fields', () => {
        expect(validateEditRestaurantRequestStep(1, {
            ...validFormData,
            requestKind: 'closure',
            name: '',
            address: '',
            phone: '',
            category: [],
        })).toBeNull();
        expect(validateEditRestaurantRequest({
            ...validFormData,
            requestKind: 'closure',
            name: '',
            address: '',
            phone: '',
            category: [],
        })).toBeNull();
    });

    test('adds an admin-visible closure note only for closure reports', () => {
        expect(getEditRestaurantRequestAdminNote(validFormData)).toBeNull();
        expect(getEditRestaurantRequestAdminNote({
            ...validFormData,
            requestKind: 'closure',
        })).toBe(CLOSED_RESTAURANT_REQUEST_ADMIN_NOTE);
    });

    test('explains relocation edits and no-input closure reports', () => {
        expect(EDIT_RESTAURANT_REQUEST_KIND_OPTIONS.find((option) => option.value === 'edit')?.description).toContain('가게 이전');
        expect(EDIT_RESTAURANT_REQUEST_KIND_OPTIONS.find((option) => option.value === 'closure')?.description).toContain('추가 입력 없이');
        expect(EDIT_RESTAURANT_REQUEST_EDIT_HELPER_TEXT).toContain('실제 위치가 바뀐 경우');
        expect(EDIT_RESTAURANT_REQUEST_CLOSURE_HELPER_TEXT).toContain('새로 입력하거나 고치지 않아도 됩니다');
    });
});
