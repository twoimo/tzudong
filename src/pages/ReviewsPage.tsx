import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Pin, CheckCircle, Clock, MapPin, Calendar, MessageSquare } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ReviewModal } from "@/components/reviews/ReviewModal";

interface Review {
    id: string;
    restaurantName: string;
    restaurantCategory: string;
    userName: string;
    visitedAt: string;
    submittedAt: string;
    content: string;
    isVerified: boolean;
    isPinned: boolean;
    isEditedByAdmin: boolean;
    photos: { url: string; type: string }[];
    category: string;
}

// Mock data for demonstration
const mockReviews: Review[] = [
    {
        id: "1",
        restaurantName: "홍대 떡볶이",
        restaurantCategory: "분식",
        userName: "관리자",
        visitedAt: "2025-01-10T18:30:00",
        submittedAt: "2025-01-10T19:00:00",
        content: "인증사진 필수! 닉네임을 포함해서 찍어주세요. 맛집 리뷰 작성 시 참고해주세요.",
        isVerified: true,
        isPinned: true,
        isEditedByAdmin: true,
        photos: [],
        category: "분식",
    },
    {
        id: "2",
        restaurantName: "홍대 떡볶이",
        restaurantCategory: "분식",
        userName: "쯔양팬123",
        visitedAt: "2025-01-10T18:30:00",
        submittedAt: "2025-01-10T19:00:00",
        content: "정말 맛있었어요! 쯔양이 추천한 그 메뉴 먹었는데 양도 많고 맛도 좋았습니다! 떡볶이 소스가 진짜 특별해요.",
        isVerified: true,
        isPinned: false,
        isEditedByAdmin: false,
        photos: [],
        category: "분식",
    },
    {
        id: "3",
        restaurantName: "강남 파스타집",
        restaurantCategory: "양식",
        userName: "맛집러버",
        visitedAt: "2025-01-09T12:00:00",
        submittedAt: "2025-01-09T14:00:00",
        content: "맛은 괜찮은데 가격이 좀 비싼 편이에요. 분위기는 좋았습니다.",
        isVerified: false,
        isPinned: false,
        isEditedByAdmin: false,
        photos: [],
        category: "양식",
    },
];

const ReviewsPage = () => {
    const { user, isAdmin } = useAuth();
    const [searchQuery, setSearchQuery] = useState("");
    const [filterCategory, setFilterCategory] = useState<string>("all");
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [selectedReview, setSelectedReview] = useState<Review | null>(null);

    const filteredReviews = mockReviews.filter((review) => {
        const matchesSearch =
            review.restaurantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            review.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            review.content.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesCategory =
            filterCategory === "all" || review.category === filterCategory;

        const matchesStatus =
            filterStatus === "all" ||
            (filterStatus === "verified" && review.isVerified) ||
            (filterStatus === "pending" && !review.isVerified);

        return matchesSearch && matchesCategory && matchesStatus;
    });

    const sortedReviews = [...filteredReviews].sort((a, b) => {
        // Pinned reviews first
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;

        // Then by submitted date
        return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    });

    const handleWriteReview = () => {
        if (!user) {
            alert("로그인이 필요합니다");
            return;
        }
        setSelectedReview(null);
        setIsReviewModalOpen(true);
    };

    const handlePinReview = (reviewId: string) => {
        if (!isAdmin) {
            alert("관리자만 사용할 수 있는 기능입니다");
            return;
        }
        // TODO: Implement pin review in Supabase
        alert(`리뷰 ${reviewId}를 상단에 고정했습니다`);
    };

    const handleUnpinReview = (reviewId: string) => {
        if (!isAdmin) {
            alert("관리자만 사용할 수 있는 기능입니다");
            return;
        }
        // TODO: Implement unpin review in Supabase
        alert(`리뷰 ${reviewId}의 고정을 해제했습니다`);
    };

    const handleEditReview = (review: Review) => {
        if (!user) {
            alert("로그인이 필요합니다");
            return;
        }
        if (!isAdmin && review.userName !== user.email) {
            alert("본인의 리뷰만 수정할 수 있습니다");
            return;
        }
        // TODO: Implement edit review
        alert(`리뷰 ${review.id}를 수정합니다`);
    };

    const handleDeleteReview = (review: Review) => {
        if (!user) {
            alert("로그인이 필요합니다");
            return;
        }
        if (!isAdmin && review.userName !== user.email) {
            alert("본인의 리뷰만 삭제할 수 있습니다");
            return;
        }

        if (confirm("정말로 이 리뷰를 삭제하시겠습니까?")) {
            // TODO: Implement delete review in Supabase
            alert(`리뷰 ${review.id}를 삭제했습니다`);
        }
    };

    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                            <MessageSquare className="h-6 w-6 text-primary" />
                            맛집 리뷰
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            총 {sortedReviews.length}개의 리뷰
                        </p>
                    </div>
                    <Button
                        onClick={handleWriteReview}
                        className="bg-gradient-primary hover:opacity-90 gap-2"
                    >
                        <Plus className="h-4 w-4" />
                        글쓰기
                    </Button>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="맛집명, 작성자, 내용 검색..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>

                    <Select value={filterCategory} onValueChange={setFilterCategory}>
                        <SelectTrigger>
                            <SelectValue placeholder="카테고리" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체 카테고리</SelectItem>
                            <SelectItem value="치킨">치킨</SelectItem>
                            <SelectItem value="중식">중식</SelectItem>
                            <SelectItem value="분식">분식</SelectItem>
                            <SelectItem value="한식">한식</SelectItem>
                            <SelectItem value="양식">양식</SelectItem>
                            <SelectItem value="카페·디저트">카페·디저트</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger>
                            <SelectValue placeholder="인증 상태" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            <SelectItem value="verified">✅ 인증완료</SelectItem>
                            <SelectItem value="pending">⏳ 검토중</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Reviews List */}
            <ScrollArea className="flex-1">
                <div className="p-6 space-y-4">
                    {sortedReviews.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-muted-foreground">검색 결과가 없습니다.</p>
                        </div>
                    ) : (
                        sortedReviews.map((review) => (
                            <Card
                                key={review.id}
                                className={`p-6 hover:shadow-md transition-shadow ${review.isPinned ? "border-primary border-2" : ""
                                    }`}
                            >
                                {/* Header */}
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            {review.isPinned && (
                                                <Pin className="h-4 w-4 text-primary fill-primary" />
                                            )}
                                            <h3 className="text-lg font-bold flex items-center gap-2">
                                                {review.userName === "관리자" && (
                                                    <Badge variant="default" className="bg-gradient-primary">
                                                        관리자
                                                    </Badge>
                                                )}
                                                <span>{review.userName}</span>
                                            </h3>
                                            {review.isVerified ? (
                                                <Badge variant="default" className="gap-1 bg-green-600">
                                                    <CheckCircle className="h-3 w-3" />
                                                    인증완료
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary" className="gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    검토중
                                                </Badge>
                                            )}
                                        </div>

                                        {review.isEditedByAdmin && (
                                            <Badge variant="outline" className="mb-2 border-orange-500 text-orange-500">
                                                ⚠️ 관리자가 수정함
                                            </Badge>
                                        )}

                                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                            <div className="flex items-center gap-1">
                                                <MapPin className="h-3 w-3" />
                                                <span className="font-medium">{review.restaurantName}</span>
                                            </div>
                                            <Badge variant="outline">{review.restaurantCategory}</Badge>
                                            <div className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                방문: {formatDateTime(review.visitedAt)}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="mb-4">
                                    <p className="text-sm whitespace-pre-wrap">{review.content}</p>
                                </div>

                                {/* Photos placeholder */}
                                {review.photos.length > 0 && (
                                    <div className="flex gap-2 mb-4">
                                        {review.photos.map((photo, idx) => (
                                            <div
                                                key={idx}
                                                className="w-24 h-24 bg-muted rounded-lg flex items-center justify-center"
                                            >
                                                📷
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Footer */}
                                <div className="flex items-center justify-between pt-4 border-t border-border">
                                    <div className="text-xs text-muted-foreground">
                                        작성: {formatDateTime(review.submittedAt)}
                                    </div>

                                    <div className="flex gap-2">
                                        {(isAdmin || review.userName === user?.email) && (
                                            <>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleEditReview(review)}
                                                >
                                                    수정
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleDeleteReview(review)}
                                                >
                                                    삭제
                                                </Button>
                                            </>
                                        )}
                                        {isAdmin && (
                                            <>
                                                {review.isPinned ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-1"
                                                        onClick={() => handleUnpinReview(review.id)}
                                                    >
                                                        <Pin className="h-3 w-3" />
                                                        고정 해제
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-1"
                                                        onClick={() => handlePinReview(review.id)}
                                                    >
                                                        <Pin className="h-3 w-3" />
                                                        상단 고정
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            </ScrollArea>

            {/* Review Modal */}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={null}
            />
        </div>
    );
};

export default ReviewsPage;

