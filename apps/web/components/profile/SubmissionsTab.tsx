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
import { CheckCircle2, XCircle, Clock, Trash2, Youtube, Plus, Edit, MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

// Interfaces
interface SubmissionItem {
    id: string;
    submission_id: string;
    youtube_link: string;
    tzuyang_review: string | null;
    target_unique_id: string | null;
    target_restaurant_id: string | null; // 승인된 레스토랑 ID 또는 수정 대상 ID
    item_status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
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

export default function SubmissionsTab() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [activeSubTab, setActiveSubTab] = useState<'submissions' | 'requests'>('submissions');

    // 내 제보 내역 조회 (submissions + items)
    const {
        data: submissionsPages,
        fetchNextPage: fetchNextSubmissions,
        hasNextPage: hasNextSubmissions,
        isLoading: isLoadingSubmissions,
        isFetchingNextPage: isFetchingNextSubmissions,
    } = useInfiniteQuery({
        queryKey: ['my-submissions', user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            const { data: submissionsData, error: submissionsError } = await supabase
                .from('restaurant_submissions')
                .select('*')
                .eq('user_id', user!.id)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19);

            if (submissionsError) throw submissionsError;
            if (!submissionsData || submissionsData.length === 0) return { submissions: [], nextCursor: null };

            const typedSubmissionsData = submissionsData as any[];
            const submissionIds = typedSubmissionsData.map(s => s.id);

            const { data: itemsData, error: itemsError } = await supabase
                .from('restaurant_submission_items')
                .select('*')
                .in('submission_id', submissionIds);

            if (itemsError) throw itemsError;

            const typedItemsData = (itemsData || []) as any[];
            const submissions = typedSubmissionsData.map(submission => ({
                ...submission,
                items: typedItemsData.filter(item => item.submission_id === submission.id)
            })) as RestaurantSubmission[];

            const nextCursor = submissionsData.length === 20 ? pageParam + 20 : null;
            return { submissions, nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        enabled: !!user && activeSubTab === 'submissions',
    });

    // 내 요청 내역 조회
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
            if (!data || data.length === 0) return { requests: [], nextCursor: null };

            const nextCursor = data.length === 20 ? pageParam + 20 : null;
            return { requests: data as RestaurantRequest[], nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        enabled: !!user && activeSubTab === 'requests',
    });

    const submissions = submissionsPages?.pages.flatMap(page => page.submissions) || [];
    const requests = requestsPages?.pages.flatMap(page => page.requests) || [];

    const submissionLoadMoreRef = useRef<HTMLDivElement>(null);
    const requestLoadMoreRef = useRef<HTMLDivElement>(null);

    const loadMoreSubmissions = useCallback(() => {
        if (hasNextSubmissions && !isFetchingNextSubmissions) fetchNextSubmissions();
    }, [hasNextSubmissions, isFetchingNextSubmissions, fetchNextSubmissions]);

    const loadMoreRequests = useCallback(() => {
        if (hasNextRequests && !isFetchingNextRequests) fetchNextRequests();
    }, [hasNextRequests, isFetchingNextRequests, fetchNextRequests]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    if (activeSubTab === 'submissions') loadMoreSubmissions();
                    else loadMoreRequests();
                }
            },
            { threshold: 0.1 }
        );

        const currentRef = activeSubTab === 'submissions' ? submissionLoadMoreRef.current : requestLoadMoreRef.current;
        if (currentRef) observer.observe(currentRef);
        return () => observer.disconnect();
    }, [loadMoreSubmissions, loadMoreRequests, activeSubTab]);


    // Mutations
    const deleteSubmissionMutation = useMutation({
        mutationFn: async (submissionId: string) => {
            const { error } = await supabase.from('restaurant_submissions').delete().eq('id', submissionId);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('제보가 삭제되었습니다');
            queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
        },
        onError: (error: any) => toast.error(error.message || '삭제 실패'),
    });

    const deleteRequestMutation = useMutation({
        mutationFn: async (requestId: string) => {
            const { error } = await supabase.from('restaurant_requests').delete().eq('id', requestId);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('요청이 삭제되었습니다');
            queryClient.invalidateQueries({ queryKey: ['my-requests'] });
        },
        onError: (error: any) => toast.error(error.message || '삭제 실패'),
    });

    const handleDeleteSubmission = (submissionId: string, status: string) => {
        if (status !== 'pending') {
            toast.error('대기 중인 제보만 삭제할 수 있습니다');
            return;
        }
        if (confirm('삭제하시겠습니까?')) deleteSubmissionMutation.mutate(submissionId);
    };

    const handleDeleteRequest = (requestId: string) => {
        if (confirm('삭제하시겠습니까?')) deleteRequestMutation.mutate(requestId);
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'pending': return <Badge variant="secondary" className="gap-1 text-[10px]"><Clock className="h-2 w-2" /> 대기</Badge>;
            case 'approved': return <Badge className="bg-green-500 gap-1 text-[10px]"><CheckCircle2 className="h-2 w-2" /> 승인</Badge>;
            case 'partially_approved': return <Badge className="bg-blue-500 gap-1 text-[10px]"><CheckCircle2 className="h-2 w-2" /> 부분승인</Badge>;
            case 'rejected': return <Badge variant="destructive" className="gap-1 text-[10px]"><XCircle className="h-2 w-2" /> 거부</Badge>;
            default: return null;
        }
    };

    const getItemStatusBadge = (status: string) => {
        switch (status) {
            case 'pending': return <Badge variant="outline" className="gap-1 text-[10px]"><Clock className="h-2 w-2" />대기</Badge>;
            case 'approved': return <Badge className="bg-green-500 gap-1 text-[10px]"><CheckCircle2 className="h-2 w-2" />승인</Badge>;
            case 'rejected': return <Badge variant="destructive" className="gap-1 text-[10px]"><XCircle className="h-2 w-2" />거부</Badge>;
            default: return null;
        }
    };

    return (
        <div className="h-full flex flex-col">
            <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as any)} className="w-full flex-1 flex flex-col">
                <div className="p-2 border-b bg-background">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="submissions" className="text-xs">제보 내역</TabsTrigger>
                        <TabsTrigger value="requests" className="text-xs">나의 요청</TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-hidden bg-muted/10">
                    <TabsContent value="submissions" className="h-full m-0">
                        <ScrollArea className="h-full p-4">
                            {isLoadingSubmissions ? (
                                <div className="text-center py-8 text-xs text-muted-foreground">로딩 중...</div>
                            ) : submissions.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <Edit className="h-10 w-10 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">제보 내역이 없습니다</p>
                                </div>
                            ) : (
                                <div className="space-y-3 pb-8">
                                    {submissions.map((submission, index) => (
                                        <Card key={submission.id} ref={index === submissions.length - 1 ? submissionLoadMoreRef : null} className="p-3">
                                            <div className="space-y-2">
                                                <div className="flex items-start justify-between gap-1">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1 flex-wrap mb-1">
                                                            <h3 className="text-sm font-semibold truncate">{submission.restaurant_name || '이름 없음'}</h3>
                                                            <Badge variant="outline" className="text-[10px] px-1 h-5">
                                                                {submission.submission_type === 'new' ? '신규' : '수정'}
                                                            </Badge>
                                                            {getStatusBadge(submission.status)}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground truncate">{submission.restaurant_address || '주소 없음'}</p>
                                                    </div>
                                                    {submission.status === 'pending' && (
                                                        <Button variant="ghost" size="sm" onClick={() => handleDeleteSubmission(submission.id, submission.status)} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0">
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    )}
                                                </div>

                                                {/* 항목 리스트 */}
                                                {submission.items && submission.items.length > 0 && (
                                                    <div className="space-y-1 pt-2 border-t text-xs">
                                                        <p className="text-muted-foreground font-medium">항목 {submission.items.length}개</p>
                                                        {submission.items.map((item, idx) => (
                                                            <div key={item.id} className="flex items-center gap-1.5 p-1 bg-muted/30 rounded">
                                                                <span className="text-muted-foreground w-3 text-center">{idx + 1}</span>
                                                                <a href={item.youtube_link} target="_blank" className="text-primary truncate flex-1 block hover:underline">{item.youtube_link}</a>
                                                                {getItemStatusBadge(item.item_status)}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </Card>
                                    ))}
                                    {isFetchingNextSubmissions && <div className="text-center py-2 text-xs">더 불러오는 중...</div>}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    <TabsContent value="requests" className="h-full m-0">
                        <ScrollArea className="h-full p-4">
                            {isLoadingRequests ? (
                                <div className="text-center py-8 text-xs text-muted-foreground">로딩 중...</div>
                            ) : requests.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">요청 내역이 없습니다</p>
                                </div>
                            ) : (
                                <div className="space-y-3 pb-8">
                                    {requests.map((request, index) => (
                                        <Card key={request.id} ref={index === requests.length - 1 ? requestLoadMoreRef : null} className="p-3">
                                            <div className="flex items-start justify-between gap-1 mb-2">
                                                <div className="min-w-0">
                                                    <h3 className="text-sm font-semibold truncate">{request.restaurant_name}</h3>
                                                    <p className="text-xs text-muted-foreground truncate">{request.road_address || request.origin_address}</p>
                                                </div>
                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteRequest(request.id)} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0">
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                            <div className="p-2 bg-muted/50 rounded text-xs mb-2">
                                                <strong>이유:</strong> {request.recommendation_reason}
                                            </div>
                                            {request.youtube_link && (
                                                <a href={request.youtube_link} target="_blank" className="text-xs text-primary hover:underline flex items-center gap-1">
                                                    <Youtube className="h-3 w-3" /> 영상 링크
                                                </a>
                                            )}
                                        </Card>
                                    ))}
                                    {isFetchingNextRequests && <div className="text-center py-2 text-xs">더 불러오는 중...</div>}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}

