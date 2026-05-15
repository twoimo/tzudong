'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
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
    adminActionsMode?: 'inline' | 'console-link';
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
    adminActionsMode = 'console-link',
}: AnnouncementPanelProps) {
    void isOpen;
    const router = useRouter();
    const canManageInline = isAdmin && adminActionsMode === 'inline';
    const showAdminConsoleCta = isAdmin && adminActionsMode === 'console-link';
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
    const [deleteConfirmation, setDeleteConfirmation] = useState('');
    const [toggleConfirmation, setToggleConfirmation] = useState('');
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const contentInputRef = useRef<HTMLTextAreaElement | null>(null);
const ITEMS_PER_PAGE = 5;

function InlineCountSkeleton() {
    return <span className="inline-block h-3 w-6 rounded-full bg-muted/70 align-middle animate-pulse motion-reduce:animate-none" aria-hidden="true" />;
}

function AnnouncementListItemSkeleton({ index }: { index: number }) {
    return (
        <div className="w-full rounded-lg border border-border bg-background/80 p-2" aria-hidden="true">
            <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
                    <Skeleton className={index % 2 === 0 ? 'h-5 w-40 rounded-full motion-reduce:animate-none' : 'h-5 w-28 rounded-full motion-reduce:animate-none'} />
                </p>
                <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    <Skeleton className="h-3 w-6 rounded-full motion-reduce:animate-none" />
                </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                <Skeleton className="mb-1 h-4 w-full rounded-full motion-reduce:animate-none" />
                <Skeleton className="h-4 w-3/4 rounded-full motion-reduce:animate-none" />
            </p>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                <span><Skeleton className="h-4 w-14 rounded-full motion-reduce:animate-none" /></span>
                <span className="text-orange-700"><Skeleton className="h-4 w-10 rounded-full motion-reduce:animate-none" /></span>
                <span><Skeleton className="h-4 w-20 rounded-full motion-reduce:animate-none" /></span>
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
        setToggleConfirmation('');
        setDeleteConfirmation('');
    };

    const handleDelete = async (id: string) => {
        const target =
            announcements.find((announcement) => announcement.id === id) ||
            (selectedAnnouncement?.id === id ? selectedAnnouncement : null);
        const title = target?.title ?? '선택한 공지';

        if (canManageInline && deleteConfirmation !== '공지삭제') {
            setLastActionMessage('삭제하려면 확인 문구 공지삭제를 입력하세요.');
            return;
        }

        try {
            await deleteAnnouncement.mutateAsync(id);
            if (selectedAnnouncement?.id === id) {
                setSelectedAnnouncement(null);
            }
            setViewMode('list');
            setLastActionMessage(`삭제 완료: "${title}" 공지사항을 목록에서 제거했습니다.`);
            setDeleteConfirmation('');
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
        const actionLabel = nextIsActive ? '게시 시작' : '게시 중지';

        if (canManageInline && toggleConfirmation !== '상태변경') {
            setLastActionMessage(`${actionLabel}하려면 확인 문구 상태변경을 입력하세요.`);
            return;
        }

        try {
            await toggleAnnouncementActive.mutateAsync({ id, isActive: nextIsActive });
            if (selectedAnnouncement?.id === id) {
                setSelectedAnnouncement((prev) =>
                    prev ? { ...prev, isActive: nextIsActive, updatedAt: new Date().toISOString() } : null
                );
            }
            setLastActionMessage(`상태 재확인: "${target.title}" 공지사항을 ${nextIsActive ? '게시 중' : '비활성'} 상태로 바꿨습니다.`);
            setToggleConfirmation('');
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
        const actionLabel = nextShowOnBanner ? '홈 지도 배너에 노출' : '홈 지도 배너에서 내리기';

        if (canManageInline && toggleConfirmation !== '배너변경') {
            setLastActionMessage(`${actionLabel}하려면 확인 문구 배너변경을 입력하세요.`);
            return;
        }

        try {
            await toggleAnnouncementBanner.mutateAsync({ id, showOnBanner: nextShowOnBanner });
            if (selectedAnnouncement?.id === id) {
                setSelectedAnnouncement((prev) =>
                    prev ? { ...prev, showOnBanner: nextShowOnBanner, updatedAt: new Date().toISOString() } : null
                );
            }
            setLastActionMessage(`상태 재확인: "${target.title}" 공지사항을 ${nextShowOnBanner ? '홈 지도 배너에 노출' : '홈 지도 배너에서 내림'} 상태로 바꿨습니다.`);
            setToggleConfirmation('');
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
        setDeleteConfirmation('');
        setToggleConfirmation('');
        setViewMode('list');
    };

    const handleViewDetail = (announcement: Announcement) => {
        setSelectedAnnouncement(announcement);
        setDeleteConfirmation('');
        setToggleConfirmation('');
        setViewMode('detail');
    };

    const handleBackToList = () => {
        setSelectedAnnouncement(null);
        setDeleteConfirmation('');
        setToggleConfirmation('');
        setViewMode('list');
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

    useEffect(() => {
        if (totalPages === 0) {
            setCurrentPage(1);
            return;
        }
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    if (canManageInline) {
        const selectedForDetail = selectedAnnouncement ?? allDisplayAnnouncements[0] ?? null;
        const isEditingForm = viewMode === 'create' || viewMode === 'edit';
        const activeCount = allDisplayAnnouncements.filter((announcement) => announcement.isActive).length;
        const bannerCount = allDisplayAnnouncements.filter((announcement) => announcement.showOnBanner).length;

        return (
            <section aria-labelledby="admin-announcements-title" className="flex h-full min-h-0 flex-col bg-background">
                <div className="shrink-0 border-b border-border bg-card px-2 py-1.5">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                            <p className="text-xs font-semibold text-primary">공지 운영</p>
                            <h2 id="admin-announcements-title" className="truncate text-xl font-bold tracking-[-0.04em] text-foreground">공지사항 관리</h2>
                            <p className="text-xs leading-5 text-muted-foreground">목록과 상세·작성 패널을 반반으로 나눠 모달 없이 게시, 배너 노출, 삭제를 처리합니다.</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground">전체 {isAnnouncementsLoading ? <InlineCountSkeleton /> : allDisplayAnnouncements.length}</span>
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">게시 {isAnnouncementsLoading ? <InlineCountSkeleton /> : activeCount}</span>
                            <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">배너 {isAnnouncementsLoading ? <InlineCountSkeleton /> : bannerCount}</span>
                            <Button type="button" size="sm" className="h-8 rounded-lg" onClick={handleCreate} disabled={isMutating}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />새 공지</Button>
                        </div>
                    </div>
                    {lastActionMessage && <p role="status" aria-live="polite" className="mt-1 rounded-lg border border-emerald-700/20 bg-emerald-50 px-2 py-1 text-xs text-emerald-900">{lastActionMessage}</p>}
                </div>

                <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto p-2 xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)] xl:overflow-hidden">
                    <section className="min-h-0 overflow-hidden rounded-xl border border-border bg-card/95 shadow-sm xl:flex xl:flex-col" aria-labelledby="announcement-list-title">
                        <div className="shrink-0 border-b border-border p-2.5">
                            <h3 id="announcement-list-title" className="text-sm font-bold text-foreground">공지 목록</h3>
                            <p className="text-xs text-muted-foreground">선택한 공지는 오른쪽에서 바로 조정합니다.</p>
                        </div>
                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2" role="list" aria-label="공지사항 목록">
                            {isAnnouncementsLoading ? (
                                <div className="space-y-2" role="status" aria-busy="true" aria-label="공지사항 목록 로딩 중">
                                    <span className="sr-only">공지사항 목록 데이터를 불러오는 중입니다.</span>
                                    {Array.from({ length: 5 }).map((_, index) => <AnnouncementListItemSkeleton key={index} index={index} />)}
                                </div>
                            ) : allDisplayAnnouncements.length === 0 ? (
                                <Card className="border-dashed border-border bg-background/70 p-4 text-center text-sm text-muted-foreground">등록된 공지사항이 없습니다. 오른쪽에서 새 공지를 작성하세요.</Card>
                            ) : allDisplayAnnouncements.map((announcement) => (
                                <button
                                    key={announcement.id}
                                    type="button"
                                    onClick={() => handleViewDetail(announcement)}
                                    className={`w-full rounded-lg border p-2 text-left transition hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedForDetail?.id === announcement.id && !isEditingForm ? 'border-primary/40 bg-primary/5' : 'border-border bg-background/80'}`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="min-w-0 truncate text-sm font-bold text-foreground">{announcement.title}</p>
                                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${announcement.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-border bg-muted/40 text-muted-foreground'}`}>{announcement.isActive ? '게시' : '비활성'}</span>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{announcement.content}</p>
                                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                                        <span>우선순위 {announcement.priority}</span>
                                        {announcement.showOnBanner && <span className="text-orange-700">홈 배너</span>}
                                        <span>{formatDistanceToNow(new Date(announcement.createdAt), { addSuffix: true, locale: ko })}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="min-h-0 overflow-hidden rounded-xl border border-border bg-card/95 shadow-sm xl:flex xl:flex-col" aria-labelledby="announcement-detail-title">
                        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border p-2.5">
                            <div className="min-w-0">
                                <h3 id="announcement-detail-title" className="text-sm font-bold text-foreground">{isEditingForm ? (viewMode === 'create' ? '새 공지 작성' : '공지 수정') : '공지 상세·상태'}</h3>
                                <p className="text-xs text-muted-foreground">위험 작업은 아래 확인 문구로 막고, 팝업 없이 바로 재확인합니다.</p>
                            </div>
                            {isEditingForm && <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={handleCancel}>취소</Button>}
                        </div>

                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
                            {isEditingForm ? (
                                <>
                                    <Card className="border-primary/15 bg-primary/5 p-3">
                                        <p className="text-sm font-semibold text-foreground">저장 전 확인</p>
                                        <p className="mt-1 text-xs leading-5 text-muted-foreground">게시 상태가 켜져 있으면 사용자 메뉴에 보이고, 홈 지도 배너가 켜져 있으면 홈 배너에도 보입니다.</p>
                                    </Card>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="title">제목</Label>
                                        <Input id="title" ref={titleInputRef} name="announcement-title" autoComplete="off" aria-invalid={formError?.field === 'title'} aria-describedby={formError?.field === 'title' ? 'announcement-title-error' : undefined} value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="예: 설 연휴 영업 안내" />
                                        {formError?.field === 'title' && <p id="announcement-title-error" className="text-xs font-medium text-destructive">{formError.message}</p>}
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="content">내용</Label>
                                        <Textarea id="content" ref={contentInputRef} name="announcement-content" autoComplete="off" aria-invalid={formError?.field === 'content'} aria-describedby={formError?.field === 'content' ? 'announcement-content-error' : undefined} value={formData.content} onChange={(e) => setFormData({ ...formData, content: e.target.value })} placeholder="공지 내용을 입력하세요" className="min-h-[160px]" />
                                        {formError?.field === 'content' && <p id="announcement-content-error" className="text-xs font-medium text-destructive">{formError.message}</p>}
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-3">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="priority">우선순위</Label>
                                            <Input id="priority" name="announcement-priority" type="number" inputMode="numeric" min={0} max={100} value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })} />
                                        </div>
                                        <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/80 p-2 text-sm sm:col-span-1">게시 상태<Switch id="isActive" checked={formData.isActive} onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })} /></label>
                                        <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/80 p-2 text-sm sm:col-span-1">홈 배너<Switch id="showOnBanner" checked={formData.showOnBanner} onCheckedChange={(checked) => setFormData({ ...formData, showOnBanner: checked })} /></label>
                                    </div>
                                    <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full rounded-lg bg-red-800 hover:bg-red-900">{isSubmitting ? '저장 중…' : viewMode === 'create' ? '공지 작성' : '수정 저장'}</Button>
                                </>
                            ) : selectedForDetail ? (
                                <>
                                    <Card className="p-3">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <h4 className="break-words text-lg font-bold text-foreground">{selectedForDetail.title}</h4>
                                                <p className="mt-1 text-xs text-muted-foreground">{formatDistanceToNow(new Date(selectedForDetail.createdAt), { addSuffix: true, locale: ko })} · 우선순위 {selectedForDetail.priority}</p>
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${selectedForDetail.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-border bg-muted/40 text-muted-foreground'}`}>{selectedForDetail.isActive ? '게시 중' : '비활성'}</span>
                                                {selectedForDetail.showOnBanner && <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-800">홈 배너</span>}
                                            </div>
                                        </div>
                                        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/80">{selectedForDetail.content}</p>
                                    </Card>
                                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                                        <h4 className="text-sm font-bold text-amber-900">노출 상태 변경 확인</h4>
                                        <p className="mt-1 text-xs leading-5 text-amber-900/80">게시 시작·중지는 <b>상태변경</b>, 홈 배너 노출·해제는 <b>배너변경</b>을 입력한 뒤 적용합니다.</p>
                                        <Input value={toggleConfirmation} onChange={(event) => setToggleConfirmation(event.target.value)} placeholder="상태변경 또는 배너변경" className="mt-2 bg-background" aria-label="공지 노출 상태 변경 확인 문구" />
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <Button variant="outline" className="rounded-lg" onClick={() => handleToggleActive(selectedForDetail.id)} disabled={isMutating || toggleConfirmation !== '상태변경'}>{selectedForDetail.isActive ? <BellOff className="mr-2 h-4 w-4" aria-hidden="true" /> : <Bell className="mr-2 h-4 w-4" aria-hidden="true" />}{selectedForDetail.isActive ? '게시 중지' : '게시 시작'}</Button>
                                        <Button variant="outline" className="rounded-lg" onClick={() => handleToggleBanner(selectedForDetail.id)} disabled={isMutating || toggleConfirmation !== '배너변경'}>{selectedForDetail.showOnBanner ? <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" /> : <Eye className="mr-2 h-4 w-4" aria-hidden="true" />}{selectedForDetail.showOnBanner ? '홈 배너 내리기' : '홈 배너 노출'}</Button>
                                        <Button variant="outline" className="rounded-lg sm:col-span-2" onClick={() => handleEdit(selectedForDetail)} disabled={isMutating}><Edit2 className="mr-2 h-4 w-4" aria-hidden="true" />수정</Button>
                                    </div>
                                    <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3">
                                        <h4 className="flex items-center gap-2 text-sm font-bold text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" />삭제 전 확인</h4>
                                        <p className="mt-1 text-xs leading-5 text-muted-foreground">삭제하려면 확인 문구 <strong>공지삭제</strong>를 입력하세요. 삭제 후 목록 상태를 다시 확인합니다.</p>
                                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                            <Input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="공지삭제" className="bg-background" aria-label="공지 삭제 확인 문구" />
                                            <Button variant="destructive" disabled={isMutating || deleteConfirmation !== '공지삭제'} onClick={() => handleDelete(selectedForDetail.id)}><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />삭제</Button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <Card className="border-dashed border-border bg-background/70 p-4 text-center text-sm text-muted-foreground">선택한 공지사항이 없습니다.</Card>
                            )}
                        </div>
                    </section>
                </div>
            </section>
        );
    }

    return (
        <div className={`h-full flex flex-col bg-background relative ${isBottomSheet || canManageInline ? '' : 'border-l border-border'}`}>
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
            <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                <div className="flex items-center gap-2">
                    {(viewMode === 'detail' || viewMode === 'edit') ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleBackToList}
                            className="gap-1 -ml-2"
                            aria-label="공지 목록으로 돌아가기"
                        >
                            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        </Button>
                    ) : (
                        <Megaphone className="h-5 w-5 text-red-800" aria-hidden="true" />
                    )}
                    <div>
                        <h2 className="text-lg font-bold">
                            {canManageInline ? '공지사항 관리' : '공지사항'}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            {viewMode === 'list' && '공지사항 목록'}
                            {viewMode === 'detail' && '상세 보기'}
                            {viewMode === 'create' && '새 공지사항'}
                            {viewMode === 'edit' && '공지사항 수정'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {canManageInline && viewMode === 'list' && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCreate}
                            disabled={isMutating}
                            className="gap-1"
                        >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            새 공지 작성
                        </Button>
                    )}
                    {!hideCloseButton && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="hover:bg-muted"
                            aria-label="공지 패널 닫기"
                        >
                            <X className="h-5 w-5" aria-hidden="true" />
                        </Button>
                    )}
                </div>
            </div>

            {/* 본문 */}
            <div className="flex-1 overflow-hidden">
                {viewMode === 'list' && (
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-3">
                            {canManageInline && lastActionMessage && (
                                <Card role="status" aria-live="polite" className="border-emerald-700/20 bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">
                                    {lastActionMessage}
                                </Card>
                            )}
                            {isAnnouncementsLoading ? (
                                <Card className="p-8 text-center">
                                    <h3 className="text-lg font-semibold mb-2">공지사항을 불러오는 중입니다</h3>
                                    <p className="text-sm text-muted-foreground">잠시만 기다려주세요.</p>
                                </Card>
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
                                    <Card
                                        key={announcement.id}
                                        className="p-4 overflow-hidden transition-colors"
                                    >
                                        <div className="space-y-3 overflow-hidden">
                                            {/* 제목/내용 - 클릭 시 상세보기 */}
                                            <button
                                                type="button"
                                                className="w-full flex items-start justify-between gap-2 overflow-hidden text-left cursor-pointer hover:bg-muted/50 -mx-4 -mt-4 p-4 rounded-t-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                onClick={() => handleViewDetail(announcement)}
                                                aria-label={`${announcement.title} 공지사항 상세 보기`}
                                            >
                                                <div className="flex-1 min-w-0 overflow-hidden">
                                                    <h3 className="font-semibold truncate mb-1">
                                                        {announcement.title}
                                                    </h3>
                                                    <p className="text-xs text-muted-foreground line-clamp-2 break-words">
                                                        {announcement.content}
                                                    </p>
                                                </div>
                                            </button>

                                            {/* 메타 정보 */}
                                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3" aria-hidden="true" />
                                                    {formatDistanceToNow(new Date(announcement.createdAt), {
                                                        addSuffix: true,
                                                        locale: ko,
                                                    })}
                                                </div>
                                                {canManageInline && <div>우선순위: {announcement.priority}</div>}
                                            </div>

                                            {/* 관리자 액션 버튼 */}
                                            {canManageInline && (
                                                <div className="flex flex-wrap items-center gap-1 pt-2 border-t border-border">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleToggleActive(announcement.id)}
                                                        disabled={isMutating}
                                                        className="gap-1 text-xs"
                                                    >
                                                        {announcement.isActive ? (
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
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleToggleBanner(announcement.id)}
                                                        disabled={isMutating}
                                                        className={`gap-1 text-xs ${announcement.showOnBanner ? 'text-orange-600' : ''}`}
                                                    >
                                                        {announcement.showOnBanner ? (
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
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleEdit(announcement)}
                                                        disabled={isMutating}
                                                        className="gap-1 text-xs"
                                                    >
                                                        <Edit2 className="h-3 w-3" aria-hidden="true" />
                                                        수정
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDelete(announcement.id)}
                                                        disabled={isMutating}
                                                        className="gap-1 text-xs text-destructive hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                                                        삭제
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </Card>
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
                            {showAdminConsoleCta && (
                                <Card className="border-primary/15 bg-primary/5 p-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <h3 className="text-sm font-semibold text-foreground">운영 변경은 관리자 콘솔에서 처리합니다</h3>
                                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                                헤더 공지 패널은 읽기용입니다. 작성·수정·게시·배너 노출은 통합 콘솔에서 진행하세요.
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="min-h-10 shrink-0 rounded-xl bg-background/80"
                                            onClick={() => router.push('/admin?module=announcements')}
                                        >
                                            공지 관리 열기
                                        </Button>
                                    </div>
                                </Card>
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
                                        <div className="whitespace-pre-wrap text-sm text-foreground leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>
                                            {selectedAnnouncement.content}
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
                                            <div className="grid grid-cols-2 gap-2">
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
                                                className="gap-1 text-xs"
                                            >
                                                <Edit2 className="h-3 w-3" aria-hidden="true" />
                                                수정
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleDelete(selectedAnnouncement.id)}
                                                disabled={isMutating}
                                                className="gap-1 text-xs text-destructive hover:text-destructive"
                                            >
                                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                                                삭제
                                            </Button>
                                            </div>
                                        </div>
                                    )}
                                    {showAdminConsoleCta && (
                                        <div className="pt-4 border-t border-border">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="min-h-10 w-full justify-between rounded-xl"
                                                onClick={() => router.push('/admin?module=announcements')}
                                            >
                                                관리자 콘솔에서 공지 관리
                                                <span aria-hidden="true">→</span>
                                            </Button>
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
