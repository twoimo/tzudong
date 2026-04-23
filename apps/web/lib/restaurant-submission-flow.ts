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

export function isHttpUrl(value: string): boolean {
    return /^https?:\/\//.test(value.trim());
}

export function validateRestaurantSubmissionStep(
    step: RestaurantSubmissionStep,
    mode: RestaurantSubmissionMode,
    data: RestaurantSubmissionFormData
): string | null {
    if (step === 1) {
        if (!data.restaurant_name.trim() || !data.address.trim() || data.categories.length === 0) {
            return '맛집 이름, 주소, 카테고리는 필수입니다';
        }

        return null;
    }

    if (step === 2) {
        if (mode === 'new') {
            if (!data.youtube_link.trim()) {
                return '유튜브 영상 링크를 입력해주세요';
            }

            if (!isHttpUrl(data.youtube_link)) {
                return '유효한 유튜브 링크를 입력해주세요';
            }

            return null;
        }

        if (!data.description.trim() || data.description.trim().length < 10) {
            return '추천 이유를 10자 이상 입력해주세요';
        }

        return null;
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

