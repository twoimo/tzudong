'use client';

import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MOBILE_FULL_FORM_SHEET, mobileSheetStyles } from "@/components/ui/mobile-sheet-frame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/no-toast";
import { X, Send, CheckCircle2, ChevronLeft } from "lucide-react";
import { RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { saveDraft, getDraft, deleteDraft } from "@/lib/submissionDraftDB";
import { useDeviceType } from "@/hooks/useDeviceType";
import {
    RESTAURANT_SUBMISSION_STEPS,
    validateRestaurantSubmission,
    validateRestaurantSubmissionStep,
    type RestaurantSubmissionStep,
} from "@/lib/restaurant-submission-flow";

interface RestaurantSubmissionModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function RestaurantSubmissionModal({
    isOpen,
    onClose,
}: RestaurantSubmissionModalProps) {
    const getErrorMessage = (error: unknown, fallback: string) => {
        return error instanceof Error && error.message ? error.message : fallback;
    };

    const { user } = useAuth();
    const { isMobileOrTablet } = useDeviceType();
    const queryClient = useQueryClient();
    const [submissionMode, setSubmissionMode] = useState<'new' | 'request'>('new');
    const [currentStep, setCurrentStep] = useState<RestaurantSubmissionStep>(1);
    const [validationMessage, setValidationMessage] = useState<string | null>(null);
    const [categoryInput, setCategoryInput] = useState("");
    const [formData, setFormData] = useState({
        restaurant_name: "",
        address: "",
        phone: "",
        categories: [] as string[],
        youtube_link: "",
        description: "", // new: 쯔양 리뷰, request: 추천 이유
    });
    const [isSaving, setIsSaving] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const mobileFormRef = useRef<HTMLFormElement>(null);

    // 모달 열릴 때 초기화
    useEffect(() => {
        if (isOpen) {
            resetForm();
            setCurrentStep(1);
            setValidationMessage(null);
        }
    }, [isOpen, submissionMode]);

    useEffect(() => {
        setValidationMessage(null);
    }, [currentStep, formData, submissionMode]);

    useEffect(() => {
        if (!isOpen || !isMobileOrTablet) return;

        const scrollContainer = mobileFormRef.current?.parentElement;
        scrollContainer?.scrollTo({ top: 0, behavior: 'instant' });
    }, [currentStep, isMobileOrTablet, isOpen]);

    // 신규 제보 (new) - restaurant_submissions + restaurant_submission_items
    const submitNewMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            if (!user) throw new Error('로그인이 필요합니다');

            // 1. restaurant_submissions 테이블에 INSERT
            const { data: submission, error: submissionError } = await supabase
                .from('restaurant_submissions')
                .insert({
                    user_id: user.id,
                    submission_type: 'new',
                    status: 'pending',
                    restaurant_name: data.restaurant_name.trim(),
                    restaurant_address: data.address.trim(),
                    restaurant_phone: data.phone.trim() || null,
                    restaurant_categories: data.categories.length > 0 ? data.categories : null,
                } as never)
                .select('id')
                .single();

            if (submissionError) throw submissionError;

            const submissionId = (submission as { id: string }).id;

            // 2. restaurant_submission_items 테이블에 INSERT
            const { error: itemError } = await supabase
                .from('restaurant_submission_items')
                .insert({
                    submission_id: submissionId,
                    youtube_link: data.youtube_link.trim(),
                    tzuyang_review: data.description.trim() || null,
                } as never);

            if (itemError) {
                // 롤백: submission 삭제
                await supabase.from('restaurant_submissions').delete().eq('id', submissionId);
                throw itemError;
            }
        },
        onSuccess: async () => {
            await clearDraft();
            toast.success('맛집 제보가 성공적으로 제출되었습니다!');
            queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
            onClose();
            resetForm();
        },
        onError: (error: unknown) => {
            toast.error(getErrorMessage(error, '제보 제출에 실패했습니다'));
        },
    });

    // 쯔양에게 맛집 제보 (request) - restaurant_requests
    const submitRequestMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            if (!user) throw new Error('로그인이 필요합니다');

            const { error } = await supabase
                .from('restaurant_requests')
                .insert({
                    user_id: user.id,
                    restaurant_name: data.restaurant_name.trim(),
                    origin_address: data.address.trim(),
                    phone: data.phone.trim() || null,
                    categories: data.categories.length > 0 ? data.categories : null,
                    recommendation_reason: data.description.trim(),
                    youtube_link: data.youtube_link.trim() || null,
                } as never);

            if (error) throw error;
        },
        onSuccess: async () => {
            await clearDraft();
            toast.success('맛집 추천이 성공적으로 제출되었습니다!');
            queryClient.invalidateQueries({ queryKey: ['my-requests'] });
            onClose();
            resetForm();
        },
        onError: (error: unknown) => {
            toast.error(getErrorMessage(error, '추천 제출에 실패했습니다'));
        },
    });

    const resetForm = () => {
        setFormData({
            restaurant_name: "",
            address: "",
            phone: "",
            categories: [],
            youtube_link: "",
            description: "",
        });
        setCategoryInput("");
        setLastSavedAt(null);
    };

    // 임시 저장된 데이터 불러오기
    const loadDraft = useCallback(async () => {
        if (!user?.id) return;

        try {
            const draft = await getDraft(user.id, submissionMode);
            if (draft) {
                setFormData({
                    restaurant_name: draft.restaurant_name,
                    address: draft.address,
                    phone: draft.phone,
                    categories: draft.categories,
                    youtube_link: draft.youtube_link,
                    description: draft.description,
                });
                setLastSavedAt(new Date(draft.savedAt));

                toast.success("임시 저장된 내용을 불러왔습니다", {
                    description: `저장 시간: ${new Date(draft.savedAt).toLocaleString('ko-KR')}`,
                });
            }
        } catch (error) {
            console.error('임시 저장 데이터 로드 실패:', error);
        }
    }, [user?.id, submissionMode]);

    // 자동 저장
    const autoSave = useCallback(async () => {
        if (!user?.id) return;

        // 내용이 하나라도 있을 때만 저장
        if (!formData.restaurant_name && !formData.address && !formData.phone && formData.categories.length === 0 && !formData.youtube_link && !formData.description) {
            return;
        }

        try {
            setIsSaving(true);
            await saveDraft({
                userId: user.id,
                submissionMode,
                restaurant_name: formData.restaurant_name,
                address: formData.address,
                phone: formData.phone,
                categories: formData.categories,
                youtube_link: formData.youtube_link,
                description: formData.description,
            });
            setLastSavedAt(new Date());
        } catch (error) {
            console.error('자동 저장 실패:', error);
        } finally {
            setIsSaving(false);
        }
    }, [user?.id, submissionMode, formData]);

    // 임시 저장 데이터 삭제
    const clearDraft = useCallback(async () => {
        if (!user?.id) return;

        try {
            await deleteDraft(user.id, submissionMode);
            setLastSavedAt(null);
        } catch (error) {
            console.error('임시 저장 데이터 삭제 실패:', error);
        }
    }, [user?.id, submissionMode]);

    // 디바운스된 자동 저장 (500ms)
    useEffect(() => {
        if (!isOpen) return;

        const timer = setTimeout(() => {
            autoSave();
        }, 500);

        return () => clearTimeout(timer);
    }, [isOpen, formData, autoSave]);

    // 모달이 열릴 때 임시 저장된 데이터 확인
    useEffect(() => {
        if (isOpen && user?.id) {
            loadDraft();
        }
    }, [isOpen, user?.id, submissionMode, loadDraft]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!user) {
            toast.error('로그인이 필요합니다');
            return;
        }

        const validationError = validateRestaurantSubmission(submissionMode, formData);
        if (validationError) {
            setValidationMessage(validationError);
            toast.error(validationError);
            return;
        }

        if (submissionMode === 'new') {
            submitNewMutation.mutate(formData);
        } else {
            submitRequestMutation.mutate(formData);
        }
    };

    const isPending = submitNewMutation.isPending || submitRequestMutation.isPending;

    const handleModeChange = (mode: 'new' | 'request') => {
        setSubmissionMode(mode);
        setCurrentStep(1);
        setValidationMessage(null);
    };

    const handleNextStep = () => {
        const validationError = validateRestaurantSubmissionStep(currentStep, submissionMode, formData);
        if (validationError) {
            setValidationMessage(validationError);
            toast.error(validationError);
            return;
        }

        setCurrentStep((step) => Math.min(step + 1, 3) as RestaurantSubmissionStep);
    };

    const handlePreviousStep = () => {
        setCurrentStep((step) => Math.max(step - 1, 1) as RestaurantSubmissionStep);
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

    const title = submissionMode === 'new' ? '쯔동여지도 제보하기' : '쯔양에게 맛집 제보하기';
    const description = submissionMode === 'new'
        ? '쯔양의 맛집 정보와 유튜브 영상 링크를 알려주세요!'
        : '쯔양에게 방문을 추천하고 싶은 맛집 정보를 알려주세요!';
    const mobileTitleId = 'restaurant-submission-sheet-title';
    const mobileDescriptionId = 'restaurant-submission-sheet-description';
    const validationMessageId = 'restaurant-submission-validation-message';

    const renderValidationMessage = () => validationMessage && (
        <div
            id={validationMessageId}
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 dark:border-red-950 dark:bg-red-950/30 dark:text-red-100"
        >
            {validationMessage}
        </div>
    );

    const renderModeSelector = () => (
        <div className="grid grid-cols-2 gap-2">
            <Button
                type="button"
                variant={submissionMode === 'new' ? 'default' : 'outline'}
                onClick={() => handleModeChange('new')}
                className="h-auto min-h-11 flex-col gap-0.5 whitespace-normal px-2 py-2"
            >
                <span>쯔양이 다녀간 맛집</span>
                <span className="text-[11px] font-normal opacity-80">영상 링크 필수</span>
            </Button>
            <Button
                type="button"
                variant={submissionMode === 'request' ? 'default' : 'outline'}
                onClick={() => handleModeChange('request')}
                className="h-auto min-h-11 flex-col gap-0.5 whitespace-normal px-2 py-2"
            >
                <span>쯔양에게 맛집 제보</span>
                <span className="text-[11px] font-normal opacity-80">추천 이유 필수</span>
            </Button>
        </div>
    );

    const renderCategoryPicker = () => (
        <div className="space-y-2">
            <Label>
                카테고리 <span className="text-red-500">*</span>
            </Label>

            {formData.categories.length > 0 && (
                <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/50 p-3">
                    {formData.categories.map((category) => (
                        <Badge key={category} variant="secondary" className="text-xs">
                            {category}
                            <button
                                type="button"
                                onClick={() => setFormData({
                                    ...formData,
                                    categories: formData.categories.filter(c => c !== category)
                                })}
                                className="ml-1.5 rounded-full p-0.5 hover:bg-destructive/20"
                                aria-label={`${category} 카테고리 삭제`}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap gap-1.5">
                {RESTAURANT_CATEGORIES.map((category) => (
                    <Button
                        key={category}
                        type="button"
                        variant={formData.categories.includes(category) ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                            if (formData.categories.includes(category)) {
                                setFormData({
                                    ...formData,
                                    categories: formData.categories.filter(c => c !== category)
                                });
                            } else {
                                setFormData({
                                    ...formData,
                                    categories: [...formData.categories, category]
                                });
                            }
                        }}
                        className="h-8 text-xs"
                    >
                        {category}
                    </Button>
                ))}
            </div>

            <div className="flex gap-2">
                <Input
                    value={categoryInput}
                    onChange={(e) => setCategoryInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            const trimmed = categoryInput.trim();
                            if (trimmed && !formData.categories.includes(trimmed)) {
                                setFormData({
                                    ...formData,
                                    categories: [...formData.categories, trimmed]
                                });
                                setCategoryInput("");
                            }
                        }
                    }}
                    placeholder="직접 입력 (예: 광고, 협찬)"
                    className="h-9 flex-1"
                />
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        const trimmed = categoryInput.trim();
                        if (trimmed && !formData.categories.includes(trimmed)) {
                            setFormData({
                                ...formData,
                                categories: [...formData.categories, trimmed]
                            });
                            setCategoryInput("");
                        }
                    }}
                    disabled={!categoryInput.trim()}
                    className="h-9"
                >
                    추가
                </Button>
            </div>
        </div>
    );

    const renderBasicFields = () => (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="restaurant_name">
                    맛집 이름 <span className="text-red-500">*</span>
                </Label>
                <Input
                    id="restaurant_name"
                    value={formData.restaurant_name}
                    onChange={(e) => setFormData({ ...formData, restaurant_name: e.target.value })}
                    placeholder="예: 명동 짜장면"
                    autoComplete="off"
                    enterKeyHint="next"
                />
            </div>

            {renderCategoryPicker()}

            <div className="space-y-2">
                <Label htmlFor="address">
                    주소 <span className="text-red-500">*</span>
                </Label>
                <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="서울시 중구 명동길 123"
                    autoComplete="street-address"
                    enterKeyHint="next"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="phone">전화번호</Label>
                <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="02-1234-5678"
                    autoComplete="tel"
                    enterKeyHint="next"
                />
            </div>
        </div>
    );

    const renderStoryFields = () => (
        <div className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
                {submissionMode === 'new'
                    ? '쯔동여지도 등록 근거가 되는 영상 링크를 먼저 받고, 리뷰 메모는 선택으로 남깁니다.'
                    : '방문을 추천하는 이유가 핵심이에요. 영상은 있으면 함께 첨부할 수 있습니다.'}
            </div>

            <div className="space-y-2">
                <Label htmlFor="youtube_link">
                    유튜브 영상 링크 {submissionMode === 'new' && <span className="text-red-500">*</span>}
                    {submissionMode === 'request' && <span className="text-muted-foreground text-xs">(선택사항)</span>}
                </Label>
                <Input
                    id="youtube_link"
                    type="url"
                    value={formData.youtube_link}
                    onChange={(e) => setFormData({ ...formData, youtube_link: e.target.value })}
                    placeholder={submissionMode === 'new'
                        ? "https://youtube.com/watch?v=... (필수)"
                        : "관련 영상 링크 (선택)"
                    }
                    autoComplete="url"
                    enterKeyHint="next"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="description">
                    {submissionMode === 'new' ? '쯔양의 리뷰' : '추천 이유'}
                    {submissionMode === 'request' && <span className="text-red-500">*</span>}
                    {submissionMode === 'request' && <span className="text-muted-foreground text-xs ml-1">(10자 이상)</span>}
                </Label>
                <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder={submissionMode === 'new'
                        ? "쯔양이 이 맛집에 대해 한 리뷰 내용을 입력해주세요..."
                        : "이 맛집을 쯔양에게 추천하는 이유를 10자 이상 입력해주세요..."
                    }
                    className="min-h-[112px]"
                />
            </div>
        </div>
    );

    const renderReviewStep = () => (
        <div className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-4">
                <p className="text-sm font-semibold text-foreground">제출 전 확인</p>
                <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">유형</dt>
                        <dd>{submissionMode === 'new' ? '쯔양이 다녀간 맛집' : '쯔양에게 맛집 제보'}</dd>
                    </div>
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">상호</dt>
                        <dd className="break-words">{formData.restaurant_name || '-'}</dd>
                    </div>
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">주소</dt>
                        <dd className="break-words">{formData.address || '-'}</dd>
                    </div>
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">카테고리</dt>
                        <dd className="flex flex-wrap gap-1">
                            {formData.categories.length > 0
                                ? formData.categories.map((category) => <Badge key={category} variant="outline" className="text-xs">{category}</Badge>)
                                : '-'}
                        </dd>
                    </div>
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">영상</dt>
                        <dd className="min-w-0 break-all">{formData.youtube_link || (submissionMode === 'request' ? '선택 안 함' : '-')}</dd>
                    </div>
                    {formData.phone && (
                        <div className="flex gap-3">
                            <dt className="w-16 shrink-0 text-muted-foreground">전화</dt>
                            <dd className="break-words">{formData.phone}</dd>
                        </div>
                    )}
                    <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">
                            {submissionMode === 'new' ? '리뷰' : '추천'}
                        </dt>
                        <dd className="min-w-0 whitespace-pre-wrap break-words">
                            {formData.description.trim() || (submissionMode === 'new' ? '입력 안 함' : '-')}
                        </dd>
                    </div>
                </dl>
            </div>

            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-950 dark:bg-red-950/30 dark:text-red-100">
                제출 후에는 관리자 검토를 거쳐 지도에 반영돼요. 부정확한 주소나 중복 제보는 반려될 수 있습니다.
            </div>
        </div>
    );

    const renderMobileStepContent = () => {
        if (currentStep === 1) {
            return (
                <div className="space-y-4">
                    {renderModeSelector()}
                    {renderBasicFields()}
                </div>
            );
        }

        if (currentStep === 2) {
            return renderStoryFields();
        }

        return renderReviewStep();
    };

    const renderDesktopForm = () => (
        <form onSubmit={handleSubmit} className="space-y-4">
            {renderModeSelector()}
            {renderBasicFields()}
            {renderStoryFields()}
            <div className="pt-4">
                {renderValidationMessage()}
            </div>
            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    onClick={onClose}
                    className="flex-1"
                >
                    취소
                </Button>
                <Button
                    type="submit"
                    disabled={isPending}
                    className={`${mobileSheetStyles.primaryAction} flex-1`}
                >
                    <Send className="h-4 w-4 mr-2" />
                    {isPending ? '제출 중...' : submissionMode === 'new' ? '제보하기' : '추천하기'}
                </Button>
            </div>
        </form>
    );

    if (isMobileOrTablet) {
        return (
            <BottomSheet
                isOpen={isOpen}
                onClose={onClose}
                {...MOBILE_FULL_FORM_SHEET}
                layoutSource="restaurant-submission"
                className="z-[110]"
                ariaLabelledBy={mobileTitleId}
                ariaDescribedBy={validationMessage ? `${mobileDescriptionId} ${validationMessageId}` : mobileDescriptionId}
                focusTrapAllowSelectors={[]}
            >
                <form
                    ref={mobileFormRef}
                    onSubmit={handleSubmit}
                    className={mobileSheetStyles.frame}
                >
                    <div className={mobileSheetStyles.header}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-red-700 dark:text-red-300">
                                    {currentStep} / {RESTAURANT_SUBMISSION_STEPS.length} · {RESTAURANT_SUBMISSION_STEPS[currentStep - 1].title}
                                </p>
                                <h2 id={mobileTitleId} className="truncate text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                                    {title}
                                </h2>
                            </div>
                            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="제보 닫기">
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                        <p id={mobileDescriptionId} className="text-sm text-muted-foreground">{description}</p>
                        <div className="mt-3 grid grid-cols-3 gap-1.5" aria-label="제보 단계 진행률">
                            {RESTAURANT_SUBMISSION_STEPS.map((step) => (
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
                                <Button type="button" variant="outline" onClick={handlePreviousStep} className="min-w-24">
                                    <ChevronLeft className="mr-1 h-4 w-4" />
                                    이전
                                </Button>
                            ) : (
                                <Button type="button" variant="outline" onClick={onClose} className="min-w-24">
                                    취소
                                </Button>
                            )}
                            {currentStep < 3 ? (
                                <Button key={`next-${currentStep}`} type="button" onClick={handleNextStep} className={`${mobileSheetStyles.primaryAction} flex-1`}>
                                    다음
                                </Button>
                            ) : (
                                <Button key="submit" type="submit" disabled={isPending} className={`${mobileSheetStyles.primaryAction} flex-1`}>
                                    <Send className="mr-2 h-4 w-4" />
                                    {isPending ? '제출 중...' : submissionMode === 'new' ? '제보하기' : '추천하기'}
                                </Button>
                            )}
                        </div>
                    </div>
                </form>
            </BottomSheet>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 rounded-xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                <DialogHeader className="relative">
                    <div className="absolute -top-1 left-0">{draftStatus}</div>
                    <div className="flex items-start justify-between gap-2 pt-3">
                        <div className="flex-1">
                            <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                                {title}
                            </DialogTitle>
                            <DialogDescription>{description}</DialogDescription>
                        </div>
                    </div>
                </DialogHeader>
                {renderDesktopForm()}
            </DialogContent>
        </Dialog>
    );
}
