'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { X, Send, CheckCircle2 } from "lucide-react";
import { RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { saveDraft, getDraft, deleteDraft } from "@/lib/submissionDraftDB";

interface RestaurantSubmissionModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function RestaurantSubmissionModal({
    isOpen,
    onClose,
}: RestaurantSubmissionModalProps) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [submissionMode, setSubmissionMode] = useState<'new' | 'request'>('new');
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

    // 모달 열릴 때 초기화
    useEffect(() => {
        if (isOpen) {
            resetForm();
        }
    }, [isOpen, submissionMode]);

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
                } as any)
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
                } as any);

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
        onError: (error: any) => {
            toast.error(error.message || '제보 제출에 실패했습니다');
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
                } as any);

            if (error) throw error;
        },
        onSuccess: async () => {
            await clearDraft();
            toast.success('맛집 추천이 성공적으로 제출되었습니다!');
            queryClient.invalidateQueries({ queryKey: ['my-requests'] });
            onClose();
            resetForm();
        },
        onError: (error: any) => {
            toast.error(error.message || '추천 제출에 실패했습니다');
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

        // 기본 필수 항목 검증
        if (!formData.restaurant_name.trim() || !formData.address.trim() || formData.categories.length === 0) {
            toast.error('맛집 이름, 주소, 카테고리는 필수입니다');
            return;
        }

        if (submissionMode === 'new') {
            // new 모드: 유튜브 링크 필수
            if (!formData.youtube_link.trim()) {
                toast.error('유튜브 영상 링크를 입력해주세요');
                return;
            }
            // URL 형식 검증
            if (!formData.youtube_link.trim().match(/^https?:\/\//)) {
                toast.error('유효한 유튜브 링크를 입력해주세요');
                return;
            }
            submitNewMutation.mutate(formData);
        } else {
            // request 모드: 추천 이유 필수 (10자 이상)
            if (!formData.description.trim() || formData.description.trim().length < 10) {
                toast.error('추천 이유를 10자 이상 입력해주세요');
                return;
            }
            submitRequestMutation.mutate(formData);
        }
    };

    const isPending = submitNewMutation.isPending || submitRequestMutation.isPending;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-xl">
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
                                {submissionMode === 'new' ? '쯔동여지도 제보하기' : '쯔양에게 맛집 제보하기'}
                            </DialogTitle>
                            <DialogDescription>
                                {submissionMode === 'new'
                                    ? '쯔양이 이미 다녀간 맛집 정보와 유튜브 영상 링크를 알려주세요'
                                    : '쯔양에게 방문을 추천하고 싶은 맛집 정보를 알려주세요'
                                }
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {/* 모드 선택 */}
                <div className="flex gap-2 mb-4">
                    <Button
                        type="button"
                        variant={submissionMode === 'new' ? 'default' : 'outline'}
                        onClick={() => setSubmissionMode('new')}
                        className="flex-1"
                    >
                        쯔양이 다녀간 맛집
                    </Button>
                    <Button
                        type="button"
                        variant={submissionMode === 'request' ? 'default' : 'outline'}
                        onClick={() => setSubmissionMode('request')}
                        className="flex-1"
                    >
                        쯔양에게 맛집 제보
                    </Button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
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

                    <div className="space-y-2">
                        <Label>
                            카테고리 <span className="text-red-500">*</span>
                        </Label>

                        {/* 선택된 카테고리 */}
                        {formData.categories.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 p-3 bg-muted/50 rounded-lg border">
                                {formData.categories.map((category) => (
                                    <Badge key={category} variant="secondary" className="text-xs">
                                        {category}
                                        <button
                                            type="button"
                                            onClick={() => setFormData({
                                                ...formData,
                                                categories: formData.categories.filter(c => c !== category)
                                            })}
                                            className="ml-1.5 hover:bg-destructive/20 rounded-full p-0.5"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                        )}

                        {/* 빠른 선택 */}
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

                        {/* 직접 입력 */}
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
                                className="flex-1 h-9"
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
                            className="min-h-[80px]"
                        />
                    </div>

                    <div className="flex gap-2 pt-4">
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
                            className="flex-1 bg-red-800 hover:bg-red-900"
                        >
                            <Send className="h-4 w-4 mr-2" />
                            {isPending ? '제출 중...' : submissionMode === 'new' ? '제보하기' : '추천하기'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
