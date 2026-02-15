'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Bookmark,
    Trash2,
    MapPin,
    ExternalLink,
} from "lucide-react";
import { useBookmarks, useToggleBookmark } from "@/hooks/use-bookmarks";
import { GlobalLoader } from "@/components/ui/global-loader";

const PAGE_SIZE = 15;

export default function BookmarksPage() {
    const { data: bookmarks = [], isLoading } = useBookmarks();
    const { toggleBookmark, isLoading: isToggling } = useToggleBookmark();
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    const visibleBookmarks = useMemo(
        () => bookmarks.slice(0, visibleCount),
        [bookmarks, visibleCount]
    );
    const hasMore = visibleCount < bookmarks.length;

    const loadMore = useCallback(() => {
        setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, bookmarks.length));
    }, [bookmarks.length]);

    useEffect(() => {
        setVisibleCount((prev) => Math.min(Math.max(prev, PAGE_SIZE), bookmarks.length));
    }, [bookmarks.length]);

    useEffect(() => {
        if (!hasMore) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting) {
                    loadMore();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [hasMore, loadMore]);

    // [최적화] 유틸 함수 메모이제이션
    const extractYouTubeVideoId = useCallback((url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }, []);

    const getYouTubeThumbnailUrl = useCallback((url: string) => {
        const videoId = extractYouTubeVideoId(url);
        return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
    }, [extractYouTubeVideoId]);

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
        return (
            <GlobalLoader
                message="북마크를 불러오는 중..."
                subMessage="저장한 맛집 목록을 확인하고 있습니다"
            />
        );
    }

    return (
        <div className="space-y-6">
            {/* 헤더 */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Bookmark className="h-6 w-6" />
                        북마크 내역
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        총 {bookmarks.length}개의 북마크
                    </p>
                </div>
            </div>

            {/* 북마크 목록 */}
            {visibleBookmarks.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <Bookmark className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium">아직 저장한 맛집이 없습니다</p>
                        <p className="text-sm mt-2">
                            맛집을 탐색하고 북마크에 저장해 보세요!
                        </p>
                        <Link href="/">
                            <Button variant="outline" className="mt-4">
                                맛집 탐색하기
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {visibleBookmarks.map((bookmark) => {
                        // 병합된 YouTube 링크 배열 처리
                        const youtubeLinks = (bookmark.restaurant as any).mergedYoutubeLinks ||
                            (bookmark.restaurant.youtube_link ? [bookmark.restaurant.youtube_link] : []);

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
                            <Card key={bookmark.id} className="overflow-hidden">
                                <CardContent className="p-3 md:p-4">
                                    <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
                                        {/* 썸네일 */}
                                        <div className="w-full sm:w-32 md:w-40 aspect-video bg-muted rounded overflow-hidden shrink-0">
                                            {thumbnailUrl ? (
                                                <img
                                                    src={thumbnailUrl}
                                                    alt={bookmark.restaurant.name}
                                                    className="w-full h-full object-cover"
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
                                                        <h3 className="font-bold text-lg">{bookmark.restaurant.name}</h3>
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
                                                    onClick={() => toggleBookmark(bookmark.restaurant_id, true)}
                                                    disabled={isToggling}
                                                    className="text-muted-foreground hover:text-destructive"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>

                                            {/* 주소 */}
                                            <p className="text-sm text-muted-foreground mb-2 truncate">
                                                <MapPin className="h-3 w-3 inline mr-1" />
                                                {bookmark.restaurant.road_address || bookmark.restaurant.jibun_address || "주소 정보 없음"}
                                            </p>

                                            {/* 푸터: 리뷰 수 + 저장일 */}
                                            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                                                <div>리뷰 {bookmark.restaurant.review_count || 0}개</div>
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
                        <div ref={loadMoreRef} className="py-6 text-center text-sm text-muted-foreground">
                            계속 불러오는 중
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
