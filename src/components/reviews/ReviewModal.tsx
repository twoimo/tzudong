import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Restaurant, RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";
import { format } from "date-fns";

interface ReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant: Restaurant;
}

export function ReviewModal({ isOpen, onClose, restaurant }: ReviewModalProps) {
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [visitedDate, setVisitedDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [visitedTime, setVisitedTime] = useState("12:00");
    const [category, setCategory] = useState(restaurant.category);
    const [verificationPhoto, setVerificationPhoto] = useState<File | null>(null);
    const [foodPhotos, setFoodPhotos] = useState<File[]>([]);

    const handleVerificationPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                toast.error("파일 크기는 5MB 이하여야 합니다");
                return;
            }
            setVerificationPhoto(file);
        }
    };

    const handleFoodPhotosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const validFiles = files.filter(file => {
            if (file.size > 5 * 1024 * 1024) {
                toast.error(`${file.name}은(는) 5MB를 초과합니다`);
                return false;
            }
            return true;
        });

        if (foodPhotos.length + validFiles.length > 5) {
            toast.error("음식 사진은 최대 5장까지 업로드할 수 있습니다");
            return;
        }

        setFoodPhotos([...foodPhotos, ...validFiles]);
    };

    const removeFoodPhoto = (index: number) => {
        setFoodPhotos(foodPhotos.filter((_, i) => i !== index));
    };

    const uploadPhoto = async (file: File, path: string): Promise<string> => {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
        const filePath = `${path}/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from("review-photos")
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
            .from("review-photos")
            .getPublicUrl(filePath);

        return data.publicUrl;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!user) {
            toast.error("로그인이 필요합니다");
            return;
        }

        if (!title.trim()) {
            toast.error("제목을 입력해주세요");
            return;
        }

        if (!content.trim()) {
            toast.error("리뷰 내용을 입력해주세요");
            return;
        }

        if (!verificationPhoto) {
            toast.error("인증사진을 업로드해주세요");
            return;
        }

        setIsSubmitting(true);

        try {
            // Upload verification photo
            const verificationPhotoUrl = await uploadPhoto(
                verificationPhoto,
                `verification/${user.id}`
            );

            // Upload food photos
            const foodPhotoUrls = await Promise.all(
                foodPhotos.map((file) => uploadPhoto(file, `food/${user.id}`))
            );

            // Create review
            const visitedAt = new Date(`${visitedDate}T${visitedTime}`);

            const { error: reviewError } = await supabase.from("reviews").insert({
                user_id: user.id,
                restaurant_id: restaurant.id,
                title: title.trim(),
                content: content.trim(),
                visited_at: visitedAt.toISOString(),
                verification_photo: verificationPhotoUrl,
                food_photos: foodPhotoUrls,
                category: category,
                is_verified: false,
            });

            if (reviewError) throw reviewError;

            // Update restaurant review count
            await supabase.rpc("increment_review_count", {
                restaurant_id: restaurant.id,
            });

            toast.success("리뷰가 등록되었습니다! 관리자 승인 후 공개됩니다.");
            onClose();
            resetForm();
        } catch (error: any) {
            console.error("Review submission error:", error);
            toast.error(error.message || "리뷰 등록에 실패했습니다");
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        setTitle("");
        setContent("");
        setVisitedDate(format(new Date(), "yyyy-MM-dd"));
        setVisitedTime("12:00");
        setCategory(restaurant.category);
        setVerificationPhoto(null);
        setFoodPhotos([]);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl flex items-center gap-2">
                        ✍️ 리뷰 작성하기
                    </DialogTitle>
                    <div className="text-sm text-muted-foreground mt-2">
                        <span className="font-semibold">{restaurant.name}</span>에 대한 리뷰를 작성해주세요
                    </div>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6 mt-4">
                    {/* Title */}
                    <div className="space-y-2">
                        <Label htmlFor="title">제목 *</Label>
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="리뷰 제목을 입력하세요"
                            maxLength={100}
                        />
                    </div>

                    {/* Visited Date & Time */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="visited-date">방문 날짜 *</Label>
                            <Input
                                id="visited-date"
                                type="date"
                                value={visitedDate}
                                onChange={(e) => setVisitedDate(e.target.value)}
                                max={format(new Date(), "yyyy-MM-dd")}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="visited-time">방문 시간 *</Label>
                            <Input
                                id="visited-time"
                                type="time"
                                value={visitedTime}
                                onChange={(e) => setVisitedTime(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Category */}
                    <div className="space-y-2">
                        <Label>카테고리 *</Label>
                        <RadioGroup value={category} onValueChange={setCategory} className="grid grid-cols-3 gap-2">
                            {RESTAURANT_CATEGORIES.map((cat) => (
                                <div key={cat} className="flex items-center space-x-2">
                                    <RadioGroupItem value={cat} id={`cat-${cat}`} />
                                    <Label htmlFor={`cat-${cat}`} className="cursor-pointer text-sm">
                                        {cat}
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </div>

                    {/* Verification Photo */}
                    <div className="space-y-2">
                        <Label>인증사진 * (닉네임 포함 필수)</Label>
                        <div className="border-2 border-dashed border-border rounded-lg p-4">
                            {verificationPhoto ? (
                                <div className="relative">
                                    <img
                                        src={URL.createObjectURL(verificationPhoto)}
                                        alt="Verification"
                                        className="w-full h-48 object-cover rounded"
                                    />
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="icon"
                                        className="absolute top-2 right-2"
                                        onClick={() => setVerificationPhoto(null)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <label className="flex flex-col items-center justify-center h-32 cursor-pointer hover:bg-accent/50 rounded transition-colors">
                                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                                    <span className="text-sm text-muted-foreground">클릭하여 업로드</span>
                                    <span className="text-xs text-muted-foreground mt-1">(최대 5MB)</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleVerificationPhotoChange}
                                        className="hidden"
                                    />
                                </label>
                            )}
                        </div>
                    </div>

                    {/* Food Photos */}
                    <div className="space-y-2">
                        <Label>음식 사진 (최대 5장)</Label>
                        <div className="grid grid-cols-3 gap-2">
                            {foodPhotos.map((file, index) => (
                                <div key={index} className="relative">
                                    <img
                                        src={URL.createObjectURL(file)}
                                        alt={`Food ${index + 1}`}
                                        className="w-full h-24 object-cover rounded"
                                    />
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="icon"
                                        className="absolute top-1 right-1 h-6 w-6"
                                        onClick={() => removeFoodPhoto(index)}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            ))}
                            {foodPhotos.length < 5 && (
                                <label className="border-2 border-dashed border-border rounded h-24 flex items-center justify-center cursor-pointer hover:bg-accent/50 transition-colors">
                                    <Upload className="h-6 w-6 text-muted-foreground" />
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={handleFoodPhotosChange}
                                        className="hidden"
                                    />
                                </label>
                            )}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="space-y-2">
                        <Label htmlFor="content">리뷰 내용 *</Label>
                        <Textarea
                            id="content"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="방문 경험을 자세히 작성해주세요"
                            rows={6}
                            maxLength={1000}
                        />
                        <div className="text-xs text-muted-foreground text-right">
                            {content.length} / 1000자
                        </div>
                    </div>

                    {/* Submit Button */}
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            className="flex-1"
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button
                            type="submit"
                            className="flex-1 bg-gradient-primary hover:opacity-90"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    등록 중...
                                </>
                            ) : (
                                "등록하기"
                            )}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

