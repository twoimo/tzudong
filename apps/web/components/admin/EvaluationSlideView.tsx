import { useState, useEffect, useMemo } from 'react';
import { EvaluationRecord } from '@/types/evaluation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    // const [videoUrl, setVideoUrl] = useState<string | null>(null); // Removed: Derived state used instead
    const [overrideVideoUrl, setOverrideVideoUrl] = useState<string | null>(null); // New: For fallbacks
    const [useFallback, setUseFallback] = useState(false);
    const [fallbackIndex, setFallbackIndex] = useState(0);

    const FALLBACK_INSTANCES = [
        'https://piped.video/embed/',
        'https://invidious.fdn.fr/embed/',
        'https://invidious.sipet.org/embed/',
        'https://yewtu.be/embed/'
    ];

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

    // Derived State for Default Video URL (No useEffect delay)
    const defaultVideoUrl = useMemo(() => {
        if (videoId) {
            return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
        }
        return null;
    }, [videoId]);

    // Final Video URL to display
    const finalVideoUrl = overrideVideoUrl || defaultVideoUrl;


    // 에러 핸들링 (자동) - iframe onError에서 호출됨
    const handleVideoError = () => {
        console.log("Video Error Triggered. Current Fallback Index:", fallbackIndex);

        if (videoId) {
            // 아직 모든 Fallback을 다 시도하지 않았다면 다음 Fallback 시도
            if (fallbackIndex < FALLBACK_INSTANCES.length) {
                const nextInstance = FALLBACK_INSTANCES[fallbackIndex];
                console.log(`Switching to fallback instance: ${nextInstance}`);

                setOverrideVideoUrl(`${nextInstance}${videoId}?autoplay=1`);
                setUseFallback(true);
                setFallbackIndex(prev => prev + 1);
                setVideoError(false); // 재시도 중이므로 에러 해제
                return;
            }
        }

        // 모든 Fallback 시도 후에도 실패하면 최종 에러 처리
        setVideoError(true);
    };

    // 수동 우회 실행 (사용자가 버튼 클릭 시)
    const activateFallback = () => {
        if (videoId) {
            // 첫 번째 Fallback 인스턴스로 즉시 전환 (또는 현재 실패했다면 다음거)
            const instance = FALLBACK_INSTANCES[fallbackIndex % FALLBACK_INSTANCES.length];
            setOverrideVideoUrl(`${instance}${videoId}?autoplay=1`);
            setUseFallback(true);
            setVideoError(false);
            setFallbackIndex(prev => prev + 1); // 다음을 준비

            toast({
                title: "우회 플레이어 실행",
                description: "재생 제한을 우회하기 위해 대체 서버를 사용합니다.",
            });
        }
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
        <div className="flex flex-col h-full bg-background overflow-hidden relative">
            {/* Top Navigation Bar - Compact */}
            <div className="flex items-center justify-between px-3 py-2 border-b shrink-0 h-14 bg-white z-10 relative">
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
            <div className="flex-1 flex overflow-hidden" key={currentRecord.id}>
                {/* Left: Video Player */}
                <div className="w-[50%] bg-black flex flex-col justify-center relative group">
                    {finalVideoUrl ? (
                        <>
                            <iframe
                                width="100%"
                                height="100%"
                                src={finalVideoUrl}
                                title="Video player"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                className="absolute inset-0 w-full h-full"
                                onError={handleVideoError}
                            />
                            {/* Manual Bypass Button Overlay (Visible on Hover or when needed) */}
                            <div className="absolute top-4 right-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="bg-black/50 hover:bg-black/80 text-white border border-white/20 backdrop-blur-sm"
                                    onClick={activateFallback}
                                >
                                    <RotateCcw className="w-3 h-3 mr-2" />
                                    {useFallback ? 'Invidious 사용 중' : '영상 미재생 시 우회(Bypass)'}
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-white p-6 text-center bg-gray-900 h-full">
                            <AlertCircle className="w-10 h-10 mb-2 text-red-500" />
                            <p className="text-gray-400 text-sm">재생할 수 있는 영상이 없습니다.</p>
                        </div>
                    )}
                </div>

                {/* Right: Info & Evaluation - Expanded Layout based on Reference Image */}
                <ScrollArea className="w-[50%] h-full border-l bg-accent/5">
                    <div className="p-5 space-y-6 text-sm">

                        {/* 0. Video Info */}
                        <div className="bg-white rounded-lg border p-4 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="flex items-center gap-2 font-semibold text-lg">
                                    📹 영상 정보
                                </h3>
                                {/* 우회 버튼을 여기에도 배치 */}
                                {!useFallback && (
                                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={activateFallback}>
                                        <PlayCircle className="w-3 h-3 mr-1" /> 영상이 안 나오나요?
                                    </Button>
                                )}
                            </div>

                            <div className="space-y-2 text-sm">
                                <div className="grid grid-cols-[80px_1fr] gap-2">
                                    <span className="font-medium text-gray-700">제목:</span>
                                    <span className="break-words">{currentRecord.youtube_meta?.title || '-'}</span>

                                    <span className="font-medium text-gray-700">게시일:</span>
                                    <span>{currentRecord.youtube_meta?.publishedAt ? new Date(currentRecord.youtube_meta.publishedAt).toLocaleDateString() : '-'}</span>

                                    <span className="font-medium text-gray-700">광고 여부:</span>
                                    <span>
                                        {currentRecord.youtube_meta?.ads_info?.is_ads
                                            ? `광고 있음 (${currentRecord.youtube_meta.ads_info.what_ads})`
                                            : '광고 없음'}
                                    </span>

                                    <span className="font-medium text-gray-700">링크:</span>
                                    <a
                                        href={currentRecord.youtube_link}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-600 hover:underline break-all"
                                    >
                                        {currentRecord.youtube_link}
                                    </a>
                                </div>
                            </div>
                        </div>

                        {/* 1. Evaluation Details */}
                        <div className="bg-white rounded-lg border p-4 shadow-sm">
                            <h3 className="flex items-center gap-2 font-semibold text-lg mb-4">
                                📊 평가 상세
                            </h3>
                            <div className="space-y-6">
                                {/* 1. Visit Authenticity */}
                                <div className="pl-3 border-l-4 border-blue-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-6 w-6 flex items-center justify-center p-0 rounded-sm bg-blue-50 text-blue-700 border-blue-200">1</Badge>
                                        <span className="font-semibold text-gray-900">방문 여부 정확성:</span>
                                        <span className={cn("font-bold", currentRecord.evaluation_results?.visit_authenticity?.eval_value === 1 ? "text-blue-600" : "text-gray-900")}>
                                            {currentRecord.evaluation_results?.visit_authenticity?.eval_value ?? 0}점
                                        </span>
                                    </div>
                                    <p className="text-gray-600 leading-relaxed text-sm">
                                        {currentRecord.evaluation_results?.visit_authenticity?.eval_basis || '근거 내용 없음'}
                                    </p>
                                </div>

                                {/* 2. Reasoning Basis Inference */}
                                <div className="pl-3 border-l-4 border-purple-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-6 w-6 flex items-center justify-center p-0 rounded-sm bg-purple-50 text-purple-700 border-purple-200">2</Badge>
                                        <span className="font-semibold text-gray-900">추론 합리성 (reasoning_basis):</span>
                                        <span className={cn("font-bold", currentRecord.evaluation_results?.rb_inference_score?.eval_value === 1 ? "text-purple-600" : "text-gray-900")}>
                                            {currentRecord.evaluation_results?.rb_inference_score?.eval_value ?? 0}점
                                        </span>
                                    </div>
                                    <p className="text-gray-600 leading-relaxed text-sm">
                                        {currentRecord.evaluation_results?.rb_inference_score?.eval_basis || '근거 내용 없음'}
                                    </p>
                                </div>

                                {/* 3. Reasoning Basis Grounding */}
                                <div className="pl-3 border-l-4 border-green-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-6 w-6 flex items-center justify-center p-0 rounded-sm bg-green-50 text-green-700 border-green-200">3</Badge>
                                        <span className="font-semibold text-gray-900">실제 근거 일치도 (reasoning_basis):</span>
                                        <Badge className={cn("text-xs", currentRecord.evaluation_results?.rb_grounding_TF?.eval_value ? "bg-green-600" : "bg-red-500")}>
                                            {currentRecord.evaluation_results?.rb_grounding_TF?.eval_value ? "True" : "False"}
                                        </Badge>
                                    </div>
                                    <p className="text-gray-600 leading-relaxed text-sm">
                                        {currentRecord.evaluation_results?.rb_grounding_TF?.eval_basis || '근거 내용 없음'}
                                    </p>
                                </div>

                                {/* 4. Review Faithfulness */}
                                <div className="pl-3 border-l-4 border-indigo-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-6 w-6 flex items-center justify-center p-0 rounded-sm bg-indigo-50 text-indigo-700 border-indigo-200">4</Badge>
                                        <span className="font-semibold text-gray-900">리뷰 충실도 (음식 리뷰):</span>
                                        <span className={cn("font-bold", currentRecord.evaluation_results?.review_faithfulness_score?.eval_value === 1 ? "text-indigo-600" : "text-gray-900")}>
                                            {currentRecord.evaluation_results?.review_faithfulness_score?.eval_value ?? 0}점
                                        </span>
                                    </div>
                                    <p className="text-gray-600 leading-relaxed text-sm">
                                        {currentRecord.evaluation_results?.review_faithfulness_score?.eval_basis || '근거 내용 없음'}
                                    </p>
                                </div>

                                {/* 5. Geocoding */}
                                <div className="pl-3 border-l-4 border-orange-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-6 w-6 flex items-center justify-center p-0 rounded-sm bg-orange-50 text-orange-700 border-orange-200">5</Badge>
                                        <span className="font-semibold text-gray-900">주소 정합성 (지오코딩 기반):</span>
                                        <Badge className={cn("text-xs", currentRecord.geocoding_success ? "bg-green-600" : "bg-red-500")}>
                                            {currentRecord.geocoding_success ? "성공" : "실패"}
                                        </Badge>
                                    </div>
                                    <div className="text-gray-600 text-sm space-y-1 mt-1">
                                        <p><span className="font-medium text-black">지번 주소:</span> {currentRecord.jibun_address || '-'}</p>
                                        <p><span className="font-medium text-black">도로명 주소:</span> {currentRecord.road_address || '-'}</p>
                                    </div>
                                </div>

                                {/* 6. Category Validity */}
                                <div className="pl-3 border-l-4 border-teal-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-6 w-6 flex items-center justify-center p-0 rounded-sm bg-teal-50 text-teal-700 border-teal-200">6</Badge>
                                        <span className="font-semibold text-gray-900">카테고리 유효성 (파싱 문제):</span>
                                        <Badge className={cn("text-xs", currentRecord.evaluation_results?.category_validity_TF?.eval_value ? "bg-green-600" : "bg-red-500")}>
                                            {currentRecord.evaluation_results?.category_validity_TF?.eval_value ? "True" : "False"}
                                        </Badge>
                                    </div>
                                </div>

                                {/* 7. Category Match */}
                                <div className="pl-3 border-l-4 border-yellow-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="h-6 w-6 flex items-center justify-center p-0 rounded-sm bg-yellow-50 text-yellow-700 border-yellow-200">7</Badge>
                                        <span className="font-semibold text-gray-900">카테고리 정합성:</span>
                                        <Badge className={cn("text-xs", currentRecord.evaluation_results?.category_TF?.eval_value ? "bg-green-600" : "bg-red-500")}>
                                            {currentRecord.evaluation_results?.category_TF?.eval_value ? "True" : "False"}
                                        </Badge>
                                        {/* 수정됨 여부 체크? */}
                                        {currentRecord.evaluation_results?.category_TF?.category_revision && (
                                            <Badge variant="outline" className="ml-2 text-yellow-700 border-yellow-300 bg-yellow-50">
                                                {currentRecord.evaluation_results.category_TF.category_revision} (수정됨)
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 2. Restaurant Info */}
                        <div className="bg-white rounded-lg border p-4 shadow-sm">
                            <h3 className="flex items-center gap-2 font-semibold text-lg mb-4">
                                🍽️ 음식점 상세 정보
                            </h3>
                            <div className="space-y-4 text-sm">
                                <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                                    <span className="font-bold">음식점명:</span>
                                    <span>{currentRecord.restaurant_name || currentRecord.name}</span>

                                    <span className="font-bold">카테고리:</span>
                                    <span>{currentRecord.restaurant_info?.category || '-'}</span>

                                    <span className="font-bold">전화번호:</span>
                                    <span>{currentRecord.phone || '-'}</span>

                                    <span className="font-bold">원본 주소:</span>
                                    <span>{currentRecord.restaurant_info?.origin_address || '-'}</span>

                                    <span className="font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-600" /> Naver 도로명:</span>
                                    <span>{currentRecord.restaurant_info?.naver_address_info?.road_address || '-'}</span>

                                    <span className="font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-600" /> Naver 지번:</span>
                                    <span>{currentRecord.restaurant_info?.naver_address_info?.jibun_address || '-'}</span>

                                    <span className="font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-600" /> 좌표:</span>
                                    <span className="font-mono text-xs text-gray-600">
                                        ({currentRecord.lat ?? '-'}, {currentRecord.lng ?? '-'})
                                    </span>
                                </div>
                                <div className="mt-4 p-3 bg-gray-100 rounded-md">
                                    <h4 className="font-bold mb-1">reasoning_basis:</h4>
                                    <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">
                                        {currentRecord.reasoning_basis || '-'}
                                    </p>
                                </div>
                                <div className="mt-4 p-3 bg-gray-100 rounded-md">
                                    <h4 className="font-bold mb-1">tzuyang_review:</h4>
                                    <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">
                                        {currentRecord.restaurant_info?.tzuyang_review || '-'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Bottom Padding */}
                        <div className="h-12" />
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}
