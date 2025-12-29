'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Bookmark,
    Trash2,
    MapPin,
    ExternalLink,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBookmarks, useToggleBookmark } from "@/hooks/use-bookmarks";

export default function BookmarksTab() {
    const { user } = useAuth();
    const { data: bookmarks = [], isLoading } = useBookmarks();
    const { toggleBookmark, isLoading: isToggling } = useToggleBookmark();

    const extractYouTubeVideoId = (url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    };

    const getYouTubeThumbnailUrl = (url: string) => {
        const videoId = extractYouTubeVideoId(url);
        return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
    };

    if (isLoading) {
        return (
            <div className="text-center py-12 text-muted-foreground bg-muted/10 h-full flex items-center justify-center">
                로딩 중...
            </div>
        );
    }

    if (!user) return null;

    return (
        <div className="h-full flex flex-col bg-muted/10">
            {bookmarks.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                    <Bookmark className="h-10 w-10 mb-3 opacity-50" />
                    <p className="text-sm font-medium">아직 저장한 맛집이 없습니다</p>
                    <p className="text-xs mt-1">맛집을 탐색하고 북마크에 저장해 보세요!</p>
                </div>
            ) : (
                <ScrollArea className="flex-1 p-4">
                    <div className="space-y-3 pb-4">
                        {bookmarks.map((bookmark) => {
                            const youtubeLinks = (bookmark.restaurant as any).mergedYoutubeLinks ||
                                (bookmark.restaurant.youtube_link ? [bookmark.restaurant.youtube_link] : []);

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
                                    <CardContent className="p-3">
                                        <div className="flex gap-3">
                                            {/* 썸네일 */}
                                            <div className="w-24 aspect-video bg-muted rounded overflow-hidden shrink-0">
                                                {thumbnailUrl ? (
                                                    <img
                                                        src={thumbnailUrl}
                                                        alt={bookmark.restaurant.name}
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <MapPin className="h-4 w-4 text-muted-foreground" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* 정보 */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between mb-1">
                                                    <div className="flex-1 min-w-0">
                                                        <h3 className="font-bold text-sm truncate pr-1">{bookmark.restaurant.name}</h3>
                                                        <p className="text-xs text-muted-foreground truncate flex items-center">
                                                            <MapPin className="h-3 w-3 inline mr-0.5 shrink-0" />
                                                            {bookmark.restaurant.road_address || bookmark.restaurant.jibun_address || "주소 정보 없음"}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => toggleBookmark(bookmark.restaurant_id, true)}
                                                        disabled={isToggling}
                                                        className="h-6 w-6 text-muted-foreground hover:text-destructive -mr-1 -mt-1"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>

                                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                                    {bookmark.restaurant.category?.[0] && (
                                                        <Badge variant="secondary" className="text-[10px] px-1 h-4">
                                                            {bookmark.restaurant.category[0]}
                                                        </Badge>
                                                    )}
                                                    <span className="text-[10px] text-muted-foreground">
                                                        저장: {formatDate(bookmark.created_at)}
                                                    </span>
                                                </div>

                                                {bookmark.restaurant.youtube_link && (
                                                    <a
                                                        href={bookmark.restaurant.youtube_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-1 text-[10px] text-primary hover:underline mt-1"
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                        영상 보기
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </ScrollArea>
            )}
        </div>
    );
}
