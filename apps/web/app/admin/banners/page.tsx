"use client";

import { useState, useRef, useMemo, Suspense, useEffect } from 'react';
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
} from 'lucide-react';
import { RISKY_WORK_STEPS } from '@/lib/admin/risky-work-procedure';
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
                        <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
                            <Skeleton className={cn("h-5 rounded-full motion-reduce:animate-none", index % 2 === 0 ? "w-32" : "w-24")} />
                        </p>
                        <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">
                            <Skeleton className="h-3 w-6 rounded-full motion-reduce:animate-none" />
                        </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <Skeleton className="h-4 w-4/5 rounded-full motion-reduce:animate-none" />
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary" className="rounded-full text-[10px]">
                            <Skeleton className="h-3 w-14 rounded-full motion-reduce:animate-none" />
                        </Badge>
                        <Badge variant="secondary" className="rounded-full text-[10px]">
                            <Skeleton className="h-3 w-12 rounded-full motion-reduce:animate-none" />
                        </Badge>
                        {index % 2 === 0 && (
                            <span className="inline-flex items-center text-[10px] text-primary">
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
};

// Suspense 래퍼
function BannerManagementPageWrapper({ embedded = false }: BannerManagementPageWrapperProps = {}) {
    return (
        <Suspense fallback={null}>
            <div data-admin-risky-work-steps={RISKY_WORK_STEPS.join(' ')}>
                <BannerManagementPage embedded={embedded} />
            </div>
        </Suspense>
    );
}

function BannerManagementRoutePage() {
    return <BannerManagementPageWrapper />;
}

BannerManagementRoutePage.Embedded = BannerManagementPageWrapper;

export default BannerManagementRoutePage;


function BannerManagementPage({ embedded }: Required<BannerManagementPageWrapperProps>) {
    const router = useRouter();
    const { user, isAdmin, isLoading: authLoading } = useAuth();

    // 배너 데이터
    const { data: banners = [], isLoading: bannersLoading } = useAdBannersAdmin();
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
        setFormData({
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
    const openCreatePanel = () => {
        resetForm();
    };

    // 상세 편집 패널 열기 (수정)
    const openEditPanel = (banner: AdBanner) => {
        const resolvedUrls = resolveAdBannerPersistenceUrls(banner);
        setEditingBanner(banner);
        setFormData({
            title: banner.title,
            description: banner.description || '',
            image_url: resolvedUrls?.image_url ?? null,
            video_url: resolvedUrls?.video_url ?? null,
            media_type: resolvedUrls?.media_type ?? 'none',
            link_url: resolvedUrls?.link_url ?? '',
            is_active: banner.is_active,
            priority: banner.priority,
            display_target: banner.display_target as DisplayTarget[],
        });
        revokeObjectUrlIfNeeded(imagePreview);
        revokeObjectUrlIfNeeded(videoPreview);
        setImagePreview(resolvedUrls?.image_url ?? null);
        setVideoPreview(resolvedUrls?.video_url ?? null);
        setBannerToDelete(null);
        setDeleteConfirmation('');
    };

    // 편집 패널 초기화
    const resetEditorPanel = () => {
        resetForm();
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
        if (isNestedUploadInteractiveTarget(event.target)) return;
        fileInputRef.current?.click();
    };

    const handleUploadSurfaceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isNestedUploadInteractiveTarget(event.target)) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;

        event.preventDefault();
        fileInputRef.current?.click();
    };

    // 미디어 선택 처리 (이미지 또는 영상)
    const handleMediaSelect = async (file: File) => {
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

            if (editingBanner) {
                // 수정
                await updateBanner.mutateAsync({ id: editingBanner.id, data: validatedDataToSubmit });
            } else {
                // 생성
                await createBanner.mutateAsync(validatedDataToSubmit);
            }

            resetEditorPanel();
        } catch (error) {
            console.error('배너 저장 실패:');
        } finally {
            setIsUploading(false);
        }
    };

    // 삭제 실행
    const handleDelete = async () => {
        if (!bannerToDelete) return;

        try {
            await deleteBanner.mutateAsync(bannerToDelete.id);

            const mediaPaths = [
                bannerToDelete.image_url,
                bannerToDelete.video_url,
            ]
                .map(resolveAdBannerMediaStoragePath)
                .filter((path): path is string => path !== null);
            await Promise.all(mediaPaths.map(async (path) => {
                await deleteImage.mutateAsync(path);
            })).catch((mediaDeleteError) => {
                console.error('배너 DB 삭제 후 미디어 정리 실패:');
            });

            setBannerToDelete(null);
            setDeleteConfirmation('');
            resetForm();
        } catch (error) {
            console.error('배너 삭제 실패:');
        }
    };

    return (
        <div className={cn("text-foreground", embedded ? "flex h-full min-h-0 flex-col overflow-hidden bg-background font-sans tracking-normal" : "min-h-screen bg-[#fdfbf7] font-sans")} data-admin-embedded-module-shell={embedded ? "true" : undefined} data-admin-embedded-module-id={embedded ? "banners" : undefined}>
            {!embedded && (
                <div
                    className="fixed inset-0 opacity-30 pointer-events-none z-0"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")`,
                    }}
                />
            )}

            <div className={cn("relative z-10 flex min-h-0 flex-1 flex-col", embedded ? "h-full" : "container mx-auto min-h-screen max-w-7xl p-3 md:p-4")}>
                <div className={cn("flex flex-none flex-col gap-2 border-b border-border bg-card lg:flex-row lg:items-center lg:justify-between", embedded ? "shrink-0 px-2 py-1.5" : "rounded-t-2xl border px-3 py-2.5 shadow-sm")} data-admin-module-header={embedded ? "compact" : undefined} data-admin-module-header-module={embedded ? "banners" : undefined}>
                    <div className="flex min-w-0 items-start gap-2">
                        {!embedded && (
                            <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-9 w-9 rounded-xl hover:bg-muted" aria-label="이전 화면으로 돌아가기">
                                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                            </Button>
                        )}
                        <div className="flex min-w-0 gap-2">
                            <div className={cn("flex shrink-0 items-center justify-center text-primary", embedded ? "h-6 w-6" : "h-8 w-8 rounded-lg border border-primary/20 bg-primary/5")}>
                                <ImageIcon className={embedded ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <h1 className={embedded ? "whitespace-nowrap bg-gradient-primary bg-clip-text text-base font-bold text-transparent" : "truncate text-lg font-bold tracking-[-0.04em] text-foreground md:text-xl"}>배너 관리</h1>
                                <p className="mt-0.5 text-xs leading-4 text-muted-foreground" data-admin-module-summary={embedded ? "true" : undefined}>
                                    전체 {bannersLoading ? <InlineCountSkeleton /> : sortedBanners.length}개 · 활성 {bannersLoading ? <InlineCountSkeleton /> : activeBannerCount}개 · 비활성 {bannersLoading ? <InlineCountSkeleton /> : inactiveBannerCount}개
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex w-full min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center lg:w-auto" data-admin-module-actions={embedded ? "top-right" : undefined}>
                        <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
                            <Badge variant="secondary" className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted/50 text-muted-foreground"><Monitor className="mr-1 h-3.5 w-3.5" aria-hidden="true" />데스크톱 배너 {bannersLoading ? <InlineCountSkeleton className="ml-1 w-5" /> : sidebarTargetCount}</Badge>
                            <Badge variant="secondary" className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted/50 text-muted-foreground"><Smartphone className="mr-1 h-3.5 w-3.5" aria-hidden="true" />모바일 팝업 {bannersLoading ? <InlineCountSkeleton className="ml-1 w-5" /> : mobileTargetCount}</Badge>
                        </div>
                        <Button onClick={openCreatePanel} className="h-9 w-full rounded-xl bg-primary px-3 text-primary-foreground shadow-primary hover:bg-primary/90 sm:w-auto">
                            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />새 배너
                        </Button>
                    </div>
                </div>

                <div className={cn("grid min-h-0 flex-1 gap-2 overflow-y-auto overflow-x-hidden scrollbar-hide [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", embedded ? "p-2 xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)] xl:overflow-hidden" : "rounded-b-2xl bg-background/70 p-2 sm:p-3 md:border md:border-t-0 xl:grid-cols-[minmax(360px,0.95fr)_minmax(460px,1.05fr)] xl:overflow-hidden")} data-admin-module-content={embedded ? "bounded" : undefined}>
                    <section className="min-h-0 overflow-hidden rounded-xl bg-card/95 shadow-sm md:border md:border-border xl:flex xl:flex-col" aria-labelledby="banner-list-title">
                        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-2.5">
                            <div>
                                <h2 id="banner-list-title" className="text-sm font-bold text-foreground">배너 목록</h2>
                                <p className="text-xs text-muted-foreground">선택하면 오른쪽에서 바로 수정합니다.</p>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-hide p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="list" aria-label="배너 목록">
                            {bannersLoading ? (
                                <div className="space-y-2" role="status" aria-busy="true" aria-label="배너 목록 로딩 중">
                                    <span className="sr-only">배너 목록 데이터를 불러오는 중입니다.</span>
                                    {Array.from({ length: 5 }).map((_, index) => <BannerListItemSkeleton key={index} index={index} />)}
                                </div>
                            ) : sortedBanners.length === 0 ? (
                                <Card className="border-dashed border-border bg-background/70 p-4 text-center text-sm text-muted-foreground">
                                    등록된 배너가 없습니다. 오른쪽 패널에서 첫 배너를 추가하세요.
                                </Card>
                            ) : sortedBanners.map((banner) => {
                                const isSelected = editingBanner?.id === banner.id;
                                const resolvedUrls = resolveAdBannerPersistenceUrls(banner);
                                return (
                                    <button
                                        key={banner.id}
                                        type="button"
                                        aria-current={isSelected ? "true" : undefined}
                                        className={cn("w-full rounded-lg border bg-background/80 p-2 text-left shadow-sm transition hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", isSelected ? "border-primary/40 bg-primary/5" : "border-border/70")}
                                        onClick={() => openEditPanel(banner)}
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
                                                    <p className="min-w-0 truncate text-sm font-bold text-foreground">{banner.title}</p>
                                                    <Badge variant={banner.is_active ? "default" : "outline"} className="shrink-0 rounded-full text-[10px]">{banner.is_active ? '활성' : '비활성'}</Badge>
                                                </div>
                                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{banner.description || '설명 없음'} · 우선순위 {banner.priority}</p>
                                                <div className="mt-1 flex min-w-0 flex-nowrap gap-1 overflow-x-auto scrollbar-hide [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
                                                    {banner.display_target.includes('sidebar') && <Badge variant="secondary" className="shrink-0 rounded-full text-[10px]">데스크톱 배너</Badge>}
                                                    {banner.display_target.includes('mobile_popup') && <Badge variant="secondary" className="shrink-0 rounded-full text-[10px]">모바일 팝업</Badge>}
                                                    {resolvedUrls?.link_url && <span className="inline-flex shrink-0 items-center text-[10px] text-primary"><ExternalLink className="mr-0.5 h-3 w-3" aria-hidden="true" />링크</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className="min-h-0 overflow-hidden rounded-xl bg-card/95 shadow-sm md:border md:border-border xl:flex xl:flex-col" aria-labelledby="banner-editor-title">
                        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-2.5">
                            <div className="min-w-0">
                                <h2 id="banner-editor-title" className="text-sm font-bold text-foreground">{editingBanner ? '배너 상세·수정' : '새 배너 작성'}</h2>
                                <p className="text-xs text-muted-foreground">모달 없이 선택·편집·삭제를 이 패널에서 처리합니다.</p>
                            </div>
                            {editingBanner && <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-lg" onClick={openCreatePanel}>새로 작성</Button>}
                        </div>

                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-hide p-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <div className="grid gap-2 md:grid-cols-2">
                                <div className="space-y-1.5 md:col-span-2">
                                    <Label htmlFor="title">제목 *</Label>
                                    <Input id="title" value={formData.title} onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))} placeholder="배너 제목" />
                                </div>
                                <div className="space-y-1.5 md:col-span-2">
                                    <Label htmlFor="description">설명</Label>
                                    <Textarea id="description" value={formData.description || ''} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} placeholder="배너 설명" rows={3} />
                                </div>
                                <div className="space-y-1.5 md:col-span-2">
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
                                <div className="space-y-1.5 md:col-span-2">
                                    <Label htmlFor="link_url">클릭 시 이동 URL</Label>
                                    <Input id="link_url" type="url" value={formData.link_url || ''} onChange={(e) => setFormData(prev => ({ ...prev, link_url: e.target.value }))} placeholder="https://example.com" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="priority">우선순위</Label>
                                    <Input id="priority" type="number" min={0} max={1000} value={formData.priority} onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))} />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border border-border bg-background/70 p-2">
                                    <Label htmlFor="is_active">활성화</Label>
                                    <Switch id="is_active" checked={formData.is_active} onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))} />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                    <Label>표시 위치</Label>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <label className="flex items-center gap-2 rounded-lg border border-border bg-background/70 p-2 text-sm"><Checkbox id="target-sidebar" checked={formData.display_target?.includes('sidebar')} onCheckedChange={() => toggleDisplayTarget('sidebar')} /><Monitor className="h-4 w-4" aria-hidden="true" />데스크톱 배너</label>
                                        <label className="flex items-center gap-2 rounded-lg border border-border bg-background/70 p-2 text-sm"><Checkbox id="target-mobile" checked={formData.display_target?.includes('mobile_popup')} onCheckedChange={() => toggleDisplayTarget('mobile_popup')} /><Smartphone className="h-4 w-4" aria-hidden="true" />모바일 팝업</label>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap">
                                <Button className="w-full sm:w-auto" onClick={handleSubmit} disabled={isUploading || createBanner.isPending || updateBanner.isPending}>
                                    {(isUploading || createBanner.isPending || updateBanner.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                                    {editingBanner ? '수정 저장' : '배너 추가'}
                                </Button>
                                <Button className="w-full sm:w-auto" variant="outline" onClick={resetEditorPanel}>초기화</Button>
                                {formData.link_url && <Button className="w-full sm:w-auto" type="button" variant="ghost" onClick={() => handleOpenExternalLink(formData.link_url || '')}><ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />링크 확인</Button>}
                            </div>

                            {editingBanner && (
                                <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3">
                                    <h3 className="flex items-center gap-2 text-sm font-bold text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" />삭제 전 확인</h3>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">삭제는 모달 없이 이 패널에서 처리합니다. 삭제하려면 <strong>배너삭제</strong>를 입력하세요.</p>
                                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                        <Input value={deleteConfirmation} onChange={(event) => { setBannerToDelete(editingBanner); setDeleteConfirmation(event.target.value); }} placeholder="배너삭제" className="bg-background" aria-label="배너 삭제 확인 문구" />
                                        <Button type="button" variant="destructive" className="w-full sm:w-auto" disabled={deleteConfirmation !== '배너삭제' || deleteBanner.isPending} onClick={() => { setBannerToDelete(editingBanner); void handleDelete(); }}>
                                            {deleteBanner.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />}
                                            삭제
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
