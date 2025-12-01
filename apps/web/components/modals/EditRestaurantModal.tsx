'use client';

import { memo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Restaurant } from "@/types/restaurant";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface EditRestaurantModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant: Restaurant | null;
    initialFormData: {
        name: string;
        address: string;
        phone: string;
        category: string[];
        youtube_reviews: { youtube_link: string; tzuyang_review: string; unique_id?: string }[];
    };
}

export const EditRestaurantModal = memo(function EditRestaurantModal({ isOpen, onClose, restaurant, initialFormData }: EditRestaurantModalProps) {
    const [editFormData, setEditFormData] = useState(initialFormData);
    const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);

    const handleEditFormChange = (field: string, value: string | string[]) => {
        setEditFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const handleYoutubeReviewChange = (index: number, field: 'youtube_link' | 'tzuyang_review', value: string) => {
        setEditFormData(prev => ({
            ...prev,
            youtube_reviews: prev.youtube_reviews.map((item, i) =>
                i === index ? { ...item, [field]: value } : item
            )
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                throw new Error('로그인이 필요합니다.');
            }

            const submissionData = editFormData.youtube_reviews.map(review => ({
                unique_id: review.unique_id || null,
                name: editFormData.name,
                categories: editFormData.category,
                address: editFormData.address,
                phone: editFormData.phone,
                youtube_link: review.youtube_link,
                tzuyang_review: review.tzuyang_review
            }));

            const { error } = await supabase
                .from('restaurant_submissions')
                .insert({
                    user_id: user.id,
                    submission_type: 'edit',
                    status: 'pending',
                    user_restaurants_submission: submissionData
                } as any);

            if (error) throw error;

            toast.success('맛집 수정 요청이 성공적으로 제출되었습니다!');
            onClose();
        } catch (error) {
            console.error('제출 실패:', error);
            toast.error('제출에 실패했습니다. 다시 시도해주세요.');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl text-primary font-bold">
                        맛집 수정 요청
                    </DialogTitle>
                    <DialogDescription>
                        해당 맛집의 유튜브 영상별 정보를 수정해주세요
                    </DialogDescription>
                </DialogHeader>

                {restaurant && (
                    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                        {/* 공통 정보 입력 */}
                        <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                            <h3 className="font-semibold text-lg">공통 정보</h3>

                            <div className="space-y-2">
                                <Label htmlFor="name">
                                    맛집 이름 <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="name"
                                    value={editFormData.name}
                                    onChange={(e) => handleEditFormChange('name', e.target.value)}
                                    placeholder="맛집 이름을 입력해주세요"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="address">
                                    주소 <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="address"
                                    value={editFormData.address}
                                    onChange={(e) => handleEditFormChange('address', e.target.value)}
                                    placeholder="주소를 입력해주세요"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="phone">전화번호</Label>
                                <Input
                                    id="phone"
                                    value={editFormData.phone}
                                    onChange={(e) => handleEditFormChange('phone', e.target.value)}
                                    placeholder="전화번호를 입력해주세요"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="category">
                                    카테고리 <span className="text-red-500">*</span>
                                </Label>
                                <Popover open={isCategoryPopoverOpen} onOpenChange={setIsCategoryPopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            role="combobox"
                                            aria-expanded={isCategoryPopoverOpen}
                                            className="w-full justify-between"
                                        >
                                            {editFormData.category.length > 0
                                                ? `${editFormData.category.length}개 선택됨`
                                                : "카테고리를 선택해주세요"
                                            }
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-full p-0" align="start">
                                        <Command>
                                            <CommandInput placeholder="카테고리 검색..." />
                                            <CommandList>
                                                <CommandEmpty>카테고리를 찾을 수 없습니다.</CommandEmpty>
                                                <CommandGroup>
                                                    {[
                                                        "한식", "중식", "일식", "양식", "분식", "치킨·피자",
                                                        "고기", "족발·보쌈", "돈까스·회", "아시안",
                                                        "패스트푸드", "카페·디저트", "기타"
                                                    ].map((category) => {
                                                        const isSelected = editFormData.category.includes(category);
                                                        return (
                                                            <CommandItem
                                                                key={category}
                                                                onSelect={() => {
                                                                    const newCategories = isSelected
                                                                        ? editFormData.category.filter(c => c !== category)
                                                                        : [...editFormData.category, category];
                                                                    handleEditFormChange('category', newCategories);
                                                                }}
                                                            >
                                                                <Check
                                                                    className={`mr-2 h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"}`}
                                                                />
                                                                {category}
                                                            </CommandItem>
                                                        );
                                                    })}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                {editFormData.category.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {editFormData.category.map((category) => (
                                            <Badge key={category} variant="secondary" className="text-xs">
                                                {category}
                                                <button
                                                    type="button"
                                                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                                                    onClick={() => {
                                                        const newCategories = editFormData.category.filter(c => c !== category);
                                                        handleEditFormChange('category', newCategories);
                                                    }}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 유튜브 영상별 정보 */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">유튜브 영상별 정보</h3>

                            {editFormData.youtube_reviews.map((review, index) => (
                                <Card key={index} className="p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Badge variant="outline">영상 {index + 1}</Badge>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>유튜브 링크</Label>
                                        <Input
                                            value={review.youtube_link}
                                            onChange={(e) => handleYoutubeReviewChange(index, 'youtube_link', e.target.value)}
                                            placeholder="https://www.youtube.com/watch?v=..."
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>쯔양 리뷰</Label>
                                        <Textarea
                                            value={review.tzuyang_review}
                                            onChange={(e) => handleYoutubeReviewChange(index, 'tzuyang_review', e.target.value)}
                                            placeholder="쯔양의 리뷰 내용을 입력해주세요"
                                            rows={3}
                                        />
                                    </div>
                                </Card>
                            ))}
                        </div>

                        <div className="flex gap-2 pt-4">
                            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                                취소
                            </Button>
                            <Button type="submit" className="flex-1 bg-gradient-primary hover:opacity-90">
                                수정 요청 제출
                            </Button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
});
