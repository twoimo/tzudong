import { useState } from 'react';
import { Restaurant } from '@/types/restaurant';

export interface FormState {
    // 관리자 모달
    refreshTrigger: number;
    isAdminEditModalOpen: boolean;
    adminRestaurantToEdit: Restaurant | null;

    // 수정 요청 모달
    isEditModalOpen: boolean;
    restaurantToEdit: Restaurant | null;
    isCategoryPopoverOpen: boolean;

    // 리뷰 모달
    isReviewModalOpen: boolean;

    // 폼 데이터
    editFormData: {
        name: string;
        address: string;
        phone: string;
        category: string[];
        youtube_reviews: { youtube_link: string; tzuyang_review: string; unique_id?: string }[];
    };
}

export function useFormState() {
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [isAdminEditModalOpen, setIsAdminEditModalOpen] = useState(false);
    const [adminRestaurantToEdit, setAdminRestaurantToEdit] = useState<Restaurant | null>(null);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);
    const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);

    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

    const [editFormData, setEditFormData] = useState({
        name: '',
        address: '',
        phone: '',
        category: [] as string[],
        youtube_reviews: [] as { youtube_link: string; tzuyang_review: string; unique_id?: string }[]
    });

    return {
        refreshTrigger,
        setRefreshTrigger,
        isAdminEditModalOpen,
        setIsAdminEditModalOpen,
        adminRestaurantToEdit,
        setAdminRestaurantToEdit,
        isEditModalOpen,
        setIsEditModalOpen,
        restaurantToEdit,
        setRestaurantToEdit,
        isCategoryPopoverOpen,
        setIsCategoryPopoverOpen,
        isReviewModalOpen,
        setIsReviewModalOpen,
        editFormData,
        setEditFormData,
    };
}
