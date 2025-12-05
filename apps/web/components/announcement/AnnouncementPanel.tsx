'use client';

import { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Megaphone, Plus, Edit2, Trash2, Calendar, Eye, EyeOff, Bell, BellOff, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { DUMMY_ANNOUNCEMENTS, Announcement, AnnouncementFormData, getActiveAnnouncements } from '@/types/announcement';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface AnnouncementPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
    isAdmin?: boolean;
    initialAnnouncement?: Announcement | null;
}

export default function AnnouncementPanel({
    isOpen,
    onClose,
    onToggleCollapse,
    isCollapsed,
    isAdmin = false,
    initialAnnouncement,
}: AnnouncementPanelProps) {
    // 관리자는 모든 공지사항, 사용자는 활성화된 것만
    const [announcements, setAnnouncements] = useState<Announcement[]>(
        isAdmin ? [...DUMMY_ANNOUNCEMENTS] : getActiveAnnouncements()
    );
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
    const ITEMS_PER_PAGE = 5;

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

    const handleDelete = (id: string) => {
        if (confirm('정말 이 공지사항을 삭제하시겠습니까?')) {
            setAnnouncements(prev => prev.filter(a => a.id !== id));
            toast.success('공지사항이 삭제되었습니다');
            setViewMode('list');
        }
    };

    const handleToggleActive = (id: string) => {
        setAnnouncements(prev =>
            prev.map(a =>
                a.id === id ? { ...a, isActive: !a.isActive, updatedAt: new Date().toISOString() } : a
            )
        );
        // 상세보기 중인 공지사항도 업데이트
        if (selectedAnnouncement?.id === id) {
            setSelectedAnnouncement(prev => prev ? { ...prev, isActive: !prev.isActive, updatedAt: new Date().toISOString() } : null);
        }
        toast.success('공지사항 상태가 변경되었습니다');
    };

    const handleToggleBanner = (id: string) => {
        setAnnouncements(prev =>
            prev.map(a =>
                a.id === id ? { ...a, showOnBanner: !a.showOnBanner, updatedAt: new Date().toISOString() } : a
            )
        );
        // 상세보기 중인 공지사항도 업데이트
        if (selectedAnnouncement?.id === id) {
            setSelectedAnnouncement(prev => prev ? { ...prev, showOnBanner: !prev.showOnBanner, updatedAt: new Date().toISOString() } : null);
        }
        toast.success('배너 노출 상태가 변경되었습니다');
    };

    const handleSubmit = () => {
        if (!formData.title.trim()) {
            toast.error('제목을 입력해주세요');
            return;
        }
        if (!formData.content.trim()) {
            toast.error('내용을 입력해주세요');
            return;
        }

        const now = new Date().toISOString();

        if (viewMode === 'create') {
            const newAnnouncement: Announcement = {
                id: crypto.randomUUID(),
                title: formData.title,
                content: formData.content,
                isActive: formData.isActive,
                showOnBanner: formData.showOnBanner,
                priority: formData.priority,
                createdAt: now,
                updatedAt: now,
            };
            setAnnouncements(prev => [newAnnouncement, ...prev]);
            toast.success('공지사항이 작성되었습니다');
        } else if (viewMode === 'edit' && selectedAnnouncement) {
            setAnnouncements(prev =>
                prev.map(a =>
                    a.id === selectedAnnouncement.id
                        ? {
                            ...a,
                            title: formData.title,
                            content: formData.content,
                            isActive: formData.isActive,
                            showOnBanner: formData.showOnBanner,
                            priority: formData.priority,
                            updatedAt: now,
                        }
                        : a
                )
            );
            toast.success('공지사항이 수정되었습니다');
        }

        resetForm();
        setViewMode('list');
    };

    const handleCancel = () => {
        resetForm();
        setViewMode('list');
    };

    const handleViewDetail = (announcement: Announcement) => {
        setSelectedAnnouncement(announcement);
        setViewMode('detail');
    };

    const handleBackToList = () => {
        setSelectedAnnouncement(null);
        setViewMode('list');
    };

    // 표시할 공지사항 (관리자: 우선순위 순, 사용자: 활성화된 것만)
    const allDisplayAnnouncements = isAdmin
        ? announcements.sort((a, b) => b.priority - a.priority)
        : announcements.filter(a => a.isActive).sort((a, b) => b.priority - a.priority);

    // 페이지네이션 계산
    const totalPages = Math.ceil(allDisplayAnnouncements.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const displayAnnouncements = allDisplayAnnouncements.slice(startIndex, startIndex + ITEMS_PER_PAGE);

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
                    {(viewMode === 'detail' || viewMode === 'edit') ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleBackToList}
                            className="gap-1 -ml-2"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                    ) : (
                        <Megaphone className="h-5 w-5 text-red-800" />
                    )}
                    <div>
                        <h2 className="text-lg font-bold">
                            {isAdmin ? '공지사항 관리' : '공지사항'}
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
                    {isAdmin && viewMode === 'list' && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCreate}
                            className="gap-1"
                        >
                            <Plus className="h-4 w-4" />
                            새 공지
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="hover:bg-muted"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>
            </div>

            {/* 본문 */}
            <div className="flex-1 overflow-hidden">
                {viewMode === 'list' && (
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-3">
                            {displayAnnouncements.length === 0 ? (
                                <Card className="p-8 text-center">
                                    <div className="text-4xl mb-3">📢</div>
                                    <h3 className="text-lg font-semibold mb-2">공지사항이 없습니다</h3>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        {isAdmin ? '새 공지사항을 작성해보세요.' : '새로운 공지사항이 등록되면 여기에 표시됩니다.'}
                                    </p>
                                    {isAdmin && (
                                        <Button onClick={handleCreate} className="gap-1">
                                            <Plus className="h-4 w-4" />
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
                                            <div
                                                className="flex items-start justify-between gap-2 overflow-hidden cursor-pointer hover:bg-muted/50 -mx-4 -mt-4 p-4 rounded-t-lg transition-colors"
                                                onClick={() => handleViewDetail(announcement)}
                                            >
                                                <div className="flex-1 min-w-0 overflow-hidden">
                                                    <h3 className="font-semibold truncate mb-1">
                                                        {announcement.title}
                                                    </h3>
                                                    <p className="text-xs text-muted-foreground line-clamp-2 break-words">
                                                        {announcement.content}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* 메타 정보 */}
                                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3" />
                                                    {formatDistanceToNow(new Date(announcement.createdAt), {
                                                        addSuffix: true,
                                                        locale: ko,
                                                    })}
                                                </div>
                                                {isAdmin && <div>우선순위: {announcement.priority}</div>}
                                            </div>

                                            {/* 관리자 액션 버튼 */}
                                            {isAdmin && (
                                                <div className="flex flex-wrap items-center gap-1 pt-2 border-t border-border">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleToggleActive(announcement.id)}
                                                        className="gap-1 text-xs"
                                                    >
                                                        {announcement.isActive ? (
                                                            <>
                                                                <EyeOff className="h-3 w-3" />
                                                                비활성화
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Eye className="h-3 w-3" />
                                                                활성화
                                                            </>
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleToggleBanner(announcement.id)}
                                                        className={`gap-1 text-xs ${announcement.showOnBanner ? 'text-orange-600' : ''}`}
                                                    >
                                                        {announcement.showOnBanner ? (
                                                            <>
                                                                <BellOff className="h-3 w-3" />
                                                                배너해제
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Bell className="h-3 w-3" />
                                                                배너노출
                                                            </>
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleEdit(announcement)}
                                                        className="gap-1 text-xs"
                                                    >
                                                        <Edit2 className="h-3 w-3" />
                                                        수정
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDelete(announcement.id)}
                                                        className="gap-1 text-xs text-destructive hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
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
                                    >
                                        <ChevronsLeft className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
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
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => setCurrentPage(totalPages)}
                                        disabled={currentPage === totalPages}
                                    >
                                        <ChevronsRight className="h-4 w-4" />
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

                                    {/* 관리자 액션 */}
                                    {isAdmin && (
                                        <div className="grid grid-cols-2 gap-2 pt-4 border-t border-border">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleToggleActive(selectedAnnouncement.id)}
                                                className="gap-1 text-xs"
                                            >
                                                {selectedAnnouncement.isActive ? (
                                                    <>
                                                        <EyeOff className="h-3 w-3" />
                                                        비활성화
                                                    </>
                                                ) : (
                                                    <>
                                                        <Eye className="h-3 w-3" />
                                                        활성화
                                                    </>
                                                )}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleToggleBanner(selectedAnnouncement.id)}
                                                className={`gap-1 text-xs ${selectedAnnouncement.showOnBanner ? 'text-orange-600' : ''}`}
                                            >
                                                {selectedAnnouncement.showOnBanner ? (
                                                    <>
                                                        <BellOff className="h-3 w-3" />
                                                        배너해제
                                                    </>
                                                ) : (
                                                    <>
                                                        <Bell className="h-3 w-3" />
                                                        배너노출
                                                    </>
                                                )}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleEdit(selectedAnnouncement)}
                                                className="gap-1 text-xs"
                                            >
                                                <Edit2 className="h-3 w-3" />
                                                수정
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleDelete(selectedAnnouncement.id)}
                                                className="gap-1 text-xs text-destructive hover:text-destructive"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                                삭제
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        </div>
                    </ScrollArea>
                )}

                {(viewMode === 'create' || viewMode === 'edit') && (
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="title">제목</Label>
                                <Input
                                    id="title"
                                    value={formData.title}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    placeholder="공지사항 제목을 입력하세요"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="content">내용</Label>
                                <Textarea
                                    id="content"
                                    value={formData.content}
                                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                    placeholder="공지사항 내용을 입력하세요"
                                    className="min-h-[200px]"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="priority">우선순위 (0~100)</Label>
                                <Input
                                    id="priority"
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={formData.priority}
                                    onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
                                />
                                <p className="text-xs text-muted-foreground">
                                    숫자가 높을수록 상단에 표시됩니다
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
                                        지도 위에 배너로 표시됩니다
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
                                    className="flex-1"
                                >
                                    취소
                                </Button>
                                <Button
                                    onClick={handleSubmit}
                                    className="flex-1 bg-red-800 hover:bg-red-900"
                                >
                                    {viewMode === 'create' ? '작성' : '저장'}
                                </Button>
                            </div>
                        </div>
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}
