'use client';

import { memo, useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, X, CheckCircle2, Send, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Restaurant, RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/no-toast";
import { saveDraft, getDraft, deleteDraft } from "@/lib/editRequestDraftDB";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MOBILE_FULL_FORM_SHEET, mobileSheetStyles } from "@/components/ui/mobile-sheet-frame";
import { useDeviceType } from "@/hooks/useDeviceType";
import {
    EDIT_RESTAURANT_REQUEST_STEPS,
    validateEditRestaurantRequest,
    validateEditRestaurantRequestStep,
    type EditRestaurantRequestStep,
} from "@/lib/edit-restaurant-request-flow";

interface EditRestaurantModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant: Restaurant | null;
    initialFormData: {
        name: string;
        address: string;
        phone: string;
        category: string[];
        youtube_reviews: { youtube_link: string; tzuyang_review: string; restaurant_id: string }[];
    };
}

export const EditRestaurantModal = memo(function EditRestaurantModal({ isOpen, onClose, restaurant, initialFormData }: EditRestaurantModalProps) {
    const { isMobileOrTablet } = useDeviceType();
    const [editFormData, setEditFormData] = useState(initialFormData);
    const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [currentStep, setCurrentStep] = useState<EditRestaurantRequestStep>(1);
    const [validationMessage, setValidationMessage] = useState<string | null>(null);
    const mobileFormRef = useRef<HTMLFormElement>(null);

    const handleEditFormChange = (field: string, value: string | string[]) => {
        setValidationMessage(null);
        setEditFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const handleYoutubeReviewChange = (index: number, field: 'youtube_link' | 'tzuyang_review', value: string) => {
        setValidationMessage(null);
        setEditFormData(prev => ({
            ...prev,
            youtube_reviews: prev.youtube_reviews.map((item, i) =>
                i === index ? { ...item, [field]: value } : item
            )
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                throw new Error('로그인이 필요합니다.');
            }

            if (!restaurant?.id) {
                throw new Error('수정할 맛집 정보가 없습니다.');
            }

            const validationError = validateEditRestaurantRequest(editFormData);
            if (validationError) {
                setValidationMessage(validationError);
                throw new Error(validationError);
            }

            // 1. restaurant_submissions 테이블에 INSERT (target_restaurant_id는 items 레벨에서 관리)
            const { data: submission, error: submissionError } = await supabase
                .from('restaurant_submissions')
                .insert({
                    user_id: user.id,
                    submission_type: 'edit',
                    status: 'pending',
                    restaurant_name: editFormData.name.trim(),
                    restaurant_address: editFormData.address.trim() || null,
                    restaurant_phone: editFormData.phone.trim() || null,
                    restaurant_categories: editFormData.category,
                    // target_restaurant_id는 submission 레벨이 아닌 items 레벨에서 저장
                } as never)
                .select('id')
                .single();

            if (submissionError) throw submissionError;

            const submissionId = (submission as { id: string }).id;

            // 2. restaurant_submission_items 테이블에 각 영상별 INSERT (각 아이템에 해당 레코드의 target_restaurant_id 저장)
            const itemsToInsert = editFormData.youtube_reviews.map(review => ({
                submission_id: submissionId,
                youtube_link: review.youtube_link.trim(),
                tzuyang_review: review.tzuyang_review?.trim() || null,
                target_restaurant_id: review.restaurant_id, // 각 아이템별로 해당 레코드의 restaurants.id 저장
            }));

            const { error: itemsError } = await supabase
                .from('restaurant_submission_items')
                .insert(itemsToInsert as never);

            if (itemsError) {
                // 롤백: submission 삭제 (CASCADE로 items도 삭제됨)
                await supabase.from('restaurant_submissions').delete().eq('id', submissionId);
                throw itemsError;
            }

            await clearDraft();
            toast.success('맛집 수정 요청이 성공적으로 제출되었습니다!');
            onClose();
        } catch (error: unknown) {
            console.error('제출 실패:', error);
            const message = error instanceof Error ? error.message : '제출에 실패했습니다. 다시 시도해주세요.';
            toast.error(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // 임시 저장된 데이터 불러오기
    const loadDraft = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id || !restaurant?.id) return;

        try {
            const draft = await getDraft(user.id, restaurant.id);
            if (draft) {
                setEditFormData({
                    name: draft.name,
                    address: draft.address,
                    phone: draft.phone,
                    category: draft.category,
                    youtube_reviews: draft.youtube_reviews,
                });
                setLastSavedAt(new Date(draft.savedAt));

                toast.success("임시 저장된 내용을 불러왔습니다", {
                    description: `저장 시간: ${new Date(draft.savedAt).toLocaleString('ko-KR')}`,
                });
            }
        } catch (error) {
            console.error('임시 저장 데이터 로드 실패:', error);
        }
    }, [restaurant?.id]);

    // 자동 저장
    const autoSave = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id || !restaurant?.id) return;

        // 내용이 하나라도 있을 때만 저장
        if (!editFormData.name && !editFormData.address && !editFormData.phone && editFormData.category.length === 0 && editFormData.youtube_reviews.length === 0) {
            return;
        }

        try {
            setIsSaving(true);
            await saveDraft({
                userId: user.id,
                restaurantId: restaurant.id,
                name: editFormData.name,
                address: editFormData.address,
                phone: editFormData.phone,
                category: editFormData.category,
                youtube_reviews: editFormData.youtube_reviews,
            });
            setLastSavedAt(new Date());
        } catch (error) {
            console.error('자동 저장 실패:', error);
        } finally {
            setIsSaving(false);
        }
    }, [restaurant?.id, editFormData]);

    // 임시 저장 데이터 삭제
    const clearDraft = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id || !restaurant?.id) return;

        try {
            await deleteDraft(user.id, restaurant.id);
            setLastSavedAt(null);
        } catch (error) {
            console.error('임시 저장 데이터 삭제 실패:', error);
        }
    }, [restaurant?.id]);

    // 디바운스된 자동 저장 (500ms)
    useEffect(() => {
        if (!isOpen) return;

        const timer = setTimeout(() => {
            autoSave();
        }, 500);

        return () => clearTimeout(timer);
    }, [isOpen, editFormData, autoSave]);

    // 모달이 열릴 때 임시 저장된 데이터 확인
    useEffect(() => {
        if (isOpen && restaurant?.id) {
            loadDraft();
            setCurrentStep(1);
            setValidationMessage(null);
        }
    }, [isOpen, restaurant?.id, loadDraft]);

    useEffect(() => {
        if (!isOpen || !isMobileOrTablet) return;

        const scrollContainer = mobileFormRef.current?.parentElement;
        scrollContainer?.scrollTo({ top: 0, behavior: 'instant' });
    }, [currentStep, isMobileOrTablet, isOpen]);

    const handleNextStep = () => {
        const validationError = validateEditRestaurantRequestStep(currentStep, editFormData);
        if (validationError) {
            setValidationMessage(validationError);
            toast.error(validationError);
            return;
        }

        setValidationMessage(null);
        setCurrentStep((step) => Math.min(step + 1, 3) as EditRestaurantRequestStep);
    };

    const handlePreviousStep = () => {
        setValidationMessage(null);
        setCurrentStep((step) => Math.max(step - 1, 1) as EditRestaurantRequestStep);
    };

    const draftStatus = lastSavedAt && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {isSaving ? (
                <>
                    <div className="animate-spin h-2.5 w-2.5 border border-primary border-t-transparent rounded-full" />
                    <span>저장 중</span>
                </>
            ) : (
                <>
                    <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />
                    <span className="text-green-600">
                        저장됨 {lastSavedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </>
            )}
        </div>
    );

    const validationMessageId = 'edit-restaurant-validation-message';

    const renderValidationMessage = () => validationMessage && (
        <div
            id={validationMessageId}
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 dark:border-red-950 dark:bg-red-950/30 dark:text-red-100"
        >
            {validationMessage}
        </div>
    );

    const renderMobileCategoryPicker = () => (
        <div className="space-y-2">
            <Label>
                카테고리 <span className="text-red-500">*</span>
            </Label>
            {editFormData.category.length > 0 && (
                <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/50 p-3">
                    {editFormData.category.map((category) => (
                        <Badge key={category} variant="secondary" className="text-xs">
                            {category}
                            <button
                                type="button"
                                className="ml-1.5 rounded-full p-0.5 hover:bg-destructive/20"
                                aria-label={`${category} 카테고리 삭제`}
                                onClick={() => {
                                    handleEditFormChange('category', editFormData.category.filter(c => c !== category));
                                }}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            )}
            <div className="flex flex-wrap gap-1.5">
                {RESTAURANT_CATEGORIES.map((category) => {
                    const isSelected = editFormData.category.includes(category);
                    return (
                        <Button
                            key={category}
                            type="button"
                            variant={isSelected ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                                handleEditFormChange(
                                    'category',
                                    isSelected
                                        ? editFormData.category.filter(c => c !== category)
                                        : [...editFormData.category, category]
                                );
                            }}
                            className="h-8 text-xs"
                        >
                            {category}
                        </Button>
                    );
                })}
            </div>
        </div>
    );

    const renderMobileBasicStep = () => (
        <div className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
                기존 맛집 정보를 기준으로 잘못된 이름, 주소, 전화번호, 카테고리를 수정해주세요.
            </div>

            <div className="space-y-2">
                <Label htmlFor="edit-mobile-name">
                    맛집 이름 <span className="text-red-500">*</span>
                </Label>
                <Input
                    id="edit-mobile-name"
                    value={editFormData.name}
                    onChange={(e) => handleEditFormChange('name', e.target.value)}
                    placeholder="맛집 이름을 입력해주세요"
                    autoComplete="organization"
                    enterKeyHint="next"
                    required
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="edit-mobile-address">
                    주소 <span className="text-red-500">*</span>
                </Label>
                <Input
                    id="edit-mobile-address"
                    value={editFormData.address}
                    onChange={(e) => handleEditFormChange('address', e.target.value)}
                    placeholder="주소를 입력해주세요"
                    autoComplete="street-address"
                    enterKeyHint="next"
                    required
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="edit-mobile-phone">전화번호</Label>
                <Input
                    id="edit-mobile-phone"
                    type="tel"
                    value={editFormData.phone}
                    onChange={(e) => handleEditFormChange('phone', e.target.value)}
                    placeholder="전화번호를 입력해주세요"
                    autoComplete="tel"
                    enterKeyHint="next"
                />
            </div>

            {renderMobileCategoryPicker()}
        </div>
    );

    const renderMobileVideoStep = () => (
        <div className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
                여러 영상에서 병합된 맛집이면 영상별 링크와 리뷰 메모를 각각 확인해주세요.
            </div>

            {editFormData.youtube_reviews.map((review, index) => (
                <Card key={`${review.restaurant_id}-${index}`} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <Badge variant="outline">영상 {index + 1}</Badge>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={`edit-mobile-youtube-${index}`}>
                            유튜브 링크 <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id={`edit-mobile-youtube-${index}`}
                            value={review.youtube_link}
                            onChange={(e) => handleYoutubeReviewChange(index, 'youtube_link', e.target.value)}
                            placeholder="https://www.youtube.com/watch?v=..."
                            inputMode="url"
                            autoComplete="url"
                            autoCapitalize="none"
                            autoCorrect="off"
                            enterKeyHint="next"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor={`edit-mobile-review-${index}`}>쯔양의 리뷰</Label>
                        <Textarea
                            id={`edit-mobile-review-${index}`}
                            value={review.tzuyang_review}
                            onChange={(e) => handleYoutubeReviewChange(index, 'tzuyang_review', e.target.value)}
                            placeholder="쯔양의 리뷰 내용을 입력해주세요"
                            className="min-h-[112px]"
                        />
                    </div>
                </Card>
            ))}
        </div>
    );

    const renderMobileReviewStep = () => (
        <div className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-4">
                <p className="text-sm font-semibold text-foreground">제출 전 확인</p>
                <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">상호</dt>
                        <dd className="break-words">{editFormData.name || '-'}</dd>
                    </div>
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">주소</dt>
                        <dd className="break-words">{editFormData.address || '-'}</dd>
                    </div>
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">카테고리</dt>
                        <dd className="flex flex-wrap gap-1">
                            {editFormData.category.length > 0
                                ? editFormData.category.map((category) => <Badge key={category} variant="outline" className="text-xs">{category}</Badge>)
                                : '-'}
                        </dd>
                    </div>
                    {editFormData.phone && (
                        <div className="flex gap-3">
                            <dt className="w-16 shrink-0 text-muted-foreground">전화</dt>
                            <dd className="break-words">{editFormData.phone}</dd>
                        </div>
                    )}
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">영상</dt>
                        <dd>{editFormData.youtube_reviews.length}개</dd>
                    </div>
                </dl>
            </div>

            <div className="space-y-2">
                {editFormData.youtube_reviews.map((review, index) => (
                    <div key={`${review.restaurant_id}-review-${index}`} className="rounded-xl border bg-card/70 p-3 text-sm">
                        <p className="font-medium">영상 {index + 1}</p>
                        <p className="mt-1 break-all text-muted-foreground">{review.youtube_link || '-'}</p>
                        {review.tzuyang_review && (
                            <p className="mt-2 whitespace-pre-wrap break-words">{review.tzuyang_review}</p>
                        )}
                    </div>
                ))}
            </div>

            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-950 dark:bg-red-950/30 dark:text-red-100">
                제출 후에는 관리자 검토를 거쳐 지도 정보에 반영돼요. 기존 맛집 삭제나 병합이 필요한 경우 관리자 검토에서 처리됩니다.
            </div>
        </div>
    );

    const renderMobileStepContent = () => {
        if (currentStep === 1) return renderMobileBasicStep();
        if (currentStep === 2) return renderMobileVideoStep();
        return renderMobileReviewStep();
    };

    if (isMobileOrTablet) {
        const mobileTitleId = 'edit-restaurant-sheet-title';
        const mobileDescriptionId = 'edit-restaurant-sheet-description';

        return (
            <BottomSheet
                isOpen={isOpen}
                onClose={onClose}
                {...MOBILE_FULL_FORM_SHEET}
                layoutSource="edit-restaurant-modal"
                className="z-[110]"
                ariaLabelledBy={mobileTitleId}
                ariaDescribedBy={validationMessage ? `${mobileDescriptionId} ${validationMessageId}` : mobileDescriptionId}
                focusTrapAllowSelectors={[]}
            >
                {isOpen && restaurant && (
                    <form
                        ref={mobileFormRef}
                        onSubmit={handleSubmit}
                        className={mobileSheetStyles.frame}
                    >
                        <div className={mobileSheetStyles.header}>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-medium text-red-700 dark:text-red-300">
                                        {currentStep} / {EDIT_RESTAURANT_REQUEST_STEPS.length} · {EDIT_RESTAURANT_REQUEST_STEPS[currentStep - 1].title}
                                    </p>
                                    <h2 id={mobileTitleId} className="truncate text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                                        맛집 수정 요청
                                    </h2>
                                </div>
                                <Button type="button" variant="ghost" size="icon" aria-label="맛집 수정 요청 닫기" onClick={onClose}>
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                            <p id={mobileDescriptionId} className="text-sm text-muted-foreground">
                                {restaurant.name}의 정보를 3단계로 확인하고 수정 요청을 제출해주세요.
                            </p>
                            <div className="mt-3 grid grid-cols-3 gap-1.5" aria-label="수정 요청 단계 진행률">
                                {EDIT_RESTAURANT_REQUEST_STEPS.map((step) => (
                                    <div key={step.id} className="space-y-1">
                                        <div className={`h-1.5 rounded-full ${step.id <= currentStep ? 'bg-red-800' : 'bg-muted'}`} />
                                        <span className={`block text-center text-[11px] ${step.id === currentStep ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                                            {step.shortTitle}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-2 min-h-4">{draftStatus}</div>
                        </div>

                        <div className={mobileSheetStyles.content}>
                            {renderMobileStepContent()}
                        </div>

                        <div className={mobileSheetStyles.footer}>
                            {validationMessage && <div className="pb-2">{renderValidationMessage()}</div>}
                            <div className="flex gap-2">
                                {currentStep > 1 ? (
                                    <Button type="button" variant="outline" onClick={handlePreviousStep} className="min-w-24" disabled={isSubmitting}>
                                        <ChevronLeft className="mr-1 h-4 w-4" />
                                        이전
                                    </Button>
                                ) : (
                                    <Button type="button" variant="outline" onClick={onClose} className="min-w-24" disabled={isSubmitting}>
                                        취소
                                    </Button>
                                )}
                                {currentStep < 3 ? (
                                    <Button type="button" onClick={handleNextStep} className={`${mobileSheetStyles.primaryAction} flex-1`}>
                                        다음
                                    </Button>
                                ) : (
                                    <Button type="submit" className={`${mobileSheetStyles.primaryAction} flex-1`} disabled={isSubmitting}>
                                        <Send className="mr-2 h-4 w-4" />
                                        {isSubmitting ? '제출 중...' : '수정 요청 제출'}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </form>
                )}
            </BottomSheet>
        );
    }


    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            {isOpen && (
                <DialogContent
                    className="w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 rounded-xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
                    onPointerDownOutside={(e) => {
                        // Popover 내부 클릭 시 Dialog가 닫히지 않도록
                        const target = e.target as HTMLElement;
                        if (target.closest('[data-radix-popper-content-wrapper]')) {
                            e.preventDefault();
                        }
                    }}
                    onInteractOutside={(e) => {
                        // Popover 내부 상호작용 시 Dialog가 닫히지 않도록
                        const target = e.target as HTMLElement;
                        if (target.closest('[data-radix-popper-content-wrapper]')) {
                            e.preventDefault();
                        }
                    }}
                >
                    <DialogHeader className="relative">
                        {/* 자동 저장 상태 표시 - 좌측 상단 */}
                        {lastSavedAt && (
                            <div className="absolute -top-1 left-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                                {isSaving ? (
                                    <>
                                        <div className="animate-spin h-2.5 w-2.5 border border-primary border-t-transparent rounded-full" />
                                        <span>저장 중</span>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />
                                        <span className="text-green-600">
                                            저장됨 {lastSavedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="flex items-start justify-between gap-2 pt-3">
                            <div className="flex-1">
                                <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                                    맛집 수정 요청
                                </DialogTitle>
                                <DialogDescription>
                                    해당 맛집의 유튜브 영상별 정보를 수정해주세요
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    {restaurant && (
                        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                            {/* 공통 정보 입력 */}
                            <div className="space-y-4 p-4 bg-muted rounded-lg">
                                <h3 className="font-semibold text-lg">공통 정보</h3>

                                <div className="space-y-2">
                                    <Label htmlFor="name">
                                        맛집 이름 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="name"
                                        value={editFormData.name}
                                        onChange={(e) => handleEditFormChange('name', e.target.value)}
                                        placeholder="맛집 이름을 입력해주세요"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="address">
                                        주소 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="address"
                                        value={editFormData.address}
                                        onChange={(e) => handleEditFormChange('address', e.target.value)}
                                        placeholder="주소를 입력해주세요"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="phone">전화번호</Label>
                                    <Input
                                        id="phone"
                                        value={editFormData.phone}
                                        onChange={(e) => handleEditFormChange('phone', e.target.value)}
                                        placeholder="전화번호를 입력해주세요"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="category">
                                        카테고리 <span className="text-red-500">*</span>
                                    </Label>
                                    <Popover open={isCategoryPopoverOpen} onOpenChange={setIsCategoryPopoverOpen} modal={true}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={isCategoryPopoverOpen}
                                                className="w-full justify-between"
                                                type="button"
                                            >
                                                {editFormData.category.length > 0
                                                    ? `${editFormData.category.length}개 선택됨`
                                                    : "카테고리를 선택해주세요"
                                                }
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent
                                            className="w-full p-0 z-[200]"
                                            align="start"
                                            onInteractOutside={(e) => {
                                                // Dialog 내부 클릭 시 Popover가 닫히지 않도록 방지
                                                e.preventDefault();
                                            }}
                                        >
                                            <Command>
                                                <CommandInput placeholder="카테고리 검색..." />
                                                <CommandList>
                                                    <CommandEmpty>카테고리를 찾을 수 없습니다.</CommandEmpty>
                                                    <CommandGroup>
                                                        {[
                                                            "한식", "중식", "일식", "양식", "분식", "치킨·피자",
                                                            "고기", "족발·보쌈", "돈까스·회", "아시안",
                                                            "패스트푸드", "카페·디저트", "기타"
                                                        ].map((category) => {
                                                            const isSelected = editFormData.category.includes(category);
                                                            return (
                                                                <CommandItem
                                                                    key={category}
                                                                    onSelect={() => {
                                                                        const newCategories = isSelected
                                                                            ? editFormData.category.filter(c => c !== category)
                                                                            : [...editFormData.category, category];
                                                                        handleEditFormChange('category', newCategories);
                                                                    }}
                                                                >
                                                                    <Check
                                                                        className={`mr-2 h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"}`}
                                                                    />
                                                                    {category}
                                                                </CommandItem>
                                                            );
                                                        })}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    {editFormData.category.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {editFormData.category.map((category) => (
                                                <Badge key={category} variant="secondary" className="text-xs">
                                                    {category}
                                                    <button
                                                        type="button"
                                                        className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                                                        onClick={() => {
                                                            const newCategories = editFormData.category.filter(c => c !== category);
                                                            handleEditFormChange('category', newCategories);
                                                        }}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 유튜브 영상별 정보 */}
                            <div className="space-y-4">
                                <h3 className="font-semibold text-lg">유튜브 영상별 정보</h3>

                                {editFormData.youtube_reviews.map((review, index) => (
                                    <Card key={index} className="p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Badge variant="outline">영상 {index + 1}</Badge>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>유튜브 링크</Label>
                                            <Input
                                                value={review.youtube_link}
                                                onChange={(e) => handleYoutubeReviewChange(index, 'youtube_link', e.target.value)}
                                                placeholder="https://www.youtube.com/watch?v=..."
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label>쯔양의 리뷰</Label>
                                            <Textarea
                                                value={review.tzuyang_review}
                                                onChange={(e) => handleYoutubeReviewChange(index, 'tzuyang_review', e.target.value)}
                                                placeholder="쯔양의 리뷰 내용을 입력해주세요"
                                                rows={3}
                                            />
                                        </div>
                                    </Card>
                                ))}
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button type="button" variant="outline" onClick={onClose} className="flex-1" disabled={isSubmitting}>
                                    취소
                                </Button>
                                <Button type="submit" className="flex-1 bg-gradient-primary hover:opacity-90" disabled={isSubmitting}>
                                    {isSubmitting ? '제출 중...' : '수정 요청 제출'}
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            )}
        </Dialog>
    );
});
