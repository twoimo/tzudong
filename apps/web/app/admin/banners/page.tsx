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
    useToggleAdBanner,
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { GlobalLoader } from '@/components/ui/global-loader';
import {
    Plus,
    Pencil,
    Trash2,
    Image as ImageIcon,
    Upload,
    X,
    ArrowLeft,
    Monitor,
    Smartphone,
    ExternalLink,
    Loader2,
    Scroll,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '@/lib/open-external-url';
import { toast } from '@/hooks/use-toast';

// 이미지 압축 옵션
const IMAGE_COMPRESSION_OPTIONS = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1600,
    fileType: 'image/webp' as const,
    useWebWorker: true,
};

const revokeObjectUrlIfNeeded = (url: string | null) => {
    if (url?.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
};

// Suspense 래퍼
export default function BannerManagementPageWrapper() {
    return (
        <Suspense fallback={<GlobalLoader />}>
            <BannerManagementPage />
        </Suspense>
    );
}

function BannerManagementPage() {
    const router = useRouter();
    const { user, isAdmin, isLoading: authLoading } = useAuth();

    // 배너 데이터
    const { data: banners = [], isLoading: bannersLoading } = useAdBannersAdmin();
    const createBanner = useCreateAdBanner();
    const updateBanner = useUpdateAdBanner();
    const deleteBanner = useDeleteAdBanner();
    const toggleBanner = useToggleAdBanner();
    const uploadImage = useUploadBannerImage();
    const deleteImage = useDeleteBannerImage();

    // 폼 상태
    const [isDialogOpen, setIsDialogOpen] = useState(false);
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
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [bannerToDelete, setBannerToDelete] = useState<AdBanner | null>(null);

    // 권한 체크
    useEffect(() => {
        if (!authLoading && (!user || !isAdmin)) {
            router.push('/');
        }
    }, [authLoading, user, isAdmin, router]);

    // 정렬된 배너 목록 (조건부 return 전에 useMemo 호출)
    const sortedBanners = useMemo(() => {
        return [...banners].sort((a, b) => b.priority - a.priority);
    }, [banners]);

    if (authLoading || !user || !isAdmin) {
        return <GlobalLoader />;
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

    // 다이얼로그 열기 (생성)
    const openCreateDialog = () => {
        resetForm();
        setIsDialogOpen(true);
    };

    // 다이얼로그 열기 (수정)
    const openEditDialog = (banner: AdBanner) => {
        setEditingBanner(banner);
        setFormData({
            title: banner.title,
            description: banner.description || '',
            image_url: banner.image_url,
            video_url: banner.video_url,
            media_type: banner.media_type,
            link_url: banner.link_url || '',
            is_active: banner.is_active,
            priority: banner.priority,
            display_target: banner.display_target as DisplayTarget[],
        });
        if (banner.image_url) {
            setImagePreview(banner.image_url);
        }
        if (banner.video_url) {
            setVideoPreview(banner.video_url);
        }
        setIsDialogOpen(true);
    };

    // 다이얼로그 닫기
    const closeDialog = () => {
        setIsDialogOpen(false);
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
            console.error('이미지 압축 실패:', error);
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
            console.error('영상 처리 실패:', error);
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
                link_url: formData.link_url?.trim() || null,
            };

            if (editingBanner) {
                // 수정
                await updateBanner.mutateAsync({ id: editingBanner.id, data: dataToSubmit });
            } else {
                // 생성
                await createBanner.mutateAsync(dataToSubmit);
            }

            closeDialog();
        } catch (error) {
            console.error('배너 저장 실패:', error);
        } finally {
            setIsUploading(false);
        }
    };

    // 삭제 확인
    const confirmDelete = (banner: AdBanner) => {
        setBannerToDelete(banner);
        setDeleteConfirmOpen(true);
    };

    // 삭제 실행
    const handleDelete = async () => {
        if (!bannerToDelete) return;

        try {
            // 이미지가 있으면 같이 삭제
            if (bannerToDelete.image_url) {
                // URL에서 path 추출
                const urlParts = bannerToDelete.image_url.split('/');
                const path = urlParts.slice(-2).join('/');
                await deleteImage.mutateAsync(path);
            }

            await deleteBanner.mutateAsync(bannerToDelete.id);
            setDeleteConfirmOpen(false);
            setBannerToDelete(null);
        } catch (error) {
            console.error('배너 삭제 실패:', error);
        }
    };

    // 토글 핸들러
    const handleToggle = async (banner: AdBanner) => {
        await toggleBanner.mutateAsync({ id: banner.id, is_active: !banner.is_active });
    };

    return (
        <div className="min-h-screen bg-[#fdfbf7] font-serif">
            {/* 한지 질감 오버레이 */}
            <div
                className="fixed inset-0 opacity-30 pointer-events-none z-0"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")`,
                }}
            />

            <div className="relative z-10 container mx-auto p-4 md:p-6 max-w-6xl">
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-6 md:mb-8">
                    <div className="flex items-center gap-3 md:gap-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.back()}
                            className="hover:bg-stone-200/50 h-8 w-8 md:h-10 md:w-10"
                        >
                            <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
                        </Button>
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold text-stone-900">배너 관리</h1>
                            <p className="text-sm text-stone-500 hidden md:block">사이드바 및 모바일 팝업 광고 배너를 관리합니다</p>
                        </div>
                    </div>
                    <Button onClick={openCreateDialog} size="icon" className="md:px-4 md:py-2 md:w-auto bg-stone-800 hover:bg-stone-700">
                        <Plus className="h-4 w-4 md:mr-2" />
                        <span className="hidden md:inline">새 배너 추가</span>
                    </Button>
                </div>

                {/* 배너 목록 */}
                {bannersLoading ? (
                    <Card className="border-stone-200 p-8 text-center text-stone-500">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                        배너 목록을 불러오는 중...
                    </Card>
                ) : sortedBanners.length === 0 ? (
                    <Card className="border-stone-200 p-8 text-center text-stone-500">
                        <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-30" />
                        <p>등록된 배너가 없습니다</p>
                        <Button onClick={openCreateDialog} variant="link" className="mt-2">
                            첫 번째 배너 추가하기
                        </Button>
                    </Card>
                ) : (
                    <>
                        {/* 모바일 카드 리스트 (md 미만에서 표시) */}
                        <div className="md:hidden space-y-3">
                            {sortedBanners.map((banner) => (
                                <Card key={banner.id} className="border-stone-200 p-4">
                                    <div className="flex gap-3">
                                        {/* 썸네일 */}
                                        {banner.image_url ? (
                                            <div className="relative w-20 h-16 rounded overflow-hidden border border-stone-200 flex-shrink-0">
                                                <Image
                                                    src={banner.image_url}
                                                    alt={banner.title}
                                                    fill
                                                    unoptimized
                                                    sizes="80px"
                                                    className="object-cover"
                                                />
                                            </div>
                                        ) : (
                                            <div className="w-20 h-16 rounded bg-stone-100 flex items-center justify-center border border-stone-200 flex-shrink-0">
                                                <Scroll className="h-6 w-6 text-stone-400" />
                                            </div>
                                        )}

                                        {/* 정보 */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="font-medium text-stone-900 truncate">{banner.title}</p>
                                                    {banner.description && (
                                                        <p className="text-xs text-stone-500 truncate mt-0.5">
                                                            {banner.description}
                                                        </p>
                                                    )}
                                                </div>
                                                <Switch
                                                    checked={banner.is_active}
                                                    onCheckedChange={() => handleToggle(banner)}
                                                    className="flex-shrink-0"
                                                />
                                            </div>

                                            {/* 배지 및 액션 */}
                                            <div className="flex items-center justify-between mt-2">
                                                <div className="flex flex-wrap gap-1">
                                                    {banner.display_target.includes('sidebar') && (
                                                        <Badge variant="secondary" className="text-xs">
                                                            <Monitor className="h-3 w-3 mr-1" />
                                                            사이드바
                                                        </Badge>
                                                    )}
                                                    {banner.display_target.includes('mobile_popup') && (
                                                        <Badge variant="secondary" className="text-xs">
                                                            <Smartphone className="h-3 w-3 mr-1" />
                                                            모바일
                                                        </Badge>
                                                    )}
                                                    <Badge variant="outline" className="text-xs">
                                                        우선순위 {banner.priority}
                                                    </Badge>
                                                </div>

                                                <div className="flex gap-1">
                                                    {banner.link_url && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleOpenExternalLink(banner.link_url!)}
                                                            className="h-7 w-7"
                                                        >
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => openEditDialog(banner)}
                                                        className="h-7 w-7"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => confirmDelete(banner)}
                                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>

                        {/* 데스크톱 테이블 (md 이상에서 표시) */}
                        <Card className="border-stone-200 overflow-hidden hidden md:block">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-stone-50">
                                        <TableHead className="w-20">썸네일</TableHead>
                                        <TableHead>제목</TableHead>
                                        <TableHead className="w-32">표시 위치</TableHead>
                                        <TableHead className="w-24 text-center">우선순위</TableHead>
                                        <TableHead className="w-24 text-center">상태</TableHead>
                                        <TableHead className="w-32 text-right">액션</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedBanners.map((banner) => (
                                        <TableRow key={banner.id} className="hover:bg-stone-50">
                                            <TableCell>
                                                {banner.image_url ? (
                                                    <div className="relative w-16 h-12 rounded overflow-hidden border border-stone-200">
                                                        <Image
                                                            src={banner.image_url}
                                                            alt={banner.title}
                                                            fill
                                                            unoptimized
                                                            sizes="64px"
                                                            className="object-cover"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="w-16 h-12 rounded bg-stone-100 flex items-center justify-center border border-stone-200">
                                                        <Scroll className="h-5 w-5 text-stone-400" />
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div>
                                                    <p className="font-medium text-stone-900">{banner.title}</p>
                                                    {banner.description && (
                                                        <p className="text-xs text-stone-500 truncate max-w-xs">
                                                            {banner.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-1">
                                                    {banner.display_target.includes('sidebar') && (
                                                        <Badge variant="secondary" className="text-xs w-fit">
                                                            <Monitor className="h-3 w-3 mr-1" />
                                                            사이드바
                                                        </Badge>
                                                    )}
                                                    {banner.display_target.includes('mobile_popup') && (
                                                        <Badge variant="secondary" className="text-xs w-fit">
                                                            <Smartphone className="h-3 w-3 mr-1" />
                                                            모바일
                                                        </Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant="outline">{banner.priority}</Badge>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Switch
                                                    checked={banner.is_active}
                                                    onCheckedChange={() => handleToggle(banner)}
                                                />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    {banner.link_url && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleOpenExternalLink(banner.link_url!)}
                                                            className="h-8 w-8"
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => openEditDialog(banner)}
                                                        className="h-8 w-8"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => confirmDelete(banner)}
                                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Card>
                    </>
                )}

                {/* 생성/수정 다이얼로그 */}
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>{editingBanner ? '배너 수정' : '새 배너 추가'}</DialogTitle>
                            <DialogDescription>
                                광고 배너 정보를 입력해주세요. 이미지는 자동으로 최적화됩니다.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-6 py-4">
                            {/* 제목 */}
                            <div className="space-y-2">
                                <Label htmlFor="title">제목 *</Label>
                                <Input
                                    id="title"
                                    value={formData.title}
                                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                                    placeholder="배너 제목"
                                />
                            </div>

                            {/* 설명 */}
                            <div className="space-y-2">
                                <Label htmlFor="description">설명</Label>
                                <Textarea
                                    id="description"
                                    value={formData.description || ''}
                                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="배너 설명 (여러 줄 가능)"
                                    rows={3}
                                />
                            </div>

                            {/* 이미지 업로드 */}
                            <div className="space-y-2">
                                <Label>배너 이미지</Label>
                                <Card
                                    className={cn(
                                        "p-6 border-dashed transition-colors cursor-pointer",
                                        isDragging ? "border-primary bg-primary/5" : "border-stone-300 hover:border-primary/50",
                                        (imagePreview || videoPreview) && "border-solid border-green-300 bg-green-50/50"
                                    )}
                                    onDragOver={handleDragOver}
                                    onDragEnter={handleDragEnter}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    {isUploading ? (
                                        <div className="flex flex-col items-center gap-2 py-4">
                                            <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
                                            <p className="text-sm text-stone-500">
                                                {compressionProgress > 0
                                                    ? `압축 중... ${compressionProgress}%`
                                                    : '미디어 처리 중...'}
                                            </p>
                                        </div>
                                    ) : videoPreview ? (
                                        <div className="space-y-3">
                                            <div className="relative aspect-video w-full max-w-md mx-auto rounded overflow-hidden border">
                                                <video
                                                    src={videoPreview}
                                                    controls
                                                    className="w-full h-full object-cover"
                                                />
                                                <Button
                                                    variant="destructive"
                                                    size="icon"
                                                    className="absolute top-2 right-2 h-8 w-8"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleMediaRemove();
                                                    }}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            <p className="text-center text-sm text-stone-500">
                                                클릭하거나 드래그하여 영상 변경
                                            </p>
                                        </div>
                                    ) : imagePreview ? (
                                        <div className="space-y-3">
                                            <div className="relative aspect-video w-full max-w-md mx-auto rounded overflow-hidden border">
                                                <Image
                                                    src={imagePreview}
                                                    alt="미리보기"
                                                    fill
                                                    unoptimized
                                                    sizes="(max-width: 768px) 100vw, 768px"
                                                    className="object-cover"
                                                />
                                                <Button
                                                    variant="destructive"
                                                    size="icon"
                                                    className="absolute top-2 right-2 h-8 w-8"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleMediaRemove();
                                                    }}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            <p className="text-center text-sm text-stone-500">
                                                클릭하거나 드래그하여 미디어 변경
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-3 py-4">
                                            <div className={cn(
                                                "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
                                                isDragging ? "bg-primary/10" : "bg-stone-100"
                                            )}>
                                                <Upload className={cn(
                                                    "h-8 w-8 transition-colors",
                                                    isDragging ? "text-primary" : "text-stone-400"
                                                )} />
                                            </div>
                                            <div className="text-center">
                                                <p className="font-medium">
                                                    {isDragging ? '여기에 파일을 놓으세요' : '이미지 또는 영상을 업로드해주세요'}
                                                </p>
                                                <p className="text-sm text-stone-500">
                                                    드래그하거나 클릭해서 선택 (영상은 WebM으로 자동 변환, 최대 10MB)
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*,video/*"
                                        onChange={handleFileInputChange}
                                        className="hidden"
                                    />
                                </Card>
                            </div>

                            {/* 링크 URL */}
                            <div className="space-y-2">
                                <Label htmlFor="link_url">클릭 시 이동 URL (선택)</Label>
                                <Input
                                    id="link_url"
                                    type="url"
                                    value={formData.link_url || ''}
                                    onChange={(e) => setFormData(prev => ({ ...prev, link_url: e.target.value }))}
                                    placeholder="https://example.com"
                                />
                            </div>

                            {/* 우선순위 */}
                            <div className="space-y-2">
                                <Label htmlFor="priority">우선순위 (높을수록 먼저 표시)</Label>
                                <Input
                                    id="priority"
                                    type="number"
                                    min={0}
                                    max={1000}
                                    value={formData.priority}
                                    onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                                />
                            </div>

                            {/* 표시 위치 */}
                            <div className="space-y-3">
                                <Label>표시 위치</Label>
                                <div className="flex gap-4">
                                    <div className="flex items-center space-x-2">
                                        <Checkbox
                                            id="target-sidebar"
                                            checked={formData.display_target?.includes('sidebar')}
                                            onCheckedChange={() => toggleDisplayTarget('sidebar')}
                                        />
                                        <Label htmlFor="target-sidebar" className="flex items-center gap-1 cursor-pointer">
                                            <Monitor className="h-4 w-4" />
                                            사이드바 (데스크톱)
                                        </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Checkbox
                                            id="target-mobile"
                                            checked={formData.display_target?.includes('mobile_popup')}
                                            onCheckedChange={() => toggleDisplayTarget('mobile_popup')}
                                        />
                                        <Label htmlFor="target-mobile" className="flex items-center gap-1 cursor-pointer">
                                            <Smartphone className="h-4 w-4" />
                                            팝업 (모바일/태블릿)
                                        </Label>
                                    </div>
                                </div>
                            </div>

                            {/* 활성화 */}
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="is_active"
                                    checked={formData.is_active}
                                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                                />
                                <Label htmlFor="is_active">활성화</Label>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={closeDialog}>
                                취소
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={isUploading || createBanner.isPending || updateBanner.isPending}
                            >
                                {(isUploading || createBanner.isPending || updateBanner.isPending) && (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                )}
                                {editingBanner ? '수정' : '추가'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* 삭제 확인 다이얼로그 */}
                <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>배너 삭제</AlertDialogTitle>
                            <AlertDialogDescription>
                                &quot;{bannerToDelete?.title}&quot; 배너를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>취소</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleDelete}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                                삭제
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
}
