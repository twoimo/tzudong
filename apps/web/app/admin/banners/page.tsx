"use client";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

import { useState, useRef, useMemo, Suspense, useEffect, useLayoutEffect } from 'react';
import { useFilledSkeletonCount } from '@/lib/use-filled-skeleton-count';
import { useInitialLoadPending } from '@/lib/use-initial-load-pending';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
    useAdBannersAdmin,
    useCreateAdBanner,
    useUpdateAdBanner,
    useDeleteAdBanner,
    useUploadBannerImage,
    useDeleteBannerImage,
} from '@/hooks/use-ad-banners';
import { AdBanner, AdBannerFormData, DisplayTarget } from '@/types/ad-banner';
import imageCompression from 'browser-image-compression';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
    Plus,
    Trash2,
    Image as ImageIcon,
    Upload,
    ArrowLeft,
    Monitor,
    Smartphone,
    ExternalLink,
    Loader2,
    Scroll,
    Search,
    RefreshCw,
    X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '@/lib/open-external-url';
import { toast } from '@/hooks/use-toast';
import {
    AD_BANNER_URL_VALIDATION_ERROR,
    resolveAdBannerDestinationUrl,
    resolveAdBannerMediaStoragePath,
    resolveAdBannerPersistenceUrls,
} from '@/lib/ad-banner-url';

// 이미지 압축 옵션
const IMAGE_COMPRESSION_OPTIONS = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1600,
    fileType: 'image/webp' as const,
    useWebWorker: true,
};

function InlineCountSkeleton({ className }: { className?: string }) {
    return <span className={cn("inline-block h-3 w-6 rounded-full bg-muted/70 align-middle animate-pulse motion-reduce:animate-none", className)} aria-hidden="true" />;
}

function BannerListItemSkeleton({ index }: { index: number }) {
    return (
        <div className="w-full rounded-lg border border-border bg-background/80 p-2 text-left" aria-hidden="true">
            <div className="flex gap-2">
                <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border">
                    <Skeleton className="h-full w-full rounded-none motion-reduce:animate-none" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                            <Skeleton className={cn("h-5 rounded-full motion-reduce:animate-none", index % 2 === 0 ? "w-32" : "w-24")} />
                        </p>
                        <Badge variant="outline" className="shrink-0 rounded-full text-2xs">
                            <Skeleton className="h-3 w-6 rounded-full motion-reduce:animate-none" />
                        </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <Skeleton className="h-4 w-4/5 rounded-full motion-reduce:animate-none" />
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary" className="rounded-full text-2xs">
                            <Skeleton className="h-3 w-14 rounded-full motion-reduce:animate-none" />
                        </Badge>
                        <Badge variant="secondary" className="rounded-full text-2xs">
                            <Skeleton className="h-3 w-12 rounded-full motion-reduce:animate-none" />
                        </Badge>
                        {index % 2 === 0 && (
                            <span className="inline-flex items-center text-2xs text-primary">
                                <ExternalLink className="mr-0.5 h-3 w-3" aria-hidden="true" />
                                <Skeleton className="h-3 w-6 rounded-full motion-reduce:animate-none" />
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

const matchesSavedBanner = (actual: AdBanner | undefined, expected: AdBanner) => Boolean(actual
    && actual.title === expected.title && actual.description === expected.description
    && actual.is_active === expected.is_active && actual.priority === expected.priority
    && actual.image_url === expected.image_url && actual.video_url === expected.video_url
    && actual.media_type === expected.media_type && actual.link_url === expected.link_url
    && JSON.stringify([...actual.display_target].sort()) === JSON.stringify([...expected.display_target].sort()));

const revokeObjectUrlIfNeeded = (url: string | null) => {
    if (url?.startsWith('blob:https:') || url?.startsWith('blob:http:')) {
        URL.revokeObjectURL(url);
    }
};

const isSafePreviewUrl = (url: string | null): url is string => {
    if (!url) return false;
    try {
        const parsed = new URL(url, 'https://tzudong.app');
        return parsed.protocol === 'blob:' || parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
};

const isNestedUploadInteractiveTarget = (target: EventTarget | null) => {
    return target instanceof HTMLElement && Boolean(
        target.closest('button, a, input, textarea, select, video')
    );
};

type BannerManagementPageWrapperProps = {
    embedded?: boolean;
    onInitialContentReady?: () => void;
};

// Suspense 래퍼
function BannerManagementPageWrapper({ embedded = false, onInitialContentReady }: BannerManagementPageWrapperProps = {}) {
    return (
        <Suspense fallback={null}>
            <BannerManagementPage embedded={embedded} onInitialContentReady={onInitialContentReady} />
        </Suspense>
    );
}

function BannerManagementRoutePage() {
    return <BannerManagementPageWrapper />;
}

BannerManagementRoutePage.Embedded = BannerManagementPageWrapper;

export default BannerManagementRoutePage;


function BannerManagementPage({ embedded, onInitialContentReady }: BannerManagementPageWrapperProps & { embedded: boolean }) {
    const router = useRouter();
    const { user, isAdmin, isLoading: authLoading } = useAuth();

    // 배너 데이터
    const { data: banners = [], isLoading: bannersLoading, isFetching: bannersFetching, isError: bannersError, refetch: refetchBanners } = useAdBannersAdmin();
    const initialLoadPending = useInitialLoadPending(!authLoading && !bannersLoading);
    useLayoutEffect(() => {
        if (!onInitialContentReady || authLoading || initialLoadPending) return;
        onInitialContentReady();
    }, [authLoading, bannersLoading, initialLoadPending, onInitialContentReady]);
    const { ref: bannerListRef, count: bannerListCount } = useFilledSkeletonCount(88, 5);
    const createBanner = useCreateAdBanner();
    const updateBanner = useUpdateAdBanner();
    const deleteBanner = useDeleteAdBanner();
    const uploadImage = useUploadBannerImage();
    const deleteImage = useDeleteBannerImage();

    // 폼 상태
    const [editingBanner, setEditingBanner] = useState<AdBanner | null>(null);
    const [formData, setFormData] = useState<AdBannerFormData>({
        title: '',
        description: '',
        image_url: null,
        video_url: null,
        media_type: 'none',
        link_url: '',
        is_active: true,
        priority: 0,
        display_target: ['sidebar', 'mobile_popup'],
    });

    // 미디어 업로드 상태
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [videoPreview, setVideoPreview] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [compressionProgress, setCompressionProgress] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 삭제 확인 다이얼로그
    const [bannerToDelete, setBannerToDelete] = useState<AdBanner | null>(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortOrder, setSortOrder] = useState('priority');
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [isNarrow, setIsNarrow] = useState(false);
    useEffect(() => {
        const media = window.matchMedia('(max-width: 1279px)');
        const update = () => setIsNarrow(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    const [targetFilter, setTargetFilter] = useState('all');
    const [pendingEditor, setPendingEditor] = useState<{ banner: AdBanner | null; close?: boolean } | null>(null);
    const [actionResult, setActionResult] = useState<{ status: 'success' | 'warning' | 'error'; message: string } | null>(null);
    const [initialForm, setInitialForm] = useState(formData);
    const editorRef = useRef<HTMLElement>(null);
    const [pendingReadback, setPendingReadback] = useState<{ saved: AdBanner } | { deletedId: string; mediaCleanupFailed: boolean } | null>(null);
    const isDirty = JSON.stringify(formData) !== JSON.stringify(initialForm) || Boolean(imageFile || videoFile);
    const isBusy = isUploading || createBanner.isPending || updateBanner.isPending || deleteBanner.isPending;
    const visibleBanners = useMemo(() => [...banners]
        .sort((a, b) => sortOrder === 'title' ? a.title.localeCompare(b.title, 'ko') : sortOrder === 'updated' ? Date.parse(b.updated_at) - Date.parse(a.updated_at) : b.priority - a.priority)
        .filter((banner) => (!searchQuery.trim() || `${banner.title} ${banner.description || ''}`.toLowerCase().includes(searchQuery.trim().toLowerCase()))
            && (statusFilter === 'all' || banner.is_active === (statusFilter === 'active'))
            && (targetFilter === 'all' || banner.display_target.includes(targetFilter as DisplayTarget))),
    [banners, searchQuery, statusFilter, targetFilter, sortOrder]);

    // 권한 체크
    useEffect(() => {
        if (embedded) return;
        if (!authLoading && (!user || !isAdmin)) {
            router.push('/');
        }
    }, [authLoading, embedded, user, isAdmin, router]);

    // 정렬된 배너 목록 (조건부 return 전에 useMemo 호출)
    const sortedBanners = useMemo(() => {
        return [...banners].sort((a, b) => b.priority - a.priority);
    }, [banners]);
    const activeBannerCount = sortedBanners.filter((banner) => banner.is_active).length;
    const inactiveBannerCount = sortedBanners.length - activeBannerCount;
    const sidebarTargetCount = sortedBanners.filter((banner) => banner.display_target.includes('sidebar')).length;
    const mobileTargetCount = sortedBanners.filter((banner) => banner.display_target.includes('mobile_popup')).length;

    if (!embedded && authLoading) {
        return null;
    }

    if (!embedded && (!user || !isAdmin)) {
        return null;
    }

    // 폼 초기화
    const resetForm = () => {
        revokeObjectUrlIfNeeded(imagePreview);
        revokeObjectUrlIfNeeded(videoPreview);
        const emptyForm: AdBannerFormData = {
            title: '', description: '', image_url: null, video_url: null,
            media_type: 'none', link_url: '', is_active: true, priority: 0,
            display_target: ['sidebar', 'mobile_popup'],
        };
        setFormData(emptyForm);
        setInitialForm(emptyForm);
        setImageFile(null);
        setVideoFile(null);
        setImagePreview(null);
        setVideoPreview(null);
        setCompressionProgress(0);
        setEditingBanner(null);
        setBannerToDelete(null);
        setDeleteConfirmation('');
    };

    const handleOpenExternalLink = (rawUrl: string) => {
        const isOpened = openExternalUrl(rawUrl);
        if (!isOpened) {
            toast({
                title: '링크를 열 수 없습니다',
                description: '링크 형식 또는 팝업 차단 설정을 확인해주세요.',
                variant: 'destructive',
            });
        }
    };

    // 작성 패널 열기 (생성)
    const openCreatePanel = () => requestEditor(null);

    // 상세 편집 패널 열기 (수정)
    const openEditPanel = (banner: AdBanner) => {
        const resolvedUrls = resolveAdBannerPersistenceUrls(banner);
        setEditingBanner(banner);
        const nextForm: AdBannerFormData = {
            title: banner.title,
            description: banner.description || '',
            image_url: resolvedUrls?.image_url ?? null,
            video_url: resolvedUrls?.video_url ?? null,
            media_type: resolvedUrls?.media_type ?? 'none',
            link_url: resolvedUrls?.link_url ?? '',
            is_active: banner.is_active,
            priority: banner.priority,
            display_target: [...banner.display_target],
        };
        setFormData(nextForm);
        setInitialForm(nextForm);
        setImageFile(null);
        setVideoFile(null);
        revokeObjectUrlIfNeeded(imagePreview);
        revokeObjectUrlIfNeeded(videoPreview);
        setImagePreview(resolvedUrls?.image_url ?? null);
        setVideoPreview(resolvedUrls?.video_url ?? null);
        setBannerToDelete(null);
        setDeleteConfirmation('');
    };

    const applyEditor = (banner: AdBanner | null, close = false) => {
        if (isBusy || pendingReadback) return;
        setPendingEditor(null);
        setActionResult(null);
        setIsEditorOpen(!close);
        if (banner) openEditPanel(banner);
        else resetForm();
        requestAnimationFrame(() => editorRef.current?.focus());
    };
    const requestEditor = (banner: AdBanner | null) => {
        if (isBusy || pendingReadback) return;
        if (banner && banner.id === editingBanner?.id) {
            editorRef.current?.focus();
            return;
        }
        if (isDirty) setPendingEditor({ banner });
        else applyEditor(banner);
    };

    const closeEditor = () => {
        if (isBusy || pendingReadback) return;
        if (isDirty) setPendingEditor({ banner: null, close: true });
        else applyEditor(null, true);
    };

    // 이미지 드래그 핸들러
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        const mediaFile = files.find(file =>
            file.type.startsWith('image/') || file.type.startsWith('video/')
        );

        if (mediaFile) {
            await handleMediaSelect(mediaFile);
        }
    };

    const handleUploadSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (isBusy || pendingReadback || isNestedUploadInteractiveTarget(event.target)) return;
        fileInputRef.current?.click();
    };

    const handleUploadSurfaceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isBusy || pendingReadback || isNestedUploadInteractiveTarget(event.target)) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;

        event.preventDefault();
        fileInputRef.current?.click();
    };

    // 미디어 선택 처리 (이미지 또는 영상)
    const handleMediaSelect = async (file: File) => {
        if (isBusy || pendingReadback) return;
        const isVideo = file.type.startsWith('video/');

        if (isVideo) {
            await handleVideoSelect(file);
        } else {
            await handleImageSelect(file);
        }
    };

    // 이미지 선택 처리
    const handleImageSelect = async (file: File) => {
        try {
            setIsUploading(true);
            setCompressionProgress(0);

            // 기존 영상 제거
            revokeObjectUrlIfNeeded(imagePreview);
            revokeObjectUrlIfNeeded(videoPreview);
            setVideoFile(null);
            setVideoPreview(null);

            // 이미지 압축
            const compressedFile = await imageCompression(file, IMAGE_COMPRESSION_OPTIONS);
            const webpFile = new File([compressedFile], `${Date.now()}.webp`, { type: 'image/webp' });

            setImageFile(webpFile);
            setImagePreview(URL.createObjectURL(webpFile));
            setFormData(prev => ({ ...prev, media_type: 'image', image_url: null, video_url: null }));
        } catch (error) {
            console.error('이미지 압축 실패:');
            toast({
                title: '이미지 처리 실패',
                description: '이미지를 처리하는 중 오류가 발생했습니다.',
                variant: 'destructive',
            });
        } finally {
            setIsUploading(false);
            setCompressionProgress(0);
        }
    };

    // 영상 선택 처리 (압축 없이 원본 업로드)
    const handleVideoSelect = async (file: File) => {
        try {
            setIsUploading(true);

            // 기존 이미지 제거
            revokeObjectUrlIfNeeded(imagePreview);
            revokeObjectUrlIfNeeded(videoPreview);
            setImageFile(null);
            setImagePreview(null);

            // 원본 파일 그대로 사용 (압축 없음)
            setVideoFile(file);
            setVideoPreview(URL.createObjectURL(file));
            setFormData(prev => ({ ...prev, media_type: 'video', image_url: null, video_url: null }));
        } catch (error) {
            console.error('영상 처리 실패:');
            toast({
                title: '영상 처리 실패',
                description: '영상을 처리하는 중 오류가 발생했습니다.',
                variant: 'destructive',
            });
        } finally {
            setIsUploading(false);
        }
    };

    // 미디어 삭제
    const handleMediaRemove = () => {
        revokeObjectUrlIfNeeded(imagePreview);
        revokeObjectUrlIfNeeded(videoPreview);
        setImageFile(null);
        setVideoFile(null);
        setImagePreview(null);
        setVideoPreview(null);
        setFormData(prev => ({ ...prev, image_url: null, video_url: null, media_type: 'none' }));
    };

    // 파일 입력 변경
    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleMediaSelect(file);
        }
    };

    // display_target 토글
    const toggleDisplayTarget = (target: DisplayTarget) => {
        setFormData(prev => {
            const current = prev.display_target || [];
            if (current.includes(target)) {
                return { ...prev, display_target: current.filter(t => t !== target) };
            } else {
                return { ...prev, display_target: [...current, target] };
            }
        });
    };

    // 폼 제출
    const handleSubmit = async () => {
        if (isBusy || bannersError || !isDirty || Boolean(pendingReadback)) return;
        if (!formData.title.trim()) {
            toast({
                title: '제목을 입력해주세요',
                variant: 'destructive',
            });
            return;
        }

        const normalizedDestinationUrl = formData.link_url
            ? resolveAdBannerDestinationUrl(formData.link_url)
            : null;
        if (formData.link_url && !normalizedDestinationUrl) {
            toast({
                title: '배너 저장 실패',
                description: AD_BANNER_URL_VALIDATION_ERROR,
                variant: 'destructive',
            });
            return;
        }

        if (!imageFile && !videoFile && !resolveAdBannerPersistenceUrls({
            image_url: formData.image_url ?? null,
            video_url: formData.video_url ?? null,
            media_type: formData.media_type,
            link_url: normalizedDestinationUrl,
        })) {
            toast({
                title: '배너 저장 실패',
                description: AD_BANNER_URL_VALIDATION_ERROR,
                variant: 'destructive',
            });
            return;
        }

        try {
            setIsUploading(true);
            setPendingEditor(null);
            setActionResult(null);

            let imageUrl = formData.image_url;
            let videoUrl = formData.video_url;

            // 새 이미지가 있으면 업로드
            if (imageFile) {
                const uploadResult = await uploadImage.mutateAsync(imageFile);
                imageUrl = uploadResult.url;
                videoUrl = null; // 이미지 업로드 시 영상 제거
            }

            // 새 영상이 있으면 업로드
            if (videoFile) {
                const uploadResult = await uploadImage.mutateAsync(videoFile); // 동일한 업로드 훅 사용
                videoUrl = uploadResult.url;
                imageUrl = null; // 영상 업로드 시 이미지 제거
            }

            const dataToSubmit = {
                ...formData,
                image_url: imageUrl,
                video_url: videoUrl,
                link_url: normalizedDestinationUrl,
            };
            const resolvedUrls = resolveAdBannerPersistenceUrls(dataToSubmit);
            if (!resolvedUrls) {
                toast({
                    title: '배너 저장 실패',
                    description: AD_BANNER_URL_VALIDATION_ERROR,
                    variant: 'destructive',
                });
                return;
            }

            const validatedDataToSubmit = {
                ...dataToSubmit,
                ...resolvedUrls,
            };

            const savedBanner = editingBanner
                ? await updateBanner.mutateAsync({ id: editingBanner.id, data: validatedDataToSubmit })
                : await createBanner.mutateAsync(validatedDataToSubmit);
            openEditPanel(savedBanner);
            setPendingReadback({ saved: savedBanner });
            const readback = await refetchBanners();
            const confirmedBanner = readback.data?.find((banner) => banner.id === savedBanner.id);
            const readbackMatches = matchesSavedBanner(confirmedBanner, savedBanner);
            if (readback.isError || !readbackMatches) {
                setActionResult({ status: 'warning', message: '저장은 완료했지만 목록 재확인이 필요합니다. 중복 저장하지 말고 새로고침으로 확인해 주세요.' });
            } else {
                openEditPanel(confirmedBanner!);
                setPendingReadback(null);
                setActionResult({ status: 'success', message: '저장한 배너 상태를 목록에서 다시 확인했습니다.' });
            }
        } catch (error) {
            console.error('배너 저장 실패:');
            setActionResult({ status: 'error', message: '배너를 저장하지 못했습니다. 입력 내용은 유지됩니다. 목록에서 적용 여부를 확인한 후 다시 시도해 주세요.' });
        } finally {
            setIsUploading(false);
        }
    };

    // 삭제 실행
    const handleDelete = async () => {
        if (!bannerToDelete) return;
        if (deleteConfirmation !== '배너삭제' || bannerToDelete.id !== editingBanner?.id || isBusy || bannersError || Boolean(pendingReadback)) return;

        try {
            setIsUploading(true);
            setActionResult(null);
            await deleteBanner.mutateAsync(bannerToDelete.id);

            const mediaPaths = [
                bannerToDelete.image_url,
                bannerToDelete.video_url,
            ]
                .map(resolveAdBannerMediaStoragePath)
                .filter((path): path is string => path !== null);
            let mediaCleanupFailed = false;
            await Promise.all(mediaPaths.map(async (path) => {
                await deleteImage.mutateAsync(path);
            })).catch(() => {
                mediaCleanupFailed = true;
                console.error('배너 DB 삭제 후 미디어 정리 실패:');
            });
            setPendingReadback({ deletedId: bannerToDelete.id, mediaCleanupFailed });
            const readback = await refetchBanners();
            const deletionConfirmed = !readback.isError && Array.isArray(readback.data) && !readback.data.some((banner) => banner.id === bannerToDelete.id);

            setBannerToDelete(null);
            setDeleteConfirmation('');
            resetForm();
            if (deletionConfirmed) {
                setPendingReadback(null);
                setIsEditorOpen(false);
            }
            setActionResult({
                status: deletionConfirmed && !mediaCleanupFailed ? 'success' : 'warning',
                message: !deletionConfirmed ? '삭제 요청은 완료했지만 목록 재확인이 필요합니다. 다시 삭제하지 말고 새로고침해 주세요.'
                    : mediaCleanupFailed ? '배너 삭제를 확인했습니다. 연결 미디어 일부를 정리하지 못했습니다.'
                    : '배너가 목록에서 삭제된 것을 확인했습니다.',
            });
        } catch (error) {
            console.error('배너 삭제 실패:');
            setActionResult({ status: 'error', message: '삭제 결과를 확인하지 못했습니다. 목록에서 현재 상태를 확인해 주세요.' });
        } finally {
            setIsUploading(false);
        }
    };

    const refreshBannerList = async () => {
        const result = await refetchBanners();
        const pending = pendingReadback;
        if (result.isError || !Array.isArray(result.data) || !pending) return;
        if ('saved' in pending) {
            const confirmed = result.data?.find((banner) => banner.id === pending.saved.id);
            if (!matchesSavedBanner(confirmed, pending.saved)) return;
            openEditPanel(confirmed!);
            setActionResult({ status: 'success', message: '저장한 배너 상태를 목록에서 다시 확인했습니다.' });
        } else {
            if (result.data?.some((banner) => banner.id === pending.deletedId)) return;
            setIsEditorOpen(false);
            setActionResult({ status: pending.mediaCleanupFailed ? 'warning' : 'success', message: pending.mediaCleanupFailed ? '배너 삭제를 확인했습니다. 연결 미디어 일부를 정리하지 못했습니다.' : '배너가 목록에서 삭제된 것을 확인했습니다.' });
        }
        setPendingReadback(null);
    };

    const inspectorContent = (
                    <section ref={editorRef} tabIndex={-1} className={cn("admin-cms-inspector !p-0 flex h-full min-h-0 flex-col overflow-hidden bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary", isNarrow && "!w-full !flex-auto")} aria-labelledby="banner-editor-title">
                {pendingEditor && <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 p-2 text-sm text-amber-950">
                    <span className="flex-1">저장하지 않은 배너 변경이 있습니다.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPendingEditor(null)}>계속 편집</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => applyEditor(pendingEditor.banner, pendingEditor.close)}>변경 버리고 이동</Button>
                </div>}
                {isEditorOpen && actionResult && <p role={actionResult.status === 'success' ? 'status' : 'alert'} className={cn("shrink-0 border-b px-3 py-2 text-sm", actionResult.status === 'success' ? 'bg-emerald-50 text-emerald-800' : actionResult.status === 'warning' ? 'bg-amber-50 text-amber-900' : 'bg-destructive/10 text-destructive')}>{actionResult.message}</p>}
                        <div className="admin-cms-inspector-header sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card p-2.5">
                            <div className="min-w-0">
                                <h2 id="banner-editor-title" className="text-sm font-semibold text-foreground">{!isEditorOpen ? '배너 상세' : editingBanner ? '배너 수정' : '새 배너 작성'}</h2>
                                <p className="text-xs text-muted-foreground" role="status">{!isEditorOpen ? '목록에서 배너를 선택하세요.' : isDirty ? '저장하지 않은 변경' : editingBanner ? '저장된 배너' : '제목과 표시 위치를 입력하세요.'}</p>
                            </div>
                            {isEditorOpen && <div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={handleSubmit} disabled={isBusy || bannersError || !isDirty || Boolean(pendingReadback)}>{isBusy ? '처리 중…' : editingBanner ? '수정 저장' : '배너 추가'}</Button><Button type="button" variant="ghost" size="sm" disabled={isBusy || Boolean(pendingReadback)} onClick={closeEditor}><X className="h-4 w-4" aria-hidden="true" />{isNarrow ? '목록으로' : '닫기'}</Button></div>}
                        </div>

                        {pendingReadback && <div className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900"><span className="min-w-0 flex-1">이전 변경의 상태를 먼저 확인해 주세요.</span><Button type="button" size="sm" variant="outline" disabled={bannersFetching || isBusy} onClick={() => void refreshBannerList()}>상태 재확인</Button></div>}
                        {!isEditorOpen ? <div className="admin-cms-empty flex min-h-64 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">배너를 선택하면 내용과 노출 설정을 편집할 수 있습니다.</p><Button type="button" variant="outline" size="sm" disabled={isBusy || Boolean(pendingReadback)} onClick={openCreatePanel}><Plus className="h-4 w-4" aria-hidden="true" />새 배너</Button></div> : <fieldset disabled={isBusy || Boolean(pendingReadback)} className="admin-cms-inspector-body min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto p-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label htmlFor="title">제목 *</Label>
                                    <Input id="title" value={formData.title} onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))} placeholder="배너 제목" />
                                </div>
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label htmlFor="description">설명</Label>
                                    <Textarea id="description" value={formData.description || ''} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} placeholder="배너 설명" rows={3} />
                                </div>
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label>배너 이미지/영상</Label>
                                    <Card
                                        role="button"
                                        tabIndex={0}
                                        aria-label="배너 이미지 또는 영상 업로드"
                                        className={cn("cursor-pointer border-dashed p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2", isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50", (imagePreview || videoPreview) && "border-solid border-emerald-300 bg-emerald-50/40")}
                                        onDragOver={handleDragOver}
                                        onDragEnter={handleDragEnter}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                        onClick={handleUploadSurfaceClick}
                                        onKeyDown={handleUploadSurfaceKeyDown}
                                    >
                                        {isUploading ? (
                                            <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{compressionProgress > 0 ? `압축 중 ${compressionProgress}%` : '미디어 처리 중'}</div>
                                        ) : isSafePreviewUrl(videoPreview) ? (
                                            <div className="space-y-2"><video src={videoPreview} controls className="aspect-video w-full rounded-md border object-cover" /><Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={(e) => { e.stopPropagation(); handleMediaRemove(); }}>미디어 제거</Button></div>
                                        ) : imagePreview ? (
                                            <div className="space-y-2"><div className="relative aspect-video w-full overflow-hidden rounded-md border"><Image src={imagePreview} alt="미리보기" fill unoptimized sizes="(max-width: 768px) 100vw, 768px" className="object-cover" /></div><Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={(e) => { e.stopPropagation(); handleMediaRemove(); }}>미디어 제거</Button></div>
                                        ) : (
                                            <div className="flex items-center gap-3 py-5 text-sm text-muted-foreground"><Upload className="h-6 w-6 shrink-0" aria-hidden="true" /><span className="min-w-0">{isDragging ? '여기에 파일을 놓으세요' : '클릭 또는 드래그로 이미지/영상을 선택하세요'}</span></div>
                                        )}
                                        <input ref={fileInputRef} id="banner-media-upload" type="file" accept="image/*,video/*" onChange={handleFileInputChange} className="hidden" />
                                    </Card>
                                </div>
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label htmlFor="link_url">클릭 시 이동 URL</Label>
                                    <Input id="link_url" type="url" value={formData.link_url || ''} onChange={(e) => setFormData(prev => ({ ...prev, link_url: e.target.value }))} placeholder="https://example.com" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="priority">우선순위 <span className="font-normal text-muted-foreground">높을수록 먼저 표시</span></Label>
                                    <Input id="priority" type="number" min={0} max={1000} value={formData.priority} onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))} />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border border-border bg-background/70 p-2">
                                    <Label htmlFor="is_active">활성화</Label>
                                    <Switch id="is_active" checked={formData.is_active} onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))} />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <Label>표시 위치</Label>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <label className="flex items-center gap-2 rounded-lg border border-border bg-background/70 p-2 text-sm"><Checkbox id="target-sidebar" checked={formData.display_target?.includes('sidebar')} onCheckedChange={() => toggleDisplayTarget('sidebar')} /><Monitor className="h-4 w-4" aria-hidden="true" />데스크톱 배너</label>
                                        <label className="flex items-center gap-2 rounded-lg border border-border bg-background/70 p-2 text-sm"><Checkbox id="target-mobile" checked={formData.display_target?.includes('mobile_popup')} onCheckedChange={() => toggleDisplayTarget('mobile_popup')} /><Smartphone className="h-4 w-4" aria-hidden="true" />모바일 팝업</label>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap">
                                <Button className="w-full sm:w-auto" variant="outline" disabled={isBusy || Boolean(pendingReadback) || !isDirty} onClick={() => { if (editingBanner) openEditPanel(editingBanner); else resetForm(); setActionResult(null); }}>변경 되돌리기</Button>
                                {formData.link_url && <Button className="w-full sm:w-auto" type="button" variant="ghost" onClick={() => handleOpenExternalLink(formData.link_url || '')}><ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />링크 확인</Button>}
                            </div>

                            {editingBanner && (
                                <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3">
                                    <h3 className="flex items-center gap-2 text-sm font-bold text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" />삭제 전 확인</h3>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">이 배너와 연결 미디어를 삭제합니다. 되돌릴 수 없으므로 <strong>배너삭제</strong>를 입력하세요.</p>
                                    {isDirty && <p className="mt-1 text-xs text-destructive">변경 내용을 저장하거나 되돌린 후 삭제할 수 있습니다.</p>}
                                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                        <Input value={deleteConfirmation} onChange={(event) => { setBannerToDelete(editingBanner); setDeleteConfirmation(event.target.value); }} placeholder="배너삭제" className="bg-background" aria-label="배너 삭제 확인 문구" />
                                        <Button type="button" variant="destructive" className="w-full sm:w-auto" disabled={deleteConfirmation !== '배너삭제' || isBusy || bannersError || Boolean(pendingReadback) || isDirty} onClick={() => void handleDelete()}>
                                            {deleteBanner.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />}
                                            삭제
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </fieldset>}
                    </section>
    );

    return (
        <div className={cn("text-foreground", embedded ? "flex h-full min-h-0 flex-col overflow-hidden bg-background font-sans tracking-normal" : "min-h-screen bg-[#fdfbf7] font-sans")} data-admin-embedded-module-shell={embedded ? "true" : undefined} data-admin-embedded-module-id={embedded ? "banners" : undefined}>
            {!embedded && (
                <div
                    className="fixed inset-0 opacity-30 pointer-events-none z-0"
                    style={{
                        backgroundImage: 'url("/images/ui-noise.png")',
                        backgroundRepeat: 'repeat',
                    }}
                />
            )}

            <div className={cn("relative z-10 flex min-h-0 flex-1 flex-col", embedded ? "h-full" : "container mx-auto min-h-screen max-w-7xl p-3 md:p-4")}>
                <AdminPageHeader title="배너 관리" icon={ImageIcon}
                    data-admin-module-header={embedded ? "compact" : undefined} data-admin-module-header-module={embedded ? "banners" : undefined}
                    summary={<>전체 {bannersLoading ? <InlineCountSkeleton /> : sortedBanners.length}개 · 활성 {bannersLoading ? <InlineCountSkeleton /> : activeBannerCount}개 · 비활성 {bannersLoading ? <InlineCountSkeleton /> : inactiveBannerCount}개</>}
                    actions={<div className="flex w-full min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center lg:w-auto" data-admin-module-actions={embedded ? "top-right" : undefined}>
                        <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
                            <Badge variant="secondary" className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted/50 text-muted-foreground"><Monitor className="mr-1 h-3.5 w-3.5" aria-hidden="true" />데스크톱 배너 {bannersLoading ? <InlineCountSkeleton className="ml-1 w-5" /> : sidebarTargetCount}</Badge>
                            <Badge variant="secondary" className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted/50 text-muted-foreground"><Smartphone className="mr-1 h-3.5 w-3.5" aria-hidden="true" />모바일 팝업 {bannersLoading ? <InlineCountSkeleton className="ml-1 w-5" /> : mobileTargetCount}</Badge>
                        </div>
                        <Button onClick={openCreatePanel} disabled={isBusy || Boolean(pendingReadback)} className="h-9 w-full rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90 sm:w-auto">
                            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />새 배너
                        </Button>
                    </div>}
                >
                    {!embedded && <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-9 w-9" aria-label="이전 화면으로 돌아가기"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Button>}
                </AdminPageHeader>

                {!isEditorOpen && actionResult && <p role={actionResult.status === 'success' ? 'status' : 'alert'} className={cn("shrink-0 border-b px-3 py-2 text-sm", actionResult.status === 'success' ? 'bg-emerald-50 text-emerald-800' : actionResult.status === 'warning' ? 'bg-amber-50 text-amber-900' : 'bg-destructive/10 text-destructive')}>{actionResult.message}</p>}

                <div className={cn("admin-cms-workspace grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]", !embedded && "border border-t-0 bg-background")} data-admin-module-content={embedded ? "bounded" : undefined}>
                    <section className="admin-cms-list-pane flex min-h-0 flex-col overflow-hidden bg-card xl:border-r" aria-labelledby="banner-list-title">
                        <div className="admin-cms-toolbar sticky top-0 z-10 shrink-0 bg-card" data-admin-banners-toolbar>
                            <h2 id="banner-list-title" className="sr-only">배너 목록</h2>
                            <div className="flex w-full min-w-0 gap-2"><div className="relative min-w-0 flex-1">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                <Input id="admin-banner-search" aria-label="배너 제목·설명 검색" placeholder="제목·설명 검색" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="h-9 pl-9" />
                            </div><Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="배너 목록 새로고침" disabled={bannersFetching || isBusy} onClick={() => void refreshBannerList()}><RefreshCw className={cn("h-4 w-4", bannersFetching && "animate-spin")} aria-hidden="true" /></Button></div>
                            <div className="flex w-full flex-wrap items-center gap-2">
                                <select aria-label="배너 활성 상태 필터" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="all">모든 상태</option><option value="active">활성</option><option value="inactive">비활성</option></select>
                                <select aria-label="배너 표시 위치 필터" value={targetFilter} onChange={(event) => setTargetFilter(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="all">모든 위치</option><option value="sidebar">데스크톱 배너</option><option value="mobile_popup">모바일 팝업</option></select>
                                <select aria-label="배너 정렬" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="priority">우선순위순</option><option value="updated">최근 수정순</option><option value="title">제목순</option></select>
                                {(searchQuery || statusFilter !== 'all' || targetFilter !== 'all') && <Button type="button" size="sm" variant="ghost" onClick={() => { setSearchQuery(''); setStatusFilter('all'); setTargetFilter('all'); }}>초기화</Button>}
                            </div>
                            {bannersError && <div role="alert" className="flex w-full flex-wrap items-center gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive"><span className="flex-1">배너 목록을 불러오지 못했습니다.{banners.length > 0 && ' 이전 목록을 표시합니다.'}</span><Button type="button" variant="outline" size="sm" disabled={bannersFetching || isBusy} onClick={() => void refreshBannerList()}>다시 시도</Button></div>}
                        </div>

                        <div ref={bannerListRef} className="admin-cms-table-container min-h-0 flex-1 overflow-y-auto" aria-label="배너 목록">
                            {bannersLoading ? (
                                <div className="space-y-2" role="status" aria-busy="true" aria-label="배너 목록 로딩 중">
                                    <span className="sr-only">배너 목록 데이터를 불러오는 중입니다.</span>
                                    {Array.from({ length: bannerListCount }).map((_, index) => <BannerListItemSkeleton key={index} index={index} />)}
                                </div>
                            ) : bannersError && banners.length === 0 ? (
                                <p className="p-4 text-center text-sm text-muted-foreground">조회가 완료되면 배너 목록을 표시합니다.</p>
                            ) : visibleBanners.length === 0 ? (
                                <Card className="border-dashed border-border bg-background/70 p-4 text-center text-sm text-muted-foreground">
                                    {banners.length > 0 ? '검색·필터에 맞는 배너가 없습니다. 조건을 초기화해 보세요.' : '등록된 배너가 없습니다. 새 배너를 추가해 보세요.'}
                                </Card>
                            ) : <><ul className="admin-cms-record-list divide-y divide-border md:hidden" role="list" aria-label="배너 목록">{visibleBanners.map((banner) => {
                                const isSelected = editingBanner?.id === banner.id;
                                const resolvedUrls = resolveAdBannerPersistenceUrls(banner);
                                return (
                                    <li key={banner.id}><button
                                        type="button"
                                        aria-current={isSelected ? "true" : undefined}
                                        aria-pressed={isSelected}
                                        data-selected={isSelected ? "true" : "false"}
                                        className={cn("admin-cms-record-row w-full border-l-2 px-3 py-2.5 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary", isSelected ? "admin-cms-row-selected border-l-primary bg-primary/5" : "border-l-transparent")}
                                        disabled={isBusy || Boolean(pendingReadback)} onClick={() => requestEditor(banner)}
                                    >
                                        <div className="flex min-w-0 gap-2">
                                            {resolvedUrls?.image_url ? (
                                                <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border">
                                                    <Image src={resolvedUrls.image_url} alt="" fill unoptimized sizes="64px" className="object-cover" />
                                                </div>
                                            ) : (
                                                <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                                                    <Scroll className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex min-w-0 items-start justify-between gap-2">
                                                    <p className="min-w-0 truncate text-sm font-semibold text-foreground">{banner.title}</p>
                                                    <Badge variant={banner.is_active ? "default" : "outline"} className="shrink-0 rounded-full text-2xs">{banner.is_active ? '활성' : '비활성'}</Badge>
                                                </div>
                                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{banner.description || '설명 없음'} · 우선순위 {banner.priority}</p>
                                                <div className="mt-1 flex min-w-0 flex-nowrap gap-1 overflow-x-auto scrollbar-hide [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
                                                    {banner.display_target.includes('sidebar') && <Badge variant="secondary" className="shrink-0 rounded-full text-2xs">데스크톱 배너</Badge>}
                                                    {banner.display_target.includes('mobile_popup') && <Badge variant="secondary" className="shrink-0 rounded-full text-2xs">모바일 팝업</Badge>}
                                                    {resolvedUrls?.link_url && <span className="inline-flex shrink-0 items-center text-2xs text-primary"><ExternalLink className="mr-0.5 h-3 w-3" aria-hidden="true" />링크</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </button></li>
                                );
                            })}</ul>
                            <table className="admin-cms-table hidden table-fixed md:table">
                                <caption className="sr-only">배너 목록</caption>
                                <thead className="sticky top-0 z-10 bg-muted"><tr><th scope="col" className="w-[44%]">배너</th><th scope="col" className="w-[14%]">상태</th><th scope="col" className="w-[30%]">노출 위치</th><th scope="col" className="w-[12%]">우선순위</th></tr></thead>
                                <tbody>{visibleBanners.map((banner) => {
                                    const isSelected = editingBanner?.id === banner.id;
                                    const resolvedUrls = resolveAdBannerPersistenceUrls(banner);
                                    return <tr key={banner.id} data-selected={isSelected ? 'true' : 'false'} className={cn(isSelected && 'admin-cms-row-selected')}>
                                        <td><button type="button" className="flex w-full min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" disabled={isBusy || Boolean(pendingReadback)} aria-pressed={isSelected} aria-label={`${banner.title} 편집`} onClick={() => requestEditor(banner)}>
                                            <span className="relative flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">{resolvedUrls?.image_url ? <Image src={resolvedUrls.image_url} alt="" fill unoptimized sizes="48px" className="object-cover" /> : <Scroll className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}</span>
                                            <span className="min-w-0"><span className="block truncate text-sm font-medium">{banner.title}</span><span className="block truncate text-xs text-muted-foreground">{banner.description || '설명 없음'}</span></span>
                                        </button></td>
                                        <td><Badge variant={banner.is_active ? 'default' : 'outline'} className="whitespace-nowrap rounded-full text-2xs">{banner.is_active ? '활성' : '비활성'}</Badge></td>
                                        <td><div className="flex flex-wrap gap-1">{banner.display_target.includes('sidebar') && <Badge variant="secondary" className="whitespace-nowrap rounded-full text-2xs">데스크톱 배너</Badge>}{banner.display_target.includes('mobile_popup') && <Badge variant="secondary" className="whitespace-nowrap rounded-full text-2xs">모바일 팝업</Badge>}</div></td>
                                        <td className="tabular-nums">{banner.priority}</td>
                                    </tr>;
                                })}</tbody>
                            </table></>}
                        </div>
                        <div className="admin-cms-footer shrink-0 justify-between" aria-live="polite"><span className="tabular-nums">{visibleBanners.length} / {sortedBanners.length}개</span><span>배너를 선택해 편집</span></div>
                    </section>

                    {!isNarrow && inspectorContent}
                    {isNarrow && <Sheet open={isEditorOpen || Boolean(pendingReadback)} onOpenChange={(open) => { if (!open) closeEditor(); }}>
                        <SheetContent className="admin-cms-drawer flex h-dvh w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[min(640px,100vw)] sm:max-w-none [&>button:last-child]:hidden" onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById('admin-banner-search')?.focus(); }}>
                            <SheetTitle className="sr-only">{editingBanner ? '배너 수정' : '새 배너 작성'}</SheetTitle>
                            <SheetDescription className="sr-only">선택한 배너의 내용과 미디어, 노출 위치를 관리합니다.</SheetDescription>
                            {inspectorContent}
                        </SheetContent>
                    </Sheet>}
                </div>
            </div>
        </div>
    );
}
