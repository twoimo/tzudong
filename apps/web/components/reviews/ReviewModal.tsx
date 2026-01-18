import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import imageCompression from "browser-image-compression";
import { saveDraft, getDraft, deleteDraft } from "@/lib/reviewDraftDB";

// 음식 사진용 압축 옵션 (스토리지 최적화)
const FOOD_PHOTO_OPTIONS = {
    maxSizeMB: 0.3,           // 최대 300KB
    maxWidthOrHeight: 1200,   // 최대 1200px
    fileType: "image/webp" as const,
    useWebWorker: true,
};



// 안전한 랜덤 파일명 생성 유틸리티 (한글 파일명 문제 해결)
const generateSafeFilename = (extension: string = ".webp"): string => {
    const randomString = Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();
    return `${timestamp}_${randomString}${extension}`;
};

// 영수증 이미지 준비 (OCR 정확도 유지, 너무 큰 파일만 리사이즈)
// OCR 후 서버에서 WebP로 압축됨
const prepareReceiptImage = async (file: File): Promise<File> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeFileName = generateSafeFilename(`.${ext}`);

    // 5MB 초과 시에만 리사이즈 (품질 손실 최소화)
    if (file.size > 5 * 1024 * 1024) {
        try {
            const resizedBlob = await imageCompression(file, {
                maxSizeMB: 5,
                maxWidthOrHeight: 3000,  // 고해상도 유지
                fileType: file.type as "image/jpeg" | "image/png" | "image/webp",
                initialQuality: 1.0,     // 품질 손실 없음
                useWebWorker: true,
            });
            return new File([resizedBlob], safeFileName, { type: file.type });
        } catch (error) {
            console.warn("영수증 리사이즈 실패, 원본 사용:", error);
        }
    }

    // 5MB 이하는 원본 그대로
    return new File([file], safeFileName, { type: file.type });
};

// 음식 사진 압축 (WebP - 스토리지 최적화)
const compressFoodImage = async (file: File): Promise<File> => {
    try {
        const compressedBlob = await imageCompression(file, FOOD_PHOTO_OPTIONS);
        const safeFileName = generateSafeFilename(".webp");
        return new File([compressedBlob], safeFileName, { type: "image/webp" });
    } catch (error) {
        console.warn("음식 사진 압축 실패, 원본 사용:", error);
        return file;
    }
};
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, X as XIcon, Loader2, CircleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { ReviewVerificationGuide } from "./form/ReviewVerificationGuide";
import { ReviewVerificationUpload } from "./form/ReviewVerificationUpload";
import { ReviewRestaurantSearch } from "./form/ReviewRestaurantSearch";
import { ReviewDateSelection } from "./form/ReviewDateSelection";
import { ReviewCategorySelect } from "./form/ReviewCategorySelect";
import { ReviewFoodPhotoUpload } from "./form/ReviewFoodPhotoUpload";
import { ReviewContentInput } from "./form/ReviewContentInput";
import { REVIEW_CATEGORIES, ReviewCategory } from "./constants";

interface ReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant: { id: string; name: string } | null;
    onSuccess?: () => void;
    inline?: boolean; // Dialog 없이 콘텐츠만 렌더링 (데스크톱 나란히 배치용)
}


interface OCRItem {
    name: string;
    price: number | null;
}

export interface OCRResult {
    store_name?: string;
    date?: string;
    time?: string;
    items?: OCRItem[];
    total_amount?: number;
    category?: string;
    review_draft?: string;
    confidence?: number;
}

export function ReviewModal({ isOpen, onClose, restaurant, onSuccess, inline = false }: ReviewModalProps) {
    const { user } = useAuth();
    const [visitedDate, setVisitedDate] = useState("");
    const [visitedTime, setVisitedTime] = useState("");
    const [categories, setCategories] = useState<ReviewCategory[]>([]);
    const [content, setContent] = useState("");
    const [verificationPhoto, setVerificationPhoto] = useState<File | null>(null);
    const [foodPhotos, setFoodPhotos] = useState<File[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

    // OCR 분석 상태
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // 맛집 검색 상태
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<{ id: string; name: string }[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<{ id: string; name: string } | null>(restaurant);


    // 맛집 검색 핸들러
    const handleSearchRestaurant = useCallback(async (query: string) => {
        if (query.trim().length < 2) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, name')
                .ilike('name', `%${query}%`)
                .limit(10) as any;

            if (error) throw error;
            setSearchResults(data || []);
        } catch (error) {
            console.error('맛집 검색 실패:', error);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    }, []);

    // 검색어 디바운스
    useEffect(() => {
        const timer = setTimeout(() => {
            handleSearchRestaurant(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery, handleSearchRestaurant]);

    // 맛집 정보가 변경되면 선택된 맛집 업데이트
    useEffect(() => {
        if (restaurant) {
            setSelectedRestaurant(restaurant);
        }
    }, [restaurant]);

    // 모달 닫기 핸들러
    const handleClose = useCallback(() => {
        setVisitedDate("");
        setVisitedTime("");
        setCategories([]);
        setContent("");
        setVerificationPhoto(null);
        setFoodPhotos([]);
        onClose();
    }, [onClose]);

    // 임시 저장 데이터 삭제 (IndexedDB)
    const clearDraft = useCallback(async () => {
        const targetRestaurantId = selectedRestaurant?.id || restaurant?.id;
        if (!user?.id || !targetRestaurantId) return;

        try {
            await deleteDraft(user.id, targetRestaurantId);
            setLastSavedAt(null);
        } catch (error) {
            console.error('임시 저장 데이터 삭제 실패:', error);
        }
    }, [user?.id, selectedRestaurant?.id, restaurant?.id]);

    // 임시 저장된 데이터 불러오기 (IndexedDB)
    const loadDraft = useCallback(async () => {
        const targetRestaurantId = selectedRestaurant?.id || restaurant?.id;
        if (!user?.id || !targetRestaurantId) return;

        try {
            const draft = await getDraft(user.id, targetRestaurantId);
            if (draft) {
                setVisitedDate(draft.visitedDate);
                setVisitedTime(draft.visitedTime);
                setCategories(draft.categories as ReviewCategory[]);
                setContent(draft.content);

                // 사진 복원
                if (draft.verificationPhoto) {
                    setVerificationPhoto(draft.verificationPhoto);
                }
                if (draft.foodPhotos && draft.foodPhotos.length > 0) {
                    setFoodPhotos(draft.foodPhotos);
                }

                setLastSavedAt(new Date(draft.savedAt));
            }
        } catch (error) {
            console.error('임시 저장 데이터 로드 실패:', error);
        }
    }, [user?.id, selectedRestaurant?.id, restaurant?.id]);

    // 자동 저장 (IndexedDB)
    const autoSave = useCallback(async () => {
        const targetRestaurantId = selectedRestaurant?.id || restaurant?.id;
        if (!user?.id || !targetRestaurantId) return;

        // 내용이 하나라도 있을 때만 저장 (빈 문자열이라도 저장 - 지운 경우 대응)
        // 모든 필드가 초기값인 경우에만 저장 스킵
        const hasAnyContent = visitedDate || visitedTime || categories.length > 0 || content || verificationPhoto || foodPhotos.length > 0;
        if (!hasAnyContent) {
            return;
        }

        try {
            setIsSaving(true);
            await saveDraft({
                userId: user.id,
                restaurantId: targetRestaurantId,
                visitedDate,
                visitedTime,
                categories,
                content,
                verificationPhoto,
                foodPhotos,
            });
            setLastSavedAt(new Date());
        } catch (error) {
            console.error('자동 저장 실패:', error);
        } finally {
            setIsSaving(false);
        }
    }, [user?.id, selectedRestaurant?.id, restaurant?.id, visitedDate, visitedTime, categories, content, verificationPhoto, foodPhotos]);

    // 폼 유효성 검사 메모이제이션 (리뷰 내용 최소 20자)
    const isFormValid = useMemo(() => {
        const targetRestaurant = selectedRestaurant || restaurant;
        return visitedDate && visitedTime && targetRestaurant?.id && categories.length > 0 && content.trim().length >= 20 && verificationPhoto && foodPhotos.length > 0;
    }, [visitedDate, visitedTime, selectedRestaurant, restaurant, categories.length, content, verificationPhoto, foodPhotos.length]);

    // OCR 분석 실행 (모달 내부에서 처리)
    const analyzeReceipt = useCallback(async (file: File) => {
        // 1. 캐싱 키 생성 (파일 메타데이터 + 크기 기반)
        const fileKey = `ocr_cache_${file.name}_${file.size}_${file.lastModified}`;

        setIsAnalyzing(true);
        try {
            let data: OCRResult;

            // 2. 세션 스토리지에서 캐시 확인
            const cachedData = sessionStorage.getItem(fileKey);

            if (cachedData) {
                data = JSON.parse(cachedData);
            } else {
                // 3. 캐시가 없으면 API 호출
                const formData = new FormData();
                formData.append('image', file);

                const response = await fetch('/api/ocr/analyze', {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'OCR 분석 실패');
                }

                data = await response.json();

                // 4. 결과 캐싱 (세션 스토리지에 저장)
                try {
                    sessionStorage.setItem(fileKey, JSON.stringify(data));
                } catch (e) {
                    console.error("OCR 결과 캐싱 실패", e);
                    // 쿼터 초과 등의 경우 무시
                }
            }

            let autoFilledParts: string[] = [];

            // 1. 맛집 자동 검색 및 설정
            if (data.store_name && !selectedRestaurant && !restaurant) {
                const { data: restaurants, error } = await supabase
                    .from('restaurants')
                    .select('id, name')
                    .eq('name', data.store_name) // 정확한 일치 우선 검색
                    .limit(1) as any;

                if (!error && restaurants && restaurants.length > 0) {
                    setSelectedRestaurant(restaurants[0]);
                    autoFilledParts.push("맛집");
                } else {
                    // 정확한 일치가 없으면 검색어로 설정하여 목록 노출 유도
                    setSearchQuery(data.store_name);
                    // 검색 결과가 나오도록 잠시 대기 후 토스트 메시지 (useEffect에 의해 검색 실행됨)
                    toast({
                        title: "맛집을 선택해주세요",
                        description: `'${data.store_name}' 검색 결과를 확인하고 선택해주세요.`,
                    });
                }
            } else if (data.store_name && (selectedRestaurant || restaurant)) {
                // 이미 선택된 경우 검증만 수행
                const currentName = selectedRestaurant?.name || restaurant?.name || "";
                if (!currentName.includes(data.store_name) && !data.store_name.includes(currentName)) {
                    toast({
                        title: "정보 불일치 주의",
                        description: `선택된 맛집(${currentName})과 영수증(${data.store_name})이 달라 보입니다.`,
                        variant: "destructive"
                    });
                }
            }

            // 2. 날짜 및 시간
            if (data.date) {
                setVisitedDate(data.date);
                autoFilledParts.push("방문일");
            }
            if (data.time) {
                setVisitedTime(data.time);
                autoFilledParts.push("시간");
            }

            // 3. 카테고리
            if (data.category) {
                // 카테고리 유효성 검사
                const validCategory = REVIEW_CATEGORIES.find(c => c === data.category);
                if (validCategory) {
                    setCategories([validCategory]);
                    autoFilledParts.push("카테고리");
                }
            }

            // 4. 리뷰 내용 (자동 생성된 초안 사용)
            if (data.review_draft) {
                setContent(data.review_draft);
                autoFilledParts.push("리뷰 내용");
            } else if (data.items && data.items.length > 0) {
                // 초안이 없으면 기존 방식대로 메뉴 목록 추가
                const menuText = data.items.map(item => `- ${item.name}: ${item.price?.toLocaleString() || 0}원`).join('\\n');
                const totalText = data.total_amount ? `\\n총 결제금액: ${data.total_amount.toLocaleString()}원` : '';
                // 함수형 업데이트를 사용하여 content 의존성 제거
                setContent(prevContent => prevContent ? `${prevContent}\\n\\n[영수증 메뉴]\\n${menuText}${totalText}` : `[영수증 메뉴]\\n${menuText}${totalText}`);
            }

            // 결과 리포트
            if (autoFilledParts.length > 0) {
                toast({
                    title: "스마트 스캔 완료! ✨",
                    description: `${autoFilledParts.join(', ')} 정보가 자동으로 입력되었습니다.`,
                });
            } else {
                toast({
                    title: "스마트 스캔 완료",
                    description: "영수증을 분석했으나 자동 입력할 정보를 찾지 못했습니다.",
                });
            }

        } catch (error) {
            console.error("OCR 오류:", error);
            toast({
                title: "스마트 스캔 실패",
                description: "영수증을 분석하지 못했습니다. 직접 입력해주세요.",
                variant: "destructive"
            });
        } finally {
            setIsAnalyzing(false);
        }
    }, [selectedRestaurant, restaurant]); // content 의존성 제거 (함수형 업데이트 사용)
    const handleSubmit = useCallback(async () => {
        const targetRestaurant = selectedRestaurant || restaurant;
        // 필수 항목 검증
        if (!visitedDate || !visitedTime || !targetRestaurant?.id || categories.length === 0 || !content || !verificationPhoto || foodPhotos.length === 0) {
            toast({
                title: "필수 항목 누락",
                description: "모든 필수 항목을 입력해주세요",
                variant: "destructive",
            });
            return;
        }

        // 리뷰 내용 길이 검증 (최소 20자)
        if (content.trim().length < 20) {
            toast({
                title: "리뷰 내용이 너무 짧습니다",
                description: "최소 20자 이상 작성해주세요 (현재 " + content.trim().length + "자)",
                variant: "destructive",
            });
            return;
        }

        if (!user) {
            toast({
                title: "로그인 필요",
                description: "리뷰를 작성하려면 로그인이 필요합니다",
                variant: "destructive",
            });
            return;
        }

        if (!targetRestaurant) {
            toast({
                title: "맛집 정보 오류",
                description: "맛집을 선택해주세요.",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);

        try {
            // 1. 이미지 준비 (영수증은 원본 유지, 음식 사진은 WebP 압축)
            const [preparedVerificationPhoto, ...compressedFoodPhotos] = await Promise.all([
                prepareReceiptImage(verificationPhoto),  // 원본 유지 (OCR 후 서버에서 압축)
                ...foodPhotos.map((photo: File) => compressFoodImage(photo))  // 스토리지 최적화 WebP
            ]);

            // 2. 인증 사진 업로드
            const verificationPhotoPath = `${user.id}/${Date.now()}_verification_${preparedVerificationPhoto.name}`;
            const { error: verificationUploadError } = await supabase.storage
                .from('review-photos')
                .upload(verificationPhotoPath, preparedVerificationPhoto, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (verificationUploadError) {
                throw new Error(`인증 사진 업로드 실패: ${verificationUploadError.message}`);
            }

            // 3. 음식 사진 병렬 업로드 (성능 최적화)
            const uploadTimestamp = Date.now();
            const foodPhotoUploadPromises = compressedFoodPhotos.map(async (compressedPhoto, i) => {
                const photoPath = `${user.id}/${uploadTimestamp}_food_${i}_${compressedPhoto.name}`;
                const { error: foodUploadError } = await supabase.storage
                    .from('review-photos')
                    .upload(photoPath, compressedPhoto, {
                        cacheControl: '3600',
                        upsert: false
                    });

                if (foodUploadError) {
                    throw new Error(`음식 사진 업로드 실패: ${foodUploadError.message}`);
                }

                return photoPath;
            });

            const uploadedFoodPhotoPaths = await Promise.all(foodPhotoUploadPromises);

            // 4. 리뷰 레코드 생성
            // 시간 형식 처리 및 검증
            let visitedAtDateTime: string;
            try {
                // 시간이 HH:MM 형식인 경우 초 추가
                const timeParts = visitedTime.split(':');
                const timeWithSeconds = timeParts.length === 2
                    ? `${visitedTime}:00`
                    : visitedTime;

                // ISO 8601 형식으로 조합
                visitedAtDateTime = `${visitedDate}T${timeWithSeconds}`;

                // 유효성 검증
                const testDate = new Date(visitedAtDateTime);
                if (isNaN(testDate.getTime())) {
                    throw new Error("유효하지 않은 날짜/시간 형식입니다");
                }
            } catch (error) {
                throw new Error(`날짜/시간 형식 오류: ${visitedDate} ${visitedTime}`);
            }

            // 타입 안전성을 위한 검증
            if (categories.length === 0) {
                throw new Error("카테고리를 선택해주세요");
            }

            const { error: insertError } = await (supabase
                .from('reviews') as any)
                .insert({
                    user_id: user.id,
                    restaurant_id: targetRestaurant.id,
                    title: `${targetRestaurant.name} 방문 후기`,
                    content: content.trim(),
                    visited_at: visitedAtDateTime,
                    verification_photo: verificationPhotoPath,
                    food_photos: uploadedFoodPhotoPaths,
                    categories: categories,
                    is_verified: false, // 관리자 검토 대기
                });

            if (insertError) {
                throw new Error(`리뷰 등록 실패: ${insertError.message}`);
            }

            // 임시 저장 데이터 삭제
            clearDraft();

            toast({
                title: "리뷰 등록 완료! 🎉",
                description: "소중한 리뷰가 등록되었습니다. 관리자 승인 후 스탬프가 지급됩니다.",
            });



            if (onSuccess) {
                onSuccess();
            }
            handleClose();
        } catch (error) {
            console.error('리뷰 제출 오류:', error);
            const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다";
            toast({
                title: "리뷰 등록 실패",
                description: errorMessage,
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    }, [selectedRestaurant, restaurant, visitedDate, visitedTime, categories, content, verificationPhoto, foodPhotos, user, onSuccess, handleClose, clearDraft]); // DRAFT_KEY는 로컬 상수이므로 의존성 제외 (혹은 포함 필요 시 컴포넌트 밖으로 이동)



    // 디바운스된 자동 저장 (500ms)
    useEffect(() => {
        if (!isOpen) return;
        const targetRestaurantId = selectedRestaurant?.id || restaurant?.id;
        if (!targetRestaurantId) return;

        const timer = setTimeout(() => {
            autoSave();
        }, 500);

        return () => clearTimeout(timer);
    }, [isOpen, selectedRestaurant?.id, restaurant?.id, visitedDate, visitedTime, categories, content, verificationPhoto, foodPhotos, autoSave]);

    // 모달이 열릴 때 임시 저장된 데이터 확인
    useEffect(() => {
        if (isOpen && user?.id && restaurant?.id) {
            loadDraft();
        }
    }, [isOpen, user?.id, restaurant?.id, loadDraft]);
    // inline 모드: Dialog 없이 콘텐츠만 렌더링
    if (inline) {
        return (
            <div className="flex flex-col h-full overflow-hidden">
                {/* 헤더 */}
                <div className="px-6 pt-6 pb-4 border-b relative shrink-0">
                    {lastSavedAt && (
                        <div className="absolute top-1.5 left-6 flex items-center gap-1 text-[10px] text-muted-foreground">
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
                            <h2 className="text-2xl font-semibold bg-gradient-primary bg-clip-text text-transparent">
                                쯔동여지도 리뷰 작성
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                맛집 방문 후기를 공유해주세요
                            </p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 rounded-full hover:bg-muted">
                            <XIcon className="h-5 w-5" />
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4">
                    <div className="space-y-6">


                        <ReviewVerificationGuide />

                        <ReviewVerificationUpload
                            photo={verificationPhoto}
                            onPhotoSelect={(file) => {
                                setVerificationPhoto(file);
                                analyzeReceipt(file);
                            }}
                            onPhotoRemove={() => setVerificationPhoto(null)}
                            isAnalyzing={isAnalyzing}
                        />

                        <div className="space-y-6 relative rounded-xl transition-all">
                            <ReviewRestaurantSearch
                                selectedRestaurant={selectedRestaurant}
                                initialRestaurant={restaurant}
                                searchQuery={searchQuery}
                                setSearchQuery={setSearchQuery}
                                searchResults={searchResults}
                                isSearching={isSearching}
                                onSelectRestaurant={(res) => {
                                    setSelectedRestaurant(res);
                                    setSearchQuery("");
                                    setSearchResults([]);
                                }}
                                onClearRestaurant={() => {
                                    setSelectedRestaurant(null);
                                    setSearchQuery("");
                                }}
                            />

                            <ReviewDateSelection
                                visitedDate={visitedDate}
                                setVisitedDate={setVisitedDate}
                                visitedTime={visitedTime}
                                setVisitedTime={setVisitedTime}
                                idPrefix="inline"
                            />

                            <ReviewCategorySelect
                                categories={categories}
                                setCategories={setCategories}
                                idPrefix="inline"
                            />

                            <ReviewFoodPhotoUpload
                                photos={foodPhotos}
                                onPhotosSelected={(files) => {
                                    requestAnimationFrame(() => {
                                        setFoodPhotos(prev => [...prev, ...files]);
                                    });
                                }}
                                onPhotoRemove={(index) => {
                                    setFoodPhotos(prev => prev.filter((_, i) => i !== index));
                                }}
                            />

                            <ReviewContentInput
                                content={content}
                                setContent={setContent}
                                idPrefix="inline"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between px-6 py-4 border-t border-border bg-muted/50 gap-3 sm:gap-0 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <div className="flex items-center justify-center sm:justify-start gap-4">
                        <div className="text-xs text-muted-foreground">
                            {isFormValid ? (
                                <span className="text-green-600 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    모든 필수 항목이 입력되었습니다
                                </span>
                            ) : (
                                <span className="text-amber-600 flex items-center gap-1">
                                    <CircleAlert className="h-3 w-3" />
                                    필수 항목을 모두 입력해주세요
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none">
                            취소
                        </Button>
                        <Button onClick={handleSubmit} disabled={!isFormValid || isSubmitting} className="bg-gradient-primary flex-1 sm:flex-none">
                            {isSubmitting ? "등록 중..." : "리뷰 등록"}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <Dialog open={isOpen} onOpenChange={handleClose}>
                {isOpen && (
                    <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 rounded-xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                        <DialogHeader className="relative space-y-3">
                            {/* 자동 저장 상태 표시 - 좌측 상단 */}
                            {lastSavedAt && (
                                <div className="absolute top-1.5 left-6 flex items-center gap-1 text-[10px] text-muted-foreground">
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
                                        쯔동여지도 리뷰 작성
                                    </DialogTitle>
                                    <DialogDescription>
                                        맛집 방문 후기를 공유해주세요
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        <div className="space-y-6 mt-2">
                            <div className="space-y-6">
                                <ReviewVerificationGuide />

                                <ReviewVerificationUpload
                                    photo={verificationPhoto}
                                    onPhotoSelect={(file) => {
                                        setVerificationPhoto(file);
                                        analyzeReceipt(file);
                                    }}
                                    onPhotoRemove={() => setVerificationPhoto(null)}
                                    isAnalyzing={isAnalyzing}
                                />

                                <ReviewRestaurantSearch
                                    selectedRestaurant={selectedRestaurant}
                                    initialRestaurant={restaurant}
                                    searchQuery={searchQuery}
                                    setSearchQuery={setSearchQuery}
                                    searchResults={searchResults}
                                    isSearching={isSearching}
                                    onSelectRestaurant={(res) => {
                                        setSelectedRestaurant(res);
                                        setSearchQuery("");
                                        setSearchResults([]);
                                    }}
                                    onClearRestaurant={() => {
                                        setSelectedRestaurant(null);
                                        setSearchQuery("");
                                    }}
                                />

                                <ReviewDateSelection
                                    visitedDate={visitedDate}
                                    setVisitedDate={setVisitedDate}
                                    visitedTime={visitedTime}
                                    setVisitedTime={setVisitedTime}
                                    idPrefix="dialog"
                                />

                                <ReviewCategorySelect
                                    categories={categories}
                                    setCategories={setCategories}
                                    idPrefix="dialog"
                                />

                                <ReviewFoodPhotoUpload
                                    photos={foodPhotos}
                                    onPhotosSelected={(files) => {
                                        requestAnimationFrame(() => {
                                            setFoodPhotos(prev => [...prev, ...files]);
                                        });
                                    }}
                                    onPhotoRemove={(index) => {
                                        setFoodPhotos(prev => prev.filter((_, i) => i !== index));
                                    }}
                                />

                                <ReviewContentInput
                                    content={content}
                                    setContent={setContent}
                                    idPrefix="dialog"
                                />
                            </div>
                        </div>

                        {isSubmitting && (
                            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
                                <div className="flex flex-col items-center gap-4">
                                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                    <p className="text-lg font-medium">리뷰 등록 중...</p>
                                    <p className="text-sm text-muted-foreground">잠시만 기다려주세요.</p>
                                </div>
                            </div>
                        )}

                        {/* 푸터 */}
                        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between pt-4 gap-3 sm:gap-0">
                            <div className="flex items-center justify-center sm:justify-start gap-4">
                                {/* 폼 유효성 상태 */}
                                <div className="text-xs text-muted-foreground">
                                    {isFormValid ? (
                                        <span className="text-green-600 flex items-center gap-1">
                                            <CheckCircle2 className="h-3 w-3" />
                                            모든 필수 항목이 입력되었습니다
                                        </span>
                                    ) : (
                                        <span className="text-amber-600 flex items-center gap-1">
                                            <CircleAlert className="h-3 w-3" />
                                            필수 항목을 모두 입력해주세요
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={handleClose}
                                    disabled={isSubmitting}
                                    className="flex-1 sm:flex-none"
                                >
                                    취소
                                </Button>
                                <Button
                                    onClick={handleSubmit}
                                    disabled={!isFormValid || isSubmitting}
                                    className="bg-gradient-primary flex-1 sm:flex-none"
                                >
                                    {isSubmitting ? "등록 중..." : "리뷰 등록"}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                )}
            </Dialog >
        </>
    );
}
