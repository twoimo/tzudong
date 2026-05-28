export const EDIT_RESTAURANT_REQUEST_STEPS = [
    { id: 1, title: '기본 정보', shortTitle: '기본' },
    { id: 2, title: '영상별 정보', shortTitle: '영상' },
    { id: 3, title: '최종 확인', shortTitle: '확인' },
] as const;

export type EditRestaurantRequestStep = typeof EDIT_RESTAURANT_REQUEST_STEPS[number]['id'];
export type EditRestaurantRequestKind = 'edit' | 'closure';

export const EDIT_RESTAURANT_REQUEST_KIND_OPTIONS = [
    {
        value: 'edit',
        label: '정보 수정',
        description: '상호, 주소, 전화번호, 카테고리 오류나 가게 이전처럼 현재 정보가 달라진 내용을 알려줍니다.',
    },
    {
        value: 'closure',
        label: '폐업 제보',
        description: '추가 입력 없이 이 맛집이 폐업했거나 영업 여부 확인이 필요하다고 알려줍니다.',
    },
] as const satisfies ReadonlyArray<{
    value: EditRestaurantRequestKind;
    label: string;
    description: string;
}>;

export const CLOSED_RESTAURANT_REQUEST_ADMIN_NOTE =
    '폐업 제보: 사용자가 이 맛집이 폐업했거나 더 이상 영업하지 않는다고 알려왔습니다. 관리자 검토 후 상태/노출 여부를 결정하세요.';

export const EDIT_RESTAURANT_REQUEST_EDIT_HELPER_TEXT =
    '정보 수정은 상호, 주소, 전화번호, 카테고리 오류뿐 아니라 가게 이전처럼 실제 위치가 바뀐 경우에도 사용할 수 있습니다.';

export const EDIT_RESTAURANT_REQUEST_CLOSURE_HELPER_TEXT =
    '폐업 제보는 기존 등록 정보를 그대로 기준으로 접수됩니다. 맛집 이름, 주소, 전화번호, 카테고리를 새로 입력하거나 고치지 않아도 됩니다.';

export type EditRestaurantRequestFormData = {
    requestKind: EditRestaurantRequestKind;
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
        if (formData.requestKind === 'closure') return null;
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

export function getEditRestaurantRequestAdminNote(formData: EditRestaurantRequestFormData) {
    return formData.requestKind === 'closure'
        ? CLOSED_RESTAURANT_REQUEST_ADMIN_NOTE
        : null;
}

export function validateEditRestaurantRequest(formData: EditRestaurantRequestFormData) {
    for (const step of EDIT_RESTAURANT_REQUEST_STEPS) {
        const validationError = validateEditRestaurantRequestStep(step.id, formData);
        if (validationError) return validationError;
    }

    return null;
}
