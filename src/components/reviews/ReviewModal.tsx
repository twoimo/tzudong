import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar, Upload, X as XIcon, AlertCircle, CheckCircle2 } from "lucide-react";
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
    const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>("");
    const [categories, setCategories] = useState<Category[]>([]);
    const [content, setContent] = useState("");
    const [verificationPhoto, setVerificationPhoto] = useState<File | null>(null);
    const [foodPhotos, setFoodPhotos] = useState<File[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // 쯔양이 방문한 맛집 목록 조회
    const { data: jjyangRestaurants = [] } = useQuery({
        queryKey: ['jjyang-restaurants'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, name')
                .gt('jjyang_visit_count', 0)
                .order('name');

            if (error) throw error;
            return data || [];
        },
        enabled: isOpen,
    });

    // restaurant prop이 전달되면 해당 맛집을 기본 선택
    useEffect(() => {
        if (restaurant?.id) {
            setSelectedRestaurantId(restaurant.id);
        }
    }, [restaurant]);

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
        if (!visitedDate || !visitedTime || !selectedRestaurantId || categories.length === 0 || !content || !verificationPhoto || foodPhotos.length === 0) {
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

        // 선택된 맛집 정보 가져오기
        const selectedRestaurant = jjyangRestaurants.find(r => r.id === selectedRestaurantId);
        if (!selectedRestaurant) {
            toast({
                title: "맛집 선택 오류",
                description: "선택된 맛집 정보를 찾을 수 없습니다",
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

                console.log('방문 날짜/시간:', visitedAtDateTime); // 디버깅용
            } catch (error) {
                throw new Error(`날짜/시간 형식 오류: ${visitedDate} ${visitedTime}`);
            }

            // 타입 안전성을 위한 검증
            if (categories.length === 0) {
                throw new Error("카테고리를 선택해주세요");
            }

            const { error: insertError } = await supabase
                .from('reviews')
                .insert({
                user_id: user.id,
                    restaurant_id: selectedRestaurantId,
                    title: `${selectedRestaurant.name} 방문 후기`,
                content: content.trim(),
                    visited_at: visitedAtDateTime,
                    verification_photo: verificationPhotoPath,
                food_photos: foodPhotoUrls,
                    categories: categories,
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
        setSelectedRestaurantId("");
        setCategories([]);
        setContent("");
        setVerificationPhoto(null);
        setFoodPhotos([]);
        onClose();
    };

    const isFormValid = visitedDate && visitedTime && selectedRestaurantId && categories.length > 0 && content && verificationPhoto && foodPhotos.length > 0;

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden p-0">
                <div className="flex flex-col h-full max-h-[90vh]">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b">
                        <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                            쯔양 팬 맛집 리뷰 작성
                    </DialogTitle>
                        <DialogDescription>
                            쯔양이 방문한 맛집에 대한 방문 후기를 공유해주세요
                        </DialogDescription>
                </DialogHeader>

                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        <div className="space-y-6">
                            {/* Important Notice */}
                            <Alert className="bg-amber-50 border-amber-200">
                                <AlertCircle className="h-4 w-4 text-amber-600" />
                                <AlertDescription className="text-amber-800 space-y-2">
                                    <div>
                                        <strong>📸 인증 사진 필수 가이드라인:</strong>
                                    </div>
                                    <ul className="text-sm space-y-1 ml-4 list-disc">
                                        <li>본인의 닉네임이 잘 보이게 영수증에 적어주세요</li>
                                        <li>상호명, 날짜/시간, 주문 메뉴 등 중요 정보는 가리지 말고 그대로 촬영해주세요</li>
                                        <li>방문 날짜는 <strong className="text-red-600">3개월 이내</strong>여야 합니다</li>
                                        <li>음식 사진도 함께 업로드하면 더 신뢰할 수 있습니다</li>
                                    </ul>
                                    <div className="text-xs text-amber-700 mt-2">
                                        💡 팁: 영수증 위에 메모지로 닉네임을 적거나, 영수증에 직접 닉네임을 써서 촬영해주세요!
                                    </div>
                                </AlertDescription>
                            </Alert>

                            {/* Restaurant Selection */}
                    <div className="space-y-2">
                                <Label htmlFor="restaurant">
                                    방문한 쯔양 맛집 <span className="text-red-500">*</span>
                                </Label>
                                <Select value={selectedRestaurantId} onValueChange={setSelectedRestaurantId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="쯔양이 방문한 맛집을 선택해주세요" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {jjyangRestaurants.map((restaurant) => (
                                            <SelectItem key={restaurant.id} value={restaurant.id}>
                                                {restaurant.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {selectedRestaurantId && (
                                    <p className="text-xs text-muted-foreground">
                                        선택된 맛집: {jjyangRestaurants.find(r => r.id === selectedRestaurantId)?.name}
                                    </p>
                                )}
                    </div>

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

                    {/* Category */}
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
                                                    <XIcon className="h-4 w-4 mr-2" />
                                                    제거
                                    </Button>
                                </div>
                            ) : (
                                            <>
                                                <div className="text-center">
                                                    <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                                                    <p className="text-sm text-muted-foreground mb-1">
                                                        영수증 인증 사진을 업로드해주세요
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        본인 닉네임이 포함된 영수증 사진
                                                    </p>
                                                </div>
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
                                                            <XIcon className="h-3 w-3" />
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
