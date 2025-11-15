/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Send, Loader2, CheckCircle2, XCircle, Clock, Trash2, Youtube, X, MessageSquare } from "lucide-react";
import { RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface RestaurantSubmission {
    id: string;
    user_id: string;
    submission_type: 'new' | 'edit';
    restaurant_id: string | null;
    status: 'pending' | 'approved' | 'rejected';

    // 사용자 입력 필드
    user_submitted_name: string | null;
    user_submitted_categories: string[] | null;
    user_submitted_phone: string | null;
    user_raw_address: string | null;

    // 관리자 검토 후 필드
    name: string | null;
    phone: string | null;
    categories: string[] | null;
    lat: number | null;
    lng: number | null;
    road_address: string | null;
    jibun_address: string | null;
    english_address: string | null;
    address_elements: any | null;

    // 유튜브 및 리뷰
    youtube_link: string | null;
    youtube_links: string[];
    youtube_metas: any[];
    description: string | null;
    tzuyang_reviews: any[];

    // 수정 요청 관련
    unique_id: string | null;
    changes_requested: any | null;

    // 관리자 처리
    admin_notes: string | null;
    rejection_reason: string | null;
    resolved_by_admin_id: string | null;
    reviewed_at: string | null;
    reviewed_by_admin_id: string | null;
    approved_restaurant_id: string | null;

    created_at: string;
    updated_at: string;
}

export default function RestaurantSubmissionsPage() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
    const [submissionMode, setSubmissionMode] = useState<'new' | 'update'>('new');
    const [selectedRestaurant, setSelectedRestaurant] = useState<any>(null);
    const [originalData, setOriginalData] = useState<any>(null);
    const [categoryInput, setCategoryInput] = useState("");
    const [formData, setFormData] = useState({
        restaurant_name: "",
        address: "",
        phone: "",
        categories: [] as string[],
        youtube_link: "",
        description: "",
        youtube_links: [] as string[],
        youtube_metas: [] as any[],
        tzuyang_reviews: [] as any[],
        video_reviews: [] as Array<{ id: string, youtube_link: string, review: string }>,
    });

    // 모든 맛집 조회 (수정 요청용) - youtube_links, youtube_metas, tzuyang_reviews 포함
    const { data: allRestaurants = [] } = useQuery({
        queryKey: ['all-restaurants'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, unique_id, name, road_address, jibun_address, categories, phone, youtube_links, youtube_metas, tzuyang_reviews')
                .eq('status', 'approved')
                .order('name');

            if (error) {
                console.error('❌ 맛집 조회 실패:', error);
                throw error;
            }
            return data || [];
        },
    });

    // 내 제보 내역 조회 - 무한 스크롤 방식
    const {
        data: submissionsPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
        refetch
    } = useInfiniteQuery({
        queryKey: ['my-submissions', user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            const { data, error } = await supabase
                .from('restaurant_submissions')
                .select('*')
                .eq('user_id', user!.id)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19); // 한 페이지당 20개씩

            if (error) throw error;

            if (!data || data.length === 0) {
                return { submissions: [], nextCursor: null };
            }

            // 다음 페이지 커서 계산
            const nextCursor = data.length === 20 ? pageParam + 20 : null;

            return {
                submissions: data as RestaurantSubmission[],
                nextCursor,
            };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        enabled: !!user,
    });

    // 모든 페이지를 평탄화하여 하나의 배열로 만들기
    const submissions = submissionsPages?.pages.flatMap(page => page.submissions) || [];

    // 제보 내역 무한 스크롤을 위한 Intersection Observer
    const loadMoreRef = useRef<HTMLDivElement>(null);

    const loadMoreSubmissions = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreSubmissions();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [loadMoreSubmissions]);

    // 모달이 열릴 때 상태 초기화
    useEffect(() => {
        if (isSubmitModalOpen) {
            if (submissionMode === 'new') {
                // 신규 제보 모드 초기화
                setFormData({
                    restaurant_name: "",
                    address: "",
                    phone: "",
                    categories: [],
                    youtube_link: "",
                    description: "",
                    youtube_links: [],
                    youtube_metas: [],
                    tzuyang_reviews: [],
                    video_reviews: [],
                });
                setSelectedRestaurant(null);
                setOriginalData(null);
            } else if (submissionMode === 'update') {
                // 수정 요청 모드 초기화 - 맛집 선택만 초기화
                setFormData({
                    restaurant_name: "",
                    address: "",
                    phone: "",
                    categories: [],
                    youtube_link: "",
                    description: "",
                    youtube_links: [],
                    youtube_metas: [],
                    tzuyang_reviews: [],
                    video_reviews: [],
                });
                setSelectedRestaurant(null);
                setOriginalData(null);
            }
            setCategoryInput("");
        }
    }, [isSubmitModalOpen, submissionMode]);


    // 제보 제출
    const submitMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            if (!user) throw new Error('로그인이 필요합니다');

            // 신규 제보일 때는 video_reviews 배열의 데이터를 사용
            let finalYoutubeLink = data.youtube_link.trim();
            let finalDescription = data.description.trim() || null;

            if (submissionMode === 'new' && data.video_reviews.length > 0) {
                // video_reviews의 첫 번째 항목을 메인으로 사용
                finalYoutubeLink = data.video_reviews[0].youtube_link.trim();
                finalDescription = data.video_reviews[0].review.trim() || null;

                // 추가 영상이 있으면 description에 포함
                if (data.video_reviews.length > 1) {
                    const additionalVideos = data.video_reviews.slice(1).map((vr, index) => {
                        const videoNum = index + 2;
                        return `\n\n[영상 ${videoNum}] ${vr.youtube_link}\n${vr.review}`;
                    }).join('');
                    finalDescription = (finalDescription || '') + additionalVideos;
                }
            }

            // 기본 제보 데이터 - DB 스키마에 맞게 수정
            const submissionData: any = {
                user_id: user.id,
                // 사용자 입력 필드 (user_submitted_*)
                user_submitted_name: data.restaurant_name.trim(),
                user_submitted_categories: data.categories,
                user_submitted_phone: data.phone.trim() || null,
                user_raw_address: data.address.trim(),
                // 추가 정보
                youtube_link: finalYoutubeLink,
                description: finalDescription,
                status: 'pending',
                submission_type: submissionMode === 'update' ? 'edit' : submissionMode, // 'new' 또는 'edit' (DB 스키마에 맞게)
            };

            // 수정 요청인 경우 추가 데이터
            if (submissionMode === 'update' && selectedRestaurant) {
                submissionData.restaurant_id = selectedRestaurant.id;
                submissionData.unique_id = selectedRestaurant.unique_id; // unique_id 추가
                submissionData.youtube_links = data.youtube_links; // 모든 유튜브 링크 배열
                submissionData.tzuyang_reviews = data.tzuyang_reviews; // 모든 쯔양 리뷰 배열

                // 동일 상호명 맛집들의 ID 목록 저장
                if (selectedRestaurant.sameNameRestaurants && selectedRestaurant.sameNameRestaurants.length > 1) {
                    submissionData.admin_notes = `동일 상호명 맛집 ${selectedRestaurant.sameNameRestaurants.length}개 일괄 수정 요청: ${selectedRestaurant.sameNameRestaurants.map((r: any) => r.id).join(', ')}`;
                }

                // 변경사항 계산
                if (originalData) {
                    const changes_requested: Record<string, { from: any; to: any }> = {};
                    Object.keys(data).forEach(key => {
                        const originalValue = originalData[key as keyof typeof originalData];
                        const newValue = data[key as keyof typeof data];

                        // 배열 비교 (categories, youtube_links, tzuyang_reviews)
                        if (Array.isArray(originalValue) && Array.isArray(newValue)) {
                            if (JSON.stringify(originalValue.sort()) !== JSON.stringify(newValue.sort())) {
                                changes_requested[key] = {
                                    from: originalValue,
                                    to: newValue
                                };
                            }
                        } else if (originalValue !== newValue) {
                            changes_requested[key] = {
                                from: originalValue || '',
                                to: newValue || ''
                            };
                        }
                    });
                    if (Object.keys(changes_requested).length > 0) {
                        submissionData.changes_requested = changes_requested;
                    }
                }
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
            setIsSubmitModalOpen(false);
            resetForm();
        },
        onError: (error: any) => {
            const modeText = submissionMode === 'new' ? '제보' : '수정 요청';
            toast.error(error.message || `${modeText} 제출에 실패했습니다`);
        },
    });

    // youtube_links와 tzuyang_reviews 배열 길이 동기화 헬퍼 함수
    const syncArrays = (youtubeLinks: string[], tzuyangReviews: any[]) => {
        const maxLength = Math.max(youtubeLinks.length, tzuyangReviews.length);
        const syncedLinks = [...youtubeLinks];
        const syncedReviews = [...tzuyangReviews];

        // youtube_links가 짧으면 빈 문자열 추가
        while (syncedLinks.length < maxLength) {
            syncedLinks.push('');
        }

        // tzuyang_reviews가 짧으면 빈 리뷰 객체 추가
        while (syncedReviews.length < maxLength) {
            syncedReviews.push({ review: '' });
        }

        return { youtubeLinks: syncedLinks, tzuyangReviews: syncedReviews };
    };

    // 모드 변경 핸들러
    const handleModeChange = (mode: 'new' | 'update') => {
        setSubmissionMode(mode);
        if (mode === 'new') {
            setFormData({
                restaurant_name: "",
                address: "",
                phone: "",
                categories: [],
                youtube_link: "",
                description: "",
                youtube_links: [],
                tzuyang_reviews: [],
                video_reviews: [],
            });
            setSelectedRestaurant(null);
            setOriginalData(null);
        }
    };

    // 기존 맛집 선택 핸들러 - 동일한 상호명의 맛집들을 그룹화
    const handleRestaurantSelect = (restaurant: any) => {
        // 동일한 상호명을 가진 모든 맛집 찾기
        const sameNameRestaurants = allRestaurants.filter(r => r.name === restaurant.name);

        const safeCategories = Array.isArray(restaurant.categories)
            ? restaurant.categories
            : (restaurant.categories ? [restaurant.categories] : []);

        // 도로명 주소 우선, 없으면 지번 주소 사용
        const restaurantAddress = restaurant.road_address || restaurant.jibun_address || "";

        // 동일한 상호명의 모든 맛집에서 youtube_links와 tzuyang_reviews 통합
        const allYoutubeLinks: string[] = [];
        const allYoutubeMetas: any[] = [];
        const allTzuyangReviews: any[] = [];

        sameNameRestaurants.forEach((r, index) => {
            // youtube_links 통합
            if (Array.isArray(r.youtube_links)) {
                r.youtube_links.forEach(link => {
                    if (link && !allYoutubeLinks.includes(link)) {
                        allYoutubeLinks.push(link);
                    }
                });
            }

            // youtube_metas 통합
            if (Array.isArray(r.youtube_metas)) {
                r.youtube_metas.forEach(meta => {
                    if (meta) {
                        allYoutubeMetas.push(meta);
                    }
                });
            }

            // tzuyang_reviews 통합
            if (Array.isArray(r.tzuyang_reviews)) {
                r.tzuyang_reviews.forEach(review => {
                    if (review) {
                        allTzuyangReviews.push(review);
                    }
                });
            } else if (typeof r.tzuyang_reviews === 'string' && r.tzuyang_reviews) {
                allTzuyangReviews.push({ review: r.tzuyang_reviews });
            }
        });

        // 배열 길이 동기화
        const { youtubeLinks: syncedLinks, tzuyangReviews: syncedReviews } = syncArrays(allYoutubeLinks, allTzuyangReviews);

        // video_reviews 배열 생성 (고유 ID 부여)
        const videoReviews = syncedLinks.map((link, index) => {
            const review = syncedReviews[index] || { review: '' };
            const reviewText = typeof review === 'string'
                ? review
                : review.review || review.content || '';

            return {
                id: `video-review-${Date.now()}-${index}`, // 고유 ID 생성
                youtube_link: link,
                review: reviewText,
            };
        });

        setSelectedRestaurant({
            ...restaurant,
            sameNameRestaurants, // 동일 상호명 맛집 목록 저장
            allYoutubeMetas, // 통합된 메타데이터 저장
        });

        setOriginalData({
            restaurant_name: restaurant.name,
            address: restaurantAddress,
            phone: restaurant.phone || "",
            categories: safeCategories,
            youtube_link: syncedLinks.length > 0 ? syncedLinks[0] : "",
            youtube_links: syncedLinks,
            youtube_metas: allYoutubeMetas,
            tzuyang_reviews: syncedReviews,
            video_reviews: videoReviews,
            description: "",
        });
        setFormData({
            restaurant_name: restaurant.name,
            address: restaurantAddress,
            phone: restaurant.phone || "",
            categories: safeCategories,
            youtube_link: syncedLinks.length > 0 ? syncedLinks[0] : "",
            youtube_links: syncedLinks,
            youtube_metas: allYoutubeMetas,
            tzuyang_reviews: syncedReviews,
            video_reviews: videoReviews,
            description: "",
        });
    };

    // 제보 삭제 (pending 상태만)
    const deleteMutation = useMutation({
        mutationFn: async (submissionId: string) => {
            const { error } = await supabase
                .from('restaurant_submissions')
                .delete()
                .eq('id', submissionId);

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('제보가 삭제되었습니다');
            queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
        },
        onError: (error: any) => {
            toast.error(error.message || '삭제에 실패했습니다');
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
            youtube_links: [],
            tzuyang_reviews: [],
            video_reviews: [],
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // 신규 제보일 때 video_reviews 확인
        if (submissionMode === 'new') {
            let hasValidVideo = false;
            if (formData.video_reviews.length > 0) {
                hasValidVideo = formData.video_reviews[0].youtube_link.trim() !== '';
            } else {
                hasValidVideo = formData.youtube_link.trim() !== '';
            }

            if (!formData.restaurant_name.trim() || !formData.address.trim() || !hasValidVideo || formData.categories.length === 0) {
                toast.error('필수 항목을 모두 입력해주세요');
                return;
            }
        } else {
            // 수정 요청일 때는 기존 로직 유지
            if (!formData.restaurant_name.trim() || !formData.address.trim() || !formData.youtube_link.trim() || formData.categories.length === 0) {
                toast.error('필수 항목을 모두 입력해주세요');
                return;
            }
        }

        submitMutation.mutate(formData);
    };

    const handleDelete = (submissionId: string, status: string) => {
        if (status !== 'pending') {
            toast.error('대기 중인 제보만 삭제할 수 있습니다');
            return;
        }

        if (confirm('정말 이 제보를 삭제하시겠습니까?')) {
            deleteMutation.mutate(submissionId);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'pending':
                return (
                    <Badge variant="secondary" className="gap-1">
                        <Clock className="h-3 w-3" />
                        검토 대기 중
                    </Badge>
                );
            case 'approved':
                return (
                    <Badge className="bg-green-500 hover:bg-green-600 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        승인됨
                    </Badge>
                );
            case 'rejected':
                return (
                    <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        거부됨
                    </Badge>
                );
            default:
                return null;
        }
    };

    const handleSubmitClick = () => {
        if (!user) {
            toast.error('맛집 제보는 로그인 후 이용 가능합니다');
            return;
        }
        setIsSubmitModalOpen(true);
    };

    return (
        <div className="flex flex-col h-full bg-background">
            {/* 헤더 */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                            <Youtube className="h-6 w-6 text-primary" />
                            쯔동여지도 제보
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            쯔양이 방문한 맛집을 유튜브 영상과 함께 제보해주세요!
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            onClick={() => {
                                if (!user) {
                                    toast.error('맛집 제보는 로그인 후 이용 가능합니다');
                                    return;
                                }
                                setSubmissionMode('new');
                                setIsSubmitModalOpen(true);
                            }}
                            className="bg-gradient-primary hover:opacity-90 gap-2"
                        >
                            <Send className="h-4 w-4" />
                            신규 맛집 제보
                        </Button>
                        <Button
                            onClick={() => {
                                if (!user) {
                                    toast.error('맛집 수정 요청은 로그인 후 이용 가능합니다');
                                    return;
                                }
                                setSubmissionMode('update');
                                setIsSubmitModalOpen(true);
                            }}
                            variant="outline"
                            className="gap-2"
                        >
                            <Youtube className="h-4 w-4" />
                            맛집 수정 요청
                        </Button>
                    </div>
                </div>

                {/* 안내 카드 */}
                <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-4">
                    <div className="flex items-start gap-3">
                        <div className="text-2xl">💡</div>
                        <div className="space-y-1 text-sm">
                            <p className="font-semibold text-blue-900 dark:text-blue-100">
                                제보 가이드
                            </p>
                            <ul className="space-y-1 text-blue-700 dark:text-blue-300 list-disc list-inside">
                                <li>유튜브 영상에서 쯔양이 직접 방문한 맛집을 발견하셨나요?</li>
                                <li>영상 링크와 함께 맛집 정보를 제보해주세요</li>
                                <li>관리자 검토 후 승인되면 지도에 표시됩니다</li>
                                <li>정확한 정보 제공을 부탁드립니다 🙏</li>
                            </ul>
                        </div>
                    </div>
                </Card>
            </div>

            {/* 제보 내역 */}
            <div className="flex-1 overflow-auto p-6 space-y-4">
                <h2 className="text-xl font-bold">내 제보 내역</h2>

                {!user ? (
                    <Card className="p-12 text-center">
                        <div className="text-6xl mb-4">🔒</div>
                        <h3 className="text-xl font-semibold mb-2">로그인이 필요합니다</h3>
                        <p className="text-muted-foreground mb-4">
                            로그인 후 제보 내역을 확인하실 수 있습니다
                        </p>
                        <p className="text-sm text-muted-foreground">
                            우측 상단의 로그인 버튼을 클릭해주세요
                        </p>
                    </Card>
                ) : isLoading ? (
                    // Loading skeleton
                    <div className="grid gap-4">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <Card key={index} className="p-4">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="h-6 bg-muted rounded animate-pulse w-40"></div>
                                            <div className="h-5 bg-muted rounded animate-pulse w-16"></div>
                                            <div className="h-5 bg-muted rounded animate-pulse w-20"></div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="h-4 bg-muted rounded animate-pulse w-48"></div>
                                            <div className="h-4 bg-muted rounded animate-pulse w-32"></div>
                                        </div>
                                        <div className="flex items-center gap-4 text-sm">
                                            <div className="h-4 bg-muted rounded animate-pulse w-24"></div>
                                            <div className="h-4 bg-muted rounded animate-pulse w-20"></div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="h-8 bg-muted rounded animate-pulse w-16"></div>
                                        <div className="h-8 bg-muted rounded animate-pulse w-16"></div>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                ) : submissions.length === 0 ? (
                    <Card className="p-12 text-center">
                        <div className="text-6xl mb-4">📋</div>
                        <h3 className="text-xl font-semibold mb-2">제보 내역이 없습니다</h3>
                        <p className="text-muted-foreground mb-4">
                            쯔양이 방문한 맛집을 발견하시면 제보해주세요!
                        </p>
                        <Button
                            onClick={handleSubmitClick}
                            className="bg-gradient-primary hover:opacity-90"
                        >
                            첫 제보하기
                        </Button>
                    </Card>
                ) : (
                    <>
                        {submissions.map((submission, index) => (
                            <Card
                                key={`${submission.id}-${index}`}
                                ref={index === submissions.length - 1 ? loadMoreRef : null}
                                className="p-4"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-lg font-semibold">
                                                {submission.user_submitted_name || submission.name || '이름 없음'}
                                            </h3>
                                            {getStatusBadge(submission.status)}
                                            <div className="flex flex-wrap gap-1">
                                                {submission.user_submitted_categories && submission.user_submitted_categories.length > 0 ? (
                                                    submission.user_submitted_categories.map((cat: string) => (
                                                        <Badge key={cat} variant="outline" className="text-xs">
                                                            {cat}
                                                        </Badge>
                                                    ))
                                                ) : submission.categories && submission.categories.length > 0 ? (
                                                    submission.categories.map((cat: string) => (
                                                        <Badge key={cat} variant="outline" className="text-xs">
                                                            {cat}
                                                        </Badge>
                                                    ))
                                                ) : null}
                                            </div>
                                            <Badge variant={submission.submission_type === 'edit' ? 'secondary' : 'default'}>
                                                {submission.submission_type === 'edit' ? '수정 요청' : '신규 제보'}
                                            </Badge>
                                        </div>

                                        <p className="text-sm text-muted-foreground">
                                            📍 {submission.user_raw_address || submission.road_address || submission.jibun_address || '주소 없음'}
                                        </p>

                                        {(submission.user_submitted_phone || submission.phone) && (
                                            <p className="text-sm text-muted-foreground">
                                                📞 {submission.user_submitted_phone || submission.phone}
                                            </p>
                                        )}

                                        {submission.description && (
                                            <p className="text-sm text-muted-foreground">
                                                💭 {submission.description}
                                            </p>
                                        )}

                                        <a
                                            href={submission.youtube_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-primary hover:underline flex items-center gap-1"
                                        >
                                            <Youtube className="h-4 w-4" />
                                            유튜브 영상 보기
                                        </a>

                                        {submission.status === 'rejected' && submission.rejection_reason && (
                                            <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded">
                                                <p className="text-sm text-red-700 dark:text-red-300">
                                                    <strong>거부 사유:</strong> {submission.rejection_reason}
                                                </p>
                                            </div>
                                        )}

                                        <p className="text-xs text-muted-foreground">
                                            제보일: {new Date(submission.created_at).toLocaleString('ko-KR')}
                                        </p>
                                    </div>

                                    {submission.status === 'pending' && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDelete(submission.id, submission.status)}
                                            className="text-destructive hover:text-destructive"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </Card>
                        ))}

                        {/* 추가 로딩 표시 */}
                        {isFetchingNextPage && (
                            <div className="text-center py-8">
                                <div className="flex items-center justify-center gap-2">
                                    <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
                                    <span className="text-sm text-muted-foreground">더 많은 제보를 불러오는 중...</span>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* 제보 모달 */}
            <Dialog open={isSubmitModalOpen} onOpenChange={setIsSubmitModalOpen}>
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

                    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                        {/* 기존 맛집 선택 (수정 요청 모드일 때만) */}
                        {submissionMode === 'update' && (
                            <div className="space-y-2">
                                <Label>
                                    수정할 맛집 선택 <span className="text-red-500">*</span>
                                </Label>
                                <Select
                                    value={selectedRestaurant?.id || ""}
                                    onValueChange={(value) => {
                                        const restaurant = allRestaurants.find(r => r.id === value);
                                        if (restaurant) {
                                            handleRestaurantSelect(restaurant);
                                        }
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="수정할 맛집을 선택해주세요" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(() => {
                                            // 상호명별로 그룹화
                                            const groupedByName = allRestaurants.reduce((acc, restaurant) => {
                                                if (!acc[restaurant.name]) {
                                                    acc[restaurant.name] = [];
                                                }
                                                acc[restaurant.name].push(restaurant);
                                                return acc;
                                            }, {} as Record<string, typeof allRestaurants>);

                                            // 각 그룹의 첫 번째 맛집만 표시 (대표)
                                            return Object.entries(groupedByName).map(([name, restaurants]) => {
                                                const representative = restaurants[0];
                                                const count = restaurants.length;
                                                const categoryDisplay = Array.isArray(representative.categories) && representative.categories.length > 0
                                                    ? representative.categories[0]
                                                    : (representative.categories || "기타");

                                                return (
                                                    <SelectItem key={representative.id} value={representative.id}>
                                                        {name} - {categoryDisplay}
                                                        {count > 1 && (
                                                            <span className="ml-2 text-xs text-muted-foreground">
                                                                (동일 상호명 {count}개)
                                                            </span>
                                                        )}
                                                    </SelectItem>
                                                );
                                            });
                                        })()}
                                    </SelectContent>
                                </Select>
                                {selectedRestaurant?.sameNameRestaurants && selectedRestaurant.sameNameRestaurants.length > 1 && (
                                    <p className="text-xs text-blue-600 dark:text-blue-400">
                                        💡 이 상호명을 가진 맛집 {selectedRestaurant.sameNameRestaurants.length}개의 유튜브 영상과 리뷰를 함께 수정합니다
                                    </p>
                                )}
                            </div>
                        )}

                        {/* 변경사항 표시 (수정 요청 모드일 때만) */}
                        {submissionMode === 'update' && selectedRestaurant && originalData && (
                            <Card className="p-4 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <div className="text-blue-600">📋</div>
                                        <Label className="text-sm font-medium text-blue-800 dark:text-blue-200">
                                            수정 요청 내용
                                        </Label>
                                    </div>

                                    {(() => {
                                        const changes = Object.entries(formData).filter(([key, value]) => {
                                            const originalValue = originalData[key as keyof typeof originalData];

                                            // 배열 비교 (categories)
                                            if (key === 'categories') {
                                                const origCategories = Array.isArray(originalValue) ? originalValue : [];
                                                const newCategories = Array.isArray(value) ? value : [];
                                                return JSON.stringify(origCategories.sort()) !== JSON.stringify(newCategories.sort());
                                            }
                                            // 일반 배열 비교
                                            if (Array.isArray(originalValue) && Array.isArray(value)) {
                                                return JSON.stringify(originalValue.sort()) !== JSON.stringify(value.sort());
                                            }
                                            return originalValue !== value;
                                        });

                                        if (changes.length === 0) {
                                            return (
                                                <div className="text-center py-4">
                                                    <div className="text-2xl mb-2">✨</div>
                                                    <p className="text-sm text-blue-700 dark:text-blue-300">
                                                        아직 변경사항이 없습니다
                                                    </p>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        정보를 수정하면 여기에 표시됩니다
                                                    </p>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div className="space-y-3">
                                                {changes.map(([key, value]) => {
                                                    const originalValue = originalData[key as keyof typeof originalData];
                                                    const fieldName = {
                                                        restaurant_name: '맛집 이름',
                                                        address: '주소',
                                                        phone: '전화번호',
                                                        categories: '카테고리',
                                                        youtube_link: '유튜브 링크',
                                                        description: '설명'
                                                    }[key] || key;

                                                    return (
                                                        <div key={key} className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-200 dark:border-blue-700">
                                                            <div className="flex items-center justify-between mb-2">
                                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                    {fieldName}
                                                                </span>
                                                                <div className="flex items-center gap-1 text-xs text-orange-600">
                                                                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                                                                    변경됨
                                                                </div>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <div className="text-xs text-red-600 line-through">
                                                                    기존: {Array.isArray(originalValue) ? originalValue.join(', ') : (originalValue || '없음')}
                                                                </div>
                                                                <div className="text-xs text-green-600 font-medium">
                                                                    변경: {Array.isArray(value) ? value.join(', ') : (value || '없음')}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </Card>
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
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>
                                카테고리 <span className="text-red-500">*</span>
                            </Label>

                            {/* 선택된 카테고리 표시 */}
                            {formData.categories.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 p-3 bg-muted/50 rounded-lg border">
                                    {(() => {
                                        // 기본 카테고리와 직접 입력 카테고리 분리
                                        const standardCategories = formData.categories.filter(cat =>
                                            RESTAURANT_CATEGORIES.includes(cat as any)
                                        );
                                        const customCategories = formData.categories.filter(cat =>
                                            !RESTAURANT_CATEGORIES.includes(cat as any)
                                        );

                                        // 기본 카테고리 먼저, 직접 입력 카테고리는 마지막에 표시
                                        const sortedCategories = [...standardCategories, ...customCategories];

                                        return sortedCategories.map((category) => {
                                            // 광고 관련 태그인지 확인
                                            const isAdTag = ['광고', '협찬', 'PPL', 'AD', '광고협찬'].some(
                                                ad => category.toLowerCase().includes(ad.toLowerCase())
                                            );

                                            // 직접 입력한 커스텀 카테고리인지 확인
                                            const isCustomCategory = !RESTAURANT_CATEGORIES.includes(category as any);

                                            // 광고 태그이거나 직접 입력한 카테고리면 오렌지 스타일
                                            const isOrangeStyle = isAdTag || isCustomCategory;

                                            return (
                                                <Badge
                                                    key={category}
                                                    variant={isOrangeStyle ? "outline" : "secondary"}
                                                    className={
                                                        isOrangeStyle
                                                            ? "text-xs px-2.5 py-1 bg-orange-50 text-orange-700 border-orange-300 hover:bg-orange-100 transition-colors"
                                                            : "text-xs px-2.5 py-1 hover:bg-secondary/80 transition-colors"
                                                    }
                                                >
                                                    {isAdTag && '📢 '}{category}
                                                    <button
                                                        type="button"
                                                        onClick={() => setFormData({
                                                            ...formData,
                                                            categories: formData.categories.filter(c => c !== category)
                                                        })}
                                                        className="ml-1.5 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            );
                                        });
                                    })()}
                                </div>
                            )}

                            {/* 빠른 선택 */}
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-muted-foreground">빠른 선택</p>
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
                                                    // 맨 앞에 추가 (빠른 선택)
                                                    setFormData({
                                                        ...formData,
                                                        categories: [...formData.categories, category]
                                                    });
                                                }
                                            }}
                                            className="h-8 text-xs px-3"
                                        >
                                            {category}
                                        </Button>
                                    ))}
                                </div>
                            </div>

                            {/* 직접 입력 */}
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-muted-foreground">직접 입력 (광고, 협찬 등)</p>
                                <div className="flex gap-2">
                                    <Input
                                        value={categoryInput}
                                        onChange={(e) => setCategoryInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                const trimmed = categoryInput.trim();
                                                if (trimmed && !formData.categories.includes(trimmed)) {
                                                    // 맨 마지막에 추가 (직접 입력)
                                                    setFormData({
                                                        ...formData,
                                                        categories: [...formData.categories, trimmed]
                                                    });
                                                    setCategoryInput("");
                                                }
                                            }
                                        }}
                                        placeholder="예: 광고, 협찬, PPL"
                                        className="flex-1 h-9"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const trimmed = categoryInput.trim();
                                            if (trimmed && !formData.categories.includes(trimmed)) {
                                                // 맨 마지막에 추가 (직접 입력)
                                                setFormData({
                                                    ...formData,
                                                    categories: [...formData.categories, trimmed]
                                                });
                                                setCategoryInput("");
                                            }
                                        }}
                                        disabled={!categoryInput.trim()}
                                        className="h-9 px-4"
                                    >
                                        추가
                                    </Button>
                                </div>
                            </div>
                        </div>                        <div className="space-y-2">
                            <Label htmlFor="address">
                                주소 <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="address"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                placeholder="서울시 중구 명동길 123"
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

                        {/* 신규 제보일 때: 유튜브 영상과 리뷰 쌍으로 표시 */}
                        {submissionMode === 'new' && (
                            <Card className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border-purple-200 dark:border-purple-800">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-2">
                                                <Youtube className="h-5 w-5 text-purple-600" />
                                                <MessageSquare className="h-5 w-5 text-pink-600" />
                                            </div>
                                            <Label className="text-sm font-medium text-purple-800 dark:text-purple-200">
                                                유튜브 영상과 쯔양의 리뷰 ({formData.video_reviews.length > 0 ? formData.video_reviews.length : 1}개)
                                            </Label>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                const newVideoReview = {
                                                    id: `video-review-${Date.now()}-${formData.video_reviews.length}`,
                                                    youtube_link: '',
                                                    review: '',
                                                };
                                                setFormData({
                                                    ...formData,
                                                    video_reviews: [...formData.video_reviews, newVideoReview],
                                                });
                                                // 새로운 쌍이 추가되면 잠시 후 스크롤
                                                setTimeout(() => {
                                                    const elements = document.querySelectorAll('[data-video-review-pair-new]');
                                                    const lastElement = elements[elements.length - 1];
                                                    lastElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                                }, 100);
                                            }}
                                            className="text-xs bg-purple-50 hover:bg-purple-100 border-purple-300"
                                        >
                                            + 영상 및 리뷰 추가
                                        </Button>
                                    </div>

                                    <div className="space-y-4">
                                        {/* 첫 번째 영상-리뷰 쌍은 기본으로 표시 */}
                                        {formData.video_reviews.length === 0 ? (
                                            <div data-video-review-pair-new className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-purple-200 dark:border-purple-700 shadow-sm">
                                                <div className="flex items-start justify-between mb-3">
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-300">
                                                            영상 1
                                                        </Badge>
                                                        <div className="flex items-center gap-1 text-xs text-purple-600">
                                                            <Youtube className="h-3 w-3" />
                                                            +
                                                            <MessageSquare className="h-3 w-3" />
                                                            <span>리뷰 1</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-4">
                                                    {/* 유튜브 링크 입력 */}
                                                    <div className="space-y-2">
                                                        <Label className="text-xs font-medium text-purple-700 dark:text-purple-300">
                                                            유튜브 영상 링크 <span className="text-red-500">*</span>
                                                        </Label>
                                                        <Textarea
                                                            value={formData.youtube_link}
                                                            onChange={(e) => setFormData({ ...formData, youtube_link: e.target.value })}
                                                            placeholder="https://youtube.com/watch?v=..."
                                                            className="min-h-[60px] text-sm resize-none border-purple-200 focus:border-purple-400"
                                                        />
                                                    </div>

                                                    {/* 쯔양 리뷰 입력 */}
                                                    <div className="space-y-2">
                                                        <Label className="text-xs font-medium text-pink-700 dark:text-pink-300">
                                                            쯔양의 리뷰
                                                        </Label>
                                                        <Textarea
                                                            ref={(el) => {
                                                                if (el) {
                                                                    el.style.height = 'auto';
                                                                    el.style.height = el.scrollHeight + 'px';
                                                                }
                                                            }}
                                                            value={formData.description}
                                                            onChange={(e) => {
                                                                setFormData({ ...formData, description: e.target.value });
                                                                // 자동 높이 조절
                                                                e.target.style.height = 'auto';
                                                                e.target.style.height = e.target.scrollHeight + 'px';
                                                            }}
                                                            placeholder="쯔양이 이 맛집에 대해 한 리뷰 내용을 입력해주세요... (팩트 체크 예정)"
                                                            className="text-sm resize-none overflow-hidden border-pink-200 focus:border-pink-400"
                                                            style={{ minHeight: '80px' }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            formData.video_reviews.map((videoReview, index) => (
                                                <div key={videoReview.id} data-video-review-pair-new className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-purple-200 dark:border-purple-700 shadow-sm">
                                                    <div className="flex items-start justify-between mb-3">
                                                        <div className="flex items-center gap-2">
                                                            <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-300">
                                                                영상 {index + 1}
                                                            </Badge>
                                                            <div className="flex items-center gap-1 text-xs text-purple-600">
                                                                <Youtube className="h-3 w-3" />
                                                                +
                                                                <MessageSquare className="h-3 w-3" />
                                                                <span>리뷰 {index + 1}</span>
                                                            </div>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => {
                                                                const newVideoReviews = formData.video_reviews.filter(vr => vr.id !== videoReview.id);
                                                                // 첫 번째 항목 삭제 시 youtube_link와 description 초기화
                                                                if (index === 0 && newVideoReviews.length === 0) {
                                                                    setFormData({
                                                                        ...formData,
                                                                        video_reviews: newVideoReviews,
                                                                        youtube_link: '',
                                                                        description: '',
                                                                    });
                                                                } else if (index === 0 && newVideoReviews.length > 0) {
                                                                    // 첫 번째 항목 삭제 시 두 번째 항목을 첫 번째로
                                                                    setFormData({
                                                                        ...formData,
                                                                        video_reviews: newVideoReviews,
                                                                        youtube_link: newVideoReviews[0].youtube_link,
                                                                        description: newVideoReviews[0].review,
                                                                    });
                                                                } else {
                                                                    setFormData({
                                                                        ...formData,
                                                                        video_reviews: newVideoReviews,
                                                                    });
                                                                }
                                                            }}
                                                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 h-8 px-2 shrink-0"
                                                            title="영상 및 리뷰 삭제"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </Button>
                                                    </div>

                                                    <div className="space-y-4">
                                                        {/* 유튜브 링크 입력 */}
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-medium text-purple-700 dark:text-purple-300">
                                                                유튜브 영상 링크 {index === 0 && <span className="text-red-500">*</span>}
                                                            </Label>
                                                            <Textarea
                                                                value={videoReview.youtube_link}
                                                                onChange={(e) => {
                                                                    const newVideoReviews = formData.video_reviews.map(vr =>
                                                                        vr.id === videoReview.id
                                                                            ? { ...vr, youtube_link: e.target.value }
                                                                            : vr
                                                                    );
                                                                    // 첫 번째 항목은 youtube_link에도 동기화
                                                                    if (index === 0) {
                                                                        setFormData({
                                                                            ...formData,
                                                                            video_reviews: newVideoReviews,
                                                                            youtube_link: e.target.value,
                                                                        });
                                                                    } else {
                                                                        setFormData({
                                                                            ...formData,
                                                                            video_reviews: newVideoReviews,
                                                                        });
                                                                    }
                                                                }}
                                                                placeholder="https://youtube.com/watch?v=..."
                                                                className="min-h-[60px] text-sm resize-none border-purple-200 focus:border-purple-400"
                                                            />
                                                        </div>

                                                        {/* 쯔양 리뷰 입력 */}
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-medium text-pink-700 dark:text-pink-300">
                                                                쯔양의 리뷰
                                                            </Label>
                                                            <Textarea
                                                                ref={(el) => {
                                                                    if (el) {
                                                                        el.style.height = 'auto';
                                                                        el.style.height = el.scrollHeight + 'px';
                                                                    }
                                                                }}
                                                                value={videoReview.review}
                                                                onChange={(e) => {
                                                                    const newVideoReviews = formData.video_reviews.map(vr =>
                                                                        vr.id === videoReview.id
                                                                            ? { ...vr, review: e.target.value }
                                                                            : vr
                                                                    );
                                                                    // 첫 번째 항목은 description에도 동기화
                                                                    if (index === 0) {
                                                                        setFormData({
                                                                            ...formData,
                                                                            video_reviews: newVideoReviews,
                                                                            description: e.target.value,
                                                                        });
                                                                    } else {
                                                                        setFormData({
                                                                            ...formData,
                                                                            video_reviews: newVideoReviews,
                                                                        });
                                                                    }
                                                                    // 자동 높이 조절
                                                                    e.target.style.height = 'auto';
                                                                    e.target.style.height = e.target.scrollHeight + 'px';
                                                                }}
                                                                placeholder="쯔양이 이 맛집에 대해 한 리뷰 내용을 입력해주세요... (팩트 체크 예정)"
                                                                className="text-sm resize-none overflow-hidden border-pink-200 focus:border-pink-400"
                                                                style={{ minHeight: '80px' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </Card>
                        )}

                        {/* 수정 요청일 때: 유튜브 영상과 리뷰 쌍으로 표시 */}
                        {submissionMode === 'update' && selectedRestaurant && formData.youtube_links.length > 0 && (
                            <Card className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border-purple-200 dark:border-purple-800">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-2">
                                                <Youtube className="h-5 w-5 text-purple-600" />
                                                <MessageSquare className="h-5 w-5 text-pink-600" />
                                            </div>
                                            <Label className="text-sm font-medium text-purple-800 dark:text-purple-200">
                                                유튜브 영상과 쯔양의 리뷰 ({formData.youtube_links.length}개)
                                            </Label>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                const newVideoReview = {
                                                    id: `video-review-${Date.now()}-${formData.video_reviews.length}`,
                                                    youtube_link: '',
                                                    review: '',
                                                };
                                                setFormData({
                                                    ...formData,
                                                    youtube_links: [...formData.youtube_links, ''],
                                                    tzuyang_reviews: [...formData.tzuyang_reviews, { review: '' }],
                                                    video_reviews: [...formData.video_reviews, newVideoReview],
                                                });
                                                // 새로운 쌍이 추가되면 잠시 후 스크롤
                                                setTimeout(() => {
                                                    const elements = document.querySelectorAll('[data-video-review-pair]');
                                                    const lastElement = elements[elements.length - 1];
                                                    lastElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                                }, 100);
                                            }}
                                            className="text-xs bg-purple-50 hover:bg-purple-100 border-purple-300"
                                        >
                                            + 영상 및 리뷰 추가
                                        </Button>
                                    </div>

                                    <div className="space-y-4">
                                        {formData.video_reviews.map((videoReview, index) => {
                                            return (
                                                <div key={videoReview.id} data-video-review-pair className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-purple-200 dark:border-purple-700 shadow-sm">
                                                    <div className="flex items-start justify-between mb-3">
                                                        <div className="flex items-center gap-2">
                                                            <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-300">
                                                                영상 {index + 1}
                                                            </Badge>
                                                            <div className="flex items-center gap-1 text-xs text-purple-600">
                                                                <Youtube className="h-3 w-3" />
                                                                +
                                                                <MessageSquare className="h-3 w-3" />
                                                                <span>리뷰 {index + 1}</span>
                                                            </div>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => {
                                                                const newVideoReviews = formData.video_reviews.filter(vr => vr.id !== videoReview.id);
                                                                const newLinks = formData.youtube_links.filter((_, i) => i !== index);
                                                                const newReviews = formData.tzuyang_reviews.filter((_, i) => i !== index);
                                                                setFormData({
                                                                    ...formData,
                                                                    video_reviews: newVideoReviews,
                                                                    youtube_links: newLinks,
                                                                    tzuyang_reviews: newReviews
                                                                });
                                                            }}
                                                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 h-8 px-2 shrink-0"
                                                            title="영상 및 리뷰 삭제"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </Button>
                                                    </div>

                                                    <div className="space-y-4">
                                                        {/* 유튜브 링크 입력 */}
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-medium text-purple-700 dark:text-purple-300">
                                                                유튜브 영상 링크
                                                            </Label>
                                                            <Textarea
                                                                value={videoReview.youtube_link}
                                                                onChange={(e) => {
                                                                    const newVideoReviews = formData.video_reviews.map(vr =>
                                                                        vr.id === videoReview.id
                                                                            ? { ...vr, youtube_link: e.target.value }
                                                                            : vr
                                                                    );
                                                                    const newLinks = formData.youtube_links.map((link, i) =>
                                                                        i === index ? e.target.value : link
                                                                    );
                                                                    setFormData({
                                                                        ...formData,
                                                                        video_reviews: newVideoReviews,
                                                                        youtube_links: newLinks
                                                                    });
                                                                }}
                                                                placeholder="https://youtube.com/watch?v=..."
                                                                className="min-h-[60px] text-sm resize-none border-purple-200 focus:border-purple-400"
                                                            />
                                                        </div>

                                                        {/* 쯔양 리뷰 입력 */}
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-medium text-pink-700 dark:text-pink-300">
                                                                쯔양의 리뷰
                                                            </Label>
                                                            <Textarea
                                                                ref={(el) => {
                                                                    if (el) {
                                                                        el.style.height = 'auto';
                                                                        el.style.height = el.scrollHeight + 'px';
                                                                    }
                                                                }}
                                                                value={videoReview.review}
                                                                onChange={(e) => {
                                                                    const newVideoReviews = formData.video_reviews.map(vr =>
                                                                        vr.id === videoReview.id
                                                                            ? { ...vr, review: e.target.value }
                                                                            : vr
                                                                    );
                                                                    const newReviews = formData.tzuyang_reviews.map((review, i) =>
                                                                        i === index ? { review: e.target.value } : review
                                                                    );
                                                                    setFormData({
                                                                        ...formData,
                                                                        video_reviews: newVideoReviews,
                                                                        tzuyang_reviews: newReviews
                                                                    });

                                                                    // 자동 높이 조절
                                                                    e.target.style.height = 'auto';
                                                                    e.target.style.height = e.target.scrollHeight + 'px';
                                                                }}
                                                                placeholder="쯔양의 리뷰를 입력하세요..."
                                                                className="text-sm resize-none overflow-hidden border-pink-200 focus:border-pink-400"
                                                                style={{ minHeight: '80px' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </Card>
                        )}

                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setIsSubmitModalOpen(false);
                                    resetForm();
                                }}
                                disabled={submitMutation.isPending}
                            >
                                취소
                            </Button>
                            <Button
                                type="submit"
                                className="bg-gradient-primary hover:opacity-90"
                                disabled={submitMutation.isPending}
                            >
                                {submitMutation.isPending ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        제출 중...
                                    </>
                                ) : (
                                    <>
                                        <Send className="mr-2 h-4 w-4" />
                                        제보하기
                                    </>
                                )}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

