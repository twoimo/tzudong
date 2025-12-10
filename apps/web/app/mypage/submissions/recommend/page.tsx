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
  MapPin,
  Store,
  Phone,
  Tag,
  Heart,
  MessageSquare,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface RestaurantRequest {
  id: string;
  user_id: string;
  restaurant_name: string;
  origin_address: string | null;
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

const PAGE_SIZE = 10;

export default function RecommendSubmissionsPage() {
  const { user } = useAuth();

  const {
    data: requestsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["myRecommendRequests", user?.id],
    queryFn: async ({ pageParam = 0 }) => {
      if (!user?.id) return { data: [], nextCursor: null };

      const { data, error } = await supabase
        .from("restaurant_requests")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (error) throw error;

      return {
        data: data as RestaurantRequest[],
        nextCursor: data && data.length === PAGE_SIZE ? pageParam + PAGE_SIZE : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!user?.id,
    initialPageParam: 0,
  });

  const requests = requestsData?.pages.flatMap((page) => page.data) || [];

  const renderRequestCard = (request: RestaurantRequest) => {
    const displayAddress = request.road_address || request.jibun_address || request.origin_address;

    return (
      <Card key={request.id} className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Store className="h-4 w-4 text-muted-foreground shrink-0" />
                <CardTitle className="text-lg">{request.restaurant_name}</CardTitle>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* 지오코딩 상태 표시 */}
              {request.geocoding_success ? (
                <Badge variant="outline" className="gap-1 text-green-600 border-green-300">
                  <CheckCircle2 className="h-3 w-3" />
                  위치확인
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                  <XCircle className="h-3 w-3" />
                  위치미확인
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* 맛집 정보 */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            {displayAddress && (
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p>{displayAddress}</p>
                  {/* 주소 상세 정보가 있으면 표시 */}
                  {request.road_address && request.jibun_address && request.road_address !== request.jibun_address && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      (지번) {request.jibun_address}
                    </p>
                  )}
                </div>
              </div>
            )}
            {request.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-sm">{request.phone}</p>
              </div>
            )}
            {request.categories && request.categories.length > 0 && (
              <div className="flex items-start gap-2">
                <Tag className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {request.categories.map((cat, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {cat}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 추천 이유 */}
          <div className="bg-pink-50 dark:bg-pink-950/30 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <MessageSquare className="h-4 w-4 text-pink-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-pink-700 dark:text-pink-300 mb-1">
                  추천 이유
                </p>
                <p className="text-sm">{request.recommendation_reason}</p>
              </div>
            </div>
          </div>

          {/* 관련 유튜브 영상 */}
          {request.youtube_link && (
            <div className="flex items-center gap-2">
              <Youtube className="h-4 w-4 text-red-500" />
              <a
                href={request.youtube_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-500 hover:underline truncate"
              >
                관련 영상 보기
                <ExternalLink className="h-3 w-3 inline ml-1" />
              </a>
            </div>
          )}

          {/* 날짜 정보 */}
          <div className="flex items-center text-xs text-muted-foreground pt-2 border-t">
            <span>추천일: {format(new Date(request.created_at), "yyyy년 M월 d일 HH:mm", { locale: ko })}</span>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Heart className="h-6 w-6 text-pink-500" />
            쯔양에게 추천
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            쯔양에게 추천한 맛집 목록입니다
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          총 {requests.length}건
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Heart className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>아직 쯔양에게 추천한 맛집이 없습니다.</p>
            <p className="text-sm mt-1">맛있는 맛집을 쯔양에게 추천해주세요!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map(renderRequestCard)}
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
