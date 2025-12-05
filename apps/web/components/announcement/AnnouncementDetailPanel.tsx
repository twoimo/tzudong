'use client';

import { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Megaphone, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getActiveAnnouncements, Announcement } from '@/types/announcement';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface AnnouncementDetailPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
    initialAnnouncement?: Announcement | null;
}

export default function AnnouncementDetailPanel({
    isOpen,
    onClose,
    onToggleCollapse,
    isCollapsed,
    initialAnnouncement,
}: AnnouncementDetailPanelProps) {
    const announcements = getActiveAnnouncements();
    const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(
        initialAnnouncement || (announcements.length > 0 ? announcements[0] : null)
    );

    // initialAnnouncement가 변경되면 선택 상태 업데이트
    useEffect(() => {
        if (initialAnnouncement) {
            setSelectedAnnouncement(initialAnnouncement);
        }
    }, [initialAnnouncement]);

    return (
        <div className="h-full flex flex-col bg-background border-l border-border relative">
            {/* 플로팅 접기/펼치기 버튼 */}
            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title={isCollapsed ? "패널 펼치기" : "패널 접기"}
                    aria-label={isCollapsed ? "패널 펼치기" : "패널 접기"}
                >
                    {!isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    ) : (
                        <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    )}
                </button>
            )}

            {/* 헤더 */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                <div className="flex items-center gap-2">
                    {selectedAnnouncement ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedAnnouncement(null)}
                            className="gap-1 -ml-2"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                    ) : (
                        <Megaphone className="h-5 w-5 text-red-800" />
                    )}
                    <div>
                        <h2 className="text-lg font-bold">공지사항</h2>
                        <p className="text-xs text-muted-foreground">
                            {selectedAnnouncement ? '상세 보기' : '공지사항 목록'}
                        </p>
                    </div>
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

            {/* 본문 */}
            <div className="flex-1 overflow-hidden">
                {announcements.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center p-8 h-full">
                        <Card className="p-8 text-center">
                            <div className="text-4xl mb-3">📢</div>
                            <h3 className="text-lg font-semibold mb-2">공지사항이 없습니다</h3>
                            <p className="text-sm text-muted-foreground">
                                새로운 공지사항이 등록되면 여기에 표시됩니다.
                            </p>
                        </Card>
                    </div>
                ) : selectedAnnouncement ? (
                    /* 선택된 공지사항 상세 보기 */
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-4">
                            <Card className="p-4 overflow-hidden">
                                <div className="space-y-4 overflow-hidden">
                                    {/* 제목 */}
                                    <div>
                                        <h3 className="text-lg font-bold mb-2 break-words">
                                            {selectedAnnouncement.title}
                                        </h3>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Calendar className="h-3 w-3 flex-shrink-0" />
                                            <span>
                                                {formatDistanceToNow(new Date(selectedAnnouncement.createdAt), {
                                                    addSuffix: true,
                                                    locale: ko,
                                                })}
                                            </span>
                                        </div>
                                    </div>

                                    {/* 내용 */}
                                    <div className="pt-4 border-t border-border overflow-hidden">
                                        <div className="whitespace-pre-wrap text-sm text-foreground leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>
                                            {selectedAnnouncement.content}
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </div>
                    </ScrollArea>
                ) : (
                    /* 공지사항 목록 */
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-3">
                            {announcements.map((announcement) => (
                                <Card
                                    key={announcement.id}
                                    className="p-4 cursor-pointer hover:bg-muted/50 transition-colors overflow-hidden"
                                    onClick={() => setSelectedAnnouncement(announcement)}
                                >
                                    <div className="space-y-3 overflow-hidden">
                                        {/* 제목 */}
                                        <div className="flex items-start justify-between gap-2 overflow-hidden">
                                            <div className="flex-1 min-w-0 overflow-hidden">
                                                <h3 className="font-semibold truncate">
                                                    {announcement.title}
                                                </h3>
                                                <p className="text-xs text-muted-foreground line-clamp-2 mt-1 break-words">
                                                    {announcement.content}
                                                </p>
                                            </div>
                                        </div>

                                        {/* 메타 정보 */}
                                        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                                            <div className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                {formatDistanceToNow(new Date(announcement.createdAt), {
                                                    addSuffix: true,
                                                    locale: ko,
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}
