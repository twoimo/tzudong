'use client';

import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
    MapPin,
    Youtube,
    Search,
    X,
    ChevronRight,
    Users,
    Clock,
    RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '@/lib/open-external-url';
import { useNaverMaps } from '@/hooks/use-naver-maps';
import { useYoutuberRestaurants, useYoutuberList, type YoutuberRestaurant } from '@/hooks/use-youtuber-restaurants';

// [TYPE] 맛집 마커 데이터 타입
interface RestaurantMarker {
    id: string;
    name: string;
    address: string;
    category: string;
    lat: number;
    lng: number;
    source: 'user_report' | 'other_youtuber';

    // 타 유튜버 정보
    youtuberName?: string;
    youtuberChannel?: string;
    videoTitle?: string;

    // 제보 공통 정보
    phone?: string;
    description?: string; // 쯔양 리뷰 또는 추천 이유
    youtubeUrl?: string; // 제보된 영상 링크
    submitterNickname?: string; // 제보자명 (선택)

    // 통계 (사용자 제보)
    reportCount?: number;
    reportedAt?: string;

    // 추가 메타 (실제 데이터)
    confidence?: string;
    addressSource?: string;
}

type NaverMapLike = {
    panTo: (target: unknown, options?: unknown) => void;
    getCenter: () => unknown;
    setCenter: (target: unknown) => void;
};

type NaverMarkerLike = {
    setMap: (map: unknown) => void;
};

// [HELPER] YoutuberRestaurant를 RestaurantMarker로 변환
function convertToMarker(restaurant: YoutuberRestaurant): RestaurantMarker | null {
    // 좌표가 없으면 null 반환
    if (!restaurant.lat || !restaurant.lng) return null;

    return {
        id: restaurant.id,
        name: restaurant.name,
        address: restaurant.road_address || restaurant.origin_address || '주소 정보 없음',
        category: restaurant.categories?.[0] || '기타',
        lat: restaurant.lat,
        lng: restaurant.lng,
        source: 'other_youtuber',
        youtuberName: restaurant.youtuber_name,
        youtuberChannel: restaurant.youtuber_channel || undefined,
        videoTitle: restaurant.youtube_meta?.title || undefined,
        phone: restaurant.phone || undefined,
        description: restaurant.youtuber_review || restaurant.tzuyang_review || undefined,
        youtubeUrl: restaurant.youtube_link || undefined,
        reportedAt: restaurant.created_at?.split('T')[0],
        confidence: restaurant.confidence,
        addressSource: restaurant.address_source || undefined,
    };
}

// [MOCK] 사용자 제보 맛집 데이터 (목업 - 실제 서비스 시 제거)
const MOCK_USER_REPORTS: RestaurantMarker[] = [
    {
        id: 'mock_ur1',
        name: '원조 청진동 해장국',
        address: '서울 종로구 종로3길 32',
        category: '한식',
        lat: 37.5703,
        lng: 126.9847,
        source: 'user_report',
        reportCount: 15,
        reportedAt: '2025-12-10',
        phone: '02-1234-5678',
        description: '쯔양님이 예전에 다녀가셨던 곳입니다! 해장국 국물이 정말 끝내줘요.',
        youtubeUrl: 'https://youtube.com/watch?v=example_user1',
        submitterNickname: '해장국매니아',
    },
    {
        id: 'mock_ur2',
        name: '황소곱창',
        address: '서울 마포구 와우산로 112',
        category: '곱창/막창',
        lat: 37.5546,
        lng: 126.9236,
        source: 'user_report',
        reportCount: 8,
        reportedAt: '2025-12-08',
        description: '여기는 진짜 숨겨진 맛집이에요. 곱이 가득 차 있어서 쯔양님이 꼭 드셔보셨으면 좋겠어요!',
        submitterNickname: '곱창러버',
    },
];

// [CONFIG] 목업 데이터 사용 여부 (실제 서비스 시 false로 변경)
const USE_MOCK_DATA = false;

// [COMPONENT] 맛집 리스트 아이템
const RestaurantListItem = memo(({
    marker,
    isSelected,
    onClick
}: {
    marker: RestaurantMarker;
    isSelected: boolean;
    onClick: () => void;
}) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={isSelected}
        aria-label={`${marker.name} 상세 보기`}
        className={cn(
            "group w-full p-3 rounded-lg cursor-pointer transition-all duration-200 border text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isSelected
                ? "bg-primary/10 border-primary shadow-sm"
                : "bg-card hover:bg-accent/50 border-border/50 hover:border-border"
        )}
    >
        <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 w-full overflow-hidden">
                    <h4 title={marker.name} className="font-medium text-sm flex-1 overflow-hidden text-ellipsis whitespace-nowrap group-hover:text-primary transition-colors">{marker.name}</h4>
                    <Badge variant="secondary" className="text-[10px] px-1.5 h-5 shrink-0 whitespace-nowrap font-normal bg-secondary/50 text-secondary-foreground">
                        {marker.category}
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate group-hover:text-foreground/80 transition-colors">{marker.address}</p>
                {marker.source === 'user_report' ? (
                    <div className="flex items-center gap-2 mt-2 text-xs">
                        <Badge variant="outline" className="text-[10px] px-1.5 h-5 bg-blue-50/50 text-blue-700 border-blue-200 font-normal">
                            <Users className="h-3 w-3 mr-1" />
                            {marker.reportCount}명 제보
                        </Badge>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 mt-2 text-xs">
                        <Badge variant="outline" className="text-[10px] px-1.5 h-5 bg-red-50/50 text-red-700 border-red-200 font-normal">
                            <Youtube className="h-3 w-3 mr-1" />
                            {marker.youtuberName}
                        </Badge>
                    </div>
                )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
        </div>
    </button>
));
RestaurantListItem.displayName = 'RestaurantListItem';

// [COMPONENT] 상세 패널
const DetailPanel = memo(({
    marker,
    onClose
}: {
    marker: RestaurantMarker | null;
    onClose: () => void;
}) => {
    if (!marker) return null;

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-start justify-between p-4 border-b gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <h3 title={marker.name} className="font-semibold text-lg truncate">{marker.name}</h3>
                    <Badge variant="secondary" className="text-xs shrink-0">{marker.category}</Badge>
                </div>
                <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="상세 패널 닫기">
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                    {/* 기본 정보 */}
                    <div className="space-y-2">
                        <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                            <span className="text-sm">{marker.address}</span>
                        </div>
                    </div>

                    <Separator />

                    {/* 사용자 제보인 경우 */}
                    {marker.source === 'user_report' && (
                        <div className="space-y-4">
                            {/* 부가 정보 (전화번호) */}
                            {marker.phone && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 p-2 rounded">
                                    <span className="text-xs font-semibold">전화번호</span>
                                    <span>{marker.phone}</span>
                                </div>
                            )}

                            {/* 제보/추천 사유 */}
                            <div className="space-y-2">
                                <h4 className="font-medium text-sm flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Users className="h-4 w-4 text-blue-500" />
                                        <span>제보 내용</span>
                                    </div>
                                    {marker.submitterNickname && (
                                        <Badge variant="outline" className="text-xs font-normal">
                                            제보자: {marker.submitterNickname}
                                        </Badge>
                                    )}
                                </h4>
                                <div className="p-3 bg-muted/50 rounded-lg text-sm leading-relaxed whitespace-pre-wrap">
                                    {marker.description || "제보 내용이 없습니다."}
                                </div>
                            </div>

                            {/* 영상 링크가 있는 경우 */}
                            {marker.youtubeUrl && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full border-red-200 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => openExternalUrl(marker.youtubeUrl)}
                                >
                                    <Youtube className="h-4 w-4 mr-2 text-red-500" />
                                    관련 영상 보기
                                </Button>
                            )}

                            {/* 제보 통계 */}
                            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                                <span>총 {marker.reportCount}명 제보</span>
                                <span className="text-muted-foreground/50">|</span>
                                <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    <span>최근: {marker.reportedAt}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 타 유튜버 맛집인 경우 */}
                    {marker.source === 'other_youtuber' && (
                        <div className="space-y-3">
                            <h4 className="font-medium text-sm flex items-center gap-2">
                                <Youtube className="h-4 w-4 text-red-500" />
                                영상 정보
                            </h4>
                            <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                                <p className="text-sm font-medium">{marker.videoTitle || '영상 제목 없음'}</p>
                                <p className="text-xs text-muted-foreground">
                                    {marker.youtuberName} {marker.youtuberChannel && `(${marker.youtuberChannel})`}
                                </p>
                            </div>

                            {/* 유튜버 리뷰/설명 */}
                            {marker.description && (
                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm">유튜버 리뷰</h4>
                                    <div className="p-3 bg-muted/50 rounded-lg text-sm leading-relaxed whitespace-pre-wrap">
                                        {marker.description}
                                    </div>
                                </div>
                            )}

                            {marker.youtubeUrl && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full border-red-200 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => openExternalUrl(marker.youtubeUrl)}
                                >
                                    <Youtube className="h-4 w-4 mr-2 text-red-500" />
                                    유튜브에서 보기
                                </Button>
                            )}

                            {/* 데이터 신뢰도 표시 */}
                            {marker.confidence && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                                    <Badge
                                        variant="outline"
                                        className={cn(
                                            "text-xs",
                                            marker.confidence === 'high' && "border-green-300 text-green-700",
                                            marker.confidence === 'medium' && "border-yellow-300 text-yellow-700",
                                            marker.confidence === 'low' && "border-red-300 text-red-700"
                                        )}
                                    >
                                        신뢰도: {marker.confidence}
                                    </Badge>
                                    {marker.addressSource && (
                                        <span className="text-muted-foreground/70">
                                            출처: {marker.addressSource}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <Separator />

                    {/* 액션 버튼 */}
                    <div className="space-y-2">
                        <Button variant="default" size="sm" className="w-full">
                            <MapPin className="h-4 w-4 mr-2" />
                            네이버 지도에서 보기
                        </Button>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
});
DetailPanel.displayName = 'DetailPanel';

// [COMPONENT] 네이버 지도 뷰
const NaverMapView = memo(({ markers, onMarkerClick, selectedMarkerId, isPanelOpen }: {
    markers: RestaurantMarker[];
    onMarkerClick: (marker: RestaurantMarker) => void;
    selectedMarkerId: string | null;
    isPanelOpen: boolean;
}) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<NaverMapLike | null>(null);
    const markersRef = useRef<NaverMarkerLike[]>([]);
    const selectedMarkerRef = useRef<RestaurantMarker | null>(null);
    const { isLoaded, isLoading, loadError, load } = useNaverMaps({ autoLoad: true });

    // 지도 중심 이동 함수 (단순 이동)
    const updateCenter = useCallback((targetMarker: RestaurantMarker) => {
        const map = mapInstanceRef.current;
        if (!map || !window.naver?.maps) return;

        const { naver } = window;
        const targetLatLng = new naver.maps.LatLng(targetMarker.lat, targetMarker.lng);
        map.panTo(targetLatLng, { duration: 300, easing: 'easeOutCubic' });
    }, []);

    // 지도 초기화
    useEffect(() => {
        if (!isLoaded || !mapRef.current || !window.naver?.maps) return;

        const { naver } = window;

        // 서울 중심 좌표
        const center = new naver.maps.LatLng(37.5665, 126.9780);

        const map = new naver.maps.Map(mapRef.current, {
            center,
            zoom: 12,
            minZoom: 8,
            maxZoom: 19,
            zoomControl: true,
            zoomControlOptions: {
                position: naver.maps.Position.TOP_RIGHT,
            },
        });

        mapInstanceRef.current = map;

        return () => {
            markersRef.current.forEach(marker => marker.setMap(null));
            markersRef.current = [];
        };
    }, [isLoaded]);

    // Resizing Observer - 컨테이너 크기 변경 감지 및 지도 리사이즈
    useEffect(() => {
        if (!mapRef.current || !mapInstanceRef.current || !window.naver?.maps) return;

        const map = mapInstanceRef.current;
        const { naver } = window;

        const resizeObserver = new ResizeObserver(() => {
            // 현재 중심 좌표 저장
            const center = map.getCenter();

            // 지도 사이즈 업데이트
            naver.maps.Event.trigger(map, 'resize');

            // 중심 복구 (선택된 마커가 있으면 그 위치로, 없으면 기존 중심 유지)
            if (selectedMarkerRef.current) {
                map.setCenter(new naver.maps.LatLng(selectedMarkerRef.current.lat, selectedMarkerRef.current.lng));
            } else {
                map.setCenter(center);
            }
        });

        resizeObserver.observe(mapRef.current);

        return () => resizeObserver.disconnect();
    }, [isLoaded]);

    // 패널 상태 변경 시 지연 리사이즈 (CSS transition 대응)
    useEffect(() => {
        if (!mapInstanceRef.current || !window.naver?.maps) return;
        const map = mapInstanceRef.current;
        const { naver } = window;

        const timer = setTimeout(() => {
            naver.maps.Event.trigger(map, 'resize');

            // 애니메이션이 끝난 후, 선택된 마커가 있다면 확실하게 중심 이동
            if (selectedMarkerRef.current) {
                updateCenter(selectedMarkerRef.current);
            }
        }, 320); // transition duration(300ms) + buffer

        return () => clearTimeout(timer);
    }, [isPanelOpen, updateCenter]);

    // 마커 업데이트
    useEffect(() => {
        if (!mapInstanceRef.current || !window.naver?.maps) return;

        const { naver } = window;
        const map = mapInstanceRef.current;

        // 기존 마커 제거
        markersRef.current.forEach(marker => marker.setMap(null));
        markersRef.current = [];

        // 새 마커 추가
        markers.forEach((markerData) => {
            const isSelected = selectedMarkerId === markerData.id;
            const isUserReport = markerData.source === 'user_report';

            const marker = new naver.maps.Marker({
                position: new naver.maps.LatLng(markerData.lat, markerData.lng),
                map,
                icon: {
                    content: `
                        <div style="
                            width: ${isSelected ? '36px' : '28px'};
                            height: ${isSelected ? '36px' : '28px'};
                            background-color: ${isUserReport ? '#3b82f6' : '#ef4444'};
                            border-radius: 50%;
                            border: 2px solid white;
                            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            transition: all 0.2s;
                            cursor: pointer;
                        ">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2">
                                ${isUserReport
                            ? '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
                            : '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>'
                        }
                            </svg>
                        </div>
                    `,
                    anchor: new naver.maps.Point(isSelected ? 18 : 14, isSelected ? 18 : 14),
                },
            });

            naver.maps.Event.addListener(marker, 'click', () => {
                onMarkerClick(markerData);
            });

            markersRef.current.push(marker);
        });

    }, [markers, selectedMarkerId, onMarkerClick, isLoaded]);

    // 선택된 마커 변경 시 ref 업데이트 및 중심 이동
    useEffect(() => {
        if (selectedMarkerId) {
            const selected = markers.find(m => m.id === selectedMarkerId);
            if (selected) {
                selectedMarkerRef.current = selected;
                // 패널이 이미 열려있는 상태에서의 클릭은 즉시 이동
                if (isPanelOpen) {
                    updateCenter(selected);
                }
                // 패널이 닫혀있다가 열리는 경우는 위쪽 useEffect가 처리 (시간차 resize 후 이동)
            }
        } else {
            selectedMarkerRef.current = null;
        }
    }, [selectedMarkerId, markers, updateCenter, isPanelOpen]);

    // 로딩 중
    if (isLoading) {
        return (
            <div className="h-full w-full bg-muted/30 rounded-lg flex items-center justify-center">
                <div className="text-center">
                    <div className="h-8 w-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">지도 로딩 중...</p>
                </div>
            </div>
        );
    }

    // 로드 에러
    if (loadError) {
        return (
            <div className="h-full w-full bg-muted/30 rounded-lg flex items-center justify-center">
                <div className="text-center">
                    <MapPin className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">지도를 불러올 수 없습니다</p>
                    <p className="text-xs text-muted-foreground mt-1">{loadError.message}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={load}>
                        다시 시도
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div ref={mapRef} className="h-full w-full rounded-lg overflow-hidden" />
    );
});
NaverMapView.displayName = 'NaverMapView';

// [MAIN] 맵 섹션 메인 컴포넌트
const MapSectionComponent = () => {
    const [viewMode, setViewMode] = useState<'all' | 'user_report' | 'other_youtuber'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMarker, setSelectedMarker] = useState<RestaurantMarker | null>(null);
    const [selectedYoutuber, setSelectedYoutuber] = useState<string>('all');

    // [DATA] 유튜버 맛집 데이터 가져오기
    const {
        restaurants: youtuberRestaurants,
        isLoading,
        error,
        refetch
    } = useYoutuberRestaurants({
        youtuberName: selectedYoutuber !== 'all' ? selectedYoutuber : undefined,
        onlyWithCoordinates: true
    });

    // [DATA] 유튜버 목록 가져오기
    const { youtubers } = useYoutuberList();

    // [OPTIMIZATION] 필터링된 마커 메모이제이션
    const filteredMarkers = useMemo(() => {
        // 유튜버 맛집 데이터를 마커로 변환
        const youtuberMarkers: RestaurantMarker[] = youtuberRestaurants
            .map(convertToMarker)
            .filter((m): m is RestaurantMarker => m !== null);

        // 목업 데이터 (USE_MOCK_DATA가 true일 때만)
        const mockMarkers = USE_MOCK_DATA ? MOCK_USER_REPORTS : [];

        const allMarkers = [...mockMarkers, ...youtuberMarkers];

        let filtered = allMarkers;

        // 뷰 모드 필터
        if (viewMode === 'user_report') {
            filtered = filtered.filter(m => m.source === 'user_report');
        } else if (viewMode === 'other_youtuber') {
            filtered = filtered.filter(m => m.source === 'other_youtuber');
        }

        // 검색 필터
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(m =>
                m.name.toLowerCase().includes(query) ||
                m.address.toLowerCase().includes(query) ||
                m.category.toLowerCase().includes(query) ||
                m.youtuberName?.toLowerCase().includes(query)
            );
        }

        return filtered;
    }, [viewMode, searchQuery, youtuberRestaurants]);

    // [OPTIMIZATION] 핸들러 메모이제이션
    const handleMarkerClick = useCallback((marker: RestaurantMarker) => {
        setSelectedMarker(marker);
    }, []);

    const handleCloseDetail = useCallback(() => {
        setSelectedMarker(null);
    }, []);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-full min-h-0">
            {/* 좌측: 맛집 목록 */}
            <Card className="lg:col-span-1 flex flex-col min-h-0">
                <CardHeader className="p-4 space-y-3 shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <CardTitle className="text-base font-semibold">맛집 목록</CardTitle>
                            <Badge variant="secondary" className="px-1.5 h-5 text-xs font-normal">
                                {filteredMarkers.length}
                            </Badge>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => refetch()}
                            disabled={isLoading}
                            title="새로고침"
                            aria-label="맛집 목록 새로고침"
                        >
                            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                        </Button>
                    </div>
                    <div className="space-y-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                            <Input
                                placeholder="맛집, 상호명, 지역 검색..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9 text-sm bg-background/50 focus:bg-background transition-colors"
                            />
                        </div>
                        <div className="flex gap-2">
                            <Select value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
                                <SelectTrigger className="h-9 text-xs flex-1 bg-background/50 focus:bg-background transition-colors">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">전체 보기</SelectItem>
                                    <SelectItem value="user_report">사용자 제보</SelectItem>
                                    <SelectItem value="other_youtuber">유튜버 맛집</SelectItem>
                                </SelectContent>
                            </Select>
                            {youtubers.length > 0 && (
                                <Select value={selectedYoutuber} onValueChange={setSelectedYoutuber}>
                                    <SelectTrigger className="h-9 text-xs flex-1 bg-background/50 focus:bg-background transition-colors">
                                        <SelectValue placeholder="유튜버 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">모든 유튜버</SelectItem>
                                        {youtubers.map((yt) => (
                                            <SelectItem key={yt.name} value={yt.name}>
                                                {yt.name} ({yt.count}개)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden">
                    <ScrollArea className="h-full w-full [&_[data-radix-scroll-area-viewport]>div]:!block">
                        <div className="p-4 space-y-2 max-w-full">
                            {isLoading ? (
                                // 로딩 상태
                                <div className="text-center py-8 text-muted-foreground text-sm">
                                    맛집 목록을 불러오는 중...
                                </div>
                            ) : error ? (
                                <div className="text-center py-8 text-destructive text-sm">
                                    데이터를 불러올 수 없습니다
                                    <Button
                                        variant="link"
                                        size="sm"
                                        className="block mx-auto mt-2"
                                        onClick={() => refetch()}
                                    >
                                        다시 시도
                                    </Button>
                                </div>
                            ) : filteredMarkers.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground text-sm">
                                    {searchQuery ? '검색 결과가 없습니다' : '등록된 맛집이 없습니다'}
                                </div>
                            ) : (
                                filteredMarkers.map((marker) => (
                                    <RestaurantListItem
                                        key={marker.id}
                                        marker={marker}
                                        isSelected={selectedMarker?.id === marker.id}
                                        onClick={() => handleMarkerClick(marker)}
                                    />
                                ))
                            )}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* 중앙: 지도 */}
            <Card className={cn(
                "flex flex-col transition-all duration-300 min-h-0",
                selectedMarker ? "lg:col-span-2" : "lg:col-span-3"
            )}>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            맛집 지도
                        </CardTitle>
                        <div className="flex items-center gap-2 text-xs">
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded-full bg-blue-500" />
                                <span>사용자 제보</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded-full bg-red-500" />
                                <span>타 유튜버</span>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 p-4 pt-0">
                    <NaverMapView
                        markers={filteredMarkers}
                        onMarkerClick={handleMarkerClick}
                        selectedMarkerId={selectedMarker?.id ?? null}
                        isPanelOpen={!!selectedMarker}
                    />
                </CardContent>
            </Card>

            {/* 우측: 상세 패널 (선택 시에만 표시) */}
            {selectedMarker && (
                <Card className="lg:col-span-1 flex flex-col min-h-0">
                    <DetailPanel
                        marker={selectedMarker}
                        onClose={handleCloseDetail}
                    />
                </Card>
            )}
        </div>
    );
};

// [OPTIMIZATION] React.memo로 불필요한 리렌더링 방지
const MapSection = memo(MapSectionComponent);
MapSection.displayName = 'MapSection';

export default MapSection;
