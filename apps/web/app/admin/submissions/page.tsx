"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useCallback, useEffect } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
    SubmissionListView,
} from "@/components/admin/SubmissionListView";
import {
    SubmissionRecord,
    ApprovalData,
    ItemDecision,
} from "@/components/admin/SubmissionDetailView";

const PAGE_SIZE = 50;

export default function AdminSubmissionsPage() {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const loadMoreRef = useRef<HTMLDivElement>(null);

    // Fetch submissions with items
    const {
        data: submissionsData,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        refetch,
    } = useInfiniteQuery({
        queryKey: ["admin-submissions", isAdmin],
        initialPageParam: 0,
        queryFn: async ({ pageParam }) => {
            if (!user || !isAdmin) return { data: [], nextCursor: null };

            // 모든 상태의 제보 가져오기 (pending, partially_approved 우선)
            const { data: submissions, error } = await supabase
                .from("restaurant_submissions")
                .select("*")
                .order("status", { ascending: true }) // pending 먼저
                .order("created_at", { ascending: false })
                .range(pageParam as number, (pageParam as number) + PAGE_SIZE - 1);

            if (error) throw error;
            if (!submissions || submissions.length === 0) {
                return { data: [], nextCursor: null };
            }

            const submissionIds = submissions.map((s: any) => s.id);
            const userIds = [...new Set(submissions.map((s: any) => s.user_id))] as string[];

            // Fetch items for all submissions
            const { data: items } = await supabase
                .from("restaurant_submission_items")
                .select("*")
                .in("submission_id", submissionIds);

            // Fetch profiles
            const { data: profiles } = await supabase
                .from("profiles")
                .select("id, nickname")
                .in("id", userIds);

            // Combine
            const profileMap = new Map(profiles?.map((p: any) => [p.id, p]) || []);
            const itemMap = new Map<string, any[]>();

            items?.forEach((item: any) => {
                const existing = itemMap.get(item.submission_id) || [];
                existing.push(item);
                itemMap.set(item.submission_id, existing);
            });

            const enrichedSubmissions = submissions.map((s: any) => ({
                ...s,
                items: itemMap.get(s.id) || [],
                profiles: profileMap.get(s.user_id) || null,
            }));

            return {
                data: enrichedSubmissions,
                nextCursor: submissions.length === PAGE_SIZE ? (pageParam as number) + PAGE_SIZE : null,
            };
        },
        getNextPageParam: (lastPage: any) => lastPage.nextCursor,
        enabled: !!user && isAdmin,
    });

    // Infinite scroll
    useEffect(() => {
        if (!loadMoreRef.current) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    // 승인 mutation - 메타데이터 포함
    const approveMutation = useMutation({
        mutationFn: async ({
            submission,
            approvalData,
            itemDecisions,
            forceApprove,
            editableData,
        }: {
            submission: SubmissionRecord;
            approvalData: ApprovalData;
            itemDecisions: Record<string, ItemDecision>;
            forceApprove: boolean;
            editableData: { name: string; address: string; phone: string; categories: string[] };
        }) => {
            // 승인된 항목만 처리
            const approvedItems = Object.entries(itemDecisions).filter(([, d]) => d.approved);

            // 공통 입력 검증 (모달에서 관리자가 입력한 값)
            if (!editableData.name?.trim()) throw new Error('가게 이름을 입력해주세요');
            if (!approvalData.jibun_address?.trim()) throw new Error('지번 주소를 선택/입력해주세요');
            if (!approvalData.lat || !approvalData.lng) throw new Error('좌표(lat, lng)가 없습니다. 지오코딩을 완료해주세요.');
            if (Number.isNaN(parseFloat(approvalData.lat)) || Number.isNaN(parseFloat(approvalData.lng))) {
                throw new Error('좌표(lat, lng)가 올바르지 않습니다.');
            }

            for (const [itemId, decision] of approvedItems) {
                if (!decision.tzuyang_review?.trim()) {
                    throw new Error('쯔양 리뷰를 입력해주세요');
                }
                if (!decision.metaData) {
                    throw new Error('YouTube 메타데이터가 없습니다. 메타데이터를 불러온 뒤 승인해주세요.');
                }

                // 지오코딩 데이터 + 메타데이터 + 관리자 수정 데이터 포함
                const restaurantData = {
                    jibun_address: approvalData.jibun_address || approvalData.road_address,
                    road_address: approvalData.road_address,
                    english_address: approvalData.english_address || '',
                    address_elements: approvalData.address_elements || null,
                    lat: parseFloat(approvalData.lat),
                    lng: parseFloat(approvalData.lng),
                    // YouTube 메타데이터 포함
                    youtube_meta: decision.metaData ? {
                        title: decision.metaData.title,
                        published_at: decision.metaData.publishedAt,
                        duration: decision.metaData.duration,
                        is_shorts: decision.metaData.is_shorts,
                        is_ads: decision.metaData.ads_info?.is_ads ?? false,
                        what_ads: decision.metaData.ads_info?.what_ads ?? null,
                    } : null,
                    // 관리자 수정 데이터 (이름, 전화번호, 카테고리, 리뷰)
                    name: editableData.name,
                    phone: editableData.phone,
                    categories: editableData.categories,
                    tzuyang_review: decision.tzuyang_review,
                };

                // 신규 제보인 경우
                if (submission.submission_type === 'new') {
                    // submission 테이블은 업데이트하지 않고 (사용자 원본 유지),
                    // restaurants 테이블 생성 시에만 관리자 수정 데이터를 사용함 (RPC 내부 처리)
                    
                    const { error } = await (supabase.rpc as any)(
                        "approve_submission_item",
                        {
                            p_item_id: itemId,
                            p_admin_user_id: user?.id,
                            p_restaurant_data: restaurantData, // 파라미터 이름 변경 (개념적)
                        }
                    );
                    if (error) throw error;
                } else {
                    // 수정 제보인 경우
                    // name, phone, categories는 이미 restaurantData에 포함됨
                    const updatedData = restaurantData;

                    const { error } = await (supabase.rpc as any)(
                        "approve_edit_submission_item",
                        {
                            p_item_id: itemId,
                            p_admin_user_id: user?.id,
                            p_updated_data: updatedData,
                        }
                    );
                    if (error) throw error;
                }
            }

            // 거부된 항목 처리
            const rejectedItems = Object.entries(itemDecisions).filter(([, d]) => !d.approved);
            for (const [itemId, decision] of rejectedItems) {
                const { error } = await (supabase.rpc as any)(
                    "reject_submission_item",
                    {
                        p_item_id: itemId,
                        p_admin_id: user?.id,
                        p_reason: decision.rejectionReason || "관리자에 의해 반려됨",
                    }
                );
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
            toast.success("제보가 처리되었습니다.");
        },
        onError: (error: Error) => {
            toast.error(error.message);
        },
    });

    // 전체 거부 mutation
    const rejectMutation = useMutation({
        mutationFn: async ({
            submission,
            reason,
        }: {
            submission: SubmissionRecord;
            reason: string;
        }) => {
            const { error } = await (supabase.rpc as any)(
                "reject_all_submission_items",
                {
                    p_submission_id: submission.id,
                    p_admin_id: user?.id,
                    p_reason: reason,
                }
            );
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
            toast.success("제보가 반려되었습니다.");
        },
        onError: (error: Error) => {
            toast.error(error.message);
        },
    });

    // 삭제 mutation
    const deleteMutation = useMutation({
        mutationFn: async (submission: SubmissionRecord) => {
            // 먼저 items 삭제
            await supabase
                .from("restaurant_submission_items")
                .delete()
                .eq("submission_id", submission.id);

            // submission 삭제
            const { error } = await supabase
                .from("restaurant_submissions")
                .delete()
                .eq("id", submission.id);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
            toast.success("제보가 삭제되었습니다.");
        },
        onError: (error: Error) => {
            toast.error(error.message);
        },
    });

    const submissions = submissionsData?.pages.flatMap((page) => page.data) || [];

    // 핸들러
    const handleApprove = useCallback(
        (
            submission: SubmissionRecord,
            approvalData: ApprovalData,
            itemDecisions: Record<string, ItemDecision>,
            forceApprove: boolean,
            editableData: { name: string; address: string; phone: string; categories: string[] }
        ) => {
            approveMutation.mutate({
                submission,
                approvalData,
                itemDecisions,
                forceApprove,
                editableData,
            });
        },
        [approveMutation]
    );

    const handleReject = useCallback(
        (submission: SubmissionRecord, reason: string) => {
            rejectMutation.mutate({ submission, reason });
        },
        [rejectMutation]
    );

    const handleDelete = useCallback(
        (submission: SubmissionRecord) => {
            deleteMutation.mutate(submission);
        },
        [deleteMutation]
    );

    if (!isAdmin) {
        return (
            <div className="container mx-auto py-8 px-4">
                <p className="text-center text-muted-foreground">관리자 권한이 필요합니다.</p>
            </div>
        );
    }

    return (
        <div className="container mx-auto py-6 px-4 max-w-[1600px]">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <Link href="/admin">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <h1 className="text-xl font-bold">사용자 제보 관리</h1>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    새로고침
                </Button>
            </div>

            {/* 제보 목록 */}
            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <SubmissionListView
                    submissions={submissions as SubmissionRecord[]}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onDelete={handleDelete}
                    onRefresh={() => refetch()}
                    loading={approveMutation.isPending || rejectMutation.isPending || deleteMutation.isPending}
                />
            )}

            {/* Load more trigger */}
            <div ref={loadMoreRef} className="h-10 flex items-center justify-center">
                {isFetchingNextPage && <Loader2 className="h-6 w-6 animate-spin" />}
            </div>
        </div>
    );
}

