export const EDIT_RESTAURANT_REQUEST_STEPS = [
    { id: 1, title: '기본 정보', shortTitle: '기본' },
    { id: 2, title: '영상별 정보', shortTitle: '영상' },
    { id: 3, title: '최종 확인', shortTitle: '확인' },
] as const;

export type EditRestaurantRequestStep = typeof EDIT_RESTAURANT_REQUEST_STEPS[number]['id'];

export type EditRestaurantRequestFormData = {
    name: string;
    address: string;
    phone: string;
    category: string[];
    youtube_reviews: Array<{
        youtube_link: string;
        tzuyang_review: string;
        restaurant_id: string;
    }>;
};

export function validateEditRestaurantRequestStep(
    step: EditRestaurantRequestStep,
    formData: EditRestaurantRequestFormData,
) {
    if (step === 1) {
        if (!formData.name.trim()) return '맛집 이름을 입력해주세요.';
        if (!formData.address.trim()) return '주소를 입력해주세요.';
        if (formData.category.length === 0) return '카테고리를 1개 이상 선택해주세요.';
        return null;
    }

    if (step === 2) {
        if (formData.youtube_reviews.length === 0) return '최소 1개의 영상 정보가 필요합니다.';

        const missingLinkIndex = formData.youtube_reviews.findIndex((review) => !review.youtube_link.trim());
        if (missingLinkIndex >= 0) return `영상 ${missingLinkIndex + 1}의 유튜브 링크를 입력해주세요.`;

        return null;
    }

    return null;
}

export function validateEditRestaurantRequest(formData: EditRestaurantRequestFormData) {
    for (const step of EDIT_RESTAURANT_REQUEST_STEPS) {
        const validationError = validateEditRestaurantRequestStep(step.id, formData);
        if (validationError) return validationError;
    }

    return null;
}
