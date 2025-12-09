'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
    MapPin,
    Phone,
    Tag,
    Youtube,
    User,
    ExternalLink,
    RefreshCw,
    Check,
    Loader2,
    Calendar,
    FileText,
    Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// YouTube 메타데이터 인터페이스
interface YouTubeMeta {
    title: string | null;
    publishedAt: string | null;
    duration: number | null;
    is_shorts: boolean | null;
    ads_info: {
        is_ads: boolean | null;
        what_ads: string[] | null;
    } | null;
}

// YouTube API 응답 인터페이스
interface YouTubeApiVideoItem {
    snippet: {
        title: string;
        publishedAt: string;
        description: string;
    };
    contentDetails: {
        duration: string;
    };
}

// ISO 8601 duration 파싱 함수
function parseDuration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const [, hours, minutes, seconds] = match;
    let total = 0;
    if (hours) total += parseInt(hours) * 3600;
    if (minutes) total += parseInt(minutes) * 60;
    if (seconds) total += parseInt(seconds);
    return total;
}

// 광고 키워드 분석 함수 (클라이언트 사이드)
async function analyzeAdContent(text: string): Promise<string[] | null> {
    const apiKey = process.env.NEXT_OPENAI_API_KEY_BYEON;
    if (!apiKey) return null;

    const textPreview = text.slice(0, 500); // 설명의 앞 500자만 사용

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                temperature: 0.3,
                messages: [
                    {
                        role: 'system',
                        content: `광고/협찬/지원을 한 **정확한 주체들의 전체 이름(기업명 + 브랜드명 조합 또는 기관명 형태)**을 **리스트** 형식으로 모아 답변하세요.
예시: ['하이트진로', '영양군청'], ['하림 멜팅피스']
반드시 추측하지 않고 **본문 내용에 쓰여 있는 주체들을 모두 작성**해야 합니다.
주체를 찾을 수 없거나 애매하면, 'None'을 출력합니다.`
                    },
                    {
                        role: 'user',
                        content: textPreview
                    }
                ]
            })
        });

        if (!response.ok) return null;

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();

        if (!content || content.toLowerCase() === 'none') return null;

        try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) return parsed.map(x => String(x).trim()).filter(Boolean);
            return [String(parsed).trim()];
        } catch {
            // JSON 파싱 실패 시 문자열 그대로 반환
            return [content];
        }
    } catch (error) {
        console.error('광고 분석 오류:', error);
        return null;
    }
}

// 기존 맛집 정보 인터페이스 (수정 요청 비교용)
export interface OriginalRestaurantData {
    id: string;
    unique_id: string;
    name: string;
    address: string;
    phone: string | null;
    categories: string[];
    youtube_link: string | null;
    tzuyang_review: string | null;
}

// 제보 데이터 인터페이스
export interface SubmissionRecord {
    id: string;
    user_id: string;
    restaurant_name: string;
    address: string;
    phone: string | null;
    category: string[] | string;
    youtube_link: string;
    description: string | null;
    status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
    created_at: string;
    reviewed_at: string | null;
    reviewed_by_admin_id: string | null;
    approved_restaurant_id: string | null;
    submission_type?: 'new' | 'edit';
    original_restaurant_id?: string;
    // 수정 요청 시 기존 맛집의 unique_id (비교 뷰 및 업데이트 시 보존용)
    unique_id?: string | null;
    // 수정 요청 시 기존 맛집 정보 (비교용)
    original_restaurant_data?: OriginalRestaurantData | null;
    profiles?: {
        nickname: string;
    } | null;
}

// 지오코딩 결과 인터페이스
export interface GeocodingResult {
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: any;
    x: string;
    y: string;
}

// 승인 데이터 인터페이스
export interface ApprovalData {
    lat: string;
    lng: string;
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: any;
}

interface SubmissionDetailViewProps {
    submission: SubmissionRecord;
    approvalData: ApprovalData;
    onApprovalDataChange: (data: ApprovalData) => void;
    geocodingResults: GeocodingResult[];
    onGeocodingResultsChange: (results: GeocodingResult[]) => void;
    selectedGeocodingIndex: number | null;
    onSelectedGeocodingIndexChange: (index: number | null) => void;
    className?: string;
}

// 유틸리티 함수: YouTube 비디오 ID 추출
function getYoutubeVideoId(url: string | undefined): string | null {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// 시/군/구까지만 추출하는 함수
function extractCityDistrictGu(address: string): string | null {
    const regex = /(.*?[시도]\s+.*?[시군구])/;
    const match = address.match(regex);
    return match ? match[1] : null;
}

// 중복 제거 함수 (지번 주소 기준)
function removeDuplicateAddresses(addresses: GeocodingResult[]): GeocodingResult[] {
    const seen = new Set<string>();
    return addresses.filter(addr => {
        if (seen.has(addr.jibun_address)) {
            return false;
        }
        seen.add(addr.jibun_address);
        return true;
    });
}

// 기존/수정 값 비교 컴포넌트
interface CompareFieldProps {
    label: string;
    original: string;
    modified: string;
    isMultiline?: boolean;
}

function CompareField({ label, original, modified, isMultiline }: CompareFieldProps) {
    const isChanged = original !== modified;

    return (
        <div className={cn(
            "rounded-md p-3",
            isChanged ? "bg-amber-100/50 border border-amber-300" : "bg-muted/30"
        )}>
            <div className="flex items-center gap-2 mb-2">
                <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
                {isChanged && (
                    <Badge variant="outline" className="text-xs bg-amber-100 text-amber-700 border-amber-300">
                        변경됨
                    </Badge>
                )}
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <span className="text-xs text-muted-foreground block mb-1">기존</span>
                    {isMultiline ? (
                        <p className={cn(
                            "text-sm whitespace-pre-wrap",
                            isChanged && "line-through text-muted-foreground"
                        )}>{original}</p>
                    ) : (
                        <p className={cn(
                            "text-sm",
                            isChanged && "line-through text-muted-foreground"
                        )}>{original}</p>
                    )}
                </div>
                <div>
                    <span className="text-xs text-muted-foreground block mb-1">수정 요청</span>
                    {isMultiline ? (
                        <p className={cn(
                            "text-sm whitespace-pre-wrap",
                            isChanged && "font-medium text-amber-800"
                        )}>{modified}</p>
                    ) : (
                        <p className={cn(
                            "text-sm",
                            isChanged && "font-medium text-amber-800"
                        )}>{modified}</p>
                    )}
                </div>
            </div>
        </div>
    );
}

export function SubmissionDetailView({
    submission,
    approvalData,
    onApprovalDataChange,
    geocodingResults,
    onGeocodingResultsChange,
    selectedGeocodingIndex,
    onSelectedGeocodingIndexChange,
    className,
}: SubmissionDetailViewProps) {
    const [geocoding, setGeocoding] = useState(false);
    const [embedError, setEmbedError] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // YouTube 메타데이터 상태
    const [youtubeMeta, setYoutubeMeta] = useState<YouTubeMeta | null>(null);
    const [fetchingMeta, setFetchingMeta] = useState(false);

    const videoId = useMemo(() => getYoutubeVideoId(submission.youtube_link), [submission.youtube_link]);

    // 리코드 변경 시 상태 초기화
    useEffect(() => {
        setEmbedError(false);
        setVideoUrl(null);
        setYoutubeMeta(null);
    }, [submission?.id]);

    // YouTube 임베드 가능 여부 확인
    useEffect(() => {
        if (!videoId || embedError) return;

        const checkEmbedAvailability = async () => {
            try {
                const response = await fetch(
                    `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`
                );

                if (!response.ok) {
                    setEmbedError(true);
                    return;
                }

                const data = await response.json();
                if (data.error) {
                    setEmbedError(true);
                }
            } catch (error) {
                console.log('YouTube 임베드 확인 실패:', error);
            }
        };

        checkEmbedAvailability();
    }, [videoId, embedError, submission?.id]);

    // 비디오 URL 생성 로직
    useEffect(() => {
        if (submission?.youtube_link && !embedError) {
            const vidId = getYoutubeVideoId(submission.youtube_link);
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
    }, [submission?.youtube_link, submission?.id, embedError]);

    // iframe 에러 핸들링
    const handleVideoError = useCallback(() => {
        setEmbedError(true);
    }, []);

    // 카테고리 배열 정규화
    const categories = useMemo(() => {
        if (Array.isArray(submission.category)) {
            return submission.category;
        }
        return submission.category ? [submission.category] : [];
    }, [submission.category]);

    // YouTube 메타데이터 가져오기 함수
    const fetchYoutubeMeta = useCallback(async () => {
        if (!videoId) {
            toast.error('유효한 YouTube 링크가 없습니다');
            return;
        }

        const apiKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
        if (!apiKey) {
            toast.error('YouTube API 키가 설정되지 않았습니다');
            return;
        }

        setFetchingMeta(true);

        try {
            // YouTube Data API v3 호출
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`
            );

            if (!response.ok) {
                throw new Error('YouTube API 호출 실패');
            }

            const data = await response.json();

            if (!data.items || data.items.length === 0) {
                throw new Error('영상을 찾을 수 없습니다');
            }

            const item = data.items[0] as YouTubeApiVideoItem;
            const snippet = item.snippet;
            const duration = parseDuration(item.contentDetails.duration);

            // 광고 키워드 확인
            const description = snippet.description || '';
            const descriptionLower = description.toLowerCase();
            const adKeywords = ['유료', '광고', '지원', '협찬'];
            const isAds = adKeywords.some(keyword => descriptionLower.includes(keyword));

            // 광고 주체 분석 (OpenAI 사용)
            let whatAds: string[] | null = null;
            if (isAds) {
                whatAds = await analyzeAdContent(description);
            }

            const meta: YouTubeMeta = {
                title: snippet.title,
                publishedAt: snippet.publishedAt,
                duration: duration,
                is_shorts: duration <= 180,
                ads_info: {
                    is_ads: isAds,
                    what_ads: whatAds,
                },
            };

            setYoutubeMeta(meta);
            toast.success('YouTube 메타데이터를 가져왔습니다');
        } catch (error: any) {
            console.error('YouTube 메타데이터 가져오기 오류:', error);
            toast.error(error.message || '메타데이터 가져오기 실패');
        } finally {
            setFetchingMeta(false);
        }
    }, [videoId]);

    // 재지오코딩 함수 (여러 개 결과 반환)
    const geocodeAddressMultiple = async (name: string, address: string, limit: number = 3): Promise<GeocodingResult[]> => {
        try {
            const combinedQuery = `${name} ${address}`;
            const { data, error } = await supabase.functions.invoke('naver-geocode', {
                body: { query: combinedQuery, count: limit }
            });

            if (error) throw new Error(error.message);
            if (!data?.addresses?.length) return [];

            return data.addresses.slice(0, limit).map((addr: any) => ({
                road_address: addr.roadAddress,
                jibun_address: addr.jibunAddress,
                english_address: addr.englishAddress,
                address_elements: addr.addressElements,
                x: addr.x,
                y: addr.y,
            }));
        } catch (error: any) {
            console.error('지오코딩 에러:', error);
            return [];
        }
    };

    // 재지오코딩 핸들러
    const handleReGeocode = async () => {
        const trimmedName = submission.restaurant_name.trim();
        const trimmedAddress = submission.address.trim();

        if (!trimmedName || !trimmedAddress) {
            toast.error('맛집명과 주소가 필요합니다');
            return;
        }

        try {
            setGeocoding(true);
            onGeocodingResultsChange([]);
            onSelectedGeocodingIndexChange(null);

            // 1. name + 전체 주소로 지오코딩 (최대 3개)
            const fullAddressResults = await geocodeAddressMultiple(trimmedName, trimmedAddress, 3);

            // 2. name + 주소의 시/군/구까지만 잘라서 지오코딩 (최대 3개)
            const shortAddress = extractCityDistrictGu(trimmedAddress);
            const shortAddressResults = shortAddress
                ? await geocodeAddressMultiple(trimmedName, shortAddress, 3)
                : [];

            // 3. 두 결과를 합치고 중복 제거
            const allResults = [...fullAddressResults, ...shortAddressResults];
            const uniqueResults = removeDuplicateAddresses(allResults);

            if (uniqueResults.length > 0) {
                onGeocodingResultsChange(uniqueResults);
                toast.success(`${uniqueResults.length}개의 주소 후보를 찾았습니다`);
            } else {
                toast.error('주소를 찾을 수 없습니다');
            }
        } catch (error: any) {
            toast.error(error.message || '지오코딩에 실패했습니다');
        } finally {
            setGeocoding(false);
        }
    };

    // 지오코딩 결과 선택 핸들러
    const handleSelectGeocodingResult = (index: number) => {
        onSelectedGeocodingIndexChange(index);
        const selected = geocodingResults[index];
        onApprovalDataChange({
            lat: selected.y,
            lng: selected.x,
            road_address: selected.road_address,
            jibun_address: selected.jibun_address,
            english_address: selected.english_address,
            address_elements: selected.address_elements,
        });
    };

    return (
        <div className={cn("flex h-full overflow-hidden", className)}>
            {/* 좌측: 비디오 플레이어 + 영상 정보 */}
            <div className="w-[40%] bg-accent/5 flex flex-col justify-start relative group border-r overflow-hidden">
                {/* YouTube 영상 */}
                <div className="p-4 pb-0 w-full shrink-0">
                    <div className="bg-white rounded-lg border p-3 shadow-sm">
                        {videoUrl && !embedError ? (
                            <div className="w-full aspect-video shadow-lg rounded-lg overflow-hidden">
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
                            <div
                                className="relative w-full aspect-video cursor-pointer group rounded-lg overflow-hidden"
                                onClick={() => {
                                    if (submission.youtube_link) {
                                        window.open(submission.youtube_link, '_blank');
                                    }
                                }}
                            >
                                {videoId ? (
                                    <img
                                        src={`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`}
                                        alt="YouTube 썸네일"
                                        className="w-full h-full object-cover rounded-lg shadow-lg transition-opacity duration-200 group-hover:opacity-90"
                                        onError={(e) => {
                                            const target = e.currentTarget;
                                            if (target.src.includes('maxresdefault')) {
                                                target.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                                            }
                                        }}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center text-muted-foreground p-6 text-center w-full h-full bg-gray-100 rounded-lg">
                                        <Youtube className="w-16 h-16 opacity-50 mb-2" />
                                        <p className="text-gray-400 text-sm">YouTube 링크 없음</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* 좌측 하단: 비디오 메타 정보 */}
                <div className="w-full bg-accent/5 p-4 pt-4 flex-1 min-h-0 overflow-y-auto">
                    <div className="bg-white rounded-lg border p-3 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="flex items-center gap-2 font-semibold text-base text-gray-800">
                                📹 영상 정보
                            </h3>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={fetchYoutubeMeta}
                                disabled={fetchingMeta || !videoId}
                                className="h-7 text-xs"
                            >
                                {fetchingMeta ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                    <Download className="w-3 h-3 mr-1" />
                                )}
                                메타데이터
                            </Button>
                        </div>
                        <div className="grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 text-sm">
                            <span className="text-gray-500 font-medium">제목:</span>
                            <span className="break-words font-medium text-gray-900 line-clamp-2" title={youtubeMeta?.title || undefined}>
                                {youtubeMeta?.title || '-'}
                            </span>

                            <span className="text-gray-500 font-medium">게시일:</span>
                            <span className="text-gray-700">
                                {youtubeMeta?.publishedAt ? new Date(youtubeMeta.publishedAt).toLocaleDateString() : '-'}
                            </span>

                            <span className="text-gray-500 font-medium">광고:</span>
                            <span className="text-gray-700">
                                {youtubeMeta?.ads_info?.is_ads
                                    ? `있음 (${youtubeMeta.ads_info.what_ads?.join(', ') || '분석 중...'})`
                                    : youtubeMeta ? '없음' : '-'}
                            </span>

                            <span className="text-gray-500 font-medium">링크:</span>
                            <div className="flex items-center gap-2 overflow-hidden">
                                <a
                                    href={submission.youtube_link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 hover:underline break-all"
                                >
                                    {submission.youtube_link}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 우측: 상세 정보 + 지오코딩 */}
            <ScrollArea className="w-[60%] h-full flex-shrink-0">
                <div className="p-6 space-y-6">
                    {/* 기본 정보 */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <FileText className="w-5 h-5" />
                                제보 정보
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* 맛집명 */}
                            <div>
                                <Label className="text-muted-foreground text-xs">맛집명</Label>
                                <p className="font-semibold text-lg">{submission.restaurant_name}</p>
                            </div>

                            {/* 주소 */}
                            <div className="flex items-start gap-2">
                                <MapPin className="w-4 h-4 mt-1 text-muted-foreground" />
                                <div>
                                    <Label className="text-muted-foreground text-xs">주소</Label>
                                    <p>{submission.address}</p>
                                </div>
                            </div>

                            {/* 연락처 */}
                            {submission.phone && (
                                <div className="flex items-center gap-2">
                                    <Phone className="w-4 h-4 text-muted-foreground" />
                                    <p>{submission.phone}</p>
                                </div>
                            )}

                            {/* 카테고리 */}
                            <div className="flex items-start gap-2">
                                <Tag className="w-4 h-4 mt-1 text-muted-foreground" />
                                <div className="flex flex-wrap gap-1">
                                    {categories.map((cat, idx) => (
                                        <Badge key={idx} variant="secondary">{cat}</Badge>
                                    ))}
                                </div>
                            </div>

                            {/* YouTube 링크 */}
                            {submission.youtube_link && (
                                <div className="flex items-start gap-2">
                                    <Youtube className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                                    <a
                                        href={submission.youtube_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-blue-500 hover:underline break-all"
                                    >
                                        {submission.youtube_link}
                                    </a>
                                </div>
                            )}

                            {/* 제보자 */}
                            <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm">{submission.profiles?.nickname || '알 수 없음'}</span>
                            </div>

                            {/* 제보일 */}
                            <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm">
                                    {new Date(submission.created_at).toLocaleDateString('ko-KR')}
                                </span>
                            </div>

                            {/* 설명 */}
                            {submission.description && (
                                <div className="pt-2 border-t">
                                    <Label className="text-muted-foreground text-xs">쯔양의 리뷰</Label>
                                    <p className="text-sm mt-1 whitespace-pre-wrap">{submission.description}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* 수정 요청 비교 뷰 (submission_type이 'edit'일 때만 표시) */}
                    {submission.submission_type === 'edit' && submission.original_restaurant_data && (
                        <Card className="border-amber-200 bg-amber-50/30">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-lg flex items-center gap-2 text-amber-700">
                                    <RefreshCw className="w-5 h-5" />
                                    수정 요청 비교
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* 맛집명 비교 */}
                                <CompareField
                                    label="맛집명"
                                    original={submission.original_restaurant_data.name}
                                    modified={submission.restaurant_name}
                                />

                                {/* 주소 비교 */}
                                <CompareField
                                    label="주소"
                                    original={submission.original_restaurant_data.address}
                                    modified={submission.address}
                                />

                                {/* 전화번호 비교 */}
                                <CompareField
                                    label="전화번호"
                                    original={submission.original_restaurant_data.phone || '-'}
                                    modified={submission.phone || '-'}
                                />

                                {/* 카테고리 비교 */}
                                <CompareField
                                    label="카테고리"
                                    original={submission.original_restaurant_data.categories.join(', ') || '-'}
                                    modified={categories.join(', ') || '-'}
                                />

                                {/* 쯔양 리뷰 비교 */}
                                <CompareField
                                    label="쯔양 리뷰"
                                    original={submission.original_restaurant_data.tzuyang_review || '-'}
                                    modified={submission.description || '-'}
                                    isMultiline
                                />
                            </CardContent>
                        </Card>
                    )}

                    {/* 거부된 경우 사유 표시 */}
                    {submission.status === 'rejected' && submission.rejection_reason && (
                        <Card className="border-red-200 bg-red-50/50">
                            <CardContent className="pt-4">
                                <Label className="text-red-600 text-sm font-medium">거부 사유</Label>
                                <p className="text-sm mt-1">{submission.rejection_reason}</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* 하단 여백 (스크롤 시 마지막 요소가 잘리지 않도록) */}
                    <div className="h-8" />
                </div>
            </ScrollArea>
        </div>
    );
}
