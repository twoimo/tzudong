'use client';

import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
    submission_type?: 'new' | 'update';
    original_restaurant_id?: string;
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
    const [isEmbeddable] = useState(true);

    const videoId = useMemo(() => getYoutubeVideoId(submission.youtube_link), [submission.youtube_link]);

    // 카테고리 배열 정규화
    const categories = useMemo(() => {
        if (Array.isArray(submission.category)) {
            return submission.category;
        }
        return submission.category ? [submission.category] : [];
    }, [submission.category]);

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
            {/* 좌측: YouTube 영상 */}
            <div className="w-1/2 h-full bg-black flex items-center justify-center flex-shrink-0">
                {videoId ? (
                    isEmbeddable ? (
                        <iframe
                            src={`https://www.youtube.com/embed/${videoId}?autoplay=0`}
                            title="YouTube video"
                            className="w-full h-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    ) : (
                        <a
                            href={submission.youtube_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex flex-col items-center gap-4 text-white"
                        >
                            <img
                                src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                                alt="YouTube thumbnail"
                                className="rounded-lg max-w-md"
                            />
                            <span className="flex items-center gap-2">
                                <ExternalLink className="w-4 h-4" />
                                YouTube에서 보기
                            </span>
                        </a>
                    )
                ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-2">
                        <Youtube className="w-16 h-16 opacity-50" />
                        <p>YouTube 링크 없음</p>
                    </div>
                )}
            </div>

            {/* 우측: 상세 정보 + 지오코딩 */}
            <ScrollArea className="w-1/2 h-full flex-shrink-0">
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
                                <div className="flex items-center gap-2">
                                    <Youtube className="w-4 h-4 text-red-500" />
                                    <a
                                        href={submission.youtube_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-blue-500 hover:underline truncate max-w-xs"
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



                    {/* 거부된 경우 사유 표시 */}
                    {submission.status === 'rejected' && submission.rejection_reason && (
                        <Card className="border-red-200 bg-red-50/50">
                            <CardContent className="pt-4">
                                <Label className="text-red-600 text-sm font-medium">거부 사유</Label>
                                <p className="text-sm mt-1">{submission.rejection_reason}</p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
