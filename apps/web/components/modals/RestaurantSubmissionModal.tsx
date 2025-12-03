'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { X, Send } from "lucide-react";
import { RESTAURANT_CATEGORIES } from "@/types/restaurant";

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
    const [submissionMode, setSubmissionMode] = useState<'new' | 'update'>('new');
    const [selectedRestaurant, setSelectedRestaurant] = useState<any>(null);
    const [categoryInput, setCategoryInput] = useState("");
    const [formData, setFormData] = useState({
        restaurant_name: "",
        address: "",
        phone: "",
        categories: [] as string[],
        youtube_link: "",
        description: "",
    });

    // 수정용 모든 맛집 조회
    const { data: allRestaurants = [] } = useQuery({
        queryKey: ['all-restaurants'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, unique_id, name, road_address, jibun_address, categories, phone')
                .eq('status', 'approved')
                .order('name');

            if (error) throw error;
            return data || [];
        },
        enabled: isOpen && submissionMode === 'update',
    });

    // 모달 열릴 때 초기화
    useEffect(() => {
        if (isOpen) {
            resetForm();
        }
    }, [isOpen, submissionMode]);

    // 제보 제출
    const submitMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            if (!user) throw new Error('로그인이 필요합니다');

            const submissionData: any = {
                user_id: user.id,
                user_submitted_name: data.restaurant_name.trim(),
                user_submitted_categories: data.categories,
                user_submitted_phone: data.phone.trim() || null,
                user_raw_address: data.address.trim(),
                youtube_link: data.youtube_link.trim(),
                description: data.description.trim() || null,
                status: 'pending',
                submission_type: submissionMode === 'update' ? 'edit' : 'new',
            };

            if (submissionMode === 'update' && selectedRestaurant) {
                submissionData.restaurant_id = selectedRestaurant.id;
                submissionData.unique_id = selectedRestaurant.unique_id;
            }

            const { error } = await supabase
                .from('restaurant_submissions')
                .insert(submissionData);

            if (error) throw error;
        },
        onSuccess: () => {
            const modeText = submissionMode === 'new' ? '맛집 제보' : '수정 요청';
            toast.success(`${modeText}가 성공적으로 제출되었습니다!`);
            queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
            onClose();
            resetForm();
        },
        onError: (error: any) => {
            const modeText = submissionMode === 'new' ? '제보' : '수정 요청';
            toast.error(error.message || `${modeText} 제출에 실패했습니다`);
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
        setSelectedRestaurant(null);
        setCategoryInput("");
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!user) {
            toast.error('로그인이 필요합니다');
            return;
        }

        if (!formData.restaurant_name.trim() || !formData.address.trim() ||
            !formData.youtube_link.trim() || formData.categories.length === 0) {
            toast.error('필수 항목을 모두 입력해주세요');
            return;
        }

        submitMutation.mutate(formData);
    };

    const handleRestaurantSelect = (restaurant: any) => {
        const safeCategories = Array.isArray(restaurant.categories)
            ? restaurant.categories
            : (restaurant.categories ? [restaurant.categories] : []);

        const restaurantAddress = restaurant.road_address || restaurant.jibun_address || "";

        setSelectedRestaurant(restaurant);
        setFormData({
            restaurant_name: restaurant.name,
            address: restaurantAddress,
            phone: restaurant.phone || "",
            categories: safeCategories,
            youtube_link: "",
            description: "",
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                        {submissionMode === 'new' ? '쯔동여지도 제보하기' : '맛집 수정 요청'}
                    </DialogTitle>
                    <DialogDescription>
                        {submissionMode === 'new'
                            ? '쯔양이 방문한 맛집 정보와 유튜브 영상 링크를 알려주세요'
                            : '잘못된 정보나 오타가 있는 맛집 정보를 수정해주세요'
                        }
                    </DialogDescription>
                </DialogHeader>

                {/* 모드 선택 */}
                <div className="flex gap-2 mb-4">
                    <Button
                        type="button"
                        variant={submissionMode === 'new' ? 'default' : 'outline'}
                        onClick={() => setSubmissionMode('new')}
                        className="flex-1"
                    >
                        신규 맛집 제보
                    </Button>
                    <Button
                        type="button"
                        variant={submissionMode === 'update' ? 'default' : 'outline'}
                        onClick={() => setSubmissionMode('update')}
                        className="flex-1"
                    >
                        맛집 수정 요청
                    </Button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* 기존 맛집 선택 (수정 모드만) */}
                    {submissionMode === 'update' && (
                        <div className="space-y-2">
                            <Label>
                                수정할 맛집 선택 <span className="text-red-500">*</span>
                            </Label>
                            <Select
                                value={selectedRestaurant?.id || ""}
                                onValueChange={(value) => {
                                    const restaurant = allRestaurants.find((r: any) => r.id === value);
                                    if (restaurant) handleRestaurantSelect(restaurant);
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="수정할 맛집을 선택해주세요" />
                                </SelectTrigger>
                                <SelectContent>
                                    {allRestaurants.map((restaurant: any) => (
                                        <SelectItem key={restaurant.id} value={restaurant.id}>
                                            {restaurant.name} - {restaurant.road_address || restaurant.jibun_address}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="restaurant_name">
                            맛집 이름 <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="restaurant_name"
                            value={formData.restaurant_name}
                            onChange={(e) => setFormData({ ...formData, restaurant_name: e.target.value })}
                            placeholder="예: 명동 짜장면"
                            disabled={submissionMode === 'update' && !selectedRestaurant}
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
                            disabled={submissionMode === 'update' && !selectedRestaurant}
                        />
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
                        <Label htmlFor="youtube_link">
                            유튜브 영상 링크 <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="youtube_link"
                            value={formData.youtube_link}
                            onChange={(e) => setFormData({ ...formData, youtube_link: e.target.value })}
                            placeholder="https://youtube.com/watch?v=..."
                            className="min-h-[60px]"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">쯔양의 리뷰</Label>
                        <Textarea
                            id="description"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="쯔양이 이 맛집에 대해 한 리뷰 내용을 입력해주세요..."
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
                            disabled={submitMutation.isPending}
                            className="flex-1 bg-red-800 hover:bg-red-900"
                        >
                            <Send className="h-4 w-4 mr-2" />
                            {submitMutation.isPending ? '제출 중...' : '제보하기'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
