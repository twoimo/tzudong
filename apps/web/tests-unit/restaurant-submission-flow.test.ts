import { describe, expect, test } from 'bun:test';
import {
    validateRestaurantSubmission,
    validateRestaurantSubmissionStep,
    type RestaurantSubmissionFormData,
} from '../lib/restaurant-submission-flow';

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
    });

    test('new submission step 2 requires an http(s) youtube link', () => {
        expect(validateRestaurantSubmissionStep(2, 'new', {
            ...completeForm,
            youtube_link: '',
        })).toBe('유튜브 영상 링크를 입력해주세요');

        expect(validateRestaurantSubmissionStep(2, 'new', {
            ...completeForm,
            youtube_link: 'youtube.com/watch?v=abc',
        })).toBe('유효한 유튜브 링크를 입력해주세요');

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

