import { normalizeCanonicalYouTubeWatchUrl } from '@/lib/youtube-url';

export type RestaurantSubmissionMode = 'new' | 'request';

export interface RestaurantSubmissionFormData {
    restaurant_name: string;
    address: string;
    phone: string;
    categories: string[];
    youtube_link: string;
    description: string;
}

export type RestaurantSubmissionStep = 1 | 2 | 3;

export const RESTAURANT_SUBMISSION_STEPS: Array<{
    id: RestaurantSubmissionStep;
    title: string;
    shortTitle: string;
}> = [
    { id: 1, title: '기본 정보', shortTitle: '기본' },
    { id: 2, title: '영상·이야기', shortTitle: '내용' },
    { id: 3, title: '확인 후 제출', shortTitle: '확인' },
];

function hasMeaningfulText(value: string): boolean {
    const compact = value.trim().replace(/\s+/g, '');
    if (!compact) return false;
    if (!/[\p{L}\p{N}]/u.test(compact)) return false;
    if (/^[\u3130-\u318F\u1100-\u11FF]+$/u.test(compact)) return false;
    if (compact.length >= 3 && new Set([...compact]).size === 1) return false;
    return true;
}

function isKeyboardMash(value: string): boolean {
    return /^(?:asdf?|qwer|zxcv)+$/i.test(value);
}

function hasMeaningfulCategory(category: string): boolean {
    const compact = category.trim().replace(/\s+/g, '');
    return compact.length > 0 && hasMeaningfulText(compact);
}

function hasRequiredCategory(categories: string[]) {
    return categories.some(hasMeaningfulCategory);
}

function isMeaningfulRestaurantName(value: string): boolean {
    const compact = value.trim().replace(/\s+/g, '');
    return compact.length >= 2 && hasMeaningfulText(compact) && !isKeyboardMash(compact);
}

function isMeaningfulAddress(value: string): boolean {
    const compact = value.trim().replace(/\s+/g, '');
    if (!hasMeaningfulText(compact)) return false;
    if (/^[A-Za-z]+\/[A-Za-z/]+$/.test(compact)) return false;
    return compact.length >= 5 || /[\uAC00-\uD7A3]/u.test(compact);
}

function isMeaningfulRequestDescription(value: string): boolean {
    const compact = value.trim().replace(/\s+/g, '');
    if (!hasMeaningfulText(compact)) return false;
    if (!/[\p{L}\p{N}]/u.test(compact)) return false;
    return true;
}

export function isRecognizedYouTubeUrl(value: string): boolean {
    return normalizeCanonicalYouTubeWatchUrl(value) !== null;
}

export type RestaurantSubmissionFieldErrors = Partial<Record<keyof RestaurantSubmissionFormData, string>>;

export function getRestaurantSubmissionFieldErrors(
    mode: RestaurantSubmissionMode,
    data: RestaurantSubmissionFormData,
): RestaurantSubmissionFieldErrors {
    const errors: RestaurantSubmissionFieldErrors = {};
    if (!isMeaningfulRestaurantName(data.restaurant_name)) errors.restaurant_name = '맛집 이름을 2자 이상 입력해주세요';
    if (!isMeaningfulAddress(data.address)) errors.address = '맛집의 주소를 확인해주세요';
    if (!hasRequiredCategory(data.categories)) errors.categories = '카테고리를 하나 이상 선택해주세요';

    if (mode === 'new') {
        if (!data.youtube_link.trim()) errors.youtube_link = '유튜브 영상 링크를 입력해주세요';
        else if (!isRecognizedYouTubeUrl(data.youtube_link)) errors.youtube_link = '유효한 유튜브 링크를 입력해주세요';
    } else if (!data.description.trim() || data.description.trim().length < 10 || !isMeaningfulRequestDescription(data.description)) {
        errors.description = '추천 이유를 10자 이상 입력해주세요';
    }

    return errors;
}

export function validateRestaurantSubmissionStep(
    step: RestaurantSubmissionStep,
    mode: RestaurantSubmissionMode,
    data: RestaurantSubmissionFormData
): string | null {
    const errors = getRestaurantSubmissionFieldErrors(mode, data);
    if (step === 1) {
        if (errors.restaurant_name || errors.address || errors.categories) {
            return '맛집 이름, 주소, 카테고리는 필수입니다';
        }

        return null;
    }

    if (step === 2) {
        return (mode === 'new' ? errors.youtube_link : errors.description) ?? null;
    }

    return validateRestaurantSubmission(mode, data);
}

export function validateRestaurantSubmission(
    mode: RestaurantSubmissionMode,
    data: RestaurantSubmissionFormData
): string | null {
    return (
        validateRestaurantSubmissionStep(1, mode, data) ??
        validateRestaurantSubmissionStep(2, mode, data)
    );
}

