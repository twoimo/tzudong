"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bookmark, Trash2, MapPin, ExternalLink } from "lucide-react";
import { useBookmarks, useToggleBookmark } from "@/hooks/use-bookmarks";
import { MyPageSectionSkeleton } from "@/components/mypage/MyPageSectionSkeleton";
import {
  MyPageEmptyState,
  MyPageErrorState,
  MyPageSectionFrame,
  myPageListCardClass,
} from "@/components/mypage/MyPageSectionFrame";

const PAGE_SIZE = 15;

export default function BookmarksPage() {
  const { data: bookmarks = [], isLoading, isError } = useBookmarks();
  const { toggleBookmark, isLoading: isToggling } = useToggleBookmark();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const visibleBookmarks = useMemo(
    () => bookmarks.slice(0, visibleCount),
    [bookmarks, visibleCount],
  );
  const hasMore = visibleCount < bookmarks.length;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, bookmarks.length));
  }, [bookmarks.length]);

  useEffect(() => {
    setVisibleCount((prev) =>
      Math.min(Math.max(prev, PAGE_SIZE), bookmarks.length),
    );
  }, [bookmarks.length]);

  useEffect(() => {
    if (!hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 },
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // [최적화] 유틸 함수 메모이제이션
  const extractYouTubeVideoId = useCallback((url: string) => {
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  }, []);

  const getYouTubeThumbnailUrl = useCallback(
    (url: string) => {
      const videoId = extractYouTubeVideoId(url);
      return videoId
        ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
        : null;
    },
    [extractYouTubeVideoId],
  );

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }, []);

  // 로딩 상태
  if (isLoading) {
    return <MyPageSectionSkeleton label="북마크를 불러오는 중…" />;
  }

  if (isError) {
    return (
      <MyPageErrorState
        title="북마크를 불러오지 못했습니다"
        description="저장한 맛집 목록을 다시 불러오려면 잠시 후 재시도해주세요."
      />
    );
  }

  return (
    <MyPageSectionFrame
      icon={Bookmark}
      eyebrow="내 활동"
      title="북마크 내역"
      description="저장한 맛집을 한눈에 확인하고 지도 탐색으로 자연스럽게 이어갑니다."
      countLabel={`총 ${bookmarks.length}개`}
      data-section="bookmarks"
    >
      {visibleBookmarks.length === 0 ? (
        <MyPageEmptyState
          icon={Bookmark}
          title="아직 저장한 맛집이 없습니다"
          description="맛집을 탐색하고 마음에 드는 곳을 북마크에 저장해 보세요."
          action={
            <Link href="/">
              <Button variant="outline" className="rounded-full">
                맛집 탐색하기
              </Button>
            </Link>
          }
        />
      ) : (
        <div
          className="grid gap-3 xl:grid-cols-2"
          data-mypage-responsive-list="bookmarks"
        >
          {visibleBookmarks.map((bookmark) => {
            const restaurantWithMergedLinks =
              bookmark.restaurant as typeof bookmark.restaurant & {
                mergedYoutubeLinks?: string[];
              };

            // 병합된 YouTube 링크 배열 처리
            const youtubeLinks = (
              restaurantWithMergedLinks.mergedYoutubeLinks ??
              (bookmark.restaurant.youtube_link
                ? [bookmark.restaurant.youtube_link]
                : [])
            ).filter(
              (link): link is string =>
                typeof link === "string" && link.length > 0,
            );

            // 첫 번째 유효한 썸네일 찾기
            let thumbnailUrl = null;
            for (const link of youtubeLinks) {
              const url = getYouTubeThumbnailUrl(link);
              if (url) {
                thumbnailUrl = url;
                break;
              }
            }

            return (
              <Card key={bookmark.id} className={myPageListCardClass}>
                <CardContent className="p-3 md:p-4">
                  <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
                    {/* 썸네일 */}
                    <div className="relative w-full sm:w-32 md:w-40 aspect-video bg-muted rounded overflow-hidden shrink-0">
                      {thumbnailUrl ? (
                        <Image
                          src={thumbnailUrl}
                          alt={bookmark.restaurant.name}
                          fill
                          sizes="(max-width: 640px) 100vw, 160px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <MapPin className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    {/* 정보 */}
                    <div className="flex-1 min-w-0">
                      {/* 헤더: 맛집명 + 카테고리 */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-lg">
                              {bookmark.restaurant.name}
                            </h3>
                            {bookmark.restaurant.category?.[0] && (
                              <Badge variant="secondary" className="text-xs">
                                {bookmark.restaurant.category[0]}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* 삭제 버튼 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            toggleBookmark(bookmark.restaurant.id, true)
                          }
                          disabled={isToggling}
                          className="h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive"
                          aria-label={`${bookmark.restaurant.name} 북마크 삭제`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* 주소 */}
                      <p className="text-sm text-muted-foreground mb-2 truncate">
                        <MapPin className="h-3 w-3 inline mr-1" />
                        {bookmark.restaurant.road_address ||
                          bookmark.restaurant.jibun_address ||
                          "주소 정보 없음"}
                      </p>

                      {/* 푸터: 리뷰 수 + 저장일 */}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                        <div>
                          리뷰 {bookmark.restaurant.review_count || 0}개
                        </div>
                        <div>저장일: {formatDate(bookmark.created_at)}</div>
                        {bookmark.restaurant.youtube_link && (
                          <a
                            href={bookmark.restaurant.youtube_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                            영상 보기
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {hasMore && (
            <div
              ref={loadMoreRef}
              className="py-6 text-center text-sm text-muted-foreground xl:col-span-2"
            >
              계속 불러오는 중…
            </div>
          )}
        </div>
      )}
    </MyPageSectionFrame>
  );
}
