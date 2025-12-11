'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Clock, Trash2, Youtube, X, ChevronRight, ChevronLeft, Plus, Edit, MessageSquare } from "lucide-react";

// 새 테이블 구조에 맞는 인터페이스
interface SubmissionItem {
    id: string;
    submission_id: string;
    youtube_link: string;
    tzuyang_review: string | null;
    target_unique_id: string | null;
    item_status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
    approved_restaurant_id: string | null;
    created_at: string;
}

interface RestaurantSubmission {
    id: string;
    user_id: string;
    submission_type: 'new' | 'edit';
    status: 'pending' | 'approved' | 'partially_approved' | 'rejected';
    restaurant_name: string;
    restaurant_address: string | null;
    restaurant_phone: string | null;
    restaurant_categories: string[] | null;
    target_restaurant_id: string | null;
    admin_notes: string | null;
    rejection_reason: string | null;
    resolved_by_admin_id: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
    items: SubmissionItem[];
}

interface RestaurantRequest {
    id: string;
    user_id: string;
    restaurant_name: string;
    origin_address: string;
    road_address: string | null;
    jibun_address: string | null;
    english_address: string | null;
    phone: string | null;
    categories: string[] | null;
    recommendation_reason: string;
    youtube_link: string | null;
    lat: number | null;
    lng: number | null;
    geocoding_success: boolean;
    created_at: string;
}

interface MyPagePanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
}

export default function MyPagePanel({ isOpen, onClose, onToggleCollapse, isCollapsed }: MyPagePanelProps) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'submissions' | 'requests'>('submissions');

    // 내 제보 내역 조회 - 무한 스크롤 (submissions + items)
    const {
        data: submissionsPages,
        fetchNextPage: fetchNextSubmissions,
        hasNextPage: hasNextSubmissions,
        isLoading: isLoadingSubmissions,
        isFetchingNextPage: isFetchingNextSubmissions,
    } = useInfiniteQuery({
        queryKey: ['my-submissions', user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            // 1. submissions 조회
            const { data: submissionsData, error: submissionsError } = await supabase
                .from('restaurant_submissions')
                .select('*')
                .eq('user_id', user!.id)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19);

            if (submissionsError) throw submissionsError;

            if (!submissionsData || submissionsData.length === 0) {
                return { submissions: [], nextCursor: null };
            }

            const typedSubmissionsData = submissionsData as any[];
            const submissionIds = typedSubmissionsData.map(s => s.id);

            // 2. items 조회
            const { data: itemsData, error: itemsError } = await supabase
                .from('restaurant_submission_items')
                .select('*')
                .in('submission_id', submissionIds);

            if (itemsError) throw itemsError;

            const typedItemsData = (itemsData || []) as any[];

            // 3. submissions와 items 매핑
            const submissions = typedSubmissionsData.map(submission => ({
                ...submission,
                items: typedItemsData.filter(item => item.submission_id === submission.id)
            })) as RestaurantSubmission[];

            const nextCursor = submissionsData.length === 20 ? pageParam + 20 : null;

            return { submissions, nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        enabled: !!user && isOpen && activeTab === 'submissions',
    });

    // 내 요청 내역 조회 (requests)
    const {
        data: requestsPages,
        fetchNextPage: fetchNextRequests,
        hasNextPage: hasNextRequests,
        isLoading: isLoadingRequests,
        isFetchingNextPage: isFetchingNextRequests,
    } = useInfiniteQuery({
        queryKey: ['my-requests', user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            const { data, error } = await supabase
                .from('restaurant_requests')
                .select('*')
                .eq('user_id', user!.id)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19);

            if (error) throw error;

            if (!data || data.length === 0) {
                return { requests: [], nextCursor: null };
            }

            const nextCursor = data.length === 20 ? pageParam + 20 : null;

            return {
                requests: data as RestaurantRequest[],
                nextCursor,
            };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        enabled: !!user && isOpen && activeTab === 'requests',
    });

    const submissions = submissionsPages?.pages.flatMap(page => page.submissions) || [];
    const requests = requestsPages?.pages.flatMap(page => page.requests) || [];

    // 무한 스크롤 refs
    const submissionLoadMoreRef = useRef<HTMLDivElement>(null);
    const requestLoadMoreRef = useRef<HTMLDivElement>(null);

    const loadMoreSubmissions = useCallback(() => {
        if (hasNextSubmissions && !isFetchingNextSubmissions) {
            fetchNextSubmissions();
        }
    }, [hasNextSubmissions, isFetchingNextSubmissions, fetchNextSubmissions]);

    const loadMoreRequests = useCallback(() => {
        if (hasNextRequests && !isFetchingNextRequests) {
            fetchNextRequests();
        }
    }, [hasNextRequests, isFetchingNextRequests, fetchNextRequests]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    if (activeTab === 'submissions') {
                        loadMoreSubmissions();
                    } else {
                        loadMoreRequests();
                    }
                }
            },
            { threshold: 0.1 }
        );

        const currentRef = activeTab === 'submissions' ? submissionLoadMoreRef.current : requestLoadMoreRef.current;
        if (currentRef) {
            observer.observe(currentRef);
        }

        return () => observer.disconnect();
    }, [loadMoreSubmissions, loadMoreRequests, activeTab]);

    // 제보 삭제 (pending만 가능)
    const deleteSubmissionMutation = useMutation({
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

    // 요청 삭제
    const deleteRequestMutation = useMutation({
        mutationFn: async (requestId: string) => {
            const { error } = await supabase
                .from('restaurant_requests')
                .delete()
                .eq('id', requestId);

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('요청이 삭제되었습니다');
            queryClient.invalidateQueries({ queryKey: ['my-requests'] });
        },
        onError: (error: any) => {
            toast.error(error.message || '삭제에 실패했습니다');
        },
    });

    const handleDeleteSubmission = (submissionId: string, status: string) => {
        if (status !== 'pending') {
            toast.error('대기 중인 제보만 삭제할 수 있습니다');
            return;
        }

        if (confirm('정말 이 제보를 삭제하시겠습니까?')) {
            deleteSubmissionMutation.mutate(submissionId);
        }
    };

    const handleDeleteRequest = (requestId: string) => {
        if (confirm('정말 이 요청을 삭제하시겠습니까?')) {
            deleteRequestMutation.mutate(requestId);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'pending':
                return (
                    <Badge variant="secondary" className="gap-1 text-xs">
                        <Clock className="h-3 w-3" />
                        대기
                    </Badge>
                );
            case 'approved':
                return (
                    <Badge className="bg-green-500 hover:bg-green-600 gap-1 text-xs">
                        <CheckCircle2 className="h-3 w-3" />
                        승인
                    </Badge>
                );
            case 'partially_approved':
                return (
                    <Badge className="bg-blue-500 hover:bg-blue-600 gap-1 text-xs">
                        <CheckCircle2 className="h-3 w-3" />
                        부분승인
                    </Badge>
                );
            case 'rejected':
                return (
                    <Badge variant="destructive" className="gap-1 text-xs">
                        <XCircle className="h-3 w-3" />
                        거부
                    </Badge>
                );
            default:
                return null;
        }
    };

    const getItemStatusBadge = (status: string) => {
        switch (status) {
            case 'pending':
                return <Badge variant="outline" className="gap-1 text-[10px]"><Clock className="h-2 w-2" />대기</Badge>;
            case 'approved':
                return <Badge className="bg-green-500 gap-1 text-[10px]"><CheckCircle2 className="h-2 w-2" />승인</Badge>;
            case 'rejected':
                return <Badge variant="destructive" className="gap-1 text-[10px]"><XCircle className="h-2 w-2" />거부</Badge>;
            default:
                return null;
        }
    };

    return (
        <div className="h-full flex flex-col bg-background border-l border-border relative">
            {/* 플로팅 접기/펼치기 버튼 - 패널 좌측 가장자리 */}
            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title={isCollapsed ? "패널 펼치기" : "패널 접기"}
                    aria-label={isCollapsed ? "패널 펼치기" : "패널 접기"}
                >
                    {!isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    ) : (
                        <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    )}
                </button>
            )}

            {/* 헤더 */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                <div>
                    <h2 className="text-lg font-bold">마이페이지</h2>
                    <p className="text-sm text-muted-foreground">내 활동 내역</p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="hover:bg-muted"
                >
                    <X className="h-5 w-5" />
                </Button>
            </div>

            {!user ? (
                <div className="flex-1 flex items-center justify-center p-4">
                    <Card className="p-8 text-center">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-semibold mb-2">로그인이 필요합니다</h3>
                        <p className="text-sm text-muted-foreground">
                            로그인 후 활동 내역을 확인하실 수 있습니다
                        </p>
                    </Card>
                </div>
            ) : (
                <div className="flex-1 overflow-auto">
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'submissions' | 'requests')} className="w-full">
                        <div className="p-2 border-b">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="submissions" className="text-xs gap-1">
                                    <Edit className="h-3 w-3" />
                                    제보 내역 ({submissions.length})
                                </TabsTrigger>
                                <TabsTrigger value="requests" className="text-xs gap-1">
                                    <MessageSquare className="h-3 w-3" />
                                    나의 요청 ({requests.length})
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        {/* 제보 탭 */}
                        <TabsContent value="submissions" className="p-4 space-y-3 m-0">
                            {isLoadingSubmissions ? (
                                <div className="space-y-3">
                                    {Array.from({ length: 3 }).map((_, index) => (
                                        <Card key={index} className="p-3">
                                            <div className="space-y-2">
                                                <div className="h-5 bg-muted rounded animate-pulse w-32"></div>
                                                <div className="h-4 bg-muted rounded animate-pulse w-48"></div>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            ) : submissions.length === 0 ? (
                                <Card className="p-8 text-center">
                                    <div className="text-4xl mb-3">📋</div>
                                    <h3 className="text-lg font-semibold mb-2">제보 내역이 없습니다</h3>
                                    <p className="text-sm text-muted-foreground">
                                        쯔양이 방문한 맛집을 발견하시면 제보해주세요!
                                    </p>
                                </Card>
                            ) : (
                                <>
                                    {submissions.map((submission, index) => (
                                        <Card
                                            key={`${submission.id}-${index}`}
                                            ref={index === submissions.length - 1 ? submissionLoadMoreRef : null}
                                            className="p-3"
                                        >
                                            <div className="space-y-2">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                                            <h3 className="text-sm font-semibold truncate">
                                                                {submission.restaurant_name || '이름 없음'}
                                                            </h3>
                                                            <Badge variant="outline" className="text-[10px]">
                                                                {submission.submission_type === 'new' ? (
                                                                    <><Plus className="h-2 w-2 mr-0.5" />신규</>
                                                                ) : (
                                                                    <><Edit className="h-2 w-2 mr-0.5" />수정</>
                                                                )}
                                                            </Badge>
                                                            {getStatusBadge(submission.status)}
                                                        </div>
                                                        {submission.restaurant_categories && submission.restaurant_categories.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mb-2">
                                                                {submission.restaurant_categories.map((cat: string) => (
                                                                    <Badge key={cat} variant="outline" className="text-[10px]">
                                                                        {cat}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {submission.status === 'pending' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleDeleteSubmission(submission.id, submission.status)}
                                                            className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>

                                                <p className="text-xs text-muted-foreground line-clamp-1">
                                                    📍 {submission.restaurant_address || '주소 없음'}
                                                </p>

                                                {/* 개별 항목 리스트 */}
                                                {submission.items && submission.items.length > 0 && (
                                                    <div className="space-y-1 pt-2 border-t">
                                                        <p className="text-xs text-muted-foreground font-medium">
                                                            항목 ({submission.items.length}개)
                                                        </p>
                                                        {submission.items.map((item, idx) => (
                                                            <div
                                                                key={item.id}
                                                                className="flex items-center gap-2 p-1.5 bg-muted/30 rounded text-xs"
                                                            >
                                                                <span className="text-muted-foreground">{idx + 1}.</span>
                                                                <a
                                                                    href={item.youtube_link}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-primary hover:underline flex items-center gap-1 flex-1 truncate"
                                                                >
                                                                    <Youtube className="h-3 w-3 flex-shrink-0" />
                                                                    <span className="truncate">{item.youtube_link}</span>
                                                                </a>
                                                                {getItemStatusBadge(item.item_status)}

                                                                {/* 거부 사유 */}
                                                                {item.item_status === 'rejected' && item.rejection_reason && (
                                                                    <span className="text-destructive text-[10px] truncate max-w-[80px]" title={item.rejection_reason}>
                                                                        ({item.rejection_reason})
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {submission.status === 'rejected' && submission.rejection_reason && (
                                                    <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded">
                                                        <p className="text-xs text-red-700 dark:text-red-300">
                                                            <strong>전체 거부 사유:</strong> {submission.rejection_reason}
                                                        </p>
                                                    </div>
                                                )}

                                                <p className="text-xs text-muted-foreground">
                                                    {new Date(submission.created_at).toLocaleDateString('ko-KR')}
                                                </p>
                                            </div>
                                        </Card>
                                    ))}

                                    {isFetchingNextSubmissions && (
                                        <div className="text-center py-4">
                                            <div className="inline-flex items-center gap-2">
                                                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                                                <span className="text-xs text-muted-foreground">로딩 중...</span>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </TabsContent>

                        {/* 요청 탭 */}
                        <TabsContent value="requests" className="p-4 space-y-3 m-0">
                            {isLoadingRequests ? (
                                <div className="space-y-3">
                                    {Array.from({ length: 3 }).map((_, index) => (
                                        <Card key={index} className="p-3">
                                            <div className="space-y-2">
                                                <div className="h-5 bg-muted rounded animate-pulse w-32"></div>
                                                <div className="h-4 bg-muted rounded animate-pulse w-48"></div>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            ) : requests.length === 0 ? (
                                <Card className="p-8 text-center">
                                    <div className="text-4xl mb-3">💬</div>
                                    <h3 className="text-lg font-semibold mb-2">요청 내역이 없습니다</h3>
                                    <p className="text-sm text-muted-foreground">
                                        쯔양에게 추천하고 싶은 맛집이 있으면 요청해주세요!
                                    </p>
                                </Card>
                            ) : (
                                <>
                                    {requests.map((request, index) => (
                                        <Card
                                            key={`${request.id}-${index}`}
                                            ref={index === requests.length - 1 ? requestLoadMoreRef : null}
                                            className="p-3"
                                        >
                                            <div className="space-y-2">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                                            <h3 className="text-sm font-semibold truncate">
                                                                {request.restaurant_name}
                                                            </h3>
                                                            <Badge variant="outline" className="text-[10px] gap-0.5">
                                                                <MessageSquare className="h-2 w-2" />
                                                                추천
                                                            </Badge>
                                                        </div>
                                                        {request.categories && request.categories.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mb-2">
                                                                {request.categories.map((cat: string) => (
                                                                    <Badge key={cat} variant="outline" className="text-[10px]">
                                                                        {cat}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDeleteRequest(request.id)}
                                                        className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>

                                                <p className="text-xs text-muted-foreground line-clamp-1">
                                                    📍 {request.road_address || request.origin_address}
                                                </p>

                                                <div className="p-2 bg-muted/50 rounded">
                                                    <p className="text-xs">
                                                        <strong>추천 이유:</strong> {request.recommendation_reason}
                                                    </p>
                                                </div>

                                                {request.youtube_link && (
                                                    <a
                                                        href={request.youtube_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-xs text-primary hover:underline flex items-center gap-1"
                                                    >
                                                        <Youtube className="h-3 w-3" />
                                                        관련 영상
                                                    </a>
                                                )}

                                                <p className="text-xs text-muted-foreground">
                                                    {new Date(request.created_at).toLocaleDateString('ko-KR')}
                                                </p>
                                            </div>
                                        </Card>
                                    ))}

                                    {isFetchingNextRequests && (
                                        <div className="text-center py-4">
                                            <div className="inline-flex items-center gap-2">
                                                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                                                <span className="text-xs text-muted-foreground">로딩 중...</span>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            )}
        </div>
    );
}
