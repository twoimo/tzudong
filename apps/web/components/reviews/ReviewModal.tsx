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

// 영수증 인증 사진용 압축 옵션 (OCR 정확도를 위해 고품질 유지)
const RECEIPT_PHOTO_OPTIONS = {
    maxSizeMB: 1.0,           // 최대 1MB (OCR 정확도 확보)
    maxWidthOrHeight: 2000,   // 더 높은 해상도 유지
    fileType: "image/jpeg" as const,  // JPEG 사용 (OpenCV 호환성 향상)
    initialQuality: 0.92,     // 높은 품질 유지
    useWebWorker: true,
};

// 안전한 랜덤 파일명 생성 유틸리티 (한글 파일명 문제 해결)
const generateSafeFilename = (extension: string = ".webp"): string => {
    const randomString = Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();
    return `${timestamp}_${randomString}${extension}`;
};

// 영수증 이미지 압축 (고품질 JPEG - OCR 정확도 우선)
const compressReceiptImage = async (file: File): Promise<File> => {
    try {
        const compressedBlob = await imageCompression(file, RECEIPT_PHOTO_OPTIONS);
        const safeFileName = generateSafeFilename(".jpg");
        return new File([compressedBlob], safeFileName, { type: "image/jpeg" });
    } catch (error) {
        console.warn("영수증 이미지 압축 실패, 원본 사용:", error);
        return file;
    }
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar, Upload, X as XIcon, AlertCircle, CheckCircle2, Image, Trash2, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant: { id: string; name: string } | null;
    onSuccess?: () => void;
}

const CATEGORIES = [
    "치킨",
    "중식",
    "돈까스·회",
    "피자",
    "패스트푸드",
    "찜·탕",
    "족발·보쌈",
    "분식",
    "카페·디저트",
    "한식",
    "고기",
    "양식",
    "아시안",
    "야식",
    "도시락",
] as const;

type Category = typeof CATEGORIES[number];

export function ReviewModal({ isOpen, onClose, restaurant, onSuccess }: ReviewModalProps) {
    const { user } = useAuth();
    const [visitedDate, setVisitedDate] = useState("");
    const [visitedTime, setVisitedTime] = useState("");
    const [categories, setCategories] = useState<Category[]>([]);
    const [content, setContent] = useState("");
    const [verificationPhoto, setVerificationPhoto] = useState<File | null>(null);
    const [foodPhotos, setFoodPhotos] = useState<File[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

    // 드래그 앤 드롭을 위한 ref들
    const verificationDropRef = useRef<HTMLDivElement>(null);
    const foodPhotosDropRef = useRef<HTMLDivElement>(null);
    const verificationFileInputRef = useRef<HTMLInputElement>(null);
    const foodPhotosFileInputRef = useRef<HTMLInputElement>(null);

    // 드래그 상태
    const [isVerificationDragging, setIsVerificationDragging] = useState(false);
    const [isFoodPhotosDragging, setIsFoodPhotosDragging] = useState(false);

    // 이미지 미리보기 URL 메모리 관리 (URL.createObjectURL 정리)
    const verificationPhotoUrl = useMemo(() => {
        if (verificationPhoto) {
            return URL.createObjectURL(verificationPhoto);
        }
        return null;
    }, [verificationPhoto]);

    const foodPhotoUrls = useMemo(() => {
        return foodPhotos.map(photo => URL.createObjectURL(photo));
    }, [foodPhotos]);

    // URL 정리 (메모리 누수 방지)
    useEffect(() => {
        return () => {
            if (verificationPhotoUrl) {
                URL.revokeObjectURL(verificationPhotoUrl);
            }
        };
    }, [verificationPhotoUrl]);

    useEffect(() => {
        return () => {
            foodPhotoUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [foodPhotoUrls]);

    // 메모이제이션된 이벤트 핸들러들
    const handleVerificationPhotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setVerificationPhoto(file);
        }
    }, []);

    const handleFoodPhotosChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        setFoodPhotos(prev => [...prev, ...files]);
    }, []);

    const removeFoodPhoto = useCallback((index: number) => {
        setFoodPhotos(prev => prev.filter((_, i) => i !== index));
    }, []);

    // 드래그 앤 드롭 핸들러들 (useCallback으로 메모이제이션)
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleVerificationDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsVerificationDragging(true);
    }, []);

    const handleVerificationDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsVerificationDragging(false);
    }, []);

    const handleVerificationDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsVerificationDragging(false);

        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(file => file.type.startsWith('image/'));

        if (imageFiles.length > 0) {
            setVerificationPhoto(imageFiles[0]);
        }
    }, []);

    const handleFoodPhotosDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsFoodPhotosDragging(true);
    }, []);

    const handleFoodPhotosDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsFoodPhotosDragging(false);
    }, []);

    const handleFoodPhotosDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsFoodPhotosDragging(false);

        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(file => file.type.startsWith('image/'));

        if (imageFiles.length > 0) {
            setFoodPhotos(prev => [...prev, ...imageFiles]);
        }
    }, []);

    // 파일 선택기 열기 함수들 (useCallback으로 메모이제이션)
    const openVerificationFileDialog = useCallback(() => {
        verificationFileInputRef.current?.click();
    }, []);

    const openFoodPhotosFileDialog = useCallback(() => {
        foodPhotosFileInputRef.current?.click();
    }, []);

    const handleSubmit = async () => {
        // 필수 항목 검증
        if (!visitedDate || !visitedTime || !restaurant?.id || categories.length === 0 || !content || !verificationPhoto || foodPhotos.length === 0) {
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

        if (!restaurant) {
            toast({
                title: "맛집 정보 오류",
                description: "맛집 정보를 찾을 수 없습니다. 맛집 상세 페이지에서 리뷰 작성 버튼을 눌러주세요.",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);

        try {
            // 1. 이미지 압축 (영수증은 고품질 JPEG, 음식 사진은 WebP)
            const [compressedVerificationPhoto, ...compressedFoodPhotos] = await Promise.all([
                compressReceiptImage(verificationPhoto),  // OCR 정확도를 위해 고품질 JPEG
                ...foodPhotos.map((photo: File) => compressFoodImage(photo))  // 스토리지 최적화 WebP
            ]);

            // 2. 인증 사진 업로드
            const verificationPhotoPath = `${user.id}/${Date.now()}_verification_${compressedVerificationPhoto.name}`;
            const { error: verificationUploadError } = await supabase.storage
                .from('review-photos')
                .upload(verificationPhotoPath, compressedVerificationPhoto, {
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

            // 4. Create review record
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
                    restaurant_id: restaurant.id,
                    title: `${restaurant.name} 방문 후기`,
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
                title: "리뷰 등록 성공! 🎉",
                description: "관리자 검토 후 공개됩니다. 소중한 후기 감사합니다!",
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
    };

    const handleClose = useCallback(() => {
        setVisitedDate("");
        setVisitedTime("");
        setCategories([]);
        setContent("");
        setVerificationPhoto(null);
        setFoodPhotos([]);
        onClose();
    }, [onClose]);

    // 폼 유효성 검사 메모이제이션 (리뷰 내용 최소 20자)
    const isFormValid = useMemo(() => {
        return visitedDate && visitedTime && restaurant?.id && categories.length > 0 && content.trim().length >= 20 && verificationPhoto && foodPhotos.length > 0;
    }, [visitedDate, visitedTime, restaurant?.id, categories.length, content, verificationPhoto, foodPhotos.length]);

    // 임시 저장된 데이터 불러오기 (IndexedDB)
    const loadDraft = useCallback(async () => {
        if (!user?.id || !restaurant?.id) return;

        try {
            const draft = await getDraft(user.id, restaurant.id);
            if (draft) {
                setVisitedDate(draft.visitedDate);
                setVisitedTime(draft.visitedTime);
                setCategories(draft.categories as Category[]);
                setContent(draft.content);

                // 사진 복원
                if (draft.verificationPhoto) {
                    setVerificationPhoto(draft.verificationPhoto);
                }
                if (draft.foodPhotos && draft.foodPhotos.length > 0) {
                    setFoodPhotos(draft.foodPhotos);
                }

                setLastSavedAt(new Date(draft.savedAt));

                const photoCount = (draft.verificationPhoto ? 1 : 0) + draft.foodPhotos.length;
                toast({
                    title: "임시 저장된 내용을 불러왔습니다",
                    description: `저장 시간: ${new Date(draft.savedAt).toLocaleString('ko-KR')}${photoCount > 0 ? ` (사진 ${photoCount}장 포함)` : ''}`,
                });
            }
        } catch (error) {
            console.error('임시 저장 데이터 로드 실패:', error);
        }
    }, [user?.id, restaurant?.id]);

    // 자동 저장 (IndexedDB)
    const autoSave = useCallback(async () => {
        if (!user?.id || !restaurant?.id) return;

        // 내용이 하나라도 있을 때만 저장
        if (!visitedDate && !visitedTime && categories.length === 0 && !content && !verificationPhoto && foodPhotos.length === 0) {
            return;
        }

        try {
            setIsSaving(true);
            await saveDraft({
                userId: user.id,
                restaurantId: restaurant.id,
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
    }, [user?.id, restaurant?.id, visitedDate, visitedTime, categories, content, verificationPhoto, foodPhotos]);

    // 임시 저장 데이터 삭제 (IndexedDB)
    const clearDraft = useCallback(async () => {
        if (!user?.id || !restaurant?.id) return;

        try {
            await deleteDraft(user.id, restaurant.id);
            setLastSavedAt(null);
        } catch (error) {
            console.error('임시 저장 데이터 삭제 실패:', error);
        }
    }, [user?.id, restaurant?.id]);

    // 디바운스된 자동 저장 (500ms)
    useEffect(() => {
        if (!isOpen) return;

        const timer = setTimeout(() => {
            autoSave();
        }, 500);

        return () => clearTimeout(timer);
    }, [isOpen, visitedDate, visitedTime, categories, content, verificationPhoto, foodPhotos, autoSave]);

    // 모달이 열릴 때 임시 저장된 데이터 확인
    useEffect(() => {
        if (isOpen && user?.id && restaurant?.id) {
            loadDraft();
        }
    }, [isOpen, user?.id, restaurant?.id, loadDraft]);

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden p-0">
                <div className="flex flex-col h-full max-h-[90vh]">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                                <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                                    쯔동여지도 리뷰 작성
                                </DialogTitle>
                                <DialogDescription>
                                    쯔양이 방문한 맛집에 대한 방문 후기를 공유해주세요
                                </DialogDescription>
                            </div>

                            {/* 자동 저장 상태 표시 */}
                            {lastSavedAt && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    {isSaving ? (
                                        <>
                                            <div className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full" />
                                            <span>저장 중...</span>
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="h-3 w-3 text-green-600" />
                                            <span className="text-green-600">
                                                저장됨 ({lastSavedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        <div className="space-y-6">
                            {/* 중요 공지 */}
                            <Alert className="bg-amber-50 border-amber-200">
                                <AlertCircle className="h-4 w-4 text-amber-600" />
                                <AlertDescription className="text-amber-800 space-y-2">
                                    <div>
                                        <strong>📸 영수증 인증 사진 가이드라인 (OCR 자동 인식):</strong>
                                    </div>
                                    <ul className="text-sm space-y-1 ml-4 list-disc">
                                        <li><strong>영수증 전체가 보이게</strong> 촬영해주세요 (접히거나 잘리면 인식 불가)</li>
                                        <li><strong>밝은 곳에서 촬영</strong>하고, 그림자가 지지 않도록 해주세요</li>
                                        <li><strong>상호명, 날짜/시간, 금액</strong>이 선명하게 보여야 합니다</li>
                                        <li>닉네임은 영수증 <strong>하단 여백</strong>이나 <strong>옆에 메모지</strong>로 적어주세요</li>
                                        <li>방문 날짜는 <strong className="text-red-600">3개월 이내</strong>여야 합니다</li>
                                    </ul>
                                    <div className="text-xs text-amber-700 mt-2 space-y-1">
                                        <div>⚠️ <strong>주의:</strong> 영수증 위에 닉네임을 직접 써서 중요 정보를 가리면 인식이 안 됩니다!</div>
                                        <div>💡 <strong>팁:</strong> 영수증을 평평한 곳에 놓고 바로 위에서 촬영하면 인식률이 높아집니다</div>
                                    </div>
                                </AlertDescription>
                            </Alert>

                            {/* 방문 맛집 정보 (읽기 전용) */}
                            <div className="space-y-2">
                                <Label>
                                    방문한 쯔양 맛집 <span className="text-red-500">*</span>
                                </Label>
                                {restaurant ? (
                                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                                        <span className="font-medium text-green-800">{restaurant.name}</span>
                                    </div>
                                ) : (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                        <p className="text-sm text-red-600">
                                            맛집 정보가 없습니다. 맛집 상세 페이지에서 리뷰 작성 버튼을 눌러주세요.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* 방문 날짜 및 시간 */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="visitDate" className="flex items-center gap-2">
                                        <Calendar className="h-4 w-4" />
                                        방문 날짜 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="visitDate"
                                        type="date"
                                        value={visitedDate}
                                        onChange={(e) => setVisitedDate(e.target.value)}
                                        max={new Date().toISOString().split('T')[0]}
                                        min={new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        📅 3개월 이내 방문한 맛집만 리뷰 작성 가능합니다
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="visitTime">
                                        방문 시간 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="visitTime"
                                        type="time"
                                        step="60"
                                        value={visitedTime}
                                        onChange={(e) => setVisitedTime(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* 카테고리 */}
                            <div className="space-y-2">
                                <Label>
                                    카테고리 <span className="text-red-500">*</span>
                                </Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className="w-full justify-between"
                                        >
                                            <span className="truncate">
                                                {categories.length > 0
                                                    ? `${categories.length}개 선택됨`
                                                    : "어떤 종류의 음식을 드셨나요?"
                                                }
                                            </span>
                                            <ChevronDown className="h-4 w-4 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64" align="start">
                                        <div className="space-y-2">
                                            <h4 className="font-semibold text-sm">카테고리 선택</h4>
                                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                                {CATEGORIES.map((cat) => (
                                                    <div key={cat} className="flex items-center space-x-2">
                                                        <Checkbox
                                                            id={`review-category-${cat}`}
                                                            checked={categories.includes(cat)}
                                                            onCheckedChange={(checked) => {
                                                                if (checked) {
                                                                    setCategories([...categories, cat]);
                                                                } else {
                                                                    setCategories(categories.filter(c => c !== cat));
                                                                }
                                                            }}
                                                        />
                                                        <Label
                                                            htmlFor={`review-category-${cat}`}
                                                            className="text-sm cursor-pointer flex-1"
                                                        >
                                                            {cat}
                                                        </Label>
                                                    </div>
                                                ))}
                                            </div>
                                            {categories.length > 0 && (
                                                <div className="pt-2 border-t">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setCategories([])}
                                                        className="w-full"
                                                    >
                                                        선택 해제
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                                {categories.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {categories.map((category) => (
                                            <Badge key={category} variant="secondary" className="text-xs">
                                                {category}
                                                <button
                                                    type="button"
                                                    onClick={() => setCategories(categories.filter(c => c !== category))}
                                                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                                                >
                                                    <XIcon className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* 인증 사진 */}
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    인증 사진 (본인 닉네임 포함) <span className="text-red-500">*</span>
                                </Label>
                                <Card
                                    ref={verificationDropRef}
                                    className={`p-6 border-dashed transition-colors cursor-pointer ${isVerificationDragging
                                        ? 'border-primary bg-primary/5'
                                        : verificationPhoto
                                            ? 'border-green-300 bg-green-50/50'
                                            : 'border-gray-300 hover:border-primary/50'
                                        }`}
                                    onDragOver={handleDragOver}
                                    onDragEnter={handleVerificationDragEnter}
                                    onDragLeave={handleVerificationDragLeave}
                                    onDrop={handleVerificationDrop}
                                    onClick={openVerificationFileDialog}
                                >
                                    <div className="flex flex-col items-center gap-4">
                                        {verificationPhoto ? (
                                            <div className="w-full space-y-3">
                                                <div className="flex items-center justify-center">
                                                    <div className="relative">
                                                        <div className="w-20 h-20 rounded-lg overflow-hidden border-2 border-green-200">
                                                            <img
                                                                src={verificationPhotoUrl || ''}
                                                                alt="인증 사진 미리보기"
                                                                className="w-full h-full object-cover"
                                                            />
                                                        </div>
                                                        <div className="absolute -top-2 -right-2 bg-green-500 text-white rounded-full p-1">
                                                            <CheckCircle2 className="h-4 w-4" />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-center">
                                                    <Badge variant="default" className="gap-1 mb-2 bg-green-500">
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        인증 사진 업로드 완료
                                                    </Badge>
                                                    <p className="text-sm font-medium">{verificationPhoto.name}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {(verificationPhoto.size / 1024 / 1024).toFixed(1)}MB
                                                    </p>
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full gap-2"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setVerificationPhoto(null);
                                                    }}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                    사진 제거
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="w-full text-center space-y-3">
                                                <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isVerificationDragging ? 'bg-primary/10' : 'bg-gray-100'
                                                    }`}>
                                                    <Image className={`h-8 w-8 transition-colors ${isVerificationDragging ? 'text-primary' : 'text-muted-foreground'
                                                        }`} />
                                                </div>
                                                <div>
                                                    <p className="font-medium mb-1">
                                                        {isVerificationDragging ? '여기에 사진을 놓아주세요' : '영수증 인증 사진을 업로드해주세요'}
                                                    </p>
                                                    <p className="text-sm text-muted-foreground mb-3">
                                                        본인 닉네임이 포함된 영수증 사진을 드래그하거나 클릭해서 선택해주세요
                                                    </p>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-2"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openVerificationFileDialog();
                                                        }}
                                                    >
                                                        <Plus className="h-4 w-4" />
                                                        사진 선택
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* 숨겨진 파일 입력 */}
                                    <input
                                        ref={verificationFileInputRef}
                                        type="file"
                                        accept="image/*"
                                        onChange={handleVerificationPhotoChange}
                                        className="hidden"
                                    />
                                </Card>
                                <p className="text-xs text-muted-foreground text-center">
                                    💡 팁: 영수증에 닉네임을 적고 촬영하면 더 정확한 인증이 됩니다
                                </p>
                            </div>

                            {/* 음식 사진 */}
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    음식 사진 (다양한 각도) <span className="text-red-500">*</span>
                                </Label>

                                {/* 업로드된 사진들 미리보기 */}
                                {foodPhotos.length > 0 && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                                        {foodPhotos.map((photo, index) => (
                                            <div key={index} className="relative group">
                                                <Card className="p-2 hover:shadow-md transition-shadow">
                                                    <div className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                                                        <img
                                                            src={foodPhotoUrls[index] || ''}
                                                            alt={`음식 사진 ${index + 1}`}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </div>
                                                    <div className="mt-2 space-y-1">
                                                        <p className="text-xs font-medium truncate" title={photo.name}>
                                                            {photo.name}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {(photo.size / 1024 / 1024).toFixed(1)}MB
                                                        </p>
                                                    </div>
                                                </Card>
                                                <Button
                                                    variant="destructive"
                                                    size="icon"
                                                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                                                    onClick={() => removeFoodPhoto(index)}
                                                >
                                                    <XIcon className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* 드래그 앤 드롭 영역 */}
                                <Card
                                    ref={foodPhotosDropRef}
                                    className={`p-6 border-dashed transition-colors cursor-pointer ${isFoodPhotosDragging
                                        ? 'border-primary bg-primary/5'
                                        : foodPhotos.length > 0
                                            ? 'border-green-300 bg-green-50/50'
                                            : 'border-gray-300 hover:border-primary/50'
                                        }`}
                                    onDragOver={handleDragOver}
                                    onDragEnter={handleFoodPhotosDragEnter}
                                    onDragLeave={handleFoodPhotosDragLeave}
                                    onDrop={handleFoodPhotosDrop}
                                    onClick={openFoodPhotosFileDialog}
                                >
                                    <div className="flex flex-col items-center gap-4">
                                        <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isFoodPhotosDragging ? 'bg-primary/10' : 'bg-gray-100'
                                            }`}>
                                            <Upload className={`h-8 w-8 transition-colors ${isFoodPhotosDragging ? 'text-primary' : 'text-muted-foreground'
                                                }`} />
                                        </div>
                                        <div className="text-center space-y-2">
                                            <p className="font-medium">
                                                {isFoodPhotosDragging ? '여기에 사진들을 놓아주세요' : '음식 사진을 업로드해주세요'}
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                먹은 음식을 다양한 각도에서 촬영한 사진을 드래그하거나 클릭해서 선택해주세요
                                            </p>
                                            <div className="flex gap-2 justify-center">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="gap-2"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        openFoodPhotosFileDialog();
                                                    }}
                                                >
                                                    <Plus className="h-4 w-4" />
                                                    사진 추가
                                                </Button>
                                                {foodPhotos.length > 0 && (
                                                    <Badge variant="secondary" className="px-3 py-1">
                                                        📷 {foodPhotos.length}장 업로드됨
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* 숨겨진 파일 입력 */}
                                    <input
                                        ref={foodPhotosFileInputRef}
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={handleFoodPhotosChange}
                                        className="hidden"
                                    />
                                </Card>

                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>💡 다양한 각도의 사진을 업로드하면 더 풍부한 리뷰가 됩니다</span>
                                    <span>업로드된 사진: {foodPhotos.length}장</span>
                                </div>
                            </div>

                            {/* 리뷰 내용 */}
                            <div className="space-y-3">
                                <Label htmlFor="content">
                                    리뷰 내용 <span className="text-red-500">*</span>
                                </Label>

                                {/* 작성 가이드 (항상 표시) */}
                                <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-3">
                                    <div className="space-y-1 text-xs text-blue-900 dark:text-blue-100">
                                        <p className="font-semibold flex items-center gap-1">
                                            💡 작성 가이드
                                        </p>
                                        <ul className="space-y-0.5 ml-4 list-disc text-blue-700 dark:text-blue-300">
                                            <li>어떤 메뉴를 드셨나요?</li>
                                            <li>맛은 어떠셨나요?</li>
                                            <li>분위기나 서비스는 어땠나요?</li>
                                            <li>추천하고 싶은 메뉴가 있나요?</li>
                                        </ul>
                                    </div>
                                </Card>

                                <Textarea
                                    id="content"
                                    placeholder="맛집에 대한 솔직한 후기를 작성해주세요..."
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    rows={8}
                                    className="resize-none"
                                />
                                <p className="text-xs text-muted-foreground text-right">
                                    {content.length} / 최소 20자
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 푸터 */}
                    <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/50">
                        <div className="flex items-center gap-4">
                            {/* 폼 유효성 상태 */}
                            <div className="text-xs text-muted-foreground">
                                {isFormValid ? (
                                    <span className="text-green-600 flex items-center gap-1">
                                        <CheckCircle2 className="h-3 w-3" />
                                        모든 필수 항목이 입력되었습니다
                                    </span>
                                ) : (
                                    <span className="text-amber-600 flex items-center gap-1">
                                        <AlertCircle className="h-3 w-3" />
                                        필수 항목을 모두 입력해주세요
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
                                취소
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={!isFormValid || isSubmitting}
                                className="bg-gradient-primary"
                            >
                                {isSubmitting ? "등록 중..." : "리뷰 등록"}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
