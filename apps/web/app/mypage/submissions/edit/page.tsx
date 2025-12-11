"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ExternalLink,
  Youtube,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  MapPin,
  Store,
  Phone,
  Tag,
  Edit3,
  ArrowRight,
} from "lucide-react";

type SubmissionStatus = 'pending' | 'approved' | 'partially_approved' | 'rejected';
type ItemStatus = 'pending' | 'approved' | 'rejected';

interface SubmissionItem {
  id: string;
  submission_id: string;
  youtube_link: string;
  tzuyang_review: string | null;
  target_restaurant_id: string | null; // 아이템별 수정 대상 레스토랑 ID
  item_status: ItemStatus;
  rejection_reason: string | null;
  approved_restaurant_id: string | null;
  created_at: string;
}

interface Submission {
  id: string;
  user_id: string;
  submission_type: 'new' | 'edit';
  status: SubmissionStatus;
  restaurant_name: string;
  restaurant_address: string | null;
  restaurant_phone: string | null;
  restaurant_categories: string[] | null;
  // target_restaurant_id는 submission 레벨이 아닌 items 레벨에서 관리
  admin_notes: string | null;
  rejection_reason: string | null;
  resolved_by_admin_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  items: SubmissionItem[];
  target_restaurant?: {
    name: string;
    address: string | null;
  } | null;
}

const PAGE_SIZE = 10;

export default function EditSubmissionsPage() {
  const { user } = useAuth();

  const {
    data: submissionsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["myEditSubmissions", user?.id],
    queryFn: async ({ pageParam = 0 }) => {
      if (!user?.id) return { data: [], nextCursor: null };

      const { data: submissions, error } = await supabase
        .from("restaurant_submissions")
        .select("*")
        .eq("user_id", user.id)
        .eq("submission_type", "edit")
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (error) throw error;
      if (!submissions || submissions.length === 0) {
        return { data: [], nextCursor: null };
      }

      const submissionIds = submissions.map((s: { id: string }) => s.id);

      // 제보 항목 조회
      const { data: items, error: itemsError } = await supabase
        .from("restaurant_submission_items")
        .select("*")
        .in("submission_id", submissionIds)
        .order("created_at", { ascending: true });

      if (itemsError) throw itemsError;

      // 아이템에서 target_restaurant_id 추출
      const targetRestaurantIds = [...new Set(
        (items || [])
          .filter((item: any) => item.target_restaurant_id)
          .map((item: any) => item.target_restaurant_id)
      )];

      // 대상 맛집 정보 조회
      let targetRestaurants: Record<string, { name: string; address: string | null }> = {};
      if (targetRestaurantIds.length > 0) {
        const { data: restaurants } = await supabase
          .from("restaurants")
          .select("id, name, road_address")
          .in("id", targetRestaurantIds);

        if (restaurants) {
          targetRestaurants = restaurants.reduce((acc: any, r: any) => {
            acc[r.id] = { name: r.name, address: r.road_address };
            return acc;
          }, {});
        }
      }

      const submissionsWithItems: Submission[] = submissions.map((submission: any) => {
        const submissionItems = (items || []).filter((item: any) => item.submission_id === submission.id) as SubmissionItem[];
        // 첫 번째 아이템의 target_restaurant 정보를 submission 수준에서 표시
        const firstItemTarget = submissionItems.length > 0 ? submissionItems[0].target_restaurant_id : null;
        
        return {
          ...submission,
          items: submissionItems,
          target_restaurant: firstItemTarget
            ? targetRestaurants[firstItemTarget] || null
            : null,
        };
      });

      return {
        data: submissionsWithItems,
        nextCursor: submissions.length === PAGE_SIZE ? pageParam + PAGE_SIZE : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!user?.id,
    initialPageParam: 0,
  });

  const submissions = submissionsData?.pages.flatMap((page) => page.data) || [];

  const getStatusBadge = (status: SubmissionStatus) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />검토 대기</Badge>;
      case "approved":
        return <Badge className="gap-1 bg-green-500 hover:bg-green-600"><CheckCircle className="h-3 w-3" />승인됨</Badge>;
      case "partially_approved":
        return <Badge className="gap-1 bg-amber-500 hover:bg-amber-600"><AlertCircle className="h-3 w-3" />부분 승인</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />반려됨</Badge>;
    }
  };

  const getItemStatusBadge = (status: ItemStatus) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-xs">대기</Badge>;
      case "approved":
        return <Badge variant="outline" className="text-xs border-green-500 text-green-600">승인</Badge>;
      case "rejected":
        return <Badge variant="outline" className="text-xs border-red-500 text-red-600">반려</Badge>;
    }
  };

  const renderSubmissionCard = (submission: Submission) => (
    <Card key={submission.id} className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Edit3 className="h-4 w-4 text-muted-foreground shrink-0" />
              <CardTitle className="text-lg">{submission.restaurant_name}</CardTitle>
              {getStatusBadge(submission.status)}
            </div>
            {/* 수정 대상 맛집 표시 */}
            {submission.target_restaurant && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                <span>기존:</span>
                <span className="font-medium">{submission.target_restaurant.name}</span>
                <ArrowRight className="h-3 w-3" />
                <span>수정요청</span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* 수정 요청 정보 */}
        <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">수정 요청 내용</p>
          {submission.restaurant_address && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm">{submission.restaurant_address}</p>
            </div>
          )}
          {submission.restaurant_phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="text-sm">{submission.restaurant_phone}</p>
            </div>
          )}
          {submission.restaurant_categories && submission.restaurant_categories.length > 0 && (
            <div className="flex items-start gap-2">
              <Tag className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="flex flex-wrap gap-1">
                {submission.restaurant_categories.map((cat, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 제보 항목 */}
        {submission.items.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">관련 영상 ({submission.items.length}개)</p>
            <div className="space-y-2">
              {submission.items.map((item, idx) => (
                <div key={item.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Youtube className="h-4 w-4 text-red-500 shrink-0" />
                      <a
                        href={item.youtube_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-500 hover:underline truncate"
                      >
                        영상 #{idx + 1}
                        <ExternalLink className="h-3 w-3 inline ml-1" />
                      </a>
                    </div>
                    {getItemStatusBadge(item.item_status)}
                  </div>
                  {item.tzuyang_review && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      💬 {item.tzuyang_review}
                    </p>
                  )}
                  {item.rejection_reason && item.item_status === 'rejected' && (
                    <p className="text-xs text-red-500 mt-1">
                      ❌ 반려 사유: {item.rejection_reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 관리자 메모 및 반려 사유 */}
        {submission.admin_notes && (
          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>관리자 메모:</strong> {submission.admin_notes}
            </p>
          </div>
        )}
        {submission.rejection_reason && submission.status === 'rejected' && (
          <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-300">
              <strong>반려 사유:</strong> {submission.rejection_reason}
            </p>
          </div>
        )}

        {/* 날짜 정보 */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <span>요청일: {format(new Date(submission.created_at), "yyyy년 M월 d일 HH:mm", { locale: ko })}</span>
          {submission.reviewed_at && (
            <span>검토일: {format(new Date(submission.reviewed_at), "yyyy년 M월 d일", { locale: ko })}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Edit3 className="h-6 w-6" />
            맛집 수정 요청
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            기존 맛집 정보 수정 요청 목록입니다
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          총 {submissions.length}건
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : submissions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Edit3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>아직 맛집 수정 요청 내역이 없습니다.</p>
            <p className="text-sm mt-1">잘못된 정보를 발견하면 수정 요청해주세요!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {submissions.map(renderSubmissionCard)}
          {hasNextPage && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    로딩 중...
                  </>
                ) : (
                  "더 보기"
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
