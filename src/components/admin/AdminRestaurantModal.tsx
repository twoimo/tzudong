import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Restaurant, RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ChevronDown, X } from "lucide-react";

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
        categories: [] as string[],
        youtube_link: "",
        description: "",
        lat: "",
        lng: "",
    });

    useEffect(() => {
        if (restaurant) {
            setFormData({
                name: restaurant.name || "",
                address: restaurant.address || "",
                phone: restaurant.phone || "",
                categories: Array.isArray(restaurant.category) ? restaurant.category : [restaurant.category].filter(Boolean),
                youtube_link: restaurant.youtube_link || "",
                description: restaurant.description || "",
                lat: String(restaurant.lat || ""),
                lng: String(restaurant.lng || ""),
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
            categories: [],
            youtube_link: "",
            description: "",
            lat: "",
            lng: "",
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
                category: formData.categories, // TEXT[] 배열로 저장
                youtube_link: formData.youtube_link.trim() || null,
                description: formData.description.trim() || null,
                lat,
                lng,
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

        if (!confirm("정말로 이 맛집을 삭제하시겠습니까?\n\n삭제된 데이터는 복구할 수 없습니다.")) {
            return;
        }

        setIsSubmitting(true);

        try {
            // 해결책 1: 코드 레벨에서 제보 먼저 삭제 (임시 해결책)
            // 참고: 데이터베이스 레벨에서 CASCADE DELETE 설정을 권장합니다.
            // 새 마이그레이션 파일: 20251021200000_update_restaurant_submissions_cascade.sql

            const { error: submissionsError } = await supabase
                .from("restaurant_submissions")
                .delete()
                .eq("approved_restaurant_id", restaurant.id);

            if (submissionsError) {
                console.error("Submissions deletion error:", submissionsError);
                // 제보 삭제 실패 시에도 계속 진행 (외래 키 제약 조건으로 어차피 실패할 것임)
            }

            // 레스토랑 삭제
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
                            <Label>카테고리 *</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="w-full justify-between"
                                    >
                                        <span className="truncate">
                                            {formData.categories.length > 0
                                                ? `${formData.categories.length}개 선택됨`
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
                                            {RESTAURANT_CATEGORIES.map((category) => (
                                                <div key={category} className="flex items-center space-x-2">
                                                    <Checkbox
                                                        id={`admin-category-${category}`}
                                                        checked={formData.categories.includes(category)}
                                                        onCheckedChange={(checked) => {
                                                            if (checked) {
                                                                setFormData({
                                                                    ...formData,
                                                                    categories: [...formData.categories, category]
                                                                });
                                                            } else {
                                                                setFormData({
                                                                    ...formData,
                                                                    categories: formData.categories.filter(c => c !== category)
                                                                });
                                                            }
                                                        }}
                                                    />
                                                    <Label
                                                        htmlFor={`admin-category-${category}`}
                                                        className="text-sm cursor-pointer flex-1"
                                                    >
                                                        {category}
                                                    </Label>
                                                </div>
                                            ))}
                                        </div>
                                        {formData.categories.length > 0 && (
                                            <div className="pt-2 border-t">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setFormData({ ...formData, categories: [] })}
                                                    className="w-full"
                                                >
                                                    선택 해제
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </PopoverContent>
                            </Popover>
                            {formData.categories.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {formData.categories.map((category) => (
                                        <Badge key={category} variant="secondary" className="text-xs">
                                            {category}
                                            <button
                                                type="button"
                                                onClick={() => setFormData({
                                                    ...formData,
                                                    categories: formData.categories.filter(c => c !== category)
                                                })}
                                                className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            )}
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
                        <Label htmlFor="description">쯔양의 리뷰</Label>
                        <Textarea
                            id="description"
                            value={formData.description}
                            onChange={(e) =>
                                setFormData({ ...formData, description: e.target.value })
                            }
                            placeholder="쯔양이 어떤 리뷰를 남겼는지 입력해주세요..."
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

