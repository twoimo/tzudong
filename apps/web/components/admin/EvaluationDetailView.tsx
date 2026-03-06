import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import Image from 'next/image';
import { EvaluationRecord } from '@/types/evaluation';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { formatCategoryText } from '@/lib/category-utils';
import { openExternalUrl } from '@/lib/open-external-url';

// 유틸리티 함수: YouTube 비디오 ID 추출 (컴포넌트 외부)
const getYoutubeVideoId = (url: string | undefined): string | null => {
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

interface EvaluationDetailViewProps {
    record: EvaluationRecord;
    className?: string;
    autoHeight?: boolean; // true일 경우 내부 스크롤 없이 콘텐츠 높이에 맞춰 늘어남
}

interface LocationMatchEvalResult {
    matched_name?: string;
    name?: string;
}

export const EvaluationDetailView = memo(function EvaluationDetailView({ record, className, autoHeight = false }: EvaluationDetailViewProps) {

    const [embedError, setEmbedError] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const iframeRef = React.useRef<HTMLIFrameElement>(null);

    // 리코드 변경 시 상태 초기화
    useEffect(() => {
        setEmbedError(false);
        setVideoUrl(null);
    }, [record?.id]);

    // videoId 메모이제이션
    const videoId = useMemo(() => getYoutubeVideoId(record?.youtube_link), [record?.youtube_link]);

    // YouTube 임베드 가능 여부 확인 (noembed.com 프록시 사용 - CORS 지원)
    useEffect(() => {
        if (!videoId || embedError) return;

        const checkEmbedAvailability = async () => {
            try {
                // noembed.com은 CORS를 지원하는 oEmbed 프록시
                const response = await fetch(
                    `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`
                );

                if (!response.ok) {

                    setEmbedError(true);
                    return;
                }

                const data = await response.json();

                // noembed에서 에러 응답 시 (비공개, 삭제, 임베드 제한 등)
                if (data.error) {

                    setEmbedError(true);
                }
            } catch {
                // 네트워크 에러 시에는 그냥 iframe 시도
            }
        };

        checkEmbedAvailability();
    }, [videoId, embedError, record?.id]);

    // 비디오 URL 생성 로직
    useEffect(() => {
        if (record?.youtube_link && !embedError) {
            const vidId = getYoutubeVideoId(record.youtube_link);
            if (vidId) {
                const origin = typeof window !== 'undefined' ? window.location.origin : '';
                const url = `https://www.youtube.com/embed/${vidId}?autoplay=0&mute=0&playsinline=1&rel=0&enablejsapi=1&origin=${origin}&controls=1`;
                setVideoUrl(url);
            } else {
                setVideoUrl(null);
            }
        } else {
            setVideoUrl(null);
        }
    }, [record?.youtube_link, record?.id, embedError]);

    // iframe 에러 핸들링
    const handleVideoError = useCallback(() => {
        setEmbedError(true);
    }, []);

    if (!record) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                <span className="text-4xl mb-4">⚠️</span>
                <p className="text-lg">표시할 데이터가 없습니다.</p>
            </div>
        );
    }

    const locationMatchResult = record.evaluation_results?.location_match_TF as LocationMatchEvalResult | undefined;

    const RightContent = () => (
        <div className="p-4 space-y-4 text-sm">
            {/* 1. 평가 상세 내역 */}
            <div className="bg-white rounded-lg border p-3 shadow-sm">
                <h3 className="flex items-center gap-2 font-semibold text-base mb-3 text-gray-800">
                    📊 평가 상세
                </h3>
                <div className="space-y-4">
                    {/* 0. 맛집명 검증 (Name Validation) */}
                    <div className="pl-3 border-l-4 border-pink-500">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-pink-50 text-pink-700 border-pink-200 text-[10px] shrink-0">0</Badge>
                            <span className="font-semibold text-gray-900 text-sm shrink-0">맛집명 검증:</span>
                            {record.approved_name && (
                                <Badge className="bg-green-600 text-[10px] h-5 px-1.5">승인됨: {record.approved_name}</Badge>
                            )}
                        </div>
                        <div className="text-gray-600 text-xs space-y-1 mt-1">
                            <div className="flex items-start gap-2">
                                <span className="font-medium text-gray-500 shrink-0 min-w-[70px]">Origin Name:</span>
                                <span className="font-bold text-gray-800 break-all">{record.origin_name || record.restaurant_name || record.name || '-'}</span>
                                <Badge variant="outline" className="text-[10px] h-4 px-1">Gemini</Badge>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="font-medium text-gray-500 shrink-0 min-w-[70px]">Naver Name:</span>
                                <span className="font-bold text-blue-700 break-all">
                                    {record.naver_name ||
                                        locationMatchResult?.matched_name ||
                                        (locationMatchResult?.name &&
                                            !['Location Match', '주소 정합성', 'location_match_TF'].includes(locationMatchResult.name)
                                            ? locationMatchResult.name
                                            : '-')
                                    }
                                </span>
                                <Badge variant="outline" className="text-[10px] h-4 px-1">Rule-based</Badge>
                            </div>
                        </div>
                    </div>

                    {/* 1. 방문 여부 (Visit Authenticity) */}
                    <div className="pl-3 border-l-4 border-blue-500">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-blue-50 text-blue-700 border-blue-200 text-[10px] shrink-0">1</Badge>
                            <span className="font-semibold text-gray-900 text-sm shrink-0">방문 여부 정확성:</span>
                            <span className={cn("font-bold text-sm", record.evaluation_results?.visit_authenticity?.eval_value === 1 ? "text-blue-600" : "text-gray-900")}>
                                {record.evaluation_results?.visit_authenticity?.eval_value ?? 0}
                            </span>
                        </div>
                        <p className="text-gray-600 leading-relaxed text-xs break-all whitespace-pre-wrap">
                            {record.evaluation_results?.visit_authenticity?.eval_basis || '근거 내용 없음'}
                        </p>
                    </div>

                    {/* 2. 추론 합리성 (Reasoning Basis Inference) */}
                    <div className="pl-3 border-l-4 border-purple-500">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-purple-50 text-purple-700 border-purple-200 text-[10px] shrink-0">2</Badge>
                            <span className="font-semibold text-gray-900 text-sm shrink-0">추론 합리성:</span>
                            <span className={cn("font-bold text-sm", record.evaluation_results?.rb_inference_score?.eval_value === 1 ? "text-purple-600" : "text-gray-900")}>
                                {record.evaluation_results?.rb_inference_score?.eval_value ?? 0}
                            </span>
                        </div>
                        <p className="text-gray-600 leading-relaxed text-xs break-all whitespace-pre-wrap">
                            {record.evaluation_results?.rb_inference_score?.eval_basis || '근거 내용 없음'}
                        </p>
                    </div>

                    {/* 3. 실제 근거 일치 (Reasoning Basis Grounding) */}
                    <div className="pl-3 border-l-4 border-green-500">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-green-50 text-green-700 border-green-200 text-[10px] shrink-0">3</Badge>
                            <span className="font-semibold text-gray-900 text-sm shrink-0">실제 근거 일치도:</span>
                            <Badge className={cn("text-[10px] h-5 px-1.5", record.evaluation_results?.rb_grounding_TF?.eval_value ? "bg-green-600" : "bg-red-500")}>
                                {record.evaluation_results?.rb_grounding_TF?.eval_value ? "True" : "False"}
                            </Badge>
                        </div>
                        <p className="text-gray-600 leading-relaxed text-xs break-all whitespace-pre-wrap">
                            {record.evaluation_results?.rb_grounding_TF?.eval_basis || '근거 내용 없음'}
                        </p>
                    </div>

                    {/* 4. 리뷰 충실도 (Review Faithfulness) */}
                    <div className="pl-3 border-l-4 border-indigo-500">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px] shrink-0">4</Badge>
                            <span className="font-semibold text-gray-900 text-sm shrink-0">리뷰 충실도:</span>
                            <span className={cn("font-bold text-sm", record.evaluation_results?.review_faithfulness_score?.eval_value === 1 ? "text-indigo-600" : "text-gray-900")}>
                                {record.evaluation_results?.review_faithfulness_score?.eval_value ?? 0}
                            </span>
                        </div>
                        <p className="text-gray-600 leading-relaxed text-xs break-all whitespace-pre-wrap">
                            {record.evaluation_results?.review_faithfulness_score?.eval_basis || '근거 내용 없음'}
                        </p>
                    </div>

                    {/* 5. 주소 정합성 (Geocoding) */}
                    <div className="pl-3 border-l-4 border-orange-500">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-orange-50 text-orange-700 border-orange-200 text-[10px] shrink-0">5</Badge>
                            <span className="font-semibold text-gray-900 text-sm shrink-0">주소 정합성:</span>
                            <Badge className={cn("text-[10px] h-5 px-1.5", record.geocoding_success ? "bg-green-600" : "bg-red-500")}>
                                {record.geocoding_success ? "성공" : "실패"}
                            </Badge>
                        </div>
                        <div className="text-gray-600 text-xs space-y-0.5 mt-0.5">
                            <p className="break-all"><span className="text-gray-500 shrink-0">지번:</span> {record.jibun_address || '-'}</p>
                            <p className="break-all"><span className="text-gray-500 shrink-0">도로명:</span> {record.road_address || '-'}</p>
                        </div>
                    </div>

                    {/* 6. 카테고리 유효성 (Category Validity) */}
                    <div className="pl-3 border-l-4 border-teal-500">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-teal-50 text-teal-700 border-teal-200 text-[10px] shrink-0">6</Badge>
                            <span className="font-semibold text-gray-900 text-sm shrink-0">카테고리 유효성:</span>
                            <Badge className={cn("text-[10px] h-5 px-1.5", record.evaluation_results?.category_validity_TF?.eval_value ? "bg-green-600" : "bg-red-500")}>
                                {record.evaluation_results?.category_validity_TF?.eval_value ? "True" : "False"}
                            </Badge>
                        </div>
                    </div>

                    {/* 7. 카테고리 정합성 (Category Match) */}
                    <div className="pl-3 border-l-4 border-yellow-500">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className="h-5 w-5 flex items-center justify-center p-0 rounded-sm bg-yellow-50 text-yellow-700 border-yellow-200 text-[10px] shrink-0">7</Badge>
                            <span className="font-semibold text-gray-900 text-sm shrink-0">카테고리 정합성:</span>
                            <Badge className={cn("text-[10px] h-5 px-1.5", record.evaluation_results?.category_TF?.eval_value ? "bg-green-600" : "bg-red-500")}>
                                {record.evaluation_results?.category_TF?.eval_value ? "True" : "False"}
                            </Badge>
                            {record.evaluation_results?.category_TF?.category_revision && (
                                <span className="ml-2 text-xs text-yellow-700 font-medium">
                                    (수정: {formatCategoryText(record.evaluation_results?.category_TF.category_revision, '-')})
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. 음식점 기본 정보 */}
            <div className="bg-white rounded-lg border p-3 shadow-sm">
                <h3 className="flex items-center gap-2 font-semibold text-base mb-3 text-gray-800">
                    🍽️ 음식점 상세 정보
                </h3>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    {/* Row 1 */}
                    <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-gray-500 text-xs font-medium">음식점명</span>
                        <span className="font-semibold text-gray-900 text-sm break-all">{record.restaurant_name || record.name || '-'}</span>
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-gray-500 text-xs font-medium">카테고리</span>
                        <span className="text-gray-900 text-sm break-all">
                            {formatCategoryText(record.categories, '') || formatCategoryText(record.restaurant_info?.category, '-')}
                        </span>
                    </div>

                    {/* Row 2 */}
                    <div className="flex flex-col gap-3 min-w-0">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-gray-500 text-xs font-medium">원본 주소</span>
                            <span className="text-gray-900 text-sm break-all">{record.restaurant_info?.origin_address || '-'}</span>
                        </div>
                        <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-start gap-1.5 min-w-0">
                                <Badge variant="outline" className="shrink-0 text-[10px] px-1 bg-green-50 text-green-700 border-green-200 h-5">Naver 도로명</Badge>
                                <span className="text-sm text-gray-700 break-all flex-1 min-w-0">{record.restaurant_info?.naver_address_info?.road_address || '-'}</span>
                            </div>
                            <div className="flex items-start gap-1.5 min-w-0">
                                <Badge variant="outline" className="shrink-0 text-[10px] px-1 bg-green-50 text-green-700 border-green-200 h-5">Naver 지번</Badge>
                                <span className="text-sm text-gray-700 break-all flex-1 min-w-0">{record.restaurant_info?.naver_address_info?.jibun_address || '-'}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-3 min-w-0">
                        {record.phone && (
                            <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-gray-500 text-xs font-medium">전화번호</span>
                                <span className="text-gray-900 text-sm">{record.phone}</span>
                            </div>
                        )}
                        <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-gray-500 text-xs font-medium flex items-center gap-1">
                                좌표 (lat, lng)
                            </span>
                            <span className="font-mono text-xs text-gray-600">
                                {record.lat ?? '-'}, {record.lng ?? '-'}
                            </span>
                        </div>
                    </div>
                </div>

                <Separator className="my-3" />

                <div className="space-y-3">
                    <div>
                        <h4 className="font-bold text-xs text-gray-500 mb-1.5 uppercase">Reasoning Basis</h4>
                        <div className="bg-gray-50 rounded-md p-2.5 border border-gray-100">
                            <p className="text-gray-700 text-xs leading-relaxed whitespace-pre-wrap break-all">
                                {record.reasoning_basis || '-'}
                            </p>
                        </div>
                    </div>
                    <div>
                        <h4 className="font-bold text-xs text-gray-500 mb-1.5 uppercase">Tzuyang Review</h4>
                        <div className="bg-gray-50 rounded-md p-2.5 border border-gray-100">
                            <p className="text-gray-700 text-xs leading-relaxed whitespace-pre-wrap break-all">
                                {record.restaurant_info?.tzuyang_review || '-'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Padding */}
            <div className="h-16" />
        </div>
    );

    return (
        <div className={cn("flex flex-col lg:flex-row", autoHeight ? "h-auto" : "h-full overflow-hidden", className)}>
            {/* 좌측: 비디오 플레이어 */}
            <div className={cn("bg-accent/5 flex flex-col justify-start relative group border-b lg:border-b-0 lg:border-r", autoHeight ? "w-full lg:w-[40%]" : "w-full lg:w-[50%] overflow-hidden")}>
                <div className="p-4 pb-0 w-full shrink-0">
                    <div className="bg-white rounded-lg border p-3 shadow-sm">
                        <div className="bg-white rounded-lg border p-3 shadow-sm">
                            {videoUrl && !embedError ? (
                                <div className="w-full aspect-video z-10 shadow-lg">
                                    <iframe
                                        ref={iframeRef}
                                        width="100%"
                                        height="100%"
                                        src={`${videoUrl}&autoplay=0`}
                                        title="Video player"
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; compute-pressure"
                                        allowFullScreen
                                        className="w-full h-full block"
                                        onError={handleVideoError}
                                    />
                                </div>
                            ) : (
                                /* Facade Pattern: 썸네일 표시 (클릭 시 새 탭) */
                                <button
                                    type="button"
                                    className="relative w-full aspect-video cursor-pointer group"
                                    onClick={() => {
                                        if (record.youtube_link) {
                                            openExternalUrl(record.youtube_link);
                                        }
                                    }}
                                    aria-label="유튜브 영상 새 탭에서 열기"
                                >
                                    {videoId ? (
                                        <Image
                                            src={`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`}
                                            alt="YouTube 썸네일"
                                            fill
                                            unoptimized
                                            sizes="(max-width: 768px) 100vw, 768px"
                                            className="rounded-lg object-cover shadow-lg transition-opacity duration-200 group-hover:opacity-90"
                                            onError={(e) => {
                                                const target = e.currentTarget;
                                                if (target.src.includes('maxresdefault')) {
                                                    target.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                                                }
                                            }}
                                        />
                                    ) : (
                                        <div className="flex flex-col items-center justify-center text-muted-foreground p-6 text-center z-10 w-full h-full bg-gray-100 rounded-lg">
                                            <p className="text-gray-400 text-sm">썸네일 없음</p>
                                        </div>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* 좌측 하단: 비디오 메타 정보 */}
                <div className={cn("w-full bg-accent/5 p-4 pt-4 flex-1 min-h-0", autoHeight ? "" : "overflow-y-auto")}>
                    <div className="bg-white rounded-lg border p-3 shadow-sm">
                        <h3 className="flex items-center gap-2 font-semibold text-base mb-2 text-gray-800">
                            📹 영상 정보
                        </h3>
                        <div className="grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 text-sm">
                            <span className="text-gray-500 font-medium">제목:</span>
                            <span className="break-words font-medium text-gray-900 line-clamp-2" title={record.youtube_meta?.title}>{record.youtube_meta?.title || '-'}</span>

                            <span className="text-gray-500 font-medium">게시일:</span>
                            <span className="text-gray-700">{record.youtube_meta?.publishedAt ? new Date(record.youtube_meta.publishedAt).toLocaleDateString() : '-'}</span>

                            <span className="text-gray-500 font-medium">광고:</span>
                            <span className="text-gray-700">
                                {record.youtube_meta?.ads_info?.is_ads
                                    ? `있음 (${record.youtube_meta.ads_info.what_ads})`
                                    : '없음'}
                            </span>

                            <span className="text-gray-500 font-medium">링크:</span>
                            <div className="flex items-center gap-2 overflow-hidden">
                                <a
                                    href={record.youtube_link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 hover:underline break-all"
                                >
                                    {record.youtube_link}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 우측: 평가 및 상세 정보 */}
            {autoHeight ? (
                <div className="h-auto w-full border-t bg-accent/5 lg:w-[60%] lg:border-l lg:border-t-0">
                    <RightContent />
                </div>
            ) : (
                <ScrollArea className="h-full w-full border-t bg-accent/5 lg:w-[50%] lg:border-l lg:border-t-0">
                    <RightContent />
                </ScrollArea>
            )}
        </div>
    );
});
