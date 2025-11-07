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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Send, Loader2, CheckCircle2, XCircle, Clock, Trash2, Youtube, ChevronDown, X } from "lucide-react";
import { RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface RestaurantSubmission {
    id: string;
    restaurant_name: string;
    address: string;
    phone: string | null;
    category: string;
    youtube_link: string;
    description: string | null;
    status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
    created_at: string;
    reviewed_at: string | null;
    submission_type?: 'new' | 'update';
    original_restaurant_id?: string;
    changes_requested?: any;
}

export default function RestaurantSubmissionsPage() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
    const [submissionMode, setSubmissionMode] = useState<'new' | 'update'>('new');
    const [selectedRestaurant, setSelectedRestaurant] = useState<any>(null);
    const [originalData, setOriginalData] = useState<any>(null);
    const [formData, setFormData] = useState({
        restaurant_name: "",
        address: "",
        phone: "",
        categories: [] as string[],
        youtube_link: "",
        description: "",
    });

    // 모든 맛집 조회 (수정 요청용)
    const { data: allRestaurants = [] } = useQuery({
        queryKey: ['all-restaurants'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, name, road_address, jibun_address, category, phone, youtube_links, description')
                .order('name');

            if (error) throw error;
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

    // 제보 제출
    const submitMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            if (!user) throw new Error('로그인이 필요합니다');

            // 기본 제보 데이터
            const submissionData: any = {
                user_id: user.id,
                restaurant_name: data.restaurant_name.trim(),
                address: data.address.trim(), // 사용자가 입력한 주소는 도로명 주소로 저장
                phone: data.phone.trim() || null,
                category: data.categories, // 항상 배열로 저장 (TEXT[])
                youtube_link: data.youtube_link.trim(),
                description: data.description.trim() || null,
                status: 'pending',
            };

            // 수정 요청인 경우 추가 데이터 (컬럼이 존재하는 경우에만)
            if (submissionMode === 'update' && selectedRestaurant) {
                try {
                    // submission_type 컬럼 존재 확인
                    const { error: testError } = await supabase
                        .from('restaurant_submissions')
                        .select('submission_type')
                        .limit(1);

                    if (!testError) {
                        submissionData.submission_type = submissionMode;
                        submissionData.original_restaurant_id = selectedRestaurant.id;

                        // 변경사항 계산
                        if (originalData) {
                            const changes_requested: any = {};
                            Object.keys(data).forEach(key => {
                                const originalValue = originalData[key as keyof typeof originalData];
                                const newValue = data[key as keyof typeof data];

                                // 배열 비교 (categories)
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
                } catch (error) {
                    // 컬럼이 존재하지 않으면 그냥 신규 제보로 처리
                    console.warn('수정 요청 관련 컬럼이 존재하지 않아 신규 제보로 처리합니다');
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
            });
            setSelectedRestaurant(null);
            setOriginalData(null);
        }
    };

    // 기존 맛집 선택 핸들러
    const handleRestaurantSelect = (restaurant: any) => {
        setSelectedRestaurant(restaurant);
        const safeCategories = Array.isArray(restaurant.category) ? restaurant.category : [restaurant.category].filter(Boolean);
        
        // 도로명 주소 우선, 없으면 지번 주소 사용
        const restaurantAddress = restaurant.road_address || restaurant.jibun_address || "";

        setOriginalData({
            restaurant_name: restaurant.name,
            address: restaurantAddress,
            phone: restaurant.phone || "",
            categories: safeCategories,
            youtube_link: Array.isArray(restaurant.youtube_links) && restaurant.youtube_links.length > 0 
                ? restaurant.youtube_links[0] 
                : (restaurant.youtube_links || ""),
            description: restaurant.description || "",
        });
        setFormData({
            restaurant_name: restaurant.name,
            address: restaurantAddress,
            phone: restaurant.phone || "",
            categories: safeCategories,
            youtube_link: Array.isArray(restaurant.youtube_links) && restaurant.youtube_links.length > 0 
                ? restaurant.youtube_links[0] 
                : (restaurant.youtube_links || ""),
            description: restaurant.description || "",
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
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.restaurant_name.trim() || !formData.address.trim() || !formData.youtube_link.trim() || formData.categories.length === 0) {
            toast.error('필수 항목을 모두 입력해주세요');
            return;
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
                                                {submission.restaurant_name}
                                            </h3>
                                            {getStatusBadge(submission.status)}
                                            <div className="flex flex-wrap gap-1">
                                                {Array.isArray(submission.category)
                                                    ? submission.category.map((cat: string) => (
                                                        <Badge key={cat} variant="outline" className="text-xs">
                                                            {cat}
                                                        </Badge>
                                                    ))
                                                    : (
                                                        <Badge variant="outline" className="text-xs">
                                                            {submission.category}
                                                        </Badge>
                                                    )
                                                }
                                            </div>
                                            <Badge variant={submission.original_restaurant_id ? 'secondary' : 'default'}>
                                                {submission.original_restaurant_id ? '수정 요청' : '신규 제보'}
                                            </Badge>
                                        </div>

                                        <p className="text-sm text-muted-foreground">
                                            📍 {submission.address}
                                        </p>

                                        {submission.phone && (
                                            <p className="text-sm text-muted-foreground">
                                                📞 {submission.phone}
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
                                        {allRestaurants.map((restaurant) => {
                                            const categoryDisplay = Array.isArray(restaurant.category) 
                                                ? restaurant.category[0] 
                                                : restaurant.category;
                                            return (
                                                <SelectItem key={restaurant.id} value={restaurant.id}>
                                                    {restaurant.name} - {categoryDisplay}
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
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
                                                        id={`category-${category}`}
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
                                                        htmlFor={`category-${category}`}
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

                        <div className="space-y-2">
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

                        <div className="space-y-2">
                            <Label htmlFor="youtube_link">
                                유튜브 영상 링크 <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="youtube_link"
                                value={formData.youtube_link}
                                onChange={(e) => setFormData({ ...formData, youtube_link: e.target.value })}
                                placeholder="https://youtube.com/watch?v=..."
                            />
                            <p className="text-xs text-muted-foreground">
                                쯔양이 방문한 맛집 유튜브 영상 링크를 입력해주세요
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">쯔양의 리뷰</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="쯔양이 이 맛집에 대해 한 리뷰 내용을 입력해주세요... (팩트 체크 예정)"
                                rows={4}
                            />
                        </div>

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

