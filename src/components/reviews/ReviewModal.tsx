import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar, Upload, X, AlertCircle, CheckCircle2 } from "lucide-react";
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
    const [category, setCategory] = useState<Category | "">("");
    const [content, setContent] = useState("");
    const [verificationPhoto, setVerificationPhoto] = useState<File | null>(null);
    const [foodPhotos, setFoodPhotos] = useState<File[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleVerificationPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setVerificationPhoto(file);
        }
    };

    const handleFoodPhotosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        setFoodPhotos([...foodPhotos, ...files]);
    };

    const removeFoodPhoto = (index: number) => {
        setFoodPhotos(foodPhotos.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
        if (!visitedDate || !visitedTime || !category || !content || !verificationPhoto || foodPhotos.length === 0) {
            toast({
                title: "필수 항목 누락",
                description: "모든 필수 항목을 입력해주세요",
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
                title: "맛집 선택 필요",
                description: "리뷰를 작성할 맛집을 선택해주세요",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);

        try {
            // 1. Upload verification photo
            const verificationPhotoPath = `${user.id}/${Date.now()}_verification_${verificationPhoto.name}`;
            const { error: verificationUploadError } = await supabase.storage
                .from('review-photos')
                .upload(verificationPhotoPath, verificationPhoto, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (verificationUploadError) {
                throw new Error(`인증 사진 업로드 실패: ${verificationUploadError.message}`);
            }

            // 2. Upload food photos
            const foodPhotoUrls: string[] = [];
            for (let i = 0; i < foodPhotos.length; i++) {
                const photo = foodPhotos[i];
                const photoPath = `${user.id}/${Date.now()}_food_${i}_${photo.name}`;
                const { error: foodUploadError } = await supabase.storage
                    .from('review-photos')
                    .upload(photoPath, photo, {
                        cacheControl: '3600',
                        upsert: false
                    });

                if (foodUploadError) {
                    throw new Error(`음식 사진 업로드 실패: ${foodUploadError.message}`);
                }

                foodPhotoUrls.push(photoPath);
            }

            // 3. Create review record
            const visitedAtDateTime = `${visitedDate}T${visitedTime}:00`;

            // 타입 안전성을 위한 검증
            if (!category) {
                throw new Error("카테고리를 선택해주세요");
            }

            const { error: insertError } = await supabase
                .from('reviews')
                .insert({
                    user_id: user.id,
                    restaurant_id: restaurant.id,
                    title: `${restaurant.name} 방문 후기`,
                    content: content.trim(),
                    visited_at: visitedAtDateTime,
                    verification_photo: verificationPhotoPath,
                    food_photos: foodPhotoUrls,
                    category: category as Category,
                    is_verified: false, // 관리자 검토 대기
                });

            if (insertError) {
                throw new Error(`리뷰 등록 실패: ${insertError.message}`);
            }

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

    const handleClose = () => {
        setVisitedDate("");
        setVisitedTime("");
        setCategory("");
        setContent("");
        setVerificationPhoto(null);
        setFoodPhotos([]);
        onClose();
    };

    const isFormValid = visitedDate && visitedTime && category && content && verificationPhoto && foodPhotos.length > 0;

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden p-0">
                <div className="flex flex-col h-full max-h-[90vh]">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b">
                        <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                            쯔양 팬 맛집 리뷰 작성
                        </DialogTitle>
                        <DialogDescription>
                            {restaurant ? `${restaurant.name}에 대한` : ""} 방문 후기를 공유해주세요
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        <div className="space-y-6">
                            {/* Important Notice */}
                            <Alert className="bg-amber-50 border-amber-200">
                                <AlertCircle className="h-4 w-4 text-amber-600" />
                                <AlertDescription className="text-amber-800">
                                    <strong>필수 인증:</strong> 신뢰도 높은 리뷰를 위해 본인의 닉네임이 포함된 인증 사진과 음식 사진이 필수입니다.
                                </AlertDescription>
                            </Alert>

                            {/* Visit Date & Time */}
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
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="visitTime">
                                        방문 시간 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="visitTime"
                                        type="time"
                                        value={visitedTime}
                                        onChange={(e) => setVisitedTime(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Category */}
                            <div className="space-y-2">
                                <Label>
                                    카테고리 <span className="text-red-500">*</span>
                                </Label>
                                <Select value={category} onValueChange={(value) => setCategory(value as Category)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="어떤 종류의 음식을 드셨나요?" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CATEGORIES.map((cat) => (
                                            <SelectItem key={cat} value={cat}>
                                                {cat}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Verification Photo */}
                            <div className="space-y-2">
                                <Label htmlFor="verificationPhoto" className="flex items-center gap-2">
                                    인증 사진 (본인 닉네임 포함) <span className="text-red-500">*</span>
                                </Label>
                                <Card className="p-4 border-dashed">
                                    <div className="flex flex-col items-center gap-3">
                                        {verificationPhoto ? (
                                            <div className="relative">
                                                <Badge variant="default" className="gap-1 mb-2">
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    인증 사진 업로드 완료
                                                </Badge>
                                                <div className="text-sm text-muted-foreground">
                                                    {verificationPhoto.name}
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="mt-2"
                                                    onClick={() => setVerificationPhoto(null)}
                                                >
                                                    <X className="h-4 w-4 mr-2" />
                                                    제거
                                                </Button>
                                            </div>
                                        ) : (
                                            <>
                                                <Upload className="h-8 w-8 text-muted-foreground" />
                                                <p className="text-sm text-center text-muted-foreground">
                                                    맛집 방문을 증명하는 인증 사진을 업로드해주세요
                                                    <br />
                                                    <span className="text-xs">
                                                        (화면에 본인의 닉네임이 함께 보이도록 촬영)
                                                    </span>
                                                </p>
                                                <Input
                                                    id="verificationPhoto"
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={handleVerificationPhotoChange}
                                                    className="max-w-xs"
                                                />
                                            </>
                                        )}
                                    </div>
                                </Card>
                            </div>

                            {/* Food Photos */}
                            <div className="space-y-2">
                                <Label htmlFor="foodPhotos" className="flex items-center gap-2">
                                    음식 사진 (다양한 각도) <span className="text-red-500">*</span>
                                </Label>
                                <Card className="p-4 border-dashed">
                                    <div className="space-y-3">
                                        {foodPhotos.length > 0 && (
                                            <div className="grid grid-cols-3 gap-3">
                                                {foodPhotos.map((photo, index) => (
                                                    <div key={index} className="relative">
                                                        <Card className="p-2">
                                                            <div className="text-xs text-muted-foreground truncate">
                                                                📷 {photo.name}
                                                            </div>
                                                        </Card>
                                                        <Button
                                                            variant="destructive"
                                                            size="icon"
                                                            className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                                                            onClick={() => removeFoodPhoto(index)}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="flex flex-col items-center gap-3 pt-3 border-t border-dashed">
                                            <Upload className="h-6 w-6 text-muted-foreground" />
                                            <p className="text-sm text-center text-muted-foreground">
                                                먹은 음식을 다양한 각도에서 촬영한 사진을 올려주세요
                                            </p>
                                            <Input
                                                id="foodPhotos"
                                                type="file"
                                                accept="image/*"
                                                multiple
                                                onChange={handleFoodPhotosChange}
                                                className="max-w-xs"
                                            />
                                        </div>
                                    </div>
                                </Card>
                                <p className="text-xs text-muted-foreground">
                                    업로드된 사진: {foodPhotos.length}개
                                </p>
                            </div>

                            {/* Review Content */}
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

                    {/* Footer */}
                    <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/50">
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
