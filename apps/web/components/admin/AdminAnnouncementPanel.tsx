'use client';

import { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Megaphone, Plus, Edit2, Trash2, Calendar, Eye, EyeOff, Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { DUMMY_ANNOUNCEMENTS, Announcement, AnnouncementFormData } from '@/types/announcement';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface AdminAnnouncementPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
}

type ViewMode = 'list' | 'create' | 'edit';

export default function AdminAnnouncementPanel({
    isOpen,
    onClose,
    onToggleCollapse,
    isCollapsed,
}: AdminAnnouncementPanelProps) {
    const [announcements, setAnnouncements] = useState<Announcement[]>([...DUMMY_ANNOUNCEMENTS]);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
    const [formData, setFormData] = useState<AnnouncementFormData>({
        title: '',
        content: '',
        isActive: true,
        showOnBanner: false,
        priority: 50,
    });

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
        }
    };

    const handleToggleActive = (id: string) => {
        setAnnouncements(prev =>
            prev.map(a =>
                a.id === id ? { ...a, isActive: !a.isActive, updatedAt: new Date().toISOString() } : a
            )
        );
        toast.success('공지사항 상태가 변경되었습니다');
    };

    const handleToggleBanner = (id: string) => {
        setAnnouncements(prev =>
            prev.map(a =>
                a.id === id ? { ...a, showOnBanner: !a.showOnBanner, updatedAt: new Date().toISOString() } : a
            )
        );
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
                    <Megaphone className="h-5 w-5 text-red-800" />
                    <div>
                        <h2 className="text-lg font-bold">공지사항 관리</h2>
                        <p className="text-xs text-muted-foreground">
                            {viewMode === 'list' ? '공지사항 목록' : viewMode === 'create' ? '새 공지사항' : '공지사항 수정'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {viewMode === 'list' && (
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
                {viewMode === 'list' ? (
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-3">
                            {announcements.length === 0 ? (
                                <Card className="p-8 text-center">
                                    <div className="text-4xl mb-3">📢</div>
                                    <h3 className="text-lg font-semibold mb-2">공지사항이 없습니다</h3>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        새 공지사항을 작성해주세요.
                                    </p>
                                    <Button onClick={handleCreate} className="gap-1">
                                        <Plus className="h-4 w-4" />
                                        새 공지사항 작성
                                    </Button>
                                </Card>
                            ) : (
                                announcements
                                    .sort((a, b) => b.priority - a.priority)
                                    .map((announcement) => (
                                        <Card key={announcement.id} className="p-4">
                                            <div className="space-y-3">
                                                {/* 제목 및 상태 */}
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                                            <h3 className="font-semibold truncate">
                                                                {announcement.title}
                                                            </h3>
                                                            <Badge
                                                                variant={announcement.isActive ? 'default' : 'secondary'}
                                                                className={announcement.isActive ? 'bg-green-500' : ''}
                                                            >
                                                                {announcement.isActive ? '게시중' : '비활성'}
                                                            </Badge>
                                                            {announcement.showOnBanner && (
                                                                <Badge variant="outline" className="text-orange-600 border-orange-400">
                                                                    배너
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground line-clamp-2">
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
                                                    <div>우선순위: {announcement.priority}</div>
                                                </div>

                                                {/* 액션 버튼 */}
                                                <div className="flex items-center gap-2 pt-2 border-t border-border">
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
                                            </div>
                                        </Card>
                                    ))
                            )}
                        </div>
                    </ScrollArea>
                ) : (
                    /* 작성/수정 폼 */
                    <div className="p-4 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="title">제목</Label>
                            <Input
                                id="title"
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                placeholder="공지사항 제목을 입력하세요"
                                maxLength={100}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="content">내용</Label>
                            <Textarea
                                id="content"
                                value={formData.content}
                                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                placeholder="공지사항 내용을 입력하세요"
                                className="min-h-[200px] resize-none"
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
                                {viewMode === 'create' ? '작성' : '수정'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
