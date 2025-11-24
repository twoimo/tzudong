import { useState, memo, Suspense, lazy, useCallback, useMemo, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import MapView from "@/components/map/MapView";
import { FilterPanel, FilterState } from "@/components/filters/FilterPanel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { MapPin, Grid3X3, Map, ChevronsUpDown, Check, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Restaurant } from "@/types/restaurant";
import CategoryFilter from "@/components/filters/CategoryFilter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useQuery } from "@tanstack/react-query";
import { mergeRestaurants } from "@/hooks/use-restaurants";

// 코드 스플리팅으로 성능 최적화
const RestaurantSearch = lazy(() => import("@/components/search/RestaurantSearch"));

// 글로벌 페이지용 국가 목록
const GLOBAL_COUNTRIES = [
    "미국", "일본", "대만", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
] as const;

type GlobalCountry = typeof GLOBAL_COUNTRIES[number];

interface GlobalMapPageProps {
    refreshTrigger: number;
    selectedRestaurant: Restaurant | null;
    setSelectedRestaurant: (restaurant: Restaurant | null) => void;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
}

// 그리드 지역 설정 (글로벌 국가)
const GRID_COUNTRIES: GlobalCountry[] = ["미국", "일본", "태국", "인도네시아"];

const GlobalMapPage = memo(({ refreshTrigger, selectedRestaurant, setSelectedRestaurant, onAdminEditRestaurant }: GlobalMapPageProps) => {
    const { isAdmin } = useAuth();
    const location = useLocation();
    const prevSelectedRestaurantRef = useRef<Restaurant | null>(null);
    const detailPanelRef = useRef<HTMLDivElement>(null);

    const [panelWidth, setPanelWidth] = useState(0);

    // 글로벌 맛집 데이터 가져오기 (병합 로직 적용을 위해 전체 데이터 필요)
    const { data: globalRestaurants = [] } = useQuery({
        queryKey: ['global-restaurants-count'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('*')
                .eq('status', 'approved');

            if (error) {
                console.error('글로벌 맛집 데이터 조회 실패:', error);
                return [];
            }
            // 병합 로직 적용하여 중복 제거
            return mergeRestaurants(data || []);
        },
    });

    // 국가별 맛집 수 계산 (병합된 데이터 기준)
    const countryCounts = useMemo(() => {
        const counts: Record<string, number> = {};

        globalRestaurants.forEach((restaurant) => {
            const address = restaurant.english_address || restaurant.road_address || restaurant.jibun_address || '';

            // 각 국가에 대해 확인
            GLOBAL_COUNTRIES.forEach((country) => {
                // 영문 주소나 한글 주소에 국가명이 포함되어 있는지 확인
                if (address.includes(country)) {
                    counts[country] = (counts[country] || 0) + 1;
                }
            });
        });

        return counts;
    }, [globalRestaurants]);

    // 관리자 수정 콜백 래핑 - 수정 후 패널 즉각 반영
    const handleAdminEditRestaurant = useCallback((restaurant: Restaurant) => {
        if (onAdminEditRestaurant) {
            onAdminEditRestaurant(restaurant);
        }
    }, [onAdminEditRestaurant]);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState<GlobalCountry | null>("튀르키예");
    const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);
    const [isGridMode, setIsGridMode] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);
    const [moveToRestaurant, setMoveToRestaurant] = useState<((restaurant: Restaurant) => void) | null>(null);
    // 패널 상태를 GlobalMapPage 레벨로 완전 이동 (MapView와 완전 분리)
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelRestaurant, setPanelRestaurant] = useState<Restaurant | null>(null);

    // selectedRestaurant 변경 감지 - 팝업에서 전달된 경우에만 패널 열기
    useEffect(() => {
        // 이전 값과 비교하여 실제로 변경되었는지 확인
        const hasChanged = prevSelectedRestaurantRef.current?.id !== selectedRestaurant?.id;

        if (selectedRestaurant && hasChanged) {
            // state로 전달된 경우에만 패널 열기 (location.state 확인)
            const state = location.state as { selectedRestaurant?: Restaurant };
            if (state?.selectedRestaurant) {
                setPanelRestaurant(selectedRestaurant);
                setIsPanelOpen(true);
                setSearchedRestaurant(selectedRestaurant);

                // 해당 레스토랑의 국가로 필터 자동 변경
                const address = selectedRestaurant.english_address || selectedRestaurant.road_address || selectedRestaurant.jibun_address || '';
                for (const country of GLOBAL_COUNTRIES) {
                    if (address.includes(country)) {
                        setSelectedCountry(country as GlobalCountry);
                        break;
                    }
                }

                // 지도 이동 함수가 준비되었다면 즉시 이동
                if (moveToRestaurant) {
                    moveToRestaurant(selectedRestaurant);
                }
            }
        }
        // selectedRestaurant가 null이 되어도 패널은 유지 (명시적으로 닫기 버튼을 눌러야만 닫힘)

        prevSelectedRestaurantRef.current = selectedRestaurant;
    }, [selectedRestaurant, moveToRestaurant, location.state]);

    // ResizeObserver로 패널 너비 추적
    useEffect(() => {
        if (!detailPanelRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setPanelWidth(entry.contentRect.width);
            }
        });

        resizeObserver.observe(detailPanelRef.current);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);
    const [editFormData, setEditFormData] = useState({
        name: '',
        address: '',
        phone: '',
        category: [] as string[],
        youtube_reviews: [] as { youtube_link: string; tzuyang_review: string; unique_id?: string }[]
    });
    const [filters, setFilters] = useState<FilterState>({
        categories: [],
        minRating: 1,
        minReviews: 0,
        minUserVisits: 0,
        minJjyangVisits: 0,
    });

    const handleFilterChange = useCallback((newFilters: FilterState) => {
        setFilters(newFilters);
    }, []);

    const handleRestaurantSelect = useCallback((restaurant: Restaurant) => {
        // 선택된 맛집을 MapView에 전달하기 위해 상태 업데이트
        setSelectedRestaurant(restaurant);
    }, [setSelectedRestaurant]);

    // 검색된 맛집의 국가를 찾는 헬퍼 함수
    const getRestaurantCountry = useCallback((restaurant: Restaurant): GlobalCountry | null => {
        const address = restaurant.english_address || restaurant.road_address || restaurant.jibun_address || '';

        // 각 국가에 대해 확인
        for (const country of GLOBAL_COUNTRIES) {
            if (address.includes(country)) {
                return country;
            }
        }
        return null;
    }, []);

    const handleRestaurantSearch = useCallback((restaurant: Restaurant) => {
        // 개발 환경에서만 구조화된 상태 로그 출력
        if (process.env.NODE_ENV === "development") {
            console.log("[handleRestaurantSearch] 호출", {
                restaurant,
                moveToRestaurantExists: !!moveToRestaurant,
                isGridMode,
                selectedCountry,
            });
        }

        // 검색된 맛집의 국가로 하단 컨트롤 패널의 국가 필터 실시간 변경
        const restaurantCountry = getRestaurantCountry(restaurant);
        if (restaurantCountry && restaurantCountry !== selectedCountry) {
            setSelectedCountry(restaurantCountry);
            console.log('🌍 검색된 맛집 국가로 필터 변경:', restaurantCountry);
        }

        // 검색 시에는 지도 재조정을 위해 searchedRestaurant 설정 (객체 복사로 참조 변경 보장)
        setSearchedRestaurant({ ...restaurant });
        setSelectedRestaurant(restaurant);

        // 검색 시 자동으로 패널 열기
        setPanelRestaurant(restaurant);
        setIsPanelOpen(true);

        // 지도 이동 함수가 준비되었다면 약간의 지연 후 이동 (패널 오픈 애니메이션 고려)
        if (moveToRestaurant) {
            if (process.env.NODE_ENV === "development") {
                console.log("[handleRestaurantSearch] moveToRestaurant 실행 예약", { restaurant });
            }
            // 300ms 지연 후 이동 (패널이 열리고 지도가 리사이즈될 시간을 줌)
            setTimeout(() => {
                moveToRestaurant(restaurant);
            }, 300);
        }

        // 그리드 모드에서 검색 시 단일 모드로 전환
        if (isGridMode) {
            if (process.env.NODE_ENV === "development") {
                console.log("[handleRestaurantSearch] 그리드 모드에서 단일 모드로 전환");
            }
            setIsGridMode(false);
        }
    }, [moveToRestaurant, isGridMode, setSelectedRestaurant, selectedCountry, getRestaurantCountry]);

    const switchToSingleMap = useCallback(() => {
        // 그리드 모드에서 검색 시 단일 모드로 전환
        if (isGridMode) {
            setIsGridMode(false);
        }
    }, [isGridMode]);

    const handleMapReady = useCallback((moveFunction: (restaurant: Restaurant) => void) => {
        setMoveToRestaurant(() => moveFunction);
    }, []);

    // 패널 관리를 GlobalMapPage 레벨로 완전 이동
    const handleMarkerClick = useCallback((restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant); // 외부 상태 관리
        setPanelRestaurant(restaurant); // 패널 전용 상태
        setIsPanelOpen(true); // 패널 열기
    }, [setSelectedRestaurant]);

    const handlePanelClose = useCallback(() => {
        setIsPanelOpen(false);
        setPanelRestaurant(null);
    }, []);

    // refreshTrigger 변경 시 패널 레스토랑 정보 업데이트
    useEffect(() => {
        if (panelRestaurant) {
            // 패널에 표시된 레스토랑이 업데이트되었는지 확인
            // 여기서는 간단히 refreshTrigger로 인한 업데이트만 처리
            // 실제 데이터 업데이트는 MapView에서 처리됨
        }
    }, [refreshTrigger, panelRestaurant]);

    const handleRequestEditRestaurant = useCallback((restaurant: Restaurant) => {
        setRestaurantToEdit(restaurant);

        // mergedRestaurants에서 모든 유튜브 링크와 쯔양 리뷰 추출
        const youtubeReviews: { youtube_link: string; tzuyang_review: string; unique_id?: string }[] = [];

        if (restaurant.mergedRestaurants && restaurant.mergedRestaurants.length > 0) {
            // 병합된 모든 레코드에서 유튜브 링크와 쯔양 리뷰 추출
            restaurant.mergedRestaurants.forEach(record => {
                if (record.youtube_link && record.tzuyang_review) {
                    youtubeReviews.push({
                        youtube_link: record.youtube_link,
                        tzuyang_review: record.tzuyang_review,
                        unique_id: record.unique_id || undefined
                    });
                }
            });
        } else {
            // 병합되지 않은 경우 (단일 레코드)
            if (restaurant.youtube_link && restaurant.tzuyang_review) {
                youtubeReviews.push({
                    youtube_link: restaurant.youtube_link,
                    tzuyang_review: restaurant.tzuyang_review,
                    unique_id: restaurant.unique_id || undefined
                });
            }
        }

        setEditFormData({
            name: restaurant.name,
            address: restaurant.road_address || restaurant.jibun_address || '',
            phone: restaurant.phone || '',
            category: Array.isArray(restaurant.categories)
                ? restaurant.categories
                : (restaurant.categories ? [restaurant.categories] : []),
            youtube_reviews: youtubeReviews
        });
        setIsEditModalOpen(true);
    }, []);

    const handleEditFormChange = (field: string, value: string | string[]) => {
        setEditFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const handleYoutubeReviewChange = (index: number, field: 'youtube_link' | 'tzuyang_review', value: string) => {
        setEditFormData(prev => ({
            ...prev,
            youtube_reviews: prev.youtube_reviews.map((item, i) =>
                i === index ? { ...item, [field]: value } : item
            )
        }));
    };

    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!restaurantToEdit) return;

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                toast.error("로그인이 필요합니다.");
                return;
            }

            // 수정된 항목들을 user_restaurants_submission 형식으로 변환
            const submissionData = editFormData.youtube_reviews.map(review => ({
                unique_id: review.unique_id || null,
                name: editFormData.name,
                categories: editFormData.category,
                address: editFormData.address,
                phone: editFormData.phone,
                youtube_link: review.youtube_link,
                tzuyang_review: review.tzuyang_review
            }));

            // 새로운 restaurant_submissions 테이블 구조에 맞춰 저장
            const { error } = await supabase
                .from('restaurant_submissions')
                .insert({
                    user_id: user.id,
                    submission_type: 'edit',
                    status: 'pending',
                    user_restaurants_submission: submissionData
                } as any);

            if (error) throw error;

            toast.success("맛집 수정 요청이 성공적으로 제출되었습니다!");
            setIsEditModalOpen(false);
            setRestaurantToEdit(null);
        } catch (error) {
            console.error('맛집 수정 요청 제출 실패:', error);
            toast.error("맛집 수정 요청 제출에 실패했습니다. 다시 시도해주세요.");
        }
    };

    return (
        <>
            {/* 하단 컨트롤 패널 */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
                <div className="flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border p-3 shadow-lg">
                    {/* 국가 선택 */}
                    <Select
                        value={selectedCountry || "튀르키예"}
                        onValueChange={(value) => {
                            setSelectedCountry(value as GlobalCountry);
                        }}
                    >
                        <SelectTrigger className="w-48">
                            <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <SelectValue placeholder="국가를 선택하세요" />
                            </div>
                        </SelectTrigger>
                        <SelectContent>
                            {GLOBAL_COUNTRIES.map((country) => {
                                const count = countryCounts[country] || 0;
                                return (
                                    <SelectItem key={country} value={country}>
                                        <div className="flex items-center justify-between w-full">
                                            <span className="whitespace-nowrap">{country}</span>
                                            <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">({count}개)</span>
                                        </div>
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>

                    {/* 카테고리 필터링 */}
                    <CategoryFilter
                        selectedCategories={filters.categories}
                        onCategoryChange={(categories) => setFilters(prev => ({ ...prev, categories }))}
                        selectedCountry={selectedCountry}
                        className="w-48"
                    />

                    {/* 맛집 검색 */}
                    <Suspense fallback={<div className="w-72 h-10 bg-muted animate-pulse rounded" />}>
                        <RestaurantSearch
                            onRestaurantSelect={handleRestaurantSelect}
                            onRestaurantSearch={handleRestaurantSearch}
                            onSearchExecute={switchToSingleMap}
                            filters={filters}
                            selectedRegion={selectedCountry}
                        />
                    </Suspense>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsGridMode(!isGridMode)}
                        className="flex items-center gap-2"
                    >
                        {isGridMode ? <Map className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {isGridMode ? (
                // 그리드 모드: 2x2 그리드로 4개 국가 표시
                <div className="grid grid-cols-2 grid-rows-2 h-full w-full gap-1 p-1">
                    {GRID_COUNTRIES.map((country, index) => (
                        <div key={country} className="relative min-h-0 overflow-hidden rounded-md border border-border">
                            <Suspense fallback={<div className="flex items-center justify-center h-full">지도 로딩 중...</div>}>
                                <MapView
                                    filters={filters}
                                    selectedCountry={country}
                                    selectedRestaurant={null} // 그리드 모드에서는 단일 지도 selectedRestaurant 사용 안 함
                                    refreshTrigger={refreshTrigger}
                                    onAdminEditRestaurant={onAdminEditRestaurant}
                                />
                            </Suspense>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="absolute top-2 left-2 bg-background/95 backdrop-blur-sm hover:bg-background text-sm font-semibold shadow z-10 h-auto py-1 px-2 text-foreground"
                                onClick={() => {
                                    setIsGridMode(false);
                                    setSelectedCountry(country);
                                }}
                            >
                                {country}
                            </Button>
                        </div>
                    ))}
                </div>
            ) : (
                // 단일 지도 모드
                <Suspense fallback={
                    <div className="flex items-center justify-center h-full bg-gradient-to-br from-background to-muted">
                        <div className="text-center space-y-6">
                            <div className="relative">
                                <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary/20 border-t-primary mx-auto"></div>
                                <div className="absolute inset-0 rounded-full border-4 border-transparent border-r-secondary animate-spin mx-auto h-16 w-16" style={{ animationDuration: '1.5s' }}></div>
                            </div>
                            <div className="space-y-3">
                                <h2 className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                                    쯔동여지도 로딩 중...
                                </h2>
                                <p className="text-muted-foreground">
                                    맛있는 발견을 준비하고 있습니다
                                </p>
                                <div className="flex justify-center space-x-1">
                                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                </div>
                            </div>
                        </div>
                    </div>
                }>
                    <PanelGroup direction="horizontal" className="w-full h-full">
                        <Panel id="map-panel" order={1} defaultSize={panelRestaurant && isPanelOpen ? 75 : 100} minSize={40} maxSize={80}>
                            <MapView
                                filters={filters}
                                selectedCountry={selectedCountry}
                                searchedRestaurant={searchedRestaurant} // 검색 시 지도 재조정용
                                selectedRestaurant={selectedRestaurant}
                                refreshTrigger={refreshTrigger}
                                onAdminEditRestaurant={onAdminEditRestaurant}
                                onRestaurantSelect={setSelectedRestaurant}
                                onMapReady={handleMapReady}
                                onRequestEditRestaurant={handleRequestEditRestaurant}
                                onMarkerClick={handleMarkerClick}
                                panelWidth={panelWidth}
                            />
                        </Panel>

                        {/* Resize Handle */}
                        {panelRestaurant && isPanelOpen && (
                            <PanelResizeHandle className="w-2 bg-border hover:bg-primary/20 transition-colors relative">
                                <div className="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-1 bg-muted-foreground/30 rounded-full"></div>
                            </PanelResizeHandle>
                        )}

                        {/* Restaurant Detail Panel */}
                        {panelRestaurant && isPanelOpen && (
                            <Panel id="detail-panel" order={2} defaultSize={25} minSize={20} maxSize={33}>
                                <div ref={detailPanelRef} className="h-full">
                                    <RestaurantDetailPanel
                                        restaurant={panelRestaurant}
                                        onClose={handlePanelClose}
                                        onWriteReview={() => {
                                            setIsReviewModalOpen(true);
                                        }}
                                        onEditRestaurant={onAdminEditRestaurant ? () => {
                                            onAdminEditRestaurant(panelRestaurant);
                                        } : undefined}
                                        onRequestEditRestaurant={() => {
                                            handleRequestEditRestaurant(panelRestaurant);
                                        }}
                                    />
                                </div>
                            </Panel>
                        )}
                    </PanelGroup>
                </Suspense>
            )}

            <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
                <SheetContent side="left" className="w-80 p-0">
                    <FilterPanel
                        filters={filters}
                        onFilterChange={handleFilterChange}
                        onClose={() => setIsFilterOpen(false)}
                    />
                </SheetContent>
            </Sheet>

            {/* 맛집 수정 요청 모달 */}
            <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                            맛집 수정 요청
                        </DialogTitle>
                        <DialogDescription>
                            잘못된 정보나 오타가 있는 맛집 정보를 수정해주세요
                        </DialogDescription>
                    </DialogHeader>

                    {restaurantToEdit && (
                        <form onSubmit={handleEditSubmit} className="space-y-4 mt-4">
                            {/* 수정할 정보 입력 */}
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">
                                        맛집 이름 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="name"
                                        name="name"
                                        value={editFormData.name}
                                        onChange={(e) => handleEditFormChange('name', e.target.value)}
                                        placeholder="맛집 이름을 입력해주세요"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="category">
                                        카테고리 <span className="text-red-500">*</span>
                                    </Label>
                                    <Popover open={isCategoryPopoverOpen} onOpenChange={setIsCategoryPopoverOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={isCategoryPopoverOpen}
                                                className="w-full justify-between"
                                            >
                                                {editFormData.category.length > 0
                                                    ? `${editFormData.category.length}개 선택됨`
                                                    : "카테고리를 선택해주세요"
                                                }
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-full p-0" align="start">
                                            <Command>
                                                <CommandInput placeholder="카테고리 검색..." />
                                                <CommandList>
                                                    <CommandEmpty>카테고리를 찾을 수 없습니다.</CommandEmpty>
                                                    <CommandGroup>
                                                        {[
                                                            "한식", "중식", "일식", "양식", "분식", "치킨", "피자",
                                                            "고기", "족발·보쌈", "돈까스·회", "아시안",
                                                            "패스트푸드", "카페·디저트", "기타"
                                                        ].map((category) => {
                                                            const isSelected = editFormData.category.includes(category);
                                                            return (
                                                                <CommandItem
                                                                    key={category}
                                                                    onSelect={() => {
                                                                        const newCategories = isSelected
                                                                            ? editFormData.category.filter(c => c !== category)
                                                                            : [...editFormData.category, category];
                                                                        handleEditFormChange('category', newCategories);
                                                                    }}
                                                                >
                                                                    <Check
                                                                        className={`mr-2 h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"
                                                                            }`}
                                                                    />
                                                                    {category}
                                                                </CommandItem>
                                                            );
                                                        })}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    {editFormData.category.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {editFormData.category.map((category) => (
                                                <Badge key={category} variant="secondary" className="text-xs">
                                                    {category}
                                                    <button
                                                        type="button"
                                                        className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                                                        onClick={() => {
                                                            const newCategories = editFormData.category.filter(c => c !== category);
                                                            handleEditFormChange('category', newCategories);
                                                        }}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="address">
                                        주소 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="address"
                                        name="address"
                                        value={editFormData.address}
                                        onChange={(e) => handleEditFormChange('address', e.target.value)}
                                        placeholder="주소를 입력해주세요"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="phone">전화번호</Label>
                                    <Input
                                        id="phone"
                                        name="phone"
                                        value={editFormData.phone}
                                        onChange={(e) => handleEditFormChange('phone', e.target.value)}
                                        placeholder="전화번호를 입력해주세요"
                                    />
                                </div>

                                {/* 유튜브 영상별 정보 */}
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-lg">유튜브 영상별 정보</h3>

                                    {editFormData.youtube_reviews.map((review, index) => (
                                        <Card key={index} className="p-4 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <Badge variant="outline">영상 {index + 1}</Badge>
                                            </div>

                                            <div className="space-y-2">
                                                <Label>유튜브 링크</Label>
                                                <Input
                                                    value={review.youtube_link}
                                                    onChange={(e) => handleYoutubeReviewChange(index, 'youtube_link', e.target.value)}
                                                    placeholder="https://www.youtube.com/watch?v=..."
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <Label>쯔양 리뷰</Label>
                                                <Textarea
                                                    value={review.tzuyang_review}
                                                    onChange={(e) => handleYoutubeReviewChange(index, 'tzuyang_review', e.target.value)}
                                                    placeholder="쯔양의 리뷰 내용을 입력해주세요"
                                                    rows={3}
                                                />
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button type="button" variant="outline" onClick={() => setIsEditModalOpen(false)} className="flex-1">
                                    취소
                                </Button>
                                <Button type="submit" className="flex-1 bg-gradient-primary hover:opacity-90">
                                    수정 요청 제출
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            {/* 리뷰 작성 모달 */}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={panelRestaurant ? { id: panelRestaurant.id, name: panelRestaurant.name } : null}
                onSuccess={() => {
                    // refreshTrigger를 업데이트해서 데이터 새로고침
                    // 부모 컴포넌트에서 refreshTrigger를 관리하므로 여기서는 사용하지 않음
                    toast.success("리뷰가 성공적으로 등록되었습니다!");
                }}
            />
        </>
    );
});

GlobalMapPage.displayName = 'GlobalMapPage';

export default GlobalMapPage;

