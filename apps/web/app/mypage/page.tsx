'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Clock, Trash2, Youtube } from "lucide-react";

interface RestaurantSubmission {
    id: string;
    user_id: string;
    submission_type: 'new' | 'edit';
    restaurant_id: string | null;
    status: 'pending' | 'approved' | 'rejected';
    user_submitted_name: string | null;
    user_submitted_categories: string[] | null;
    user_submitted_phone: string | null;
    user_raw_address: string | null;
    name: string | null;
    phone: string | null;
    categories: string[] | null;
    road_address: string | null;
    jibun_address: string | null;
    youtube_link: string | null;
    description: string | null;
    rejection_reason: string | null;
    created_at: string;
    updated_at: string;
}

export default function MyPage() {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    // 내 제보 내역 조회 - 무한 스크롤
    const {
        data: submissionsPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['my-submissions', user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            const { data, error } = await supabase
                .from('restaurant_submissions')
                .select('*')
                .eq('user_id', user!.id)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19);

            if (error) throw error;

            if (!data || data.length === 0) {
                return { submissions: [], nextCursor: null };
            }

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

    const submissions = submissionsPages?.pages.flatMap(page => page.submissions) || [];

    // 무한 스크롤
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

    // 제보 삭제
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

    return (
        <div className="flex flex-col h-full bg-background">
            {/* 헤더 */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                            마이페이지
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            내가 제보한 맛집 내역을 확인하세요
                        </p>
                    </div>
                </div>
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
                    </Card>
                ) : isLoading ? (
                    <div className="grid gap-4">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <Card key={index} className="p-4">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="h-6 bg-muted rounded animate-pulse w-40"></div>
                                            <div className="h-5 bg-muted rounded animate-pulse w-16"></div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="h-4 bg-muted rounded animate-pulse w-48"></div>
                                            <div className="h-4 bg-muted rounded animate-pulse w-32"></div>
                                        </div>
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
                            onClick={() => window.location.href = '/'}
                            className="bg-gradient-primary hover:opacity-90"
                        >
                            홈으로 가기
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
                                        <div className="flex items-center gap-2 flex-wrap">
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
                                            href={submission.youtube_link || undefined}
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
        </div>
    );
}
