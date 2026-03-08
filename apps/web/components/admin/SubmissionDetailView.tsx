'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
    Youtube,
    User,
    RefreshCw,
    Loader2,
    Calendar,
    AlertTriangle,
    X,
    Sparkles,
    Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RESTAURANT_CATEGORIES } from '@/constants/categories';
import { formatCategoryText } from '@/lib/category-utils';
import { supabase } from '@/integrations/supabase/client';
import { geocodeWithGoogleMapsJs } from '@/lib/google-js-geocode';

// ==================== 타입 정의 ====================

interface NaverGeocodeAddress {
    roadAddress?: string;
    jibunAddress?: string;
    englishAddress?: string;
    addressElements?: unknown;
    x: string;
    y: string;
}

interface NaverGeocodeResponse {
    error?: string;
    addresses?: NaverGeocodeAddress[];
}

export interface SubmissionItem {
    id: string;
    submission_id: string;
    youtube_link: string;
    tzuyang_review: string | null;
    target_restaurant_id: string | null; // 승인된 레스토랑 ID 또는 EDIT 시 수정 대상 식당 ID
    item_status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
    duplicate_check_result?: {
        isDuplicate: boolean;
        existingRestaurantId?: string;
        existingRestaurantName?: string;
        matchedYoutubeUrl?: string;
    } | null;
    created_at: string;
    // 아이템별 기존 레스토랑 데이터 (target_restaurant_id로 매칭)
    original_restaurant?: {
        id: string;
        name: string;
        youtube_link: string | null;
        tzuyang_review: string | null;
        youtube_meta?: {
            title?: string;
            published_at?: string;
            duration?: number;
            is_shorts?: boolean;
            is_ads?: boolean;
            what_ads?: string[] | null;
        } | null;
    } | null;
}

export interface SubmissionRecord {
    id: string;
    user_id: string;
    submission_type: 'new' | 'edit';
    status: 'pending' | 'approved' | 'partially_approved' | 'rejected';
    restaurant_name: string;
    restaurant_address: string | null;
    restaurant_phone: string | null;
    restaurant_categories: string[] | null;
    // target_restaurant_id는 submission 레벨이 아닌 items 레벨에서 관리
    admin_notes: string | null;
    rejection_reason: string | null;
    resolved_by_admin_id: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
    items: SubmissionItem[];
    profiles?: { nickname: string } | null;
    original_restaurant_data?: {
        id: string;
        unique_id: string;
        name: string;
        road_address: string | null;
        jibun_address: string | null;
        phone: string | null;
        categories: string[] | null;
        youtube_link: string | null;
        tzuyang_review: string | null;
        youtube_meta?: {
            title?: string;
            published_at?: string;
            duration?: number;
            is_shorts?: boolean;
            is_ads?: boolean;
            what_ads?: string[] | null;
        } | null;
    } | null;
}

export interface GeocodingResult {
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: unknown;
    x: string;
    y: string;
}

export interface ApprovalData {
    lat: string;
    lng: string;
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: unknown;
}

export interface ItemDecision {
    approved: boolean;
    rejectionReason: string;
    youtube_link: string;
    tzuyang_review: string;
    metaFetched?: boolean;
    metaData?: {
        title: string;
        publishedAt: string;
        duration: number;
        is_shorts: boolean;
        ads_info: { is_ads: boolean; what_ads: string[] | null };
    } | null;
}

export interface NaverSearchResult {
    title: string;
    address: string;
    roadAddress?: string;
    isMatch?: boolean;
}

interface SubmissionDetailViewProps {
    submission: SubmissionRecord;
    approvalData: ApprovalData;
    onApprovalDataChange: (data: ApprovalData) => void;
    geocodingResults: GeocodingResult[];
    onGeocodingResultsChange: (results: GeocodingResult[]) => void;
    selectedGeocodingIndex: number | null;
    onSelectedGeocodingIndexChange: (index: number | null) => void;
    itemDecisions: Record<string, ItemDecision>;
    onItemDecisionsChange: (
        decisions:
            | Record<string, ItemDecision>
            | ((prev: Record<string, ItemDecision>) => Record<string, ItemDecision>)
    ) => void;
    forceApprove: boolean;
    onForceApproveChange: (force: boolean) => void;
    editableData: {
        name: string;
        address: string;
        phone: string;
        categories: string[];
    };
    onEditableDataChange: (data: { name: string; address: string; phone: string; categories: string[] }) => void;
    className?: string;
    // 네이버 검색 검증 관련 props 추가
    naverSearchResults: NaverSearchResult[];
    naverSearchLoading: boolean;
    onVerifyNaverSearch: () => void;
    // 지오코딩 선택 핸들러 (선택적)
    onGeocodingSelect?: (result: GeocodingResult, index: number) => void;
}

// ==================== 유틸리티 함수 ====================

function getYoutubeVideoId(url: string | undefined): string | null {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&].*)?/,
        /(?:youtube\.com\/(?:embed|v)\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) return match[1];
    }
    return null;
}

function extractCityDistrictGu(address: string): string | null {
    // 공백 기준으로 분리하여 앞 2~3어절 추출 (시/도 + 시/군/구 + 읍/면/동/도로명)
    const parts = address.trim().split(/\s+/);
    if (parts.length >= 2) {
        // 기본: 시/도 + 시/군/구
        let region = `${parts[0]} ${parts[1]}`;

        // 3번째 어절이 있고, (구/시/군/읍/면/동/로/길)로 끝나면 추가
        // 예: 성남시 분당구, 마포구 양화로, 제주시 애월읍
        if (parts.length >= 3) {
            const p3 = parts[2];
            if (p3.endsWith('구') || p3.endsWith('시') || p3.endsWith('군') ||
                p3.endsWith('읍') || p3.endsWith('면') || p3.endsWith('동') ||
                p3.endsWith('로') || p3.endsWith('길')) {
                region += ` ${p3}`;
            }
        }
        return region;
    }
    return null;
}

function removeDuplicateAddresses(addresses: GeocodingResult[]): GeocodingResult[] {
    const seen = new Set<string>();
    return addresses.filter(addr => {
        if (seen.has(addr.jibun_address)) return false;
        seen.add(addr.jibun_address);
        return true;
    });
}

function sanitizePlainText(input: string): string {
    return input.replace(/<[^>]*>/g, '').trim();
}

async function geocodeAddressMultiple(name: string, address: string, maxResults: number = 3): Promise<GeocodingResult[]> {
    // Supabase Edge Function을 통해 지오코딩 (EditRestaurantModal과 동일한 방식)


    const { data, error } = await supabase.functions.invoke('naver-geocode', {
        body: { query: address, count: maxResults }
    });



    if (error) {
        console.error('❌ Edge Function 에러:', error);
        throw new Error(error.message || JSON.stringify(error));
    }

    const geocodeData = data as NaverGeocodeResponse | null;

    if (!geocodeData) {
        console.error('❌ 응답 데이터 없음');
        return [];
    }

    if (geocodeData.error) {
        console.error('❌ API 에러:', geocodeData.error);
        throw new Error(geocodeData.error);
    }

    if (!geocodeData.addresses || geocodeData.addresses.length === 0) {
        console.warn('⚠️ 주소 결과 없음');
        return [];
    }

    return (geocodeData.addresses || []).slice(0, maxResults).map((addr) => ({
        road_address: addr.roadAddress || '',
        jibun_address: addr.jibunAddress || '',
        english_address: addr.englishAddress || '',
        address_elements: addr.addressElements || null,
        x: addr.x,
        y: addr.y,
    }));
}

async function fetchYoutubeMetadata(youtubeLink: string): Promise<{
    title: string;
    publishedAt: string;
    duration: number;
    is_shorts: boolean;
    ads_info: { is_ads: boolean; what_ads: string[] | null };
} | null> {
    try {
        const response = await fetch('/api/youtube-meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ youtube_link: youtubeLink }),
        });
        if (!response.ok) throw new Error('Failed to fetch metadata');
        return await response.json();
    } catch (error) {
        console.error('YouTube metadata fetch error:', error);
        return null;
    }
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ==================== 메인 컴포넌트 ====================

export function SubmissionDetailView({
    submission,
    approvalData,
    onApprovalDataChange,
    geocodingResults,
    onGeocodingResultsChange,
    selectedGeocodingIndex,
    onSelectedGeocodingIndexChange,
    itemDecisions,
    onItemDecisionsChange,
    forceApprove,
    onForceApproveChange,
    editableData,
    onEditableDataChange,
    // 네이버 검색 검증 관련 props 추가
    naverSearchResults,
    naverSearchLoading,
    onVerifyNaverSearch,
    onGeocodingSelect,
    className,
}: SubmissionDetailViewProps) {
    const [geocodingNaver, setGeocodingNaver] = useState(false);
    const [geocodingGoogle, setGeocodingGoogle] = useState(false);
    const [fetchingMeta, setFetchingMeta] = useState<string | null>(null);
    const [initialAddress, setInitialAddress] = useState<string>('');
    const [addressChanged, setAddressChanged] = useState(false);

    const isEditSubmission = submission.submission_type === 'edit';
    const pendingItems = submission.items.filter(item => item.item_status === 'pending');
    const hasDuplicateItems = pendingItems.some(item => item.duplicate_check_result?.isDuplicate);

    useEffect(() => {
        setInitialAddress(submission.restaurant_address ?? '');
        setAddressChanged(false);
    }, [submission.id, submission.restaurant_address]);

    const handleFieldChange = (field: keyof typeof editableData, value: string | string[]) => {
        if (field === 'address') {
            const newAddress = value as string;
            if (newAddress.trim() !== initialAddress.trim()) {
                setAddressChanged(true);
                onGeocodingResultsChange([]);
                onSelectedGeocodingIndexChange(null);
            } else {
                setAddressChanged(false);
            }
        }
        onEditableDataChange({ ...editableData, [field]: value });
    };

    const handleItemDecisionChange = <K extends keyof ItemDecision>(
        itemId: string,
        field: K,
        value: ItemDecision[K]
    ) => {
        onItemDecisionsChange({
            ...itemDecisions,
            [itemId]: { ...itemDecisions[itemId], [field]: value },
        });
    };

    const handleReGeocodeNaver = async () => {
        const address = editableData.address.trim();
        const name = editableData.name.trim();
        if (!address || !name) {
            toast.error('맛집명과 주소를 입력해주세요');
            return;
        }

        setGeocodingNaver(true);
        try {
            const fullResults = await geocodeAddressMultiple(name, address, 3);
            const shortAddress = extractCityDistrictGu(address);
            const shortResults = shortAddress ? await geocodeAddressMultiple(name, shortAddress, 3) : [];
            const uniqueResults = removeDuplicateAddresses([...fullResults, ...shortResults]);

            if (uniqueResults.length > 0) {
                onGeocodingResultsChange(uniqueResults);
                setAddressChanged(false);
                setInitialAddress(address);
                toast.success(`${uniqueResults.length}개의 주소 후보를 찾았습니다`);
            } else {
                toast.error('주소를 찾을 수 없습니다');
            }
        } catch {
            toast.error('네이버 지오코딩에 실패했습니다');
        } finally {
            setGeocodingNaver(false);
        }
    };

    const handleReGeocodeGoogle = async () => {
        const address = editableData.address.trim();
        const name = editableData.name.trim();
        if (!address || !name) {
            toast.error('맛집명과 주소를 입력해주세요');
            return;
        }

        setGeocodingGoogle(true);
        try {
            const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
            const searchQuery = `${name} ${address}`;

            const results: GeocodingResult[] = await geocodeWithGoogleMapsJs(searchQuery, apiKey, 3);

            if (results.length > 0) {
                onGeocodingResultsChange(results);
                setAddressChanged(false);
                setInitialAddress(address);
                toast.success(`${results.length}개의 주소 후보를 찾았습니다`);
            } else {
                toast.error('주소를 찾을 수 없습니다');
            }
        } catch (error: unknown) {
            console.error('Google Geocoding error:', error);
            toast.error(error instanceof Error ? error.message : 'Google 지오코딩에 실패했습니다');
        } finally {
            setGeocodingGoogle(false);
        }
    };

    const handleSelectGeocodingResult = (index: number) => {
        const result = geocodingResults[index];

        // 먼저 initialAddress 업데이트 (handleFieldChange 트리거 방지)
        setInitialAddress(result.jibun_address);
        setAddressChanged(false);

        // 새로운 핸들러가 있으면 사용 (부모에서 원자적 업데이트 처리)
        if (onGeocodingSelect) {
            onGeocodingSelect(result, index);
            return;
        }

        // 기존 로직 (fallback)
        // 그 다음 선택 인덱스 업데이트
        onSelectedGeocodingIndexChange(index);
        onApprovalDataChange({
            lat: result.y,
            lng: result.x,
            road_address: result.road_address,
            jibun_address: result.jibun_address,
            english_address: result.english_address,
            address_elements: result.address_elements,
        });
        // 마지막으로 주소 필드 업데이트 (지오코딩 결과는 유지)
        onEditableDataChange({ ...editableData, address: result.jibun_address });
    };

    const handleFetchMetadata = async (itemId: string, youtubeLink: string) => {
        setFetchingMeta(itemId);
        try {
            const meta = await fetchYoutubeMetadata(youtubeLink);
            if (meta) {
                onItemDecisionsChange((prev: Record<string, ItemDecision>) => ({
                    ...prev,
                    [itemId]: {
                        ...prev[itemId],
                        metaFetched: true,
                        metaData: meta
                    },
                }));
                toast.success(`메타데이터 가져오기 완료`);
            } else {
                toast.error('메타데이터를 가져오지 못했습니다');
            }
        } catch {
            toast.error('메타데이터 가져오기 실패');
        } finally {
            setFetchingMeta(null);
        }
    };

    // 자동 메타데이터 가져오기
    useEffect(() => {
        let isMounted = true;
        const fetchAllMetadata = async () => {
            const pendingItems = submission.items.filter(item => item.item_status === 'pending');
            const updates: Record<string, Partial<ItemDecision>> = {};
            let hasUpdates = false;

            // 병렬로 메타데이터 가져오기
            await Promise.all(pendingItems.map(async (item) => {
                if (!isMounted) return;

                // 초기 상태의 decision 참조 (여기서는 youtube_link만 필요하므로 안전)
                const decision = itemDecisions[item.id];
                const link = decision?.youtube_link || item.youtube_link;

                if (decision && !decision.metaFetched && link) {
                    try {
                        const meta = await fetchYoutubeMetadata(link);
                        if (meta) {
                            updates[item.id] = {
                                metaFetched: true,
                                metaData: meta
                            };
                            hasUpdates = true;
                        }
                    } catch (e) {
                        console.error(`Failed to fetch meta for ${item.id}`, e);
                    }
                }
            }));

            if (isMounted && hasUpdates) {
                onItemDecisionsChange((prev: Record<string, ItemDecision>) => {
                    const next = { ...prev };
                    Object.entries(updates).forEach(([id, update]) => {
                        if (next[id]) {
                            next[id] = { ...next[id], ...update };
                        }
                    });
                    return next;
                });
                toast.success('메타데이터 자동 가져오기 완료');
            }
        };

        const timer = setTimeout(() => {
            fetchAllMetadata();
        }, 500);

        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [submission.id]); // itemDecisions를 의존성에 넣으면 무한 루프 가능성 있음

    // 자동 지오코딩 (주소가 있고 결과가 없을 때)
    useEffect(() => {
        const autoGeocode = async () => {
            if (editableData.address && geocodingResults.length === 0 && !geocodingNaver && !geocodingGoogle) {
                // 승인 데이터가 없을 때만 실행
                if (!approvalData.lat || !approvalData.lng) {
                    await handleReGeocodeNaver();
                }
            }
        };

        const timer = setTimeout(() => {
            autoGeocode();
        }, 100);

        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [submission.id]);

    // 지오코딩 결과 선택 시 자동으로 네이버 검색 검증 실행
    useEffect(() => {
        if (selectedGeocodingIndex !== null && geocodingResults.length > 0) {
            // 상태 업데이트가 반영될 시간을 주기 위해 약간의 지연
            const timer = setTimeout(() => {
                onVerifyNaverSearch();
            }, 200);
            return () => clearTimeout(timer);
        }
    }, [selectedGeocodingIndex, geocodingResults.length, onVerifyNaverSearch]);

    return (
        <div className={cn("overflow-y-auto", className)}>
            <div className="space-y-4 p-4">
                {/* 제보자 정보 */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground pb-2 border-b">
                    <User className="h-4 w-4" />
                    <span>{submission.profiles?.nickname || '탈퇴한 사용자'}</span>
                    <span className="mx-1">•</span>
                    <Calendar className="h-4 w-4" />
                    <span>{new Date(submission.created_at).toLocaleDateString('ko-KR')}</span>
                    <span className="mx-1">•</span>
                    <Badge variant={isEditSubmission ? "secondary" : "default"} className="text-xs">
                        {isEditSubmission ? '수정 요청' : '신규 제보'}
                    </Badge>
                </div>

                {/* 수정 요청: 기존 정보 vs 사용자 제출 정보 비교 (이름, 전화, 주소, 카테고리만) */}
                {isEditSubmission && submission.original_restaurant_data && (
                    <div className="rounded-lg border overflow-hidden">
                        <div className="grid grid-cols-2 divide-x">
                            {/* 기존 정보 */}
                            <div className="p-3 bg-gray-50/50 dark:bg-gray-900/20">
                                <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                                    📋 기존 등록 정보
                                </p>
                                <div className="space-y-1.5 text-xs">
                                    <p><span className="text-muted-foreground">이름:</span> <span className="font-medium">{submission.original_restaurant_data.name || '-'}</span></p>
                                    <p><span className="text-muted-foreground">전화:</span> {submission.original_restaurant_data.phone || '-'}</p>
                                    <p><span className="text-muted-foreground">주소:</span> {submission.original_restaurant_data.road_address || submission.original_restaurant_data.jibun_address || '-'}</p>
                                    <p><span className="text-muted-foreground">카테고리:</span> {formatCategoryText(submission.original_restaurant_data.categories, '-')}</p>
                                </div>
                            </div>
                            {/* 사용자 제출 정보 */}
                            <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20">
                                <p className="text-xs font-semibold text-blue-600 mb-2 flex items-center gap-1">
                                    ✏️ 사용자 제출 정보
                                </p>
                                <div className="space-y-1.5 text-xs">
                                    <p><span className="text-muted-foreground">이름:</span> <span className="font-medium">{submission.restaurant_name || '-'}</span></p>
                                    <p><span className="text-muted-foreground">전화:</span> {submission.restaurant_phone || '-'}</p>
                                    <p><span className="text-muted-foreground">주소:</span> {submission.restaurant_address || '-'}</p>
                                    <p><span className="text-muted-foreground">카테고리:</span> {formatCategoryText(submission.restaurant_categories, '-')}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 레스토랑 이름 */}
                <div className="space-y-1">
                    <Label htmlFor="edit-name" className="text-sm">레스토랑 이름</Label>
                    <Input
                        id="edit-name"
                        value={editableData.name}
                        onChange={(e) => handleFieldChange('name', e.target.value)}
                        placeholder="예: 홍대 떡볶이"
                    />
                </div>

                {/* 주소 + 지오코딩 버튼 */}
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="edit-address" className="text-sm">주소</Label>
                        <div className="flex gap-1">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={handleReGeocodeNaver}
                                disabled={geocodingNaver || geocodingGoogle || !editableData.address.trim()}
                                className="h-7 text-xs"
                            >
                                {geocodingNaver ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                                네이버 지오코딩
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={handleReGeocodeGoogle}
                                disabled={geocodingNaver || geocodingGoogle || !editableData.address.trim()}
                                className="h-7 text-xs"
                            >
                                {geocodingGoogle ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                                Google 지오코딩
                            </Button>
                        </div>
                    </div>
                    <Textarea
                        id="edit-address"
                        value={editableData.address}
                        onChange={(e) => handleFieldChange('address', e.target.value)}
                        placeholder="예: 서울특별시 마포구 양화로 160"
                        rows={2}
                        className="resize-none"
                    />
                    {addressChanged && (
                        <p className="text-xs text-amber-600">⚠️ 주소가 변경되었습니다. 재지오코딩을 해주세요.</p>
                    )}
                </div>

                {/* 지오코딩 결과 목록 */}
                {geocodingResults.length > 0 && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Label className="text-sm">지오코딩 결과 ({geocodingResults.length}개)</Label>
                            <Badge variant="default" className="bg-green-600 text-xs">성공</Badge>
                        </div>
                            <div className="space-y-1">
                                {geocodingResults.map((result, index) => (
                                <button
                                    type="button"
                                    key={index}
                                    onClick={() => handleSelectGeocodingResult(index)}
                                    className={cn(
                                        "w-full text-left p-2 rounded-lg border-2 cursor-pointer transition-all text-sm",
                                        selectedGeocodingIndex === index
                                            ? 'border-primary bg-primary/5'
                                            : 'border-gray-200 hover:border-gray-300'
                                    )}
                                    aria-label={`지오코딩 옵션 ${index + 1} 선택`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant={selectedGeocodingIndex === index ? 'default' : 'outline'} className="text-xs">
                                            옵션 {index + 1}
                                        </Badge>
                                        {selectedGeocodingIndex === index && (
                                            <Badge variant="default" className="bg-green-600 text-xs">선택됨</Badge>
                                        )}
                                    </div>
                                    <p className="text-xs"><span className="text-muted-foreground">도로명:</span> {result.road_address}</p>
                                    <p className="text-xs"><span className="text-muted-foreground">지번:</span> {result.jibun_address}</p>
                                    <p className="text-xs"><span className="text-muted-foreground">좌표:</span> {result.y}, {result.x}</p>
                                </button>
                            ))}
                        </div>
                        {selectedGeocodingIndex === null && (
                            <p className="text-xs text-muted-foreground text-center">⬆️ 위 옵션 중 하나를 클릭해서 선택해주세요</p>
                        )}
                    </div>
                )}

                {/* 네이버 검색 검증 (지오코딩 선택 후 활성화) */}
                <div className="space-y-2 pt-2 border-t">
                    <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold flex items-center gap-1">
                            <span className="text-green-600">N</span> 네이버 검색 검증
                        </Label>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onVerifyNaverSearch}
                            disabled={naverSearchLoading || selectedGeocodingIndex === null}
                            className="h-6 text-xs"
                        >
                            {naverSearchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                            검증 실행
                        </Button>
                    </div>

                    {selectedGeocodingIndex === null ? (
                        <div className="text-xs text-muted-foreground p-2 border rounded-md bg-gray-50 text-center">
                            지오코딩 결과를 선택하면 검증이 가능합니다.
                        </div>
                    ) : naverSearchResults.length > 0 ? (
                        <div className="border rounded-md p-2 bg-gray-50 space-y-2">
                            {naverSearchResults.map((result, idx) => (
                                <div key={idx} className={cn(
                                    "text-xs p-2 rounded border flex justify-between items-start",
                                    result.isMatch ? "bg-green-50 border-green-200" : "bg-white border-gray-200"
                                )}>
                                    <div>
                                        <p className="font-medium text-gray-900">{sanitizePlainText(result.title)}</p>
                                        <p className="text-gray-500 mt-0.5">{result.address}</p>
                                        {result.roadAddress && <p className="text-gray-400 text-[10px]">{result.roadAddress}</p>}
                                    </div>
                                    {result.isMatch ? (
                                        <Badge variant="default" className="bg-green-600 text-[10px] shrink-0">주소 일치</Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-gray-500 text-[10px] shrink-0">불일치</Badge>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-xs text-muted-foreground p-2 border rounded-md bg-gray-50 text-center">
                            {naverSearchLoading ? "검색 중..." : "검증이 필요합니다. 검증 실행 버튼을 눌러주세요."}
                        </div>
                    )}
                </div>

                {/* 전화번호 */}
                <div className="space-y-1">
                    <Label htmlFor="edit-phone" className="text-sm">전화번호</Label>
                    <Input
                        id="edit-phone"
                        value={editableData.phone}
                        onChange={(e) => handleFieldChange('phone', e.target.value)}
                        placeholder="예: 02-1234-5678"
                    />
                </div>

                {/* 카테고리 */}
                <div className="space-y-2">
                    <Label className="text-sm">카테고리 (여러 개 선택 가능)</Label>
                    {editableData.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {editableData.categories.map((cat) => (
                                <Badge key={cat} variant="secondary" className="gap-1 px-2 py-1">
                                    {cat}
                                    <X
                                        className="h-3.5 w-3.5 cursor-pointer hover:text-destructive"
                                        onClick={() => handleFieldChange('categories', editableData.categories.filter(c => c !== cat))}
                                    />
                                </Badge>
                            ))}
                        </div>
                    )}
                    <div className="border rounded-lg p-3 max-h-40 overflow-y-auto">
                        <div className="grid grid-cols-2 gap-2">
                            {RESTAURANT_CATEGORIES.map((category) => (
                                <div key={category} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`cat-${category}`}
                                        checked={editableData.categories.includes(category)}
                                        onCheckedChange={(checked) => {
                                            if (checked) {
                                                handleFieldChange('categories', [...editableData.categories, category]);
                                            } else {
                                                handleFieldChange('categories', editableData.categories.filter(c => c !== category));
                                            }
                                        }}
                                        className="h-4 w-4"
                                    />
                                    <label htmlFor={`cat-${category}`} className="text-sm cursor-pointer">{category}</label>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 제보 항목 */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Youtube className="h-4 w-4 text-red-500" />
                        <Label className="text-sm">제보 항목</Label>
                        <Badge variant="outline" className="text-xs">
                            {submission.items.length}개 중{' '}
                            <span className="font-bold text-primary ml-1">
                                {Object.values(itemDecisions).filter(d => d.approved).length}개
                            </span>{' '}
                            선택
                        </Badge>
                    </div>

                    {submission.items.map((item) => {
                        const videoId = getYoutubeVideoId(itemDecisions[item.id]?.youtube_link || item.youtube_link);
                        const decision = itemDecisions[item.id];
                        const isPending = item.item_status === 'pending';
                        const metaData = decision?.metaData;
                        const isSelected = decision?.approved;

                        return (
                            <div
                                key={item.id}
                                className={cn(
                                    "border rounded-lg p-3",
                                    isSelected && "border-green-500 bg-green-50/50",
                                    item.item_status === 'approved' && "border-green-300 bg-green-50/50",
                                    item.item_status === 'rejected' && "border-red-300 bg-red-50/50"
                                )}
                            >
                                {/* 헤더: 선택박스 + 메타데이터 버튼 + 상태 뱃지 */}
                                <div className="flex items-center justify-between mb-2">
                                    {/* 왼쪽: 선택 박스 + 메타데이터 버튼 */}
                                    <div className="flex items-center gap-2">
                                        {/* 선택 박스 (체크박스 + 텍스트 함께) - 대기 중 항목만 */}
                                        {isPending && decision && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleItemDecisionChange(item.id, 'approved', !decision.approved);
                                                }}
                                                className={cn(
                                                    "flex items-center gap-1.5 px-2 py-1 rounded border-2 cursor-pointer transition-colors",
                                                    decision.approved
                                                        ? "border-green-500 bg-green-50"
                                                        : "border-gray-300 bg-white hover:border-gray-400"
                                                )}
                                                aria-label={`항목 ${item.id} 선택`}
                                            >
                                                <div className={cn(
                                                    "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0",
                                                    decision.approved
                                                        ? "border-green-500 bg-green-500"
                                                        : "border-gray-400 bg-white"
                                                )}>
                                                    {decision.approved && <Check className="h-3 w-3 text-white" />}
                                                </div>
                                                <span className={cn(
                                                    "text-xs font-medium",
                                                    decision.approved ? "text-green-700" : "text-gray-600"
                                                )}>
                                                    선택
                                                </span>
                                            </button>
                                        )}

                                        {/* 메타데이터 가져오기 버튼 - 빨간색 */}
                                        <Button
                                            variant={decision?.metaFetched ? "default" : "destructive"}
                                            size="sm"
                                            className={cn(
                                                "h-7 px-3 text-xs",
                                                decision?.metaFetched && "bg-green-600 hover:bg-green-700"
                                            )}
                                            onClick={() => handleFetchMetadata(item.id, decision?.youtube_link || item.youtube_link)}
                                            disabled={fetchingMeta === item.id}
                                        >
                                            {fetchingMeta === item.id ? (
                                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                            ) : decision?.metaFetched ? (
                                                <Check className="h-3 w-3 mr-1" />
                                            ) : (
                                                <Sparkles className="h-3 w-3 mr-1" />
                                            )}
                                            {decision?.metaFetched ? '메타 완료' : '메타데이터 가져오기'}
                                        </Button>
                                    </div>

                                    {/* 오른쪽: 상태 뱃지 + 기타 뱃지들 */}
                                    <div className="flex items-center gap-2">
                                        {item.duplicate_check_result?.isDuplicate && (
                                            <Badge variant="destructive" className="text-xs">
                                                <AlertTriangle className="h-3 w-3 mr-1" />중복
                                            </Badge>
                                        )}
                                        <Badge variant={
                                            item.item_status === 'pending' ? 'secondary' :
                                                item.item_status === 'approved' ? 'default' : 'destructive'
                                        } className="text-xs">
                                            {item.item_status === 'pending' ? '대기' :
                                                item.item_status === 'approved' ? '승인' : '반려'}
                                        </Badge>
                                    </div>
                                </div>

                                {/* 사용자 제출 섹션 (썸네일 + 메타데이터 + 입력 필드) */}
                                <div className="border rounded-lg p-3 bg-white">
                                    {/* 사용자 제출 헤더 */}
                                    <p className="text-sm font-semibold text-gray-800 mb-2 border-b pb-1">사용자 제출</p>

                                    {/* YouTube 썸네일 + 메타데이터 */}
                                    <div className="flex gap-3 mb-3">
                                        {videoId && (
                                            <a
                                                href={decision?.youtube_link || item.youtube_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-shrink-0"
                                            >
                                                <Image
                                                    src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                                                    alt="YouTube thumbnail"
                                                    width={128}
                                                    height={80}
                                                    unoptimized
                                                    className="w-32 h-20 object-cover rounded hover:opacity-80 transition-opacity"
                                                />
                                            </a>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            {metaData ? (
                                                <div className="text-xs space-y-1">
                                                    <p className="font-medium line-clamp-2">{metaData.title}</p>
                                                    <p className="text-muted-foreground">
                                                        {new Date(metaData.publishedAt).toLocaleDateString('ko-KR')} · {formatDuration(metaData.duration)}
                                                        {metaData.is_shorts && <Badge variant="outline" className="ml-1 text-[10px]">Shorts</Badge>}
                                                    </p>
                                                    <div className="flex items-center gap-1">
                                                        {metaData.ads_info.is_ads ? (
                                                            <>
                                                                <Badge variant="destructive" className="text-[10px]">광고</Badge>
                                                                {metaData.ads_info.what_ads && metaData.ads_info.what_ads.length > 0 && (
                                                                    <span className="text-muted-foreground">({metaData.ads_info.what_ads.join(', ')})</span>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <Badge variant="secondary" className="text-[10px]">광고 아님</Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-muted-foreground">메타데이터를 가져와주세요</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* YouTube 링크 (관리자 수정) */}
                                    <div className="space-y-1">
                                        <Label className="text-xs">YouTube 링크 (관리자 수정 가능)</Label>
                                        <Input
                                            value={decision?.youtube_link || item.youtube_link}
                                            onChange={(e) => handleItemDecisionChange(item.id, 'youtube_link', e.target.value)}
                                            placeholder="YouTube URL"
                                            className="text-xs h-8"
                                        />
                                    </div>

                                    {/* 쯔양 리뷰 (관리자 수정) */}
                                    <div className="space-y-1 mt-2">
                                        <Label className="text-xs">쯔양 리뷰 (관리자 수정 가능)</Label>
                                        <Textarea
                                            value={decision?.tzuyang_review ?? item.tzuyang_review ?? ''}
                                            onChange={(e) => handleItemDecisionChange(item.id, 'tzuyang_review', e.target.value)}
                                            placeholder="리뷰 내용을 입력하세요"
                                            rows={3}
                                            className="text-xs resize-none"
                                        />
                                    </div>
                                </div>

                                {/* EDIT 타입: 기존 데이터 섹션 (아이템별 target_restaurant_id로 매칭) */}
                                {isEditSubmission && item.original_restaurant && (
                                    <div className="border rounded-lg p-3 bg-gray-50 mt-2">
                                        {/* 기존 데이터 헤더 */}
                                        <p className="text-sm font-semibold text-gray-800 mb-2 border-b pb-1">기존 데이터</p>

                                        {/* 기존 YouTube 썸네일 + 메타데이터 */}
                                        {(() => {
                                            const originalVideoId = getYoutubeVideoId(item.original_restaurant?.youtube_link || undefined);
                                            const originalMeta = item.original_restaurant?.youtube_meta;
                                            return (
                                                <div className="flex gap-3 mb-3">
                                                    {originalVideoId && (
                                                        <a
                                                            href={item.original_restaurant?.youtube_link || ''}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex-shrink-0"
                                                        >
                                                            <Image
                                                                src={`https://img.youtube.com/vi/${originalVideoId}/mqdefault.jpg`}
                                                                alt="기존 YouTube thumbnail"
                                                                width={128}
                                                                height={80}
                                                                unoptimized
                                                                className="w-32 h-20 object-cover rounded hover:opacity-80 transition-opacity border"
                                                            />
                                                        </a>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        {originalMeta ? (
                                                            <div className="text-xs space-y-1">
                                                                <p className="font-medium line-clamp-2">{originalMeta.title || '제목 없음'}</p>
                                                                <p className="text-muted-foreground">
                                                                    {originalMeta.published_at ? new Date(originalMeta.published_at).toLocaleDateString('ko-KR') : '-'}
                                                                    {originalMeta.duration && ` · ${formatDuration(originalMeta.duration)}`}
                                                                    {originalMeta.is_shorts && <Badge variant="outline" className="ml-1 text-[10px]">Shorts</Badge>}
                                                                </p>
                                                                <div className="flex items-center gap-1">
                                                                    {originalMeta.is_ads ? (
                                                                        <>
                                                                            <Badge variant="destructive" className="text-[10px]">광고</Badge>
                                                                            {originalMeta.what_ads && originalMeta.what_ads.length > 0 && (
                                                                                <span className="text-muted-foreground">({originalMeta.what_ads.join(', ')})</span>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        <Badge variant="secondary" className="text-[10px]">광고 아님</Badge>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div>
                                                                <p className="text-xs text-gray-500 mb-1">기존 등록된 영상</p>
                                                                {item.original_restaurant?.youtube_link ? (
                                                                    <a
                                                                        href={item.original_restaurant.youtube_link}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="text-blue-500 hover:underline text-xs break-all"
                                                                    >
                                                                        {item.original_restaurant.youtube_link}
                                                                    </a>
                                                                ) : <span className="text-gray-400 text-xs">기존 YouTube 링크 없음</span>}
                                                                <p className="text-[10px] text-gray-400 mt-1">메타데이터 없음</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* 기존 쯔양 리뷰 */}
                                        <div className="space-y-1">
                                            <Label className="text-xs text-gray-600">기존 쯔양 리뷰</Label>
                                            <div className="bg-white rounded p-2 text-xs whitespace-pre-wrap min-h-[40px] border">
                                                {item.original_restaurant?.tzuyang_review || '-'}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 반려 사유 입력 (선택 안 됨 + 대기 중) - 빨간 박스 */}
                                {isPending && decision && !decision.approved && (
                                    <div className="border-2 border-red-300 rounded-lg p-2 bg-red-50/50 mt-2">
                                        <Label className="text-xs text-red-600 font-medium mb-1 block">
                                            ⚠️ 반려 사유 (필수 입력)
                                        </Label>
                                        <Input
                                            placeholder="반려 사유를 입력해주세요"
                                            value={decision.rejectionReason}
                                            onChange={(e) =>
                                                handleItemDecisionChange(item.id, 'rejectionReason', e.target.value)
                                            }
                                            className="text-xs h-8 border-red-300 focus:border-red-500"
                                        />
                                    </div>
                                )}

                                {/* 중복 경고 */}
                                {item.duplicate_check_result?.isDuplicate && (
                                    <div className="bg-red-50 border border-red-200 rounded p-2 mt-2 text-xs text-red-600">
                                        <strong>중복 감지:</strong> {item.duplicate_check_result.existingRestaurantName}
                                        {item.duplicate_check_result.matchedYoutubeUrl && (
                                            <p className="mt-1 truncate">기존 URL: {item.duplicate_check_result.matchedYoutubeUrl}</p>
                                        )}
                                    </div>
                                )}

                                {/* 반려된 항목 사유 표시 */}
                                {item.item_status === 'rejected' && item.rejection_reason && (
                                    <div className="text-xs text-red-500 mt-2">반려 사유: {item.rejection_reason}</div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* 중복 강제 승인 옵션 */}
                {hasDuplicateItems && (
                    <div className="rounded-lg p-2 bg-amber-50/50 border border-amber-200">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="force-approve"
                                checked={forceApprove}
                                onCheckedChange={(checked) => onForceApproveChange(checked as boolean)}
                                className="h-4 w-4"
                            />
                            <Label htmlFor="force-approve" className="text-sm text-amber-700">
                                중복 항목 강제 승인 (주의: 중복 데이터가 생성됩니다)
                            </Label>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default SubmissionDetailView;
