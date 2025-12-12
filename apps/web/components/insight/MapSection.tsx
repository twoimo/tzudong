'use client';

import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
    MapPin,
    ExternalLink,
    Youtube,
    Search,
    X,
    ChevronRight,
    Users,
    Star,
    Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNaverMaps } from '@/hooks/use-naver-maps';

// [TYPE] 맛집 마커 데이터 타입
interface RestaurantMarker {
    id: string;
    name: string;
    address: string;
    category: string;
    lat: number;
    lng: number;
    source: 'user_report' | 'other_youtuber';
    youtuberName?: string;
    youtuberChannel?: string;
    videoUrl?: string;
    videoTitle?: string;
    reportCount?: number;
    reportReasons?: string[];
    reportedAt?: string;
    rating?: number;
}

// [MOCK] 사용자 제보 맛집 데이터
const MOCK_USER_REPORTS: RestaurantMarker[] = [
    {
        id: 'ur1',
        name: '원조 청진동 해장국',
        address: '서울 종로구 종로3길 32',
        category: '한식',
        lat: 37.5703,
        lng: 126.9847,
        source: 'user_report',
        reportCount: 15,
        reportReasons: ['쯔양님이 좋아하실 것 같아요', '해장국이 정말 맛있어요', '가성비 최고'],
        reportedAt: '2025-12-10',
        rating: 4.5,
    },
    {
        id: 'ur2',
        name: '황소곱창',
        address: '서울 마포구 와우산로 112',
        category: '곱창/막창',
        lat: 37.5546,
        lng: 126.9236,
        source: 'user_report',
        reportCount: 8,
        reportReasons: ['곱창이 진짜 맛있어요', '분위기도 좋아요'],
        reportedAt: '2025-12-08',
        rating: 4.2,
    },
];

// [MOCK] 타 유튜버 맛집 데이터
const MOCK_YOUTUBER_SPOTS: RestaurantMarker[] = [
    {
        id: 'yt1',
        name: '풍년옥',
        address: '서울 중구 명동길 74',
        category: '냉면',
        lat: 37.5636,
        lng: 126.9832,
        source: 'other_youtuber',
        youtuberName: '먹방유튜버A',
        youtuberChannel: '@mukbangA',
        videoUrl: 'https://youtube.com/watch?v=example1',
        videoTitle: '명동 최고의 냉면집!',
        rating: 4.8,
    },
    {
        id: 'yt2',
        name: '을밀대',
        address: '서울 마포구 도화동 543',
        category: '평양냉면',
        lat: 37.5406,
        lng: 126.9525,
        source: 'other_youtuber',
        youtuberName: '먹방유튜버B',
        youtuberChannel: '@foodieB',
        videoUrl: 'https://youtube.com/watch?v=example2',
        videoTitle: '평양냉면 맛집 탐방',
        rating: 4.6,
    },
    {
        id: 'yt3',
        name: '진미평양냉면',
        address: '서울 강남구 역삼동 823',
        category: '평양냉면',
        lat: 37.5012,
        lng: 127.0396,
        source: 'other_youtuber',
        youtuberName: '먹방유튜버C',
        youtuberChannel: '@gourmetC',
        videoUrl: 'https://youtube.com/watch?v=example3',
        videoTitle: '강남에서 만난 평양냉면',
        rating: 4.4,
    },
];

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
    <div
        onClick={onClick}
        className={cn(
            "p-3 rounded-lg cursor-pointer transition-all duration-200 border",
            isSelected
                ? "bg-primary/10 border-primary shadow-sm"
                : "bg-card hover:bg-muted/50 border-transparent"
        )}
    >
        <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h4 className="font-medium text-sm truncate">{marker.name}</h4>
                    <Badge variant="secondary" className="text-xs shrink-0">
                        {marker.category}
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{marker.address}</p>
                {marker.source === 'user_report' ? (
                    <div className="flex items-center gap-2 mt-2 text-xs">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            <Users className="h-3 w-3 mr-1" />
                            {marker.reportCount}명 제보
                        </Badge>
                        {marker.rating && (
                            <span className="flex items-center text-amber-600">
                                <Star className="h-3 w-3 mr-0.5 fill-current" />
                                {marker.rating}
                            </span>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center gap-2 mt-2 text-xs">
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                            <Youtube className="h-3 w-3 mr-1" />
                            {marker.youtuberName}
                        </Badge>
                    </div>
                )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
    </div>
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
            <div className="flex items-center justify-between p-4 border-b">
                <h3 className="font-semibold text-lg">{marker.name}</h3>
                <Button variant="ghost" size="icon" onClick={onClose}>
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
                        <Badge variant="secondary">{marker.category}</Badge>
                        {marker.rating && (
                            <div className="flex items-center gap-1 text-amber-600">
                                <Star className="h-4 w-4 fill-current" />
                                <span className="font-medium">{marker.rating}</span>
                            </div>
                        )}
                    </div>

                    <Separator />

                    {/* 사용자 제보인 경우 */}
                    {marker.source === 'user_report' && (
                        <div className="space-y-3">
                            <h4 className="font-medium text-sm flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                제보 현황 ({marker.reportCount}명)
                            </h4>
                            <div className="space-y-2">
                                {marker.reportReasons?.map((reason, idx) => (
                                    <div
                                        key={idx}
                                        className="p-3 bg-muted/50 rounded-lg text-sm"
                                    >
                                        "{reason}"
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                최근 제보: {marker.reportedAt}
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
                                <p className="text-sm font-medium">{marker.videoTitle}</p>
                                <p className="text-xs text-muted-foreground">
                                    {marker.youtuberName} ({marker.youtuberChannel})
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() => window.open(marker.videoUrl, '_blank')}
                            >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                유튜브에서 보기
                            </Button>
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
    const mapInstanceRef = useRef<any>(null);
    const markersRef = useRef<any[]>([]);
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

    // [OPTIMIZATION] 필터링된 마커 메모이제이션
    const filteredMarkers = useMemo(() => {
        const allMarkers = [...MOCK_USER_REPORTS, ...MOCK_YOUTUBER_SPOTS];

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
                m.category.toLowerCase().includes(query)
            );
        }

        return filtered;
    }, [viewMode, searchQuery]);

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
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">맛집 목록</CardTitle>
                    <div className="space-y-2 mt-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="맛집 검색..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9 text-sm"
                            />
                        </div>
                        <Select value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
                            <SelectTrigger className="h-9 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">전체 보기</SelectItem>
                                <SelectItem value="user_report">사용자 제보만</SelectItem>
                                <SelectItem value="other_youtuber">타 유튜버만</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden">
                    <ScrollArea className="h-full px-4 pb-4">
                        <div className="space-y-2">
                            {filteredMarkers.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground text-sm">
                                    검색 결과가 없습니다
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
