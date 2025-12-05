import { useState, useEffect } from 'react';
import { EvaluationRecord } from '@/types/evaluation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
    XCircle,
    AlertCircle,
    ExternalLink,
    MapPin,
    RotateCcw,
    Undo2,
    Trash2,
    PlayCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface EvaluationSlideViewProps {
    records: EvaluationRecord[];
    currentIndex: number;
    onNavigate: (index: number) => void;
    onApprove: (record: EvaluationRecord) => void;
    onDelete: (record: EvaluationRecord) => void;
    onRestore?: (record: EvaluationRecord) => void;
    onRegisterMissing?: (record: EvaluationRecord) => void;
    onResolveConflict?: (record: EvaluationRecord) => void;
    onEdit?: (record: EvaluationRecord) => void;
    loading?: boolean;
}

export function EvaluationSlideView({
    records,
    currentIndex,
    onNavigate,
    onApprove,
    onDelete,
    onRestore,
    onRegisterMissing,
    onResolveConflict,
    onEdit,
    loading
}: EvaluationSlideViewProps) {
    const currentRecord = records[currentIndex];
    const { toast } = useToast();
    const [videoError, setVideoError] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [playerType, setPlayerType] = useState<'youtube' | 'invidious' | 'piped' | 'popup'>('youtube');

    // 리코드 변경 시 플레이어 타입 초기화
    useEffect(() => {
        setPlayerType('youtube');
    }, [currentRecord?.id]);

    // YouTube ID 추출
    const getYoutubeVideoId = (url: string | undefined) => {
        if (!url) return null;
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&].*)?/,
            /(?:youtube\.com\/(?:embed|v)\/)([a-zA-Z0-9_-]{11})/,
            /(?:m\.youtube\.com\/watch\?v=|youtube\.com\/.*[?&]v=)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1] && match[1].length === 11) {
                return match[1];
            }
        }
        return null;
    };

    const videoId = getYoutubeVideoId(currentRecord?.youtube_link);

    // 비디오 URL 생성 로직
    useEffect(() => {
        if (currentRecord?.youtube_link) {
            const vidId = getYoutubeVideoId(currentRecord.youtube_link);
            if (vidId) {
                let url = '';
                if (playerType === 'youtube') {
                    const origin = typeof window !== 'undefined' ? window.location.origin : '';
                    // autoplay=1, mute=1 (자동재생, 음소거)
                    url = `https://www.youtube.com/embed/${vidId}?autoplay=1&mute=1&playsinline=1&rel=0&enablejsapi=1&origin=${origin}&controls=1`;
                } else if (playerType === 'invidious') {
                    url = `https://yewtu.be/embed/${vidId}?autoplay=1&mute=1&muted=1`;
                } else if (playerType === 'piped') {
                    url = `https://piped.video/embed/${vidId}?autoplay=1&mute=1&muted=1`;
                } else if (playerType === 'popup') {
                    setVideoUrl(null); // 팝업 모드는 iframe URL 없음 (UI 렌더링용)
                    setVideoError(false);
                    return;
                }
                setVideoUrl(url);
                setVideoError(false);
            } else {
                setVideoUrl(null);
            }
        }
    }, [currentRecord?.youtube_link, currentRecord?.id, playerType]);

    // 에러 핸들링
    const handleVideoError = () => {
        if (playerType === 'youtube') {
            setPlayerType('popup'); // 바로 팝업 모드로 전환 (가장 확실한 방법)
            return;
        }
        setVideoError(true);
    };

    // 키보드 네비게이션
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
            if (e.key === 'ArrowLeft') {
                if (currentIndex > 0) onNavigate(currentIndex - 1);
            } else if (e.key === 'ArrowRight') {
                if (currentIndex < records.length - 1) onNavigate(currentIndex + 1);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentIndex, records.length, onNavigate]);

    if (!currentRecord) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                <AlertCircle className="w-12 h-12 mb-4" />
                <p className="text-lg">표시할 데이터가 없습니다.</p>
            </div>
        );
    }

    const getStatusBadge = (status: string) => {
        const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
            pending: { label: '미처리', variant: 'secondary' },
            approved: { label: '승인됨', variant: 'default' },
            hold: { label: '보류', variant: 'outline' },
            missing: { label: 'Missing', variant: 'destructive' },
            geocoding_failed: { label: '지오코딩 실패', variant: 'destructive' },
            not_selected: { label: '평가 미대상', variant: 'outline' },
            deleted: { label: '삭제됨', variant: 'destructive' },
        };
        const config = variants[status] || { label: status, variant: 'default' };
        return <Badge variant={config.variant} className="text-xs px-2 py-0.5">{config.label}</Badge>;
    };

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            {/* Top Navigation Bar - Compact */}
            <div className="flex items-center justify-between px-3 py-2 border-b shrink-0 h-14">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex items-center space-x-1 shrink-0">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onNavigate(currentIndex - 1)} disabled={currentIndex <= 0}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs font-medium w-[60px] text-center">
                            {currentIndex + 1} / {records.length}
                        </span>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onNavigate(currentIndex + 1)} disabled={currentIndex >= records.length - 1}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                    {getStatusBadge(currentRecord.status)}
                    <h2 className="text-sm font-semibold truncate max-w-[400px]">
                        {currentRecord.restaurant_name || currentRecord.name}
                    </h2>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {currentRecord.status === 'deleted' ? (
                        <Button onClick={() => onRestore?.(currentRecord)} disabled={loading} variant="outline" size="sm" className="h-8 bg-blue-50 text-blue-600 border-blue-200">
                            <Undo2 className="w-3.5 h-3.5 mr-1.5" /> 복원
                        </Button>
                    ) : (
                        <>
                            <Button onClick={() => onEdit?.(currentRecord)} variant="outline" disabled={loading} size="sm" className="h-8">수정</Button>
                            <Button onClick={() => onDelete(currentRecord)} variant="destructive" disabled={loading} size="sm" className="h-8">
                                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> 삭제
                            </Button>
                            {currentRecord.status !== 'approved' && (
                                <Button
                                    onClick={() => {
                                        onApprove(currentRecord);
                                        if (currentIndex < records.length - 1) setTimeout(() => onNavigate(currentIndex + 1), 300);
                                    }}
                                    disabled={loading || !currentRecord.geocoding_success}
                                    className="bg-green-600 hover:bg-green-700 h-8"
                                    size="sm"
                                >
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> 승인
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Main Content Area - Split View */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: Video Player */}
                <div className="w-[50%] bg-gray-100 flex flex-col justify-start items-center relative overflow-hidden group">
                    {/* Background Thumbnail for Popup Mode */}
                    {playerType === 'popup' && videoId && (
                        <div
                            className="absolute inset-0 bg-cover bg-center opacity-50 blur-sm scale-110"
                            style={{ backgroundImage: `url(https://img.youtube.com/vi/${videoId}/hqdefault.jpg)` }}
                        />
                    )}

                    {videoUrl && !videoError && playerType !== 'popup' ? (
                        <div className="w-full aspect-video z-10 shadow-lg">
                            <iframe
                                width="100%"
                                height="100%"
                                src={videoUrl}
                                title="Video player"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; compute-pressure"
                                allowFullScreen
                                className="w-full h-full block"
                                onError={handleVideoError}
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-white p-6 text-center z-10 w-full h-full bg-black/40 backdrop-blur-sm">
                            {playerType === 'popup' && videoId ? (
                                <div className="flex flex-col items-center">
                                    <img
                                        src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                                        alt="Thumbnail"
                                        className="w-full max-w-[320px] h-auto rounded shadow-lg mb-6 border border-white/20"
                                    />
                                    <Button
                                        variant="default"
                                        asChild
                                        size="lg"
                                        className="gap-2 bg-red-600 hover:bg-red-700 text-white font-bold text-base px-8 py-6 h-auto shadow-xl hover:scale-105 transition-transform"
                                    >
                                        <a href={currentRecord.youtube_link} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="w-6 h-6" /> 새 창에서 재생하기
                                        </a>
                                    </Button>
                                    <div className="mt-6 space-y-1 text-center">
                                        <p className="text-sm text-gray-200 font-medium">
                                            임베드 제한된 영상입니다.
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            위 버튼을 눌러 유튜브 새 창에서 확인하세요.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {videoError ? (
                                        <>
                                            <AlertCircle className="w-10 h-10 mb-2 text-red-500" />
                                            <p className="mb-2 text-sm">{playerType === 'youtube' ? '재생 불가' : '재생 실패'}</p>
                                            <p className="text-xs text-gray-400 mb-4">플레이어 소스를 변경해보세요.</p>
                                        </>
                                    ) : videoId ? (
                                        <p className="text-sm">로딩 중...</p>
                                    ) : (
                                        <p className="text-gray-400 text-sm">링크 없음</p>
                                    )}
                                </>
                            )}

                            {currentRecord.youtube_link && !videoId && (
                                <div className="flex flex-col items-center gap-2 mt-6">
                                    <Button variant="secondary" size="sm" className="h-7 text-xs bg-white/10 hover:bg-white/20 text-white border-0" onClick={() => window.open(currentRecord.youtube_link, '_blank')}>
                                        <ExternalLink className="w-3 h-3 mr-1" /> YouTube에서 보기 (새 탭)
                                    </Button>
                                </div>
                            )}

                            {currentRecord.youtube_link && (
                                <div className="absolute bottom-4 right-4">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm" className="h-7 text-xs border-gray-600 text-gray-300 hover:text-white hover:bg-gray-800 bg-black/50 backdrop-blur-md">
                                                <PlayCircle className="w-3 h-3 mr-1" />
                                                {playerType === 'youtube' ? 'YouTube' : playerType === 'invidious' ? 'Invidious' : playerType === 'piped' ? 'Piped' : 'Popup 모드'}
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => setPlayerType('youtube')}>
                                                YouTube (기본)
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setPlayerType('invidious')}>
                                                Invidious (우회)
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setPlayerType('piped')}>
                                                Piped (우회)
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setPlayerType('popup')}>
                                                Popup (팝업/새창)
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Right: Info & Evaluation - Expanded Layout based on Reference Image */}
                <ScrollArea className="w-[50%] h-full border-l bg-accent/5">
                    <div className="p-4 space-y-4 text-sm">

                        {/* 0. Video Info */}
                        <div className="bg-white rounded-lg border p-3 shadow-sm">
                            <h3 className="flex items-center gap-2 font-semibold text-base mb-2 text-gray-800">
                                📹 영상 정보
                            </h3>
                            <div className="grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 text-sm">
                                <span className="text-gray-500 font-medium">제목:</span>
                                <span className="break-words font-medium text-gray-900 line-clamp-2" title={currentRecord.youtube_meta?.title}>{currentRecord.youtube_meta?.title || '-'}</span>

                                <span className="text-gray-500 font-medium">게시일:</span>
                                <span className="text-gray-700">{currentRecord.youtube_meta?.publishedAt ? new Date(currentRecord.youtube_meta.publishedAt).toLocaleDateString() : '-'}</span>

                                <span className="text-gray-500 font-medium">광고:</span>
                                <span className="text-gray-700">
                                    {currentRecord.youtube_meta?.ads_info?.is_ads
                                        ? `있음 (${currentRecord.youtube_meta.ads_info.what_ads})`
                                        : '없음'}
                                </span>

                                <span className="text-gray-500 font-medium">링크:</span>
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <a
                                        href={currentRecord.youtube_link}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-600 hover:underline truncate"
                                    >
                                        {currentRecord.youtube_link}
                                    </a>
                                </div>
                            </div>
                        </div>

                        {/* 1. Evaluation Details */}
                        <div className="bg-white rounded-lg border p-3 shadow-sm">
                            <h3 className="flex items-center gap-2 font-semibold text-base mb-3 text-gray-800">
                                📊 평가 상세
                            </h3>
                            <div className="space-y-4">
                                {/* 1. Visit Authenticity */}
                                <div className="pl-3 border-l-4 border-blue-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-blue-50 text-blue-700 border-blue-200 text-[10px]">1</Badge>
                                        <span className="font-semibold text-gray-900 text-sm">방문 여부 정확성:</span>
                                        <span className={cn("font-bold text-sm", currentRecord.evaluation_results?.visit_authenticity?.eval_value === 1 ? "text-blue-600" : "text-gray-900")}>
                                            {currentRecord.evaluation_results?.visit_authenticity?.eval_value ?? 0}
                                        </span>
                                    </div>
                                    <p className="text-gray-600 leading-relaxed text-xs">
                                        {currentRecord.evaluation_results?.visit_authenticity?.eval_basis || '근거 내용 없음'}
                                    </p>
                                </div>

                                {/* 2. Reasoning Basis Inference */}
                                <div className="pl-3 border-l-4 border-purple-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-purple-50 text-purple-700 border-purple-200 text-[10px]">2</Badge>
                                        <span className="font-semibold text-gray-900 text-sm">추론 합리성:</span>
                                        <span className={cn("font-bold text-sm", currentRecord.evaluation_results?.rb_inference_score?.eval_value === 1 ? "text-purple-600" : "text-gray-900")}>
                                            {currentRecord.evaluation_results?.rb_inference_score?.eval_value ?? 0}
                                        </span>
                                    </div>
                                    <p className="text-gray-600 leading-relaxed text-xs">
                                        {currentRecord.evaluation_results?.rb_inference_score?.eval_basis || '근거 내용 없음'}
                                    </p>
                                </div>

                                {/* 3. Reasoning Basis Grounding */}
                                <div className="pl-3 border-l-4 border-green-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-green-50 text-green-700 border-green-200 text-[10px]">3</Badge>
                                        <span className="font-semibold text-gray-900 text-sm">실제 근거 일치도:</span>
                                        <Badge className={cn("text-[10px] h-5 px-1.5", currentRecord.evaluation_results?.rb_grounding_TF?.eval_value ? "bg-green-600" : "bg-red-500")}>
                                            {currentRecord.evaluation_results?.rb_grounding_TF?.eval_value ? "True" : "False"}
                                        </Badge>
                                    </div>
                                    <p className="text-gray-600 leading-relaxed text-xs">
                                        {currentRecord.evaluation_results?.rb_grounding_TF?.eval_basis || '근거 내용 없음'}
                                    </p>
                                </div>

                                {/* 4. Review Faithfulness */}
                                <div className="pl-3 border-l-4 border-indigo-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px]">4</Badge>
                                        <span className="font-semibold text-gray-900 text-sm">리뷰 충실도:</span>
                                        <span className={cn("font-bold text-sm", currentRecord.evaluation_results?.review_faithfulness_score?.eval_value === 1 ? "text-indigo-600" : "text-gray-900")}>
                                            {currentRecord.evaluation_results?.review_faithfulness_score?.eval_value ?? 0}
                                        </span>
                                    </div>
                                    <p className="text-gray-600 leading-relaxed text-xs">
                                        {currentRecord.evaluation_results?.review_faithfulness_score?.eval_basis || '근거 내용 없음'}
                                    </p>
                                </div>

                                {/* 5. Geocoding */}
                                <div className="pl-3 border-l-4 border-orange-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-orange-50 text-orange-700 border-orange-200 text-[10px]">5</Badge>
                                        <span className="font-semibold text-gray-900 text-sm">주소 정합성:</span>
                                        <Badge className={cn("text-[10px] h-5 px-1.5", currentRecord.geocoding_success ? "bg-green-600" : "bg-red-500")}>
                                            {currentRecord.geocoding_success ? "성공" : "실패"}
                                        </Badge>
                                    </div>
                                    <div className="text-gray-600 text-xs space-y-0.5 mt-0.5">
                                        <p><span className="text-gray-500">지번:</span> {currentRecord.jibun_address || '-'}</p>
                                        <p><span className="text-gray-500">도로명:</span> {currentRecord.road_address || '-'}</p>
                                    </div>
                                </div>

                                {/* 6. Category Validity */}
                                <div className="pl-3 border-l-4 border-teal-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-teal-50 text-teal-700 border-teal-200 text-[10px]">6</Badge>
                                        <span className="font-semibold text-gray-900 text-sm">카테고리 유효성:</span>
                                        <Badge className={cn("text-[10px] h-5 px-1.5", currentRecord.evaluation_results?.category_validity_TF?.eval_value ? "bg-green-600" : "bg-red-500")}>
                                            {currentRecord.evaluation_results?.category_validity_TF?.eval_value ? "True" : "False"}
                                        </Badge>
                                    </div>
                                </div>

                                {/* 7. Category Match */}
                                <div className="pl-3 border-l-4 border-yellow-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-yellow-50 text-yellow-700 border-yellow-200 text-[10px]">7</Badge>
                                        <span className="font-semibold text-gray-900 text-sm">카테고리 정합성:</span>
                                        <Badge className={cn("text-[10px] h-5 px-1.5", currentRecord.evaluation_results?.category_TF?.eval_value ? "bg-green-600" : "bg-red-500")}>
                                            {currentRecord.evaluation_results?.category_TF?.eval_value ? "True" : "False"}
                                        </Badge>
                                        {currentRecord.evaluation_results?.category_TF?.category_revision && (
                                            <span className="ml-2 text-xs text-yellow-700 font-medium">
                                                (수정: {currentRecord.evaluation_results.category_TF.category_revision})
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 2. Restaurant Info */}
                        <div className="bg-white rounded-lg border p-3 shadow-sm">
                            <h3 className="flex items-center gap-2 font-semibold text-base mb-3 text-gray-800">
                                🍽️ 음식점 상세 정보
                            </h3>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                {/* Row 1 */}
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-gray-500 text-xs font-medium">음식점명</span>
                                    <span className="font-semibold text-gray-900 text-sm break-keep">{currentRecord.restaurant_name || currentRecord.name || '-'}</span>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-gray-500 text-xs font-medium">카테고리</span>
                                    <span className="text-gray-900 text-sm">{currentRecord.restaurant_info?.category || '-'}</span>
                                </div>

                                {/* Row 2 */}
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-gray-500 text-xs font-medium">전화번호</span>
                                    <span className="text-gray-900 text-sm">{currentRecord.phone || '-'}</span>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-gray-500 text-xs font-medium flex items-center gap-1">
                                        좌표 (lat, lng)
                                    </span>
                                    <span className="font-mono text-xs text-gray-600">
                                        {currentRecord.lat ?? '-'}, {currentRecord.lng ?? '-'}
                                    </span>
                                </div>

                                {/* Row 3 - Full Width Address */}
                                <div className="col-span-2 flex flex-col gap-0.5">
                                    <span className="text-gray-500 text-xs font-medium">원본 주소</span>
                                    <span className="text-gray-900 text-sm">{currentRecord.restaurant_info?.origin_address || '-'}</span>
                                </div>

                                {/* Row 4 - Naver Addresses */}
                                <div className="col-span-2 grid grid-cols-1 gap-1">
                                    <div className="flex items-start gap-1.5">
                                        <Badge variant="outline" className="shrink-0 text-[10px] px-1 bg-green-50 text-green-700 border-green-200 h-5">Naver 도로명</Badge>
                                        <span className="text-sm text-gray-700 break-all">{currentRecord.restaurant_info?.naver_address_info?.road_address || '-'}</span>
                                    </div>
                                    <div className="flex items-start gap-1.5">
                                        <Badge variant="outline" className="shrink-0 text-[10px] px-1 bg-green-50 text-green-700 border-green-200 h-5">Naver 지번</Badge>
                                        <span className="text-sm text-gray-700 break-all">{currentRecord.restaurant_info?.naver_address_info?.jibun_address || '-'}</span>
                                    </div>
                                </div>
                            </div>

                            <Separator className="my-3" />

                            <div className="space-y-3">
                                <div>
                                    <h4 className="font-bold text-xs text-gray-500 mb-1.5 uppercase">Reasoning Basis</h4>
                                    <div className="bg-gray-50 rounded-md p-2.5 border border-gray-100">
                                        <p className="text-gray-700 text-xs leading-relaxed whitespace-pre-wrap break-keep">
                                            {currentRecord.reasoning_basis || '-'}
                                        </p>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="font-bold text-xs text-gray-500 mb-1.5 uppercase">Tzuyang Review</h4>
                                    <div className="bg-gray-50 rounded-md p-2.5 border border-gray-100">
                                        <p className="text-gray-700 text-xs leading-relaxed whitespace-pre-wrap break-keep">
                                            {currentRecord.restaurant_info?.tzuyang_review || '-'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Bottom Padding */}
                        <div className="h-8" />
                    </div>
                </ScrollArea >
            </div >
        </div >
    );
}
