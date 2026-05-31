'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { X, ChevronRight, ChevronLeft, Megaphone, Plus, Edit2, Trash2, Calendar, Eye, EyeOff, Bell, BellOff, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/lib/no-toast';
import { Announcement, AnnouncementFormData } from '@/types/announcement';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
    useActiveAnnouncements,
    useAnnouncementsAdmin,
    useCreateAnnouncement,
    useDeleteAnnouncement,
    useToggleAnnouncementActive,
    useToggleAnnouncementBanner,
    useUpdateAnnouncement,
} from '@/hooks/use-announcements';

interface AnnouncementPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
    isAdmin?: boolean;
    initialAnnouncement?: Announcement | null;
    isBottomSheet?: boolean;
    hideCloseButton?: boolean;
    adminActionsMode?: 'inline';
}

function normalizeAnnouncementContent(content: string): string {
    return content
        .replace(/\r\n?/g, '\n')
        .replace(/\\n/g, '\n')
        .trim();
}

function getAnnouncementContentParagraphs(content: string): string[] {
    const normalizedContent = normalizeAnnouncementContent(content);

    return normalizedContent ? normalizedContent.split(/\n{2,}/) : [];
}

export default function AnnouncementPanel({
    isOpen,
    onClose,
    onToggleCollapse,
    isCollapsed,
    isAdmin = false,
    initialAnnouncement,
    isBottomSheet = false,
    hideCloseButton = false,
    adminActionsMode = 'inline',
}: AnnouncementPanelProps) {
    void isOpen;
    void isBottomSheet;
    const canManageInline = isAdmin && adminActionsMode === 'inline';
    const { data: adminAnnouncements = [], isLoading: isAdminAnnouncementsLoading } = useAnnouncementsAdmin(canManageInline);
    const { data: activeAnnouncements = [], isLoading: isActiveAnnouncementsLoading } = useActiveAnnouncements(!canManageInline);
    const createAnnouncement = useCreateAnnouncement();
    const updateAnnouncement = useUpdateAnnouncement();
    const deleteAnnouncement = useDeleteAnnouncement();
    const toggleAnnouncementActive = useToggleAnnouncementActive();
    const toggleAnnouncementBanner = useToggleAnnouncementBanner();

    const announcements = canManageInline ? adminAnnouncements : activeAnnouncements;
    const isAnnouncementsLoading = canManageInline ? isAdminAnnouncementsLoading : isActiveAnnouncementsLoading;
    const isSubmitting = createAnnouncement.isPending || updateAnnouncement.isPending;
    const isMutating =
        isSubmitting ||
        deleteAnnouncement.isPending ||
        toggleAnnouncementActive.isPending ||
        toggleAnnouncementBanner.isPending;

    const [viewMode, setViewMode] = useState<'list' | 'detail' | 'create' | 'edit'>('list');
    const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(
        initialAnnouncement || null
    );
    const [formData, setFormData] = useState<AnnouncementFormData>({
        title: '',
        content: '',
        isActive: true,
        showOnBanner: false,
        priority: 50,
    });
    const [currentPage, setCurrentPage] = useState(1);
    const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);
    const [formError, setFormError] = useState<{ field: 'title' | 'content'; message: string } | null>(null);
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const contentInputRef = useRef<HTMLTextAreaElement | null>(null);
const ITEMS_PER_PAGE = 5;

function InlineCountSkeleton() {
    return <span className="inline-block h-3 w-6 rounded-full bg-muted/70 align-middle animate-pulse motion-reduce:animate-none" aria-hidden="true" />;
}

function AnnouncementListItemSkeleton({ index }: { index: number }) {
    return (
        <div className="w-full rounded-xl border border-border/70 bg-card px-3 py-3" aria-hidden="true">
            <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <Skeleton className={index % 2 === 0 ? 'h-4 w-40 max-w-full rounded-full motion-reduce:animate-none' : 'h-4 w-28 max-w-full rounded-full motion-reduce:animate-none'} />
                    <div className="mt-2 flex items-center gap-1">
                        <Skeleton className="h-3 w-3 rounded-full motion-reduce:animate-none" />
                        <Skeleton className={index % 3 === 0 ? 'h-3 w-16 rounded-full motion-reduce:animate-none' : 'h-3 w-20 rounded-full motion-reduce:animate-none'} />
                    </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <Skeleton className="h-5 w-10 rounded-full motion-reduce:animate-none" />
                    {index % 2 === 0 && <Skeleton className="h-5 w-9 rounded-full motion-reduce:animate-none" />}
                </div>
            </div>
        </div>
    );
}

    // initialAnnouncement가 변경되면 상세보기로 전환
    useEffect(() => {
        if (initialAnnouncement) {
            setSelectedAnnouncement(initialAnnouncement);
            setViewMode('detail');
        }
    }, [initialAnnouncement]);

    const resetForm = () => {
        setFormData({
            title: '',
            content: '',
            isActive: true,
            showOnBanner: false,
            priority: 50,
        });
        setSelectedAnnouncement(null);
    };

    const handleCreate = () => {
        resetForm();
        setViewMode('create');
    };

    const handleEdit = (announcement: Announcement) => {
        setSelectedAnnouncement(announcement);
        setFormData({
            title: announcement.title,
            content: announcement.content,
            isActive: announcement.isActive,
            showOnBanner: announcement.showOnBanner,
            priority: announcement.priority,
        });
        setViewMode('edit');
    };

    const handleDelete = async (id: string) => {
        const target =
            announcements.find((announcement) => announcement.id === id) ||
            (selectedAnnouncement?.id === id ? selectedAnnouncement : null);
        const title = target?.title ?? '선택한 공지';

        try {
            await deleteAnnouncement.mutateAsync(id);
            if (selectedAnnouncement?.id === id) {
                setSelectedAnnouncement(null);
            }
            setViewMode('list');
            setLastActionMessage(`삭제 완료: "${title}" 공지사항을 목록에서 제거했습니다.`);
        } catch {
            // mutation 훅에서 에러 토스트 처리
        }
    };

    const handleToggleActive = async (id: string) => {
        const target =
            announcements.find((announcement) => announcement.id === id) ||
            (selectedAnnouncement?.id === id ? selectedAnnouncement : null);
        if (!target) return;
        const nextIsActive = !target.isActive;

        try {
            await toggleAnnouncementActive.mutateAsync({ id, isActive: nextIsActive });
            if (selectedAnnouncement?.id === id) {
                setSelectedAnnouncement((prev) =>
                    prev ? { ...prev, isActive: nextIsActive, updatedAt: new Date().toISOString() } : null
                );
            }
            setLastActionMessage(`상태 재확인: "${target.title}" 공지사항을 ${nextIsActive ? '게시 중' : '비활성'} 상태로 바꿨습니다.`);
        } catch {
            // mutation 훅에서 에러 토스트 처리
        }
    };

    const handleToggleBanner = async (id: string) => {
        const target =
            announcements.find((announcement) => announcement.id === id) ||
            (selectedAnnouncement?.id === id ? selectedAnnouncement : null);
        if (!target) return;
        const nextShowOnBanner = !target.showOnBanner;

        try {
            await toggleAnnouncementBanner.mutateAsync({ id, showOnBanner: nextShowOnBanner });
            if (selectedAnnouncement?.id === id) {
                setSelectedAnnouncement((prev) =>
                    prev ? { ...prev, showOnBanner: nextShowOnBanner, updatedAt: new Date().toISOString() } : null
                );
            }
            setLastActionMessage(`상태 재확인: "${target.title}" 공지사항을 ${nextShowOnBanner ? '홈 지도 배너에 노출' : '홈 지도 배너에서 내림'} 상태로 바꿨습니다.`);
        } catch {
            // mutation 훅에서 에러 토스트 처리
        }
    };

    const handleSubmit = async () => {
        if (!formData.title.trim()) {
            const message = '제목을 입력해주세요.';
            setFormError({ field: 'title', message });
            titleInputRef.current?.focus();
            toast.error(message);
            return;
        }
        if (!formData.content.trim()) {
            const message = '내용을 입력해주세요.';
            setFormError({ field: 'content', message });
            contentInputRef.current?.focus();
            toast.error(message);
            return;
        }
        setFormError(null);

        if (viewMode === 'create') {
            try {
                await createAnnouncement.mutateAsync(formData);
                setLastActionMessage(`작성 완료: "${formData.title.trim()}" 공지사항을 저장했습니다. 게시 상태와 배너 노출 여부를 목록에서 다시 확인하세요.`);
            } catch {
                return;
            }
        } else if (viewMode === 'edit' && selectedAnnouncement) {
            try {
                await updateAnnouncement.mutateAsync({
                    id: selectedAnnouncement.id,
                    data: formData,
                });
                setLastActionMessage(`수정 완료: "${formData.title.trim()}" 공지사항을 저장했습니다. 변경된 공개 상태를 다시 확인하세요.`);
            } catch {
                return;
            }
        }

        resetForm();
        setViewMode('list');
    };

    const handleCancel = () => {
        resetForm();
        setFormError(null);
        setViewMode('list');
    };

    const handleViewDetail = (announcement: Announcement) => {
        setSelectedAnnouncement(announcement);
        setViewMode('detail');
    };

    // 표시할 공지사항 (운영 콘솔: 전체, 공개 읽기 패널: 활성만)
    const allDisplayAnnouncements = useMemo(() => {
        const sorted = [...announcements].sort((a, b) => b.priority - a.priority);
        return canManageInline ? sorted : sorted.filter((announcement) => announcement.isActive);
    }, [announcements, canManageInline]);

    // 페이지네이션 계산
    const totalPages = Math.ceil(allDisplayAnnouncements.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const displayAnnouncements = allDisplayAnnouncements.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    const activeCount = allDisplayAnnouncements.filter((announcement) => announcement.isActive).length;
    const bannerCount = allDisplayAnnouncements.filter((announcement) => announcement.showOnBanner).length;

    useEffect(() => {
        if (totalPages === 0) {
            setCurrentPage(1);
            return;
        }
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    return (
        <div className="relative flex h-full flex-col bg-background">
            {/* 플로팅 접기/펼치기 버튼 */}
            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title={isCollapsed ? "패널 펼치기" : "패널 접기"}
                    aria-label={isCollapsed ? "패널 펼치기" : "패널 접기"}
                >
                    {!isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                    ) : (
                        <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                    )}
                </button>
            )}

            {/* 헤더 */}
            <div className="shrink-0 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-[min(11rem,100%)]">
                        <h1 className="flex min-w-0 flex-wrap items-center gap-1.5 text-[1.0625rem] font-bold leading-tight text-primary text-balance xs:text-xl sm:gap-2 sm:text-2xl">
                            <Megaphone className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" aria-hidden="true" />
                            <span className="min-w-0 truncate">쯔동여지도 공지</span>
                            {viewMode === 'list' && (
                                <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground xs:text-sm">
                                    {isAnnouncementsLoading ? <InlineCountSkeleton /> : `(${allDisplayAnnouncements.length}개)`}
                                </span>
                            )}
                        </h1>
                        <p className="mt-1 max-w-full text-pretty text-xs leading-5 text-muted-foreground xs:text-sm">
                            {viewMode === 'list' && '쯔동여지도 소식과 운영 안내를 확인하세요.'}
                            {viewMode === 'detail' && '공지 내용을 자세히 확인하세요.'}
                            {viewMode === 'create' && '새 공지사항을 작성합니다.'}
                            {viewMode === 'edit' && '공지사항 내용을 수정합니다.'}
                        </p>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                        {canManageInline && viewMode === 'list' && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={handleCreate}
                                disabled={isMutating}
                                className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted"
                                title="새 공지 작성"
                                aria-label="새 공지 작성"
                            >
                                <Plus className="h-5 w-5" aria-hidden="true" />
                            </Button>
                        )}
                        {!hideCloseButton && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={viewMode === 'list' ? onClose : handleCancel}
                                className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted"
                                aria-label={viewMode === 'list' ? '공지 패널 닫기' : '공지 목록으로 이동'}
                            >
                                <X className="h-5 w-5" aria-hidden="true" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* 본문 */}
            <div className="flex-1 overflow-hidden">
                {viewMode === 'list' && (
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-3">
                            {canManageInline && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="rounded-full border border-border bg-muted/45 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                                        전체 {isAnnouncementsLoading ? <InlineCountSkeleton /> : allDisplayAnnouncements.length}
                                    </span>
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                                        게시 {isAnnouncementsLoading ? <InlineCountSkeleton /> : activeCount}
                                    </span>
                                    <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">
                                        배너 {isAnnouncementsLoading ? <InlineCountSkeleton /> : bannerCount}
                                    </span>
                                </div>
                            )}
                            {canManageInline && lastActionMessage && (
                                <Card role="status" aria-live="polite" className="border-emerald-700/20 bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">
                                    {lastActionMessage}
                                </Card>
                            )}
                            {isAnnouncementsLoading ? (
                                <div className="space-y-3" role="status" aria-busy="true" aria-label="공지사항 목록 로딩 중">
                                    <span className="sr-only">공지사항 목록 데이터를 불러오는 중입니다.</span>
                                    {Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (
                                        <AnnouncementListItemSkeleton key={index} index={index} />
                                    ))}
                                </div>
                            ) : displayAnnouncements.length === 0 ? (
                                <Card className="p-8 text-center">
                                    <div className="text-4xl mb-3">📢</div>
                                    <h3 className="text-lg font-semibold mb-2">공지사항이 없습니다</h3>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        {canManageInline ? '새 공지사항을 작성해보세요.' : '새로운 공지사항이 등록되면 여기에 표시됩니다.'}
                                    </p>
                                    {canManageInline && (
                                        <Button onClick={handleCreate} className="gap-1" disabled={isMutating}>
                                            <Plus className="h-4 w-4" aria-hidden="true" />
                                            새 공지사항 작성
                                        </Button>
                                    )}
                                </Card>
                            ) : (
                                displayAnnouncements.map((announcement) => (
                                    <button
                                        key={announcement.id}
                                        type="button"
                                        className="group w-full rounded-xl border border-border/70 bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        onClick={() => handleViewDetail(announcement)}
                                        aria-label={`${announcement.title} 공지사항 상세 보기`}
                                    >
                                        <div className="flex min-w-0 items-center justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
                                                    {announcement.title}
                                                </h3>
                                                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                                    <Calendar className="h-3 w-3" aria-hidden="true" />
                                                    {formatDistanceToNow(new Date(announcement.createdAt), {
                                                        addSuffix: true,
                                                        locale: ko,
                                                    })}
                                                </div>
                                            </div>
                                            {canManageInline && (
                                                <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] font-semibold">
                                                    <span className={`rounded-full px-2 py-0.5 ${announcement.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-muted text-muted-foreground'}`}>
                                                        {announcement.isActive ? '게시' : '비활성'}
                                                    </span>
                                                    {announcement.showOnBanner && (
                                                        <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-800">
                                                            배너
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                ))
                            )}

                            {/* 페이지네이션 */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-2 pt-2">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => setCurrentPage(1)}
                                        disabled={currentPage === 1}
                                        aria-label="첫 공지 페이지로 이동"
                                    >
                                        <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        aria-label="이전 공지 페이지로 이동"
                                    >
                                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                    <span className="text-sm text-muted-foreground px-2">
                                        {currentPage} / {totalPages}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        aria-label="다음 공지 페이지로 이동"
                                    >
                                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => setCurrentPage(totalPages)}
                                        disabled={currentPage === totalPages}
                                        aria-label="마지막 공지 페이지로 이동"
                                    >
                                        <ChevronsRight className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                )}

                {viewMode === 'detail' && selectedAnnouncement && (
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
                                            <Calendar className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
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
                                        <div className="space-y-3 text-sm text-foreground leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>
                                            {getAnnouncementContentParagraphs(selectedAnnouncement.content).map((paragraph, index) => (
                                                <p
                                                    key={`${selectedAnnouncement.id}-paragraph-${index}`}
                                                    className="whitespace-pre-line"
                                                    style={{ whiteSpace: 'pre-line' }}
                                                >
                                                    {paragraph}
                                                </p>
                                            ))}
                                        </div>
                                    </div>

                                    {/* 관리자 액션 */}
                                    {canManageInline && (
                                        <div className="space-y-3 pt-4 border-t border-border">
                                            {lastActionMessage && (
                                                <Card role="status" aria-live="polite" className="border-emerald-700/20 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
                                                    {lastActionMessage}
                                                </Card>
                                            )}
                                            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/30 p-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleToggleActive(selectedAnnouncement.id)}
                                                    disabled={isMutating}
                                                    className="gap-1 text-xs"
                                                >
                                                    {selectedAnnouncement.isActive ? (
                                                        <>
                                                            <EyeOff className="h-3 w-3" aria-hidden="true" />
                                                            게시 중지
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Eye className="h-3 w-3" aria-hidden="true" />
                                                            게시 시작
                                                        </>
                                                    )}
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleToggleBanner(selectedAnnouncement.id)}
                                                    disabled={isMutating}
                                                    className={`gap-1 text-xs ${selectedAnnouncement.showOnBanner ? 'text-orange-600' : ''}`}
                                                >
                                                    {selectedAnnouncement.showOnBanner ? (
                                                        <>
                                                            <BellOff className="h-3 w-3" aria-hidden="true" />
                                                            홈 배너에서 내리기
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Bell className="h-3 w-3" aria-hidden="true" />
                                                            홈 배너에 노출
                                                        </>
                                                    )}
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleEdit(selectedAnnouncement)}
                                                    disabled={isMutating}
                                                    className="col-span-2 gap-1 text-xs"
                                                >
                                                    <Edit2 className="h-3 w-3" aria-hidden="true" />
                                                    수정
                                                </Button>
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={() => handleDelete(selectedAnnouncement.id)}
                                                    disabled={isMutating}
                                                    className="col-span-2 gap-1 text-xs"
                                                >
                                                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                                                    삭제
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        </div>
                    </ScrollArea>
                )}

                {canManageInline && (viewMode === 'create' || viewMode === 'edit') && (
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-4">
                            <Card className="border-primary/15 bg-primary/5 p-4">
                                <h3 className="text-sm font-semibold text-foreground">저장 전 확인</h3>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                    작성·수정한 공지는 저장 뒤 목록으로 돌아갑니다. 게시 상태가 켜져 있으면 사용자 메뉴에 보이고,
                                    “홈 지도 배너”가 켜져 있으면 홈 화면 배너에도 보입니다.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                    <span className="rounded-full border border-primary/25 bg-background/80 px-3 py-1 text-primary">
                                        게시 상태: {formData.isActive ? '사용자 메뉴에 보임' : '비활성'}
                                    </span>
                                    <span className="rounded-full border border-primary/25 bg-background/80 px-3 py-1 text-primary">
                                        홈 지도 배너: {formData.showOnBanner ? '노출' : '미노출'}
                                    </span>
                                    <span className="rounded-full border border-primary/25 bg-background/80 px-3 py-1 text-primary">
                                        우선순위 {formData.priority}
                                    </span>
                                </div>
                            </Card>
                            <div className="space-y-2">
                                <Label htmlFor="title">제목</Label>
                                <Input
                                    id="title"
                                    ref={titleInputRef}
                                    name="announcement-title"
                                    autoComplete="off"
                                    aria-invalid={formError?.field === 'title'}
                                    aria-describedby={formError?.field === 'title' ? 'announcement-title-error' : undefined}
                                    value={formData.title}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    placeholder="예: 설 연휴 영업 안내…"
                                />
                                {formError?.field === 'title' && (
                                    <p id="announcement-title-error" className="text-xs font-medium text-destructive">
                                        {formError.message}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="content">내용</Label>
                                <Textarea
                                    id="content"
                                    ref={contentInputRef}
                                    name="announcement-content"
                                    autoComplete="off"
                                    aria-invalid={formError?.field === 'content'}
                                    aria-describedby={formError?.field === 'content' ? 'announcement-content-error' : undefined}
                                    value={formData.content}
                                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                    placeholder="예: 연휴 기간에는 일부 맛집의 영업 시간이 달라질 수 있어요…"
                                    className="min-h-[200px]"
                                />
                                {formError?.field === 'content' && (
                                    <p id="announcement-content-error" className="text-xs font-medium text-destructive">
                                        {formError.message}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="priority">우선순위 (0~100)</Label>
                                <Input
                                    id="priority"
                                    name="announcement-priority"
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={100}
                                    value={formData.priority}
                                    onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
                                />
                                <p className="text-xs text-muted-foreground">
                                    숫자가 높을수록 상단에 표시됩니다. 일반 50, 중요 80, 긴급 100을 권장합니다.
                                </p>
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="isActive">게시 상태</Label>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        id="isActive"
                                        checked={formData.isActive}
                                        onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                                    />
                                    <span className="text-sm text-muted-foreground">
                                        {formData.isActive ? '게시중' : '비활성'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <div>
                                    <Label htmlFor="showOnBanner">메인화면 배너</Label>
                                    <p className="text-xs text-muted-foreground">
                                        켜면 홈 지도 위 배너에 바로 보입니다.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        id="showOnBanner"
                                        checked={formData.showOnBanner}
                                        onCheckedChange={(checked) => setFormData({ ...formData, showOnBanner: checked })}
                                    />
                                    <span className="text-sm text-muted-foreground">
                                        {formData.showOnBanner ? '노출' : '미노출'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button
                                    variant="outline"
                                    onClick={handleCancel}
                                    disabled={isSubmitting}
                                    className="flex-1"
                                >
                                    취소
                                </Button>
                                <Button
                                    onClick={handleSubmit}
                                    disabled={isSubmitting}
                                    className="flex-1 bg-red-800 hover:bg-red-900"
                                >
                                    {isSubmitting ? '저장 중…' : viewMode === 'create' ? '공지 작성 후 목록으로 돌아가기' : '수정 저장 후 목록으로 돌아가기'}
                                </Button>
                            </div>
                        </div>
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}
