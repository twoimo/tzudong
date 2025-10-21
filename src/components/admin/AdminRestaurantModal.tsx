import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Restaurant, RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface AdminRestaurantModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant?: Restaurant | null;
    onSuccess: () => void;
}

export function AdminRestaurantModal({
    isOpen,
    onClose,
    restaurant,
    onSuccess,
}: AdminRestaurantModalProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        name: "",
        address: "",
        phone: "",
        category: RESTAURANT_CATEGORIES[0],
        youtube_link: "",
        tzuyang_review: "",
        lat: "",
        lng: "",
        ai_rating: "",
    });

    useEffect(() => {
        if (restaurant) {
            setFormData({
                name: restaurant.name || "",
                address: restaurant.address || "",
                phone: restaurant.phone || "",
                category: restaurant.category || RESTAURANT_CATEGORIES[0],
                youtube_link: restaurant.youtube_link || "",
                tzuyang_review: restaurant.tzuyang_review || "",
                lat: String(restaurant.lat || ""),
                lng: String(restaurant.lng || ""),
                ai_rating: String(restaurant.ai_rating || ""),
            });
        } else {
            resetForm();
        }
    }, [restaurant]);

    const resetForm = () => {
        setFormData({
            name: "",
            address: "",
            phone: "",
            category: RESTAURANT_CATEGORIES[0],
            youtube_link: "",
            tzuyang_review: "",
            lat: "",
            lng: "",
            ai_rating: "",
        });
    };

    const geocodeAddress = async (address: string) => {
        try {
            const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
            const response = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
                    address
                )}&key=${apiKey}`
            );
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                const location = data.results[0].geometry.location;
                return { lat: location.lat, lng: location.lng };
            }
            return null;
        } catch (error) {
            console.error("Geocoding error:", error);
            return null;
        }
    };

    const handleAddressBlur = async () => {
        if (formData.address && (!formData.lat || !formData.lng)) {
            toast.info("주소로 좌표를 검색 중...");
            const coords = await geocodeAddress(formData.address);
            if (coords) {
                setFormData({
                    ...formData,
                    lat: String(coords.lat),
                    lng: String(coords.lng),
                });
                toast.success("좌표가 자동으로 입력되었습니다");
            } else {
                toast.error("주소에서 좌표를 찾을 수 없습니다");
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name.trim() || !formData.address.trim()) {
            toast.error("이름과 주소는 필수입니다");
            return;
        }

        const lat = parseFloat(formData.lat);
        const lng = parseFloat(formData.lng);

        if (isNaN(lat) || isNaN(lng)) {
            toast.error("올바른 좌표를 입력해주세요");
            return;
        }

        setIsSubmitting(true);

        try {
            const restaurantData = {
                name: formData.name.trim(),
                address: formData.address.trim(),
                phone: formData.phone.trim() || null,
                category: formData.category,
                youtube_link: formData.youtube_link.trim() || null,
                tzuyang_review: formData.tzuyang_review.trim() || null,
                lat,
                lng,
                ai_rating: formData.ai_rating ? parseFloat(formData.ai_rating) : null,
            };

            let error;

            if (restaurant) {
                // Update existing restaurant
                ({ error } = await supabase
                    .from("restaurants")
                    .update(restaurantData)
                    .eq("id", restaurant.id));
            } else {
                // Create new restaurant
                ({ error } = await supabase.from("restaurants").insert(restaurantData));
            }

            if (error) throw error;

            toast.success(
                restaurant ? "맛집이 수정되었습니다" : "맛집이 등록되었습니다"
            );
            onSuccess();
            resetForm();
            onClose();
        } catch (error: any) {
            console.error("Restaurant submission error:", error);
            toast.error(error.message || "작업에 실패했습니다");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!restaurant) return;

        if (!confirm("정말 이 맛집을 삭제하시겠습니까?")) {
            return;
        }

        setIsSubmitting(true);

        try {
            const { error } = await supabase
                .from("restaurants")
                .delete()
                .eq("id", restaurant.id);

            if (error) throw error;

            toast.success("맛집이 삭제되었습니다");
            onSuccess();
            onClose();
        } catch (error: any) {
            console.error("Restaurant deletion error:", error);
            toast.error(error.message || "삭제에 실패했습니다");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl">
                        {restaurant ? "🏪 맛집 수정" : "🏪 맛집 등록"}
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">이름 *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="맛집 이름"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="category">카테고리 *</Label>
                            <Select
                                value={formData.category}
                                onValueChange={(value) =>
                                    setFormData({ ...formData, category: value as any })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {RESTAURANT_CATEGORIES.map((cat) => (
                                        <SelectItem key={cat} value={cat}>
                                            {cat}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="address">주소 *</Label>
                        <Input
                            id="address"
                            value={formData.address}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            onBlur={handleAddressBlur}
                            placeholder="서울시 강남구..."
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="lat">위도 *</Label>
                            <Input
                                id="lat"
                                type="number"
                                step="0.00000001"
                                value={formData.lat}
                                onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
                                placeholder="37.5665"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="lng">경도 *</Label>
                            <Input
                                id="lng"
                                type="number"
                                step="0.00000001"
                                value={formData.lng}
                                onChange={(e) => setFormData({ ...formData, lng: e.target.value })}
                                placeholder="126.9780"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="ai_rating">AI 점수 (1-10)</Label>
                            <Input
                                id="ai_rating"
                                type="number"
                                step="0.1"
                                min="1"
                                max="10"
                                value={formData.ai_rating}
                                onChange={(e) =>
                                    setFormData({ ...formData, ai_rating: e.target.value })
                                }
                                placeholder="8.5"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="phone">전화번호</Label>
                        <Input
                            id="phone"
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            placeholder="02-1234-5678"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="youtube_link">유튜브 링크</Label>
                        <Input
                            id="youtube_link"
                            value={formData.youtube_link}
                            onChange={(e) =>
                                setFormData({ ...formData, youtube_link: e.target.value })
                            }
                            placeholder="https://youtube.com/watch?v=..."
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="tzuyang_review">쯔양 리뷰</Label>
                        <Textarea
                            id="tzuyang_review"
                            value={formData.tzuyang_review}
                            onChange={(e) =>
                                setFormData({ ...formData, tzuyang_review: e.target.value })
                            }
                            placeholder="쯔양이 방문한 소감..."
                            rows={4}
                        />
                    </div>

                    <div className="flex gap-2">
                        {restaurant && (
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={handleDelete}
                                disabled={isSubmitting}
                            >
                                삭제
                            </Button>
                        )}
                        <div className="flex-1" />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button
                            type="submit"
                            className="bg-gradient-primary hover:opacity-90"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    처리 중...
                                </>
                            ) : restaurant ? (
                                "수정"
                            ) : (
                                "등록"
                            )}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

