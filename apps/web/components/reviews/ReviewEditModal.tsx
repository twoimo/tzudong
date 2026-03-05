"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import imageCompression from "browser-image-compression";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, X as XIcon, AlertCircle, CheckCircle2, Trash2, Plus, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { saveDraft as saveEditDraft, getDraft as getEditDraft, deleteDraft as deleteEditDraft } from "@/lib/reviewDraftDB";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Image compression options for food photos
const FOOD_PHOTO_OPTIONS = {
    maxSizeMB: 0.3,
    maxWidthOrHeight: 1200,
    fileType: "image/webp" as const,
    useWebWorker: true,
};

// Safe random filename generator
const generateSafeFilename = (extension: string = ".webp"): string => {
    const randomString = Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();
    return `${timestamp}_${randomString}${extension}`;
};

// Compress food image to WebP
const compressFoodImage = async (file: File): Promise<File> => {
    try {
        const compressedBlob = await imageCompression(file, FOOD_PHOTO_OPTIONS);
        const safeFileName = generateSafeFilename(".webp");
        return new File([compressedBlob], safeFileName, { type: "image/webp" });
    } catch (error) {
        console.warn("Food photo compression failed, using original:", error);
        return file;
    }
};

interface ReviewEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    review: {
        id: string;
        restaurantId: string;
        restaurantName: string;
        content: string;
        categories: string[];
        foodPhotos: string[];
        isVerified: boolean;
        adminNote: string | null;
    } | null;
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

export function ReviewEditModal({ isOpen, onClose, review, onSuccess }: ReviewEditModalProps) {
    const { user } = useAuth();
    const [categories, setCategories] = useState<Category[]>([]);
    const [content, setContent] = useState("");
    const [newFoodPhotos, setNewFoodPhotos] = useState<File[]>([]);
    const [existingFoodPhotos, setExistingFoodPhotos] = useState<string[]>([]);
    const [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

    // Refs
    const foodPhotosDropRef = useRef<HTMLDivElement>(null);
    const foodPhotosFileInputRef = useRef<HTMLInputElement>(null);

    // Drag states
    const [isFoodPhotosDragging, setIsFoodPhotosDragging] = useState(false);

    // Preview URLs for new photos
    const newFoodPhotoUrls = useMemo(() => {
        return newFoodPhotos.map(photo => URL.createObjectURL(photo));
    }, [newFoodPhotos]);

    // Cleanup URLs on unmount
    useEffect(() => {
        return () => {
            newFoodPhotoUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [newFoodPhotoUrls]);

    // Load review data when opened
    useEffect(() => {
        if (isOpen && review) {
            setContent(review.content);

            // [DEBUG & SAFETY] 카테고리 데이터 안전하게 로드
            const rawCategories = review.categories;
            let puredCategories: Category[] = [];

            if (Array.isArray(rawCategories)) {
                // 배열인 경우 유효한 카테고리만 필터링
                puredCategories = rawCategories.filter(c => CATEGORIES.includes(c as Category)) as Category[];
            } else if (typeof rawCategories === 'string') {
                // 혹시 문자열로 오는 경우 처리
                if (CATEGORIES.includes(rawCategories as Category)) {
                    puredCategories = [rawCategories as Category];
                }
            }

            setCategories(puredCategories);

            setExistingFoodPhotos(review.foodPhotos || []);
            setNewFoodPhotos([]);
            setRemovedPhotos([]);
        }
    }, [isOpen, review]);

    // Auto-save to IndexedDB
    useEffect(() => {
        if (!isOpen || !review || !user) return;
        if (content.trim().length === 0 && categories.length === 0) return;

        const saveTimer = setTimeout(async () => {
            try {
                // Use review ID as draft key
                await saveEditDraft({
                    userId: user.id,
                    restaurantId: `edit_${review.id}`,
                    visitedDate: '',
                    visitedTime: '',
                    categories: categories,
                    content: content,
                    verificationPhoto: null,
                    foodPhotos: [], // Don't save file objects for edit drafts
                });
                setLastSavedAt(new Date());
            } catch (error) {
                console.error('Edit draft 저장 실패:', error);
            }
        }, 2000); // Save after 2 seconds of inactivity

        return () => clearTimeout(saveTimer);
    }, [isOpen, review, user, content, categories]);

    // Load draft on open
    useEffect(() => {
        const loadDraft = async () => {
            if (!isOpen || !review || !user) return;

            try {
                const draft = await getEditDraft(user.id, `edit_${review.id}`);
                if (draft && draft.savedAt) {
                    // Only load draft if it's newer than review data
                    const draftDate = new Date(draft.savedAt);
                    setLastSavedAt(draftDate);
                    // Prefer draft content if exists
                    if (draft.content && draft.content.trim().length > 0) {
                        setContent(draft.content);
                    }
                    if (draft.categories && draft.categories.length > 0) {
                        setCategories(draft.categories as Category[]);
                    }
                }
            } catch (error) {
                console.error('Edit draft 로드 실패:', error);
            }
        };
        loadDraft();
    }, [isOpen, review, user]);

    // Handler for new food photos
    const handleFoodPhotosChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        requestAnimationFrame(() => {
            setNewFoodPhotos(prev => [...prev, ...files]);
        });

        e.target.value = '';
    }, []);

    // Remove new photo
    const removeNewFoodPhoto = useCallback((index: number) => {
        setNewFoodPhotos(prev => prev.filter((_, i) => i !== index));
    }, []);

    // Remove existing photo
    const removeExistingFoodPhoto = useCallback((photoPath: string) => {
        setExistingFoodPhotos(prev => prev.filter(p => p !== photoPath));
        setRemovedPhotos(prev => [...prev, photoPath]);
    }, []);

    // Drag and drop handlers
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
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
            setNewFoodPhotos(prev => [...prev, ...imageFiles]);
        }
    }, []);

    const openFoodPhotosFileDialog = useCallback(() => {
        foodPhotosFileInputRef.current?.click();
    }, []);

    // Submit edit
    const handleSubmit = async () => {
        if (!review || !user) return;

        // Validate content length (min 20 chars)
        if (content.trim().length < 20) {
            toast({
                title: "리뷰 내용이 너무 짧습니다",
                description: `최소 20자 이상 작성해주세요 (현재 ${content.trim().length}자)`,
                variant: "destructive",
            });
            return;
        }

        // Validate categories
        if (categories.length === 0) {
            toast({
                title: "카테고리를 선택해주세요",
                variant: "destructive",
            });
            return;
        }

        // Validate at least one food photo
        const totalPhotos = existingFoodPhotos.length + newFoodPhotos.length;
        if (totalPhotos === 0) {
            toast({
                title: "음식 사진이 필요합니다",
                description: "최소 1장 이상의 음식 사진을 업로드해주세요",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);

        try {
            // 1. Upload new food photos if any
            let uploadedNewPhotoPaths: string[] = [];
            if (newFoodPhotos.length > 0) {
                const uploadTimestamp = Date.now();
                const uploadPromises = newFoodPhotos.map(async (photo, i) => {
                    const compressedPhoto = await compressFoodImage(photo);
                    const photoPath = `${user.id}/${uploadTimestamp}_food_edit_${i}_${compressedPhoto.name}`;
                    const { error: uploadError } = await supabase.storage
                        .from('review-photos')
                        .upload(photoPath, compressedPhoto, {
                            cacheControl: '3600',
                            upsert: false
                        });

                    if (uploadError) {
                        throw new Error(`음식 사진 업로드 실패: ${uploadError.message}`);
                    }
                    return photoPath;
                });

                uploadedNewPhotoPaths = await Promise.all(uploadPromises);
            }

            // 2. Combine existing and new photo paths
            const finalFoodPhotos = [...existingFoodPhotos, ...uploadedNewPhotoPaths];

            // 3. Update review in database
            const { error: updateError } = await supabase
                .from('reviews')
                .update({
                    content: content.trim(),
                    categories: categories,
                    food_photos: finalFoodPhotos,
                    is_verified: false, // Require re-verification
                    admin_note: null, // Clear previous admin note
                    updated_at: new Date().toISOString(),
                } as never)
                .eq('id', review.id);

            if (updateError) {
                throw new Error(`리뷰 수정 실패: ${updateError.message}`);
            }

            // 4. Delete removed photos from storage (optional, for cleanup)
            if (removedPhotos.length > 0) {
                await supabase.storage
                    .from('review-photos')
                    .remove(removedPhotos);
            }

            toast({
                title: "리뷰 수정 완료",
                description: "관리자 재검토 후 다시 공개됩니다.",
            });

            if (onSuccess) {
                onSuccess();
            }
            handleClose();
        } catch (error) {
            console.error('리뷰 수정 오류:', error);
            const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다";
            toast({
                title: "리뷰 수정 실패",
                description: errorMessage,
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // Delete review handler
    const handleDeleteReview = async () => {
        if (!review || !user) return;

        setIsDeleting(true);

        try {
            // Delete review from database
            const { error: deleteError } = await supabase
                .from('reviews')
                .delete()
                .eq('id', review.id)
                .eq('user_id', user.id); // Ensure user owns the review

            if (deleteError) {
                throw new Error(`리뷰 삭제 실패: ${deleteError.message}`);
            }

            // Delete all photos from storage
            const allPhotos = [...existingFoodPhotos];
            if (allPhotos.length > 0) {
                await supabase.storage
                    .from('review-photos')
                    .remove(allPhotos);
            }

            // Delete draft from IndexedDB
            try {
                await deleteEditDraft(user.id, `edit_${review.id}`);
            } catch (e) {
                console.error('Draft deletion failed:', e);
            }

            toast({
                title: "리뷰 삭제 완료",
                description: "리뷰가 성공적으로 삭제되었습니다.",
            });

            if (onSuccess) {
                onSuccess();
            }
            handleClose();
        } catch (error) {
            console.error('리뷰 삭제 오류:', error);
            const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다";
            toast({
                title: "리뷰 삭제 실패",
                description: errorMessage,
                variant: "destructive",
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleClose = useCallback(async () => {
        // Delete draft when closing if submitted successfully
        if (user && review) {
            try {
                await deleteEditDraft(user.id, `edit_${review.id}`);
            } catch (e) {
                console.error('Draft cleanup failed:', e);
            }
        }
        setCategories([]);
        setContent("");
        setNewFoodPhotos([]);
        setExistingFoodPhotos([]);
        setRemovedPhotos([]);
        setLastSavedAt(null);
        onClose();
    }, [onClose, user, review]);

    // Form validation
    const isFormValid = useMemo(() => {
        const totalPhotos = existingFoodPhotos.length + newFoodPhotos.length;
        return categories.length > 0 && content.trim().length >= 20 && totalPhotos > 0;
    }, [categories.length, content, existingFoodPhotos.length, newFoodPhotos.length]);

    // Check if this is a rejected review
    const isRejected = review?.adminNote?.includes("거부");

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            {isOpen && review && (
                <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-hidden p-0 rounded-xl">
                    <div className="flex flex-col h-full max-h-[calc(100dvh-2rem)]">
                        <DialogHeader className="px-6 pt-6 pb-4 border-b relative shrink-0">
                            {/* 자동 저장 상태 표시 */}
                            <div className="absolute top-1.5 left-6 flex items-center gap-1 text-[10px] text-muted-foreground">
                                {lastSavedAt && (
                                    <>
                                        <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />
                                        <span className="text-green-600">
                                            저장됨 {lastSavedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </>
                                )}
                            </div>
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                    <DialogTitle className="text-xl">
                                        {isRejected ? "리뷰 수정 후 재제출" : "리뷰 수정"}
                                    </DialogTitle>
                                    <DialogDescription className="mt-1">
                                        <span className="font-medium text-foreground">{review.restaurantName}</span>
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto px-6 py-4">
                            <div className="space-y-5">
                                {/* Rejection reason display */}
                                {isRejected && review.adminNote && (
                                    <Alert className="bg-red-50 border-red-200">
                                        <AlertCircle className="h-4 w-4 text-red-600" />
                                        <AlertDescription className="text-red-800">
                                            <div className="font-semibold mb-1">이전 거부 사유</div>
                                            <p className="text-sm">
                                                {review.adminNote.startsWith("거부: ")
                                                    ? review.adminNote.substring(4)
                                                    : review.adminNote}
                                            </p>
                                        </AlertDescription>
                                    </Alert>
                                )}

                                {/* Edit notice */}
                                <Alert className="bg-amber-50 border-amber-200">
                                    <Info className="h-4 w-4 text-amber-600" />
                                    <AlertDescription className="text-amber-800 text-sm flex flex-col gap-0.5">
                                        <span>수정 시 관리자 재검토가 필요합니다.</span>
                                        <span>승인 전까지 리뷰가 비공개 처리됩니다.</span>
                                    </AlertDescription>
                                </Alert>


                                {/* Category selection */}
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
                                                        : "카테고리 선택"
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
                                                                id={`edit-category-${cat}`}
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
                                                                htmlFor={`edit-category-${cat}`}
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

                                {/* Review content */}
                                <div className="space-y-2">
                                    <Label htmlFor="editContent">
                                        리뷰 내용 <span className="text-red-500">*</span>
                                        <span className="text-xs text-muted-foreground ml-2">
                                            ({content.trim().length}/20자 이상)
                                        </span>
                                    </Label>
                                    <Textarea
                                        id="editContent"
                                        placeholder="맛, 분위기, 서비스 등 상세한 후기를 작성해주세요"
                                        value={content}
                                        onChange={(e) => setContent(e.target.value)}
                                        className="min-h-[120px] resize-none"
                                    />
                                </div>

                                {/* Food photos */}
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-2">
                                        음식 사진 <span className="text-red-500">*</span>
                                        <span className="text-xs text-muted-foreground">
                                            (현재 {existingFoodPhotos.length + newFoodPhotos.length}장)
                                        </span>
                                    </Label>

                                    {/* Existing photos */}
                                    {existingFoodPhotos.length > 0 && (
                                        <div className="space-y-1">
                                            <p className="text-xs text-muted-foreground">기존 사진</p>
                                            <div className="flex flex-wrap gap-2">
                                                {existingFoodPhotos.map((photoPath, idx) => (
                                                    <div key={photoPath} className="relative group">
                                                        <div className="relative w-20 h-20 rounded-lg overflow-hidden border">
                                                            <Image
                                                                src={supabase.storage.from('review-photos').getPublicUrl(photoPath).data.publicUrl}
                                                                alt={`기존 음식 사진 ${idx + 1}`}
                                                                fill
                                                                unoptimized
                                                                sizes="80px"
                                                                className="object-cover"
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeExistingFoodPhoto(photoPath)}
                                                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <XIcon className="h-3 w-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* New photos */}
                                    {newFoodPhotos.length > 0 && (
                                        <div className="space-y-1">
                                            <p className="text-xs text-muted-foreground">새로 추가된 사진</p>
                                            <div className="flex flex-wrap gap-2">
                                                {newFoodPhotos.map((photo, idx) => (
                                                    <div key={idx} className="relative group">
                                                        <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-green-300">
                                                            <Image
                                                                src={newFoodPhotoUrls[idx]}
                                                                alt={`새 음식 사진 ${idx + 1}`}
                                                                fill
                                                                unoptimized
                                                                sizes="80px"
                                                                className="object-cover"
                                                            />
                                                        </div>
                                                        <div className="absolute -top-1 -left-1 bg-green-500 text-white rounded-full p-0.5">
                                                            <Plus className="h-2 w-2" />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeNewFoodPhoto(idx)}
                                                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <XIcon className="h-3 w-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Add more photos drop zone */}
                                    <Card
                                        ref={foodPhotosDropRef}
                                        className={`p-4 border-dashed transition-colors cursor-pointer ${isFoodPhotosDragging
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/50'
                                            }`}
                                        onDragOver={handleDragOver}
                                        onDragEnter={handleFoodPhotosDragEnter}
                                        onDragLeave={handleFoodPhotosDragLeave}
                                        onDrop={handleFoodPhotosDrop}
                                        onClick={openFoodPhotosFileDialog}
                                    >
                                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                                            <Plus className="h-4 w-4" />
                                            사진 추가하기
                                        </div>
                                        <input
                                            ref={foodPhotosFileInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={handleFoodPhotosChange}
                                            multiple
                                            className="hidden"
                                        />
                                    </Card>
                                </div>

                                {/* Notice about verification photo */}
                                <Alert className="bg-muted/50 border-muted">
                                    <Info className="h-4 w-4" />
                                    <AlertDescription className="text-xs text-muted-foreground">
                                        영수증 인증 사진과 방문 날짜는 수정할 수 없습니다.
                                    </AlertDescription>
                                </Alert>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t bg-muted/30 shrink-0">
                            <div className="flex gap-2">
                                {/* Delete button with confirmation */}
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="destructive"
                                            size="icon"
                                            disabled={isSubmitting || isDeleting}
                                            title="리뷰 삭제"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>리뷰를 삭제하시겠습니까?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                이 작업은 취소할 수 없습니다. 리뷰와 함께 업로드된 모든 사진이 영구적으로 삭제됩니다.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>취소</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={handleDeleteReview}
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                                {isDeleting ? "삭제 중..." : "삭제"}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                                <Button
                                    variant="outline"
                                    onClick={handleClose}
                                    className="flex-1"
                                    disabled={isSubmitting || isDeleting}
                                >
                                    취소
                                </Button>
                                <Button
                                    onClick={handleSubmit}
                                    className="flex-1"
                                    disabled={!isFormValid || isSubmitting || isDeleting}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                                            수정 중...
                                        </>
                                    ) : (
                                        isRejected ? "수정 후 재제출" : "수정 완료"
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent >
            )
            }
        </Dialog >
    );
}
