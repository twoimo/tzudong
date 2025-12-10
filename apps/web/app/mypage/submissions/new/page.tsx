"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  PlusCircle,
} from "lucide-react";

type SubmissionStatus = 'pending' | 'approved' | 'partially_approved' | 'rejected';
type ItemStatus = 'pending' | 'approved' | 'rejected';

interface SubmissionItem {
  id: string;
  submission_id: string;
  youtube_link: string;
  tzuyang_review: string | null;
  target_restaurant_id: string | null; // 아이템별 수정 대상 레스토랑 ID (new 타입에서는 사용 안함)
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
  admin_notes: string | null;
  rejection_reason: string | null;
  resolved_by_admin_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  items: SubmissionItem[];
}

const PAGE_SIZE = 10;

export default function NewSubmissionsPage() {
  const { user } = useAuth();

  const {
    data: submissionsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["myNewSubmissions", user?.id],
    queryFn: async ({ pageParam = 0 }) => {
      if (!user?.id) return { data: [], nextCursor: null };

      const { data: submissions, error } = await supabase
        .from("restaurant_submissions")
        .select("*")
        .eq("user_id", user.id)
        .eq("submission_type", "new")
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (error) throw error;
      if (!submissions || submissions.length === 0) {
        return { data: [], nextCursor: null };
      }

      const submissionIds = submissions.map((s: { id: string }) => s.id);

      const { data: items, error: itemsError } = await supabase
        .from("restaurant_submission_items")
        .select("*")
        .in("submission_id", submissionIds)
        .order("created_at", { ascending: true });

      if (itemsError) throw itemsError;

      const submissionsWithItems: Submission[] = submissions.map((submission: any) => ({
        ...submission,
        items: (items || []).filter((item: any) => item.submission_id === submission.id),
      }));

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
              <Store className="h-4 w-4 text-muted-foreground shrink-0" />
              <CardTitle className="text-lg">{submission.restaurant_name}</CardTitle>
              {getStatusBadge(submission.status)}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* 맛집 기본 정보 */}
        <div className="bg-muted/50 rounded-lg p-3 space-y-2">
          {submission.restaurant_address && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-sm">{submission.restaurant_address}</p>
            </div>
          )}
          {submission.restaurant_phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-sm">{submission.restaurant_phone}</p>
            </div>
          )}
          {submission.restaurant_categories && submission.restaurant_categories.length > 0 && (
            <div className="flex items-start gap-2">
              <Tag className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
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
        <div>
          <p className="text-sm font-medium mb-2">제보 영상 ({submission.items.length}개)</p>
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
          <span>제보일: {format(new Date(submission.created_at), "yyyy년 M월 d일 HH:mm", { locale: ko })}</span>
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
            <PlusCircle className="h-6 w-6" />
            신규 맛집 제보
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            새로 제보한 맛집 목록입니다
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
            <PlusCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>아직 신규 맛집 제보 내역이 없습니다.</p>
            <p className="text-sm mt-1">새로운 맛집을 제보해주세요!</p>
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
