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
import { CheckCircle2, XCircle, Clock, Trash2, Youtube, X } from "lucide-react";

interface RestaurantSubmission {
    id: string;
    user_id: string;
    submission_type: 'new' | 'edit';
    status: 'pending' | 'approved' | 'rejected';
    user_submitted_name: string | null;
    user_submitted_categories: string[] | null;
    user_submitted_phone: string | null;
    user_raw_address: string | null;
    youtube_link: string | null;
    description: string | null;
    rejection_reason: string | null;
    created_at: string;
}

interface MyPagePanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function MyPagePanel({ isOpen, onClose }: MyPagePanelProps) {
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
        enabled: !!user && isOpen,
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
        <div className="h-full flex flex-col bg-background">
            {/* 헤더 */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                <div>
                    <h2 className="text-lg font-bold">마이페이지</h2>
                    <p className="text-sm text-muted-foreground">내 제보 내역</p>
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

            {/* 제보 내역 */}
            <div className="flex-1 overflow-auto p-4 space-y-3">
                {!user ? (
                    <Card className="p-8 text-center">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-semibold mb-2">로그인이 필요합니다</h3>
                        <p className="text-sm text-muted-foreground">
                            로그인 후 제보 내역을 확인하실 수 있습니다
                        </p>
                    </Card>
                ) : isLoading ? (
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
                                ref={index === submissions.length - 1 ? loadMoreRef : null}
                                className="p-3"
                            >
                                <div className="space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <h3 className="text-sm font-semibold truncate">
                                                    {submission.user_submitted_name || '이름 없음'}
                                                </h3>
                                                {getStatusBadge(submission.status)}
                                            </div>
                                            {submission.user_submitted_categories && submission.user_submitted_categories.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mb-2">
                                                    {submission.user_submitted_categories.map((cat: string) => (
                                                        <Badge key={cat} variant="outline" className="text-xs">
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
                                                onClick={() => handleDelete(submission.id, submission.status)}
                                                className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>

                                    <p className="text-xs text-muted-foreground line-clamp-1">
                                        📍 {submission.user_raw_address || '주소 없음'}
                                    </p>

                                    {submission.youtube_link && (
                                        <a
                                            href={submission.youtube_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-primary hover:underline flex items-center gap-1"
                                        >
                                            <Youtube className="h-3 w-3" />
                                            유튜브 영상
                                        </a>
                                    )}

                                    {submission.status === 'rejected' && submission.rejection_reason && (
                                        <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded">
                                            <p className="text-xs text-red-700 dark:text-red-300">
                                                <strong>거부 사유:</strong> {submission.rejection_reason}
                                            </p>
                                        </div>
                                    )}

                                    <p className="text-xs text-muted-foreground">
                                        {new Date(submission.created_at).toLocaleDateString('ko-KR')}
                                    </p>
                                </div>
                            </Card>
                        ))}

                        {isFetchingNextPage && (
                            <div className="text-center py-4">
                                <div className="inline-flex items-center gap-2">
                                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                                    <span className="text-xs text-muted-foreground">로딩 중...</span>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
