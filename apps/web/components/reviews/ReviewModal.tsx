import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import useSWR from "swr";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar, Upload, X as XIcon, AlertCircle, CircleAlert, CheckCircle2, Image, Trash2, Plus, Search, Camera, ChevronDown, Loader2, Clock, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface ReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant: { id: string; name: string } | null;
    onSuccess?: () => void;
    inline?: boolean; // Dialog 없이 콘텐츠만 렌더링 (데스크톱 나란히 배치용)
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
    const [categories, setCategories] = useState<Category[]>([]);
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
            analyzeReceipt(file);
        }
    }, []);

    const handleFoodPhotosChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        // requestAnimationFrame을 사용하여 UI 블로킹 방지
        requestAnimationFrame(() => {
            setFoodPhotos(prev => [...prev, ...files]);
        });

        // input 초기화 (같은 파일 재선택 가능하도록)
        e.target.value = '';
    }, []);

    const removeFoodPhoto = useCallback((index: number) => {
        setFoodPhotos(prev => prev.filter((_, i) => i !== index));
    }, []);

    // 드래그 앤 드롭 핸들러 (useCallback으로 메모이제이션)
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
            analyzeReceipt(imageFiles[0]);
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

    // 기존 로컬 스토리지 기반 임시 저장 로직 제거됨 (IndexedDB로 통합)

    // 모달 닫을 때나 성공 시 초안 삭제 (이 부분은 handleSubmit 성공 시와 handleClose에서 처리해야 함)
    // handleClose에서는 삭제하지 않음 (임시 저장 의도). handleSubmit 성공 시에만 삭제.

    // OCR 분석 실행 (모달 내부에서 처리)
    const analyzeReceipt = async (file: File) => {
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

                if (!user) {
                    throw new Error('로그인이 필요한 서비스입니다');
                }

                // [보안] 3. 토큰 직접 조회 (쿠키 전송 실패 대비)
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;

                if (!token) {
                    throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
                }

                const response = await fetch('/api/ocr/extract', {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    credentials: 'include',
                });

                if (!response.ok) {
                    // 429: 일일 한도 초과 (백엔드에서 메시지 전달)
                    if (response.status === 429) {
                        const errorData = await response.json();
                        mutateQuota(); // 쿼터 정보 갱신하여 UI에 한도 초과 반영
                        throw new Error(errorData.error || "일일 무료 분석 한도를 초과했습니다.");
                    }
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
            // 수정: 이미 선택된 맛집이 있어도(selectedRestaurant) OCR 결과가 있으면 교체 시도 (단, props로 고정된 restaurant가 없어야 함)
            if (data.store_name && !restaurant) {
                const { data: restaurants, error } = await supabase
                    .from('restaurants')
                    .select('id, name')
                    .eq('name', data.store_name) // 정확한 일치 우선 검색
                    .limit(1) as any;

                if (!error && restaurants && restaurants.length > 0) {
                    setSelectedRestaurant(restaurants[0]);
                    autoFilledParts.push("맛집");

                    // 만약 기존에 선택된 맛집과 다르다면 알림
                    if (selectedRestaurant && selectedRestaurant.id !== restaurants[0].id) {
                        toast({
                            title: "맛집 정보 업데이트",
                            description: `영수증 정보에 맞춰 맛집이 '${restaurants[0].name}'(으)로 변경되었습니다.`,
                        });
                    }
                } else {
                    // 정확한 일치가 없으면 검색어로 설정하여 목록 노출 유도
                    setSearchQuery(data.store_name);
                    setSelectedRestaurant(null); // 기존 선택 해제하여 검색 유도

                    // 검색 결과가 나오도록 잠시 대기 후 토스트 메시지 (useEffect에 의해 검색 실행됨)
                    toast({
                        title: "맛집을 선택해주세요",
                        description: `'${data.store_name}' 검색 결과를 확인하고 선택해주세요.`,
                    });
                }
            } else if (data.store_name && restaurant) {
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
                const validCategory = CATEGORIES.find(c => c === data.category);
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
                const newContent = content ? `${content}\\n\\n[영수증 메뉴]\\n${menuText}${totalText}` : `[영수증 메뉴]\\n${menuText}${totalText}`;
                setContent(newContent);
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

            // 분석 성공 시 쿼터 갱신 (실시간 반영)
            mutateQuota();

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
    };
    const handleSubmit = async () => {
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

            // 성공 시 초안 삭제


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
        const targetRestaurant = selectedRestaurant || restaurant;
        return visitedDate && visitedTime && targetRestaurant?.id && categories.length > 0 && content.trim().length >= 20 && verificationPhoto && foodPhotos.length > 0;
    }, [visitedDate, visitedTime, selectedRestaurant, restaurant, categories.length, content, verificationPhoto, foodPhotos.length]);

    // 임시 저장된 데이터 불러오기 (IndexedDB)
    const loadDraft = useCallback(async () => {
        const targetRestaurantId = selectedRestaurant?.id || restaurant?.id;
        if (!user?.id || !targetRestaurantId) return;

        try {
            const draft = await getDraft(user.id, targetRestaurantId);
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

    // SWR을 사용한 쿼터 조회 (자동 캐싱 및 중복 요청 제거)
    const { data: quota, isLoading: isLoadingQuota, mutate: mutateQuota } = useSWR(
        isOpen && user ? '/api/ocr/quota' : null,
        async (url) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Quota fetch failed');
            return res.json();
        },
        {
            revalidateOnFocus: false, // 포커스 시 재조회 방지 (너무 잦은 조회 방지)
            dedupingInterval: 60000,  // 1분 내 중복 요청 방지
        }
    );

    const ocrLimitReached = quota?.remaining === 0;

    // 초기 로딩 및 모달 열릴 때 임시 저장 불러오기
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
                            <h2 className="text-2xl font-semibold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-3">
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

                        {/* 중요 공지 - 컴팩트 버전 */}
                        <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3">
                            <div className="space-y-1 text-xs text-amber-900 dark:text-amber-100">
                                <p className="font-semibold flex items-center gap-1">
                                    📸 영수증 인증 가이드
                                </p>
                                <ul className="space-y-0.5 ml-4 list-disc text-amber-700 dark:text-amber-300">
                                    <li><b>영수증 전체</b>가 잘리지 않도록 촬영해주세요</li>
                                    <li><b>AI 자동 분석</b>으로 정보를 편리하게 채워보세요 ✨</li>
                                    <li>방문일은 <span className="text-red-600 font-semibold">3개월 이내</span>여야 합니다</li>
                                </ul>
                            </div>
                        </Card>

                        {/* 인증 사진 (최상단 배치) */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="flex items-center gap-2">
                                    인증 사진 <span className="text-red-500">*</span>
                                </Label>
                                {quota && (
                                    <Badge variant="outline" className={`text-xs font-normal border-primary/20 ${quota.remaining === 0 ? 'bg-amber-50 text-amber-600' : 'bg-primary/5 text-primary'}`}>
                                        AI 분석 남은 횟수: {quota.remaining}/{quota.max}회
                                    </Badge>
                                )}
                            </div>
                            <Card
                                ref={verificationDropRef}
                                className={`relative p-6 border-dashed transition-colors ${isLoadingQuota
                                    ? 'border-muted bg-muted/20 cursor-wait'
                                    : ocrLimitReached
                                        ? 'border-muted bg-muted/50 cursor-not-allowed'
                                        : isVerificationDragging
                                            ? 'border-primary bg-primary/5 cursor-pointer'
                                            : verificationPhoto
                                                ? 'border-green-300 bg-green-50/50 cursor-pointer'
                                                : 'border-border hover:border-primary/50 cursor-pointer'
                                    }`}
                                onDragOver={!ocrLimitReached && !isLoadingQuota ? handleDragOver : undefined}
                                onDragEnter={!ocrLimitReached && !isLoadingQuota ? handleVerificationDragEnter : undefined}
                                onDragLeave={!ocrLimitReached && !isLoadingQuota ? handleVerificationDragLeave : undefined}
                                onDrop={!ocrLimitReached && !isLoadingQuota ? handleVerificationDrop : undefined}
                                onClick={!ocrLimitReached && !isLoadingQuota ? openVerificationFileDialog : undefined}
                            >
                                <div className="flex flex-col items-center gap-4">
                                    {verificationPhoto ? (
                                        <div className="w-full space-y-3">
                                            <div className="flex items-center justify-center relative">
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
                                    ) : isLoadingQuota ? (
                                        <div className="w-full text-center space-y-3 py-4">
                                            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                                            <p className="text-sm text-muted-foreground">분석 가능 횟수 확인 중...</p>
                                        </div>
                                    ) : ocrLimitReached ? (
                                        <div className="w-full text-center space-y-3 p-2">
                                            <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center bg-amber-100 transition-colors">
                                                <AlertTriangle className="h-8 w-8 text-amber-600" />
                                            </div>
                                            <div>
                                                <p className="font-medium mb-1 text-amber-700">
                                                    일일 무료 분석 한도(5회)를 사용했습니다
                                                </p>
                                                <p className="text-sm text-muted-foreground mb-3">
                                                    {quota?.resetAt ? (
                                                        <>
                                                            {new Date(quota.resetAt).toLocaleTimeString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}에 다시 분석할 수 있습니다
                                                        </>
                                                    ) : (
                                                        <>내일 00시에 다시 분석할 수 있습니다</>
                                                    )}
                                                </p>

                                            </div>
                                        </div>
                                    ) : (
                                        <div className="w-full text-center space-y-3">
                                            <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isVerificationDragging ? 'bg-primary/10' : 'bg-muted'
                                                }`}>
                                                <Image className={`h-8 w-8 transition-colors ${isVerificationDragging ? 'text-primary' : 'text-muted-foreground'
                                                    }`} />
                                            </div>
                                            <div>
                                                <p className="font-medium mb-1">
                                                    {isVerificationDragging ? '여기에 사진을 놓아주세요' : '영수증 인증 사진을 업로드해주세요'}
                                                </p>
                                                <p className="text-sm text-muted-foreground mb-3">
                                                    <span className="text-primary font-medium">AI가 가게명, 날짜, 메뉴, 리뷰 내용을 자동으로 입력해드려요!</span>
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
                                <input ref={verificationFileInputRef} type="file" accept="image/*" onChange={handleVerificationPhotoChange} className="hidden" />

                                {/* AI 분석 로딩 오버레이 (카드 전체 덮음) */}
                                {isAnalyzing && (
                                    <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 rounded-xl border border-primary/20">
                                        <div className="relative mb-4">
                                            <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                                            <div className="relative bg-background rounded-full p-3 border-2 border-primary shadow-lg">
                                                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
                                            </div>
                                        </div>
                                        <h3 className="text-lg font-bold text-primary mb-2">AI가 영수증을 분석하고 있어요</h3>
                                        <p className="text-sm text-muted-foreground mb-4">
                                            가게명, 방문일시, 메뉴 정보를<br />자동으로 입력합니다 ✨
                                        </p>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                                            <CheckCircle2 className="w-3 h-3 text-green-600" />
                                            <span>분석된 데이터는 AI 학습에 사용되지 않습니다</span>
                                        </div>
                                    </div>
                                )}
                            </Card>
                        </div>

                        {/* 하단 폼 영역 (맛집 정보 ~ 리뷰 내용) */}
                        <div className="space-y-6 relative rounded-xl transition-all">

                            {/* 방문 맛집 정보 */}
                            <div className={`space-y-2 transition-all duration-500 ${(!selectedRestaurant && searchQuery && !isSearching)
                                ? "ring-2 ring-primary ring-offset-2 rounded-lg p-1 bg-primary/5"
                                : ""
                                }`}>
                                <Label>
                                    방문한 쯔양 맛집 <span className="text-red-500">*</span>
                                </Label>
                                {(selectedRestaurant || restaurant) ? (
                                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                                        <span className="font-medium text-green-800 flex-1">
                                            {(selectedRestaurant || restaurant)?.name}
                                        </span>
                                        {!restaurant && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setSelectedRestaurant(null);
                                                    setSearchQuery("");
                                                }}
                                                className="h-6 px-2 text-xs"
                                            >
                                                변경
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder="맛집 이름을 검색하세요..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="pl-9"
                                            />
                                        </div>
                                        {isSearching && (
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                                                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                                                검색 중...
                                            </div>
                                        )}
                                        {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                                            <div className="text-sm text-muted-foreground p-2">
                                                검색 결과가 없습니다.
                                            </div>
                                        )}
                                        {searchResults.length > 0 && (
                                            <div className="border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                                                {searchResults.map((result) => (
                                                    <button
                                                        key={result.id}
                                                        onClick={() => {
                                                            setSelectedRestaurant(result);
                                                            setSearchQuery("");
                                                            setSearchResults([]);
                                                        }}
                                                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0 text-sm"
                                                    >
                                                        {result.name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {searchQuery.length < 2 && (
                                            <p className="text-xs text-muted-foreground">
                                                2글자 이상 입력하면 검색됩니다.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 방문 날짜 및 시간 */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="inline-visitDate" className="flex items-center gap-2">
                                        <Calendar className="h-4 w-4" />
                                        방문 날짜 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="inline-visitDate"
                                        type="date"
                                        value={visitedDate}
                                        onChange={(e) => setVisitedDate(e.target.value)}
                                        max={new Date().toISOString().split('T')[0]}
                                        min={new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                                        enterKeyHint="next"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="inline-visitTime" className="flex items-center gap-2">
                                        <Clock className="h-4 w-4" />
                                        방문 시간 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="inline-visitTime"
                                        type="time"
                                        step="60"
                                        value={visitedTime}
                                        onChange={(e) => setVisitedTime(e.target.value)}
                                        enterKeyHint="next"
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
                                        <Button variant="outline" className="w-full justify-between">
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
                                                            id={`inline-category-${cat}`}
                                                            checked={categories.includes(cat)}
                                                            onCheckedChange={(checked) => {
                                                                if (checked) {
                                                                    setCategories([...categories, cat]);
                                                                } else {
                                                                    setCategories(categories.filter(c => c !== cat));
                                                                }
                                                            }}
                                                        />
                                                        <Label htmlFor={`inline-category-${cat}`} className="text-sm cursor-pointer flex-1">
                                                            {cat}
                                                        </Label>
                                                    </div>
                                                ))}
                                            </div>
                                            {categories.length > 0 && (
                                                <div className="pt-2 border-t">
                                                    <Button variant="outline" size="sm" onClick={() => setCategories([])} className="w-full">
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


                            {/* 음식 사진 */}
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    음식 사진 (다양한 각도) <span className="text-red-500">*</span>
                                </Label>

                                {foodPhotos.length > 0 && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                                        {foodPhotos.map((photo, index) => (
                                            <div key={index} className="relative group">
                                                <Card className="p-2 hover:shadow-md transition-shadow">
                                                    <div className="aspect-square rounded-lg overflow-hidden bg-muted">
                                                        <img src={foodPhotoUrls[index] || ''} alt={`음식 사진 ${index + 1}`} className="w-full h-full object-cover" />
                                                    </div>
                                                    <div className="mt-2 space-y-1">
                                                        <p className="text-xs font-medium truncate" title={photo.name}>{photo.name}</p>
                                                        <p className="text-xs text-muted-foreground">{(photo.size / 1024 / 1024).toFixed(1)}MB</p>
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

                                <Card
                                    ref={foodPhotosDropRef}
                                    className={`p-6 border-dashed transition-colors cursor-pointer ${isFoodPhotosDragging
                                        ? 'border-primary bg-primary/5'
                                        : foodPhotos.length > 0
                                            ? 'border-green-300 bg-green-50/50'
                                            : 'border-border hover:border-primary/50'
                                        }`}
                                    onDragOver={handleDragOver}
                                    onDragEnter={handleFoodPhotosDragEnter}
                                    onDragLeave={handleFoodPhotosDragLeave}
                                    onDrop={handleFoodPhotosDrop}
                                    onClick={openFoodPhotosFileDialog}
                                >
                                    <div className="flex flex-col items-center gap-4">
                                        <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isFoodPhotosDragging ? 'bg-primary/10' : 'bg-muted'}`}>
                                            <Upload className={`h-8 w-8 transition-colors ${isFoodPhotosDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                                        </div>
                                        <div className="text-center space-y-2">
                                            <p className="font-medium">
                                                {isFoodPhotosDragging ? '여기에 사진들을 놓아주세요' : '음식 사진을 업로드해주세요'}
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                다양한 각도에서 촬영한 사진을 드래그하거나 클릭해서 선택해주세요
                                            </p>
                                            <div className="flex gap-2 justify-center">
                                                <Button variant="outline" size="sm" className="gap-2" onClick={(e) => { e.stopPropagation(); openFoodPhotosFileDialog(); }}>
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
                                    <input ref={foodPhotosFileInputRef} type="file" accept="image/*" multiple onChange={handleFoodPhotosChange} className="hidden" />
                                </Card>

                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-muted-foreground">
                                    <span>💡 다양한 각도의 사진을 업로드하면 더 풍부한 리뷰가 됩니다</span>
                                </div>
                            </div>

                            {/* 리뷰 내용 */}
                            <div className="space-y-3">
                                <Label htmlFor="inline-content">
                                    리뷰 내용 <span className="text-red-500">*</span>
                                </Label>

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
                                    id="inline-content"
                                    placeholder="맛집에 대한 솔직한 후기를 작성해주세요..."
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    rows={8}
                                    className="resize-none"
                                />
                                <div className="text-right text-xs text-muted-foreground">
                                    {content.length} / 최소 20자
                                </div>
                            </div>
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
                    <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 rounded-xl pb-[max(1.5rem,env(safe-area-inset-bottom))] duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none">
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
                                <div className="flex-1 text-center">
                                    <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent flex items-center justify-center gap-3">
                                        쯔동여지도 리뷰 작성
                                    </DialogTitle>
                                    <DialogDescription className="text-center">
                                        맛집 방문 후기를 공유해주세요
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        <div className="space-y-6 mt-2">
                            <div className="space-y-6">
                                {/* 중요 공지 - 컴팩트 버전 */}
                                {/* 중요 공지 - 컴팩트 버전 */}
                                <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3">
                                    <div className="space-y-1 text-xs text-amber-900 dark:text-amber-100">
                                        <p className="font-semibold flex items-center gap-1">
                                            📸 영수증 인증 가이드
                                        </p>
                                        <ul className="space-y-0.5 ml-4 list-disc text-amber-700 dark:text-amber-300">
                                            <li><b>영수증 전체</b>가 잘리지 않도록 촬영해주세요</li>
                                            <li><b>AI 자동 분석</b>으로 정보를 편리하게 채워보세요 ✨</li>
                                            <li>방문일은 <span className="text-red-600 font-semibold">3개월 이내</span>여야 합니다</li>
                                        </ul>
                                    </div>
                                </Card>

                                {/* 인증 사진 (최상단 배치) */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="flex items-center gap-2">
                                            인증 사진 <span className="text-red-500">*</span>
                                        </Label>
                                        {quota && (
                                            <Badge variant="outline" className={`text-xs font-normal border-primary/20 ${quota.remaining === 0 ? 'bg-amber-50 text-amber-600' : 'bg-primary/5 text-primary'}`}>
                                                AI 분석 남은 횟수: {quota.remaining}/{quota.max}회
                                            </Badge>
                                        )}
                                    </div>
                                    <Card
                                        ref={verificationDropRef}
                                        className={`relative p-6 border-dashed transition-colors ${isLoadingQuota
                                            ? 'border-muted bg-muted/20 cursor-wait'
                                            : ocrLimitReached
                                                ? 'border-muted bg-muted/50 cursor-not-allowed'
                                                : isVerificationDragging
                                                    ? 'border-primary bg-primary/5 cursor-pointer'
                                                    : verificationPhoto
                                                        ? 'border-green-300 bg-green-50/50 cursor-pointer'
                                                        : 'border-border hover:border-primary/50 cursor-pointer'
                                            }`}
                                        onDragOver={!ocrLimitReached && !isLoadingQuota ? handleDragOver : undefined}
                                        onDragEnter={!ocrLimitReached && !isLoadingQuota ? handleVerificationDragEnter : undefined}
                                        onDragLeave={!ocrLimitReached && !isLoadingQuota ? handleVerificationDragLeave : undefined}
                                        onDrop={!ocrLimitReached && !isLoadingQuota ? handleVerificationDrop : undefined}
                                        onClick={!ocrLimitReached && !isLoadingQuota ? openVerificationFileDialog : undefined}
                                    >
                                        <div className="flex flex-col items-center gap-4">
                                            {verificationPhoto ? (
                                                <div className="w-full space-y-3">
                                                    <div className="flex items-center justify-center relative">
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
                                            ) : isLoadingQuota ? (
                                                <div className="w-full text-center space-y-3 py-4">
                                                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                                                    <p className="text-sm text-muted-foreground">분석 가능 횟수 확인 중...</p>
                                                </div>
                                            ) : ocrLimitReached ? (
                                                <div className="w-full text-center space-y-3 p-2">
                                                    <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center bg-amber-100 transition-colors">
                                                        <Clock className="h-8 w-8 text-amber-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-amber-700 mb-1">
                                                            일일 무료 분석 한도(5회)를 사용했습니다
                                                        </p>
                                                        <p className="text-sm text-muted-foreground mb-3">
                                                            {quota?.resetAt ? (
                                                                <>
                                                                    {new Date(quota.resetAt).toLocaleTimeString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}에 다시 분석할 수 있습니다
                                                                </>
                                                            ) : (
                                                                <>내일 00시에 다시 분석할 수 있습니다</>
                                                            )}
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="w-full text-center space-y-3">
                                                    <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isVerificationDragging ? 'bg-primary/10' : 'bg-muted'
                                                        }`}>
                                                        <Image className={`h-8 w-8 transition-colors ${isVerificationDragging ? 'text-primary' : 'text-muted-foreground'
                                                            }`} />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium mb-1">
                                                            {isVerificationDragging ? '여기에 사진을 놓아주세요' : '영수증 인증 사진을 업로드해주세요'}
                                                        </p>
                                                        <p className="text-sm text-muted-foreground mb-3">
                                                            <span className="text-primary font-medium">AI가 가게명, 날짜, 메뉴, 리뷰 내용을 자동으로 입력해드려요!</span>
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
                                        <input ref={verificationFileInputRef} type="file" accept="image/*" onChange={handleVerificationPhotoChange} className="hidden" />

                                        {/* AI 분석 로딩 오버레이 (카드 전체 덮음) */}
                                        {isAnalyzing && (
                                            <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 rounded-xl border border-primary/20">
                                                <div className="relative mb-4">
                                                    <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                                                    <div className="relative bg-background rounded-full p-3 border-2 border-primary shadow-lg">
                                                        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
                                                    </div>
                                                </div>
                                                <h3 className="text-lg font-bold text-primary mb-2">AI가 영수증을 분석하고 있어요</h3>
                                                <p className="text-sm text-muted-foreground mb-4">
                                                    가게명, 방문일시, 메뉴 정보를<br />자동으로 입력합니다 ✨
                                                </p>
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                                                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                                                    <span>분석된 데이터는 AI 학습에 사용되지 않습니다</span>
                                                </div>
                                            </div>
                                        )}
                                    </Card>
                                </div>

                                {/* 방문 맛집 정보 */}
                                <div className={`space-y-2 transition-all duration-500 ${(!selectedRestaurant && searchQuery && !isSearching)
                                    ? "ring-2 ring-primary ring-offset-2 rounded-lg p-1 bg-primary/5"
                                    : ""
                                    }`}>
                                    <Label>
                                        방문한 쯔양 맛집 <span className="text-red-500">*</span>
                                    </Label>
                                    {(selectedRestaurant || restaurant) ? (
                                        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                                            <span className="font-medium text-green-800 flex-1">
                                                {(selectedRestaurant || restaurant)?.name}
                                            </span>
                                            {!restaurant && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setSelectedRestaurant(null);
                                                        setSearchQuery("");
                                                    }}
                                                    className="h-6 px-2 text-xs"
                                                >
                                                    변경
                                                </Button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                                <Input
                                                    placeholder="맛집 이름을 검색하세요..."
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                    className="pl-9"
                                                />
                                            </div>
                                            {isSearching && (
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                                                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                                                    검색 중...
                                                </div>
                                            )}
                                            {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                                                <div className="text-sm text-muted-foreground p-2">
                                                    검색 결과가 없습니다.
                                                </div>
                                            )}
                                            {searchResults.length > 0 && (
                                                <div className="border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                                                    {searchResults.map((result) => (
                                                        <button
                                                            key={result.id}
                                                            onClick={() => {
                                                                setSelectedRestaurant(result);
                                                                setSearchQuery("");
                                                                setSearchResults([]);
                                                            }}
                                                            className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0 text-sm"
                                                        >
                                                            {result.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {searchQuery.length < 2 && (
                                                <p className="text-xs text-muted-foreground">
                                                    2글자 이상 입력하면 검색됩니다.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* 방문 날짜 및 시간 */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                                            enterKeyHint="next"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="visitTime" className="flex items-center gap-2">
                                            <Clock className="h-4 w-4" />
                                            방문 시간 <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            id="visitTime"
                                            type="time"
                                            step="60"
                                            value={visitedTime}
                                            onChange={(e) => setVisitedTime(e.target.value)}
                                            enterKeyHint="next"
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
                                                        <div className="aspect-square rounded-lg overflow-hidden bg-muted">
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
                                                : 'border-border hover:border-primary/50'
                                            }`}
                                        onDragOver={handleDragOver}
                                        onDragEnter={handleFoodPhotosDragEnter}
                                        onDragLeave={handleFoodPhotosDragLeave}
                                        onDrop={handleFoodPhotosDrop}
                                        onClick={openFoodPhotosFileDialog}
                                    >
                                        <div className="flex flex-col items-center gap-4">
                                            <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isFoodPhotosDragging ? 'bg-primary/10' : 'bg-muted'
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

                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-muted-foreground">
                                        <span>💡 다양한 각도의 사진을 업로드하면 더 풍부한 리뷰가 됩니다</span>
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
                                            <AlertCircle className="h-3 w-3" />
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
