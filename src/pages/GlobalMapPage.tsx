import { useState, memo, Suspense, lazy, useCallback, useMemo, useEffect } from "react";
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

// 코드 스플리팅으로 성능 최적화
const RestaurantSearch = lazy(() => import("@/components/search/RestaurantSearch"));

// 글로벌 페이지용 국가 목록
const GLOBAL_COUNTRIES = [
    "미국", "일본", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
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

    // selectedRestaurant 변경 시 panelRestaurant도 업데이트 (관리자 수정 즉각 반영)
    useEffect(() => {
        if (selectedRestaurant && isPanelOpen) {
            setPanelRestaurant(selectedRestaurant);
        }
    }, [selectedRestaurant, isPanelOpen]);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);
    const [editFormData, setEditFormData] = useState({
        name: '',
        address: '',
        phone: '',
        category: [] as string[],
        youtube_link: '',
        tzuyang_review: ''
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

    const handleRestaurantSearch = useCallback((restaurant: Restaurant) => {
        // 검색 시에는 지도 재조정을 위해 searchedRestaurant 설정
        setSearchedRestaurant(restaurant);
        setSelectedRestaurant(restaurant);

        // 지도 이동 함수가 준비되었다면 즉시 이동
        if (moveToRestaurant) {
            moveToRestaurant(restaurant);
        }

        // 그리드 모드에서 검색 시 단일 모드로 전환
        if (isGridMode) {
            setIsGridMode(false);
            // 검색된 맛집의 국가로 전환 (가능하다면)
            // TODO: 맛집의 국가 정보를 기반으로 selectedCountry 설정
        }
    }, [moveToRestaurant, isGridMode, setSelectedRestaurant]);

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
        setEditFormData({
            name: restaurant.name,
            address: restaurant.road_address || restaurant.jibun_address || '',
            phone: restaurant.phone || '',
            category: Array.isArray(restaurant.categories)
                ? restaurant.categories
                : (restaurant.categories ? [restaurant.categories] : []),
            youtube_link: Array.isArray(restaurant.youtube_links) && restaurant.youtube_links.length > 0
                ? restaurant.youtube_links[0]
                : (typeof restaurant.youtube_links === 'string' ? restaurant.youtube_links : ''),
            tzuyang_review: Array.isArray(restaurant.tzuyang_reviews) && restaurant.tzuyang_reviews.length > 0
                ? JSON.stringify(restaurant.tzuyang_reviews[0])
                : ''
        });
        setIsEditModalOpen(true);
    }, []);

    const handleEditFormChange = (field: string, value: string | string[]) => {
        setEditFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const getEditChanges = () => {
        if (!restaurantToEdit) return [];

        const originalData = {
            name: restaurantToEdit.name,
            address: restaurantToEdit.road_address || restaurantToEdit.jibun_address || '',
            phone: restaurantToEdit.phone || '',
            category: Array.isArray(restaurantToEdit.categories)
                ? restaurantToEdit.categories
                : (restaurantToEdit.categories ? [restaurantToEdit.categories] : []),
            youtube_link: Array.isArray(restaurantToEdit.youtube_links) && restaurantToEdit.youtube_links.length > 0
                ? restaurantToEdit.youtube_links[0]
                : (typeof restaurantToEdit.youtube_links === 'string' ? restaurantToEdit.youtube_links : ''),
            tzuyang_review: Array.isArray(restaurantToEdit.tzuyang_reviews) && restaurantToEdit.tzuyang_reviews.length > 0
                ? JSON.stringify(restaurantToEdit.tzuyang_reviews[0])
                : ''
        }; return Object.entries(editFormData).filter(([key, value]) => {
            const originalValue = originalData[key as keyof typeof originalData];
            if (key === 'category') {
                // 카테고리는 배열 비교
                return JSON.stringify(originalValue) !== JSON.stringify(value);
            }
            return originalValue !== value;
        });
    };

    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!restaurantToEdit) return;

        try {
            const formData = new FormData(e.target as HTMLFormElement);
            const updatedData = {
                name: editFormData.name,
                address: editFormData.address,
                phone: editFormData.phone,
                category: editFormData.category,
                youtube_link: editFormData.youtube_link,
                tzuyang_review: editFormData.tzuyang_review,
            };

            // 변경사항 계산
            const originalData = {
                restaurant_name: restaurantToEdit.name,
                address: restaurantToEdit.address,
                phone: restaurantToEdit.phone || '',
                category: Array.isArray(restaurantToEdit.categories) ? restaurantToEdit.categories : (restaurantToEdit.categories ? [restaurantToEdit.categories] : []),
                youtube_link: restaurantToEdit.youtube_link || '',
                tzuyang_review: restaurantToEdit.tzuyang_review || ''
            };

            const changes_requested: Record<string, { from: string | string[]; to: string | string[] }> = {};
            Object.entries(updatedData).forEach(([key, value]) => {
                const originalValue = originalData[key === 'name' ? 'restaurant_name' : key as keyof typeof originalData];
                const hasChanged = key === 'category'
                    ? JSON.stringify(originalValue) !== JSON.stringify(value)
                    : originalValue !== value;

                if (hasChanged) {
                    changes_requested[key === 'name' ? 'restaurant_name' : key] = {
                        from: originalValue,
                        to: value
                    };
                }
            });

            // restaurant_submissions 테이블에 수정 요청 저장
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                toast.error("로그인이 필요합니다.");
                return;
            }

            const { error } = await supabase
                .from('restaurant_submissions')
                .insert({
                    original_restaurant_id: restaurantToEdit.id,
                    restaurant_name: updatedData.name.trim(),
                    address: updatedData.address.trim(),
                    phone: updatedData.phone?.trim() || null,
                    category: updatedData.category,
                    youtube_link: updatedData.youtube_link.trim(),
                    tzuyang_review: updatedData.tzuyang_review?.trim(),
                    changes_requested,
                    user_id: user.id,
                    submission_type: 'edit'
                });

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
                        <SelectTrigger className="w-40">
                            <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <SelectValue placeholder="국가를 선택하세요" />
                            </div>
                        </SelectTrigger>
                        <SelectContent>
                            {GLOBAL_COUNTRIES.map((country) => (
                                <SelectItem key={country} value={country}>
                                    {country}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* 카테고리 필터링 */}
                    <Select
                        value={filters.categories.length > 0 ? filters.categories.join(',') : 'all'}
                        onValueChange={(value) => {
                            if (value === 'all') {
                                setFilters(prev => ({ ...prev, categories: [] }));
                            } else {
                                setFilters(prev => ({ ...prev, categories: value.split(',').filter(Boolean) }));
                            }
                        }}
                    >
                        <SelectTrigger className="w-40">
                            <SelectValue placeholder="카테고리 필터" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            <SelectItem value="한식">한식</SelectItem>
                            <SelectItem value="중식">중식</SelectItem>
                            <SelectItem value="양식">양식</SelectItem>
                            <SelectItem value="분식">분식</SelectItem>
                            <SelectItem value="치킨">치킨</SelectItem>
                            <SelectItem value="피자">피자</SelectItem>
                            <SelectItem value="고기">고기</SelectItem>
                            <SelectItem value="족발·보쌈">족발·보쌈</SelectItem>
                            <SelectItem value="돈까스·회">돈까스·회</SelectItem>
                            <SelectItem value="아시안">아시안</SelectItem>
                            <SelectItem value="패스트푸드">패스트푸드</SelectItem>
                            <SelectItem value="카페·디저트">카페·디저트</SelectItem>
                            <SelectItem value="찜·탕">찜·탕</SelectItem>
                            <SelectItem value="야식">야식</SelectItem>
                            <SelectItem value="도시락">도시락</SelectItem>
                        </SelectContent>
                    </Select>

                    {/* 맛집 검색 */}
                    <Suspense fallback={<div className="w-72 h-10 bg-muted animate-pulse rounded" />}>
                        <RestaurantSearch
                            onRestaurantSelect={handleRestaurantSelect}
                            onRestaurantSearch={handleRestaurantSearch}
                            onSearchExecute={switchToSingleMap}
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
                        <Panel defaultSize={panelRestaurant && isPanelOpen ? 75 : 100} minSize={40} maxSize={80}>
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
                            <Panel defaultSize={25} minSize={20} maxSize={60}>
                                <RestaurantDetailPanel
                                    restaurant={panelRestaurant}
                                    onClose={handlePanelClose}
                                    onWriteReview={() => {
                                        setIsReviewModalOpen(true);
                                    }}
                                    onEditRestaurant={handleAdminEditRestaurant && panelRestaurant ? (() => {
                                        handleAdminEditRestaurant(panelRestaurant);
                                    }) : undefined}
                                    onRequestEditRestaurant={handleRequestEditRestaurant}
                                />
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

                                <div className="space-y-2">
                                    <Label htmlFor="youtube_link">쯔양 유튜브 영상 링크</Label>
                                    <Input
                                        id="youtube_link"
                                        name="youtube_link"
                                        value={editFormData.youtube_link}
                                        onChange={(e) => handleEditFormChange('youtube_link', e.target.value)}
                                        placeholder="https://www.youtube.com/watch?v=..."
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="tzuyang_review">쯔양의 리뷰</Label>
                                    <Textarea
                                        id="tzuyang_review"
                                        name="tzuyang_review"
                                        value={editFormData.tzuyang_review}
                                        onChange={(e) => handleEditFormChange('tzuyang_review', e.target.value)}
                                        placeholder="쯔양의 리뷰 내용을 입력해주세요"
                                        rows={4}
                                    />
                                </div>
                            </div>

                            {/* 변경사항 표시 */}
                            {getEditChanges().length > 0 && (
                                <Card className="p-4 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="text-blue-600">📋</div>
                                            <Label className="text-sm font-medium text-blue-800 dark:text-blue-200">
                                                수정 요청 내용
                                            </Label>
                                        </div>

                                        <div className="space-y-3">
                                            {getEditChanges().map(([key, value]) => {
                                                const originalValue = restaurantToEdit ? {
                                                    name: restaurantToEdit.name,
                                                    address: restaurantToEdit.address,
                                                    phone: restaurantToEdit.phone || '',
                                                    category: Array.isArray(restaurantToEdit.category) ? restaurantToEdit.category : [restaurantToEdit.category],
                                                    youtube_link: restaurantToEdit.youtube_link || '',
                                                    tzuyang_review: restaurantToEdit.tzuyang_review || ''
                                                }[key as keyof typeof restaurantToEdit] || '' : '';

                                                const fieldName = {
                                                    name: '맛집 이름',
                                                    address: '주소',
                                                    phone: '전화번호',
                                                    category: '카테고리',
                                                    youtube_link: '유튜브 링크',
                                                    tzuyang_review: '쯔양의 리뷰'
                                                }[key] || key;

                                                return (
                                                    <div key={key} className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-200 dark:border-blue-700">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                {fieldName}
                                                            </span>
                                                            <div className="flex items-center gap-1 text-xs text-orange-600">
                                                                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                                                                변경됨
                                                            </div>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <div className="text-xs text-red-600 line-through">
                                                                기존: {key === 'category' ? (Array.isArray(originalValue) ? originalValue.join(', ') : originalValue) : (originalValue || '없음')}
                                                            </div>
                                                            <div className="text-xs text-green-600 font-medium">
                                                                변경: {key === 'category' ? (Array.isArray(value) ? value.join(', ') : value) : (value || '없음')}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </Card>
                            )}

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

