import { useState, memo, Suspense, lazy } from "react";
import MapView from "@/components/map/MapView";
import { FilterPanel, FilterState } from "@/components/filters/FilterPanel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MapPin, Grid3X3, Map } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Restaurant } from "@/types/restaurant";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState<GlobalCountry | null>("튀르키예");
    const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);
    const [isGridMode, setIsGridMode] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);
    const [moveToRestaurant, setMoveToRestaurant] = useState<((restaurant: Restaurant) => void) | null>(null);
    const [editFormData, setEditFormData] = useState({
        name: '',
        address: '',
        phone: '',
        category: '',
        youtube_link: '',
        description: ''
    });
    const [filters, setFilters] = useState<FilterState>({
        categories: [],
        minRating: 1,
        minReviews: 0,
        minUserVisits: 0,
        minJjyangVisits: 0,
    });

    const handleFilterChange = (newFilters: FilterState) => {
        setFilters(newFilters);
    };

    const handleRestaurantSelect = (restaurant: Restaurant) => {
        // 선택된 맛집을 MapView에 전달하기 위해 상태 업데이트
        setSelectedRestaurant(restaurant);
    };

    const handleRestaurantSearch = (restaurant: Restaurant) => {
        console.log('GlobalMapPage: Restaurant searched:', restaurant.name);
        // 검색 시에는 지도 재조정을 위해 searchedRestaurant 설정
        setSearchedRestaurant(restaurant);
        setSelectedRestaurant(restaurant);

        // 지도 이동 함수가 준비되었다면 즉시 이동
        if (moveToRestaurant) {
            console.log('GlobalMapPage: Moving to restaurant immediately');
            moveToRestaurant(restaurant);
        } else {
            console.log('GlobalMapPage: Map move function not ready yet');
        }

        // 그리드 모드에서 검색 시 단일 모드로 전환
        if (isGridMode) {
            setIsGridMode(false);
            // 검색된 맛집의 국가로 전환 (가능하다면)
            // TODO: 맛집의 국가 정보를 기반으로 selectedCountry 설정
        }
    };

    const switchToSingleMap = () => {
        // 그리드 모드에서 검색 시 단일 모드로 전환
        if (isGridMode) {
            setIsGridMode(false);
        }
    };

    const handleMapReady = (moveFunction: (restaurant: Restaurant) => void) => {
        console.log('GlobalMapPage: Map ready, storing move function');
        setMoveToRestaurant(() => moveFunction);
    };

    const handleRequestEditRestaurant = (restaurant: Restaurant) => {
        setRestaurantToEdit(restaurant);
        setEditFormData({
            name: restaurant.name,
            address: restaurant.address,
            phone: restaurant.phone || '',
            category: Array.isArray(restaurant.category) ? restaurant.category[0] : restaurant.category,
            youtube_link: restaurant.youtube_link || '',
            description: restaurant.description || ''
        });
        setIsEditModalOpen(true);
    };

    const handleEditFormChange = (field: string, value: string) => {
        setEditFormData(prev => ({
            ...prev,
            [field]: value
        }));
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
                description: editFormData.description,
            };

            // 변경사항 계산
            const originalData = {
                restaurant_name: restaurantToEdit.name,
                address: restaurantToEdit.address,
                phone: restaurantToEdit.phone || '',
                category: Array.isArray(restaurantToEdit.category) ? restaurantToEdit.category[0] : restaurantToEdit.category,
                youtube_link: restaurantToEdit.youtube_link || '',
                description: restaurantToEdit.description || ''
            };

            const changes_requested: Record<string, { from: any; to: any }> = {};
            Object.entries(updatedData).forEach(([key, value]) => {
                const originalValue = originalData[key === 'name' ? 'restaurant_name' : key as keyof typeof originalData];
                if (originalValue !== value) {
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
                    restaurant_name: updatedData.name,
                    address: updatedData.address,
                    phone: updatedData.phone,
                    category: [updatedData.category],
                    youtube_link: updatedData.youtube_link,
                    description: updatedData.description,
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

                    {/* 맛집 검색 */}
                    <Suspense fallback={<div className="w-72 h-10 bg-muted animate-pulse rounded" />}>
                        <RestaurantSearch
                            onRestaurantSelect={handleRestaurantSelect}
                            onRestaurantSearch={handleRestaurantSearch}
                            onSearchExecute={switchToSingleMap}
                        />
                    </Suspense>

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
                    <div className="flex items-center justify-center h-full bg-muted">
                        <div className="text-center space-y-4">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                            <div className="space-y-2">
                                <h2 className="text-lg font-semibold bg-gradient-primary bg-clip-text text-transparent">
                                    지도 준비 중...
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    잠시만 기다려주세요
                                </p>
                            </div>
                        </div>
                    </div>
                }>
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
                    />
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
                        <form onSubmit={handleEditSubmit} className="space-y-6">
                            {/* 현재 정보 표시 */}
                            <div className="p-4 bg-muted/50 rounded-lg">
                                <h3 className="font-semibold mb-2">현재 정보</h3>
                                <div className="text-sm space-y-1">
                                    <p><strong>이름:</strong> {restaurantToEdit.name}</p>
                                    <p><strong>주소:</strong> {restaurantToEdit.address}</p>
                                    <p><strong>전화번호:</strong> {restaurantToEdit.phone || '-'}</p>
                                    <p><strong>카테고리:</strong> {Array.isArray(restaurantToEdit.category) ? restaurantToEdit.category.join(', ') : restaurantToEdit.category}</p>
                                    <p><strong>유튜브:</strong> {restaurantToEdit.youtube_link || '-'}</p>
                                    <p><strong>쯔양 리뷰:</strong> {restaurantToEdit.description ? '있음' : '없음'}</p>
                                </div>
                            </div>

                            {/* 수정 폼 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="edit-name">맛집 이름 *</Label>
                                    <Input
                                        id="edit-name"
                                        name="name"
                                        value={editFormData.name}
                                        onChange={(e) => handleEditFormChange('name', e.target.value)}
                                        placeholder="맛집 이름을 입력하세요"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="edit-category">카테고리 *</Label>
                                    <Select
                                        value={editFormData.category}
                                        onValueChange={(value) => handleEditFormChange('category', value)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="카테고리를 선택해주세요" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="한식">한식</SelectItem>
                                            <SelectItem value="중식">중식</SelectItem>
                                            <SelectItem value="일식">일식</SelectItem>
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
                                            <SelectItem value="기타">기타</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2 md:col-span-2">
                                    <Label htmlFor="edit-address">주소 *</Label>
                                    <Input
                                        id="edit-address"
                                        name="address"
                                        value={editFormData.address}
                                        onChange={(e) => handleEditFormChange('address', e.target.value)}
                                        placeholder="맛집 주소를 입력하세요"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="edit-phone">전화번호</Label>
                                    <Input
                                        id="edit-phone"
                                        name="phone"
                                        value={editFormData.phone}
                                        onChange={(e) => handleEditFormChange('phone', e.target.value)}
                                        placeholder="전화번호를 입력하세요"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="edit-youtube">쯔양 유튜브 영상 링크</Label>
                                    <Input
                                        id="edit-youtube"
                                        name="youtube_link"
                                        value={editFormData.youtube_link}
                                        onChange={(e) => handleEditFormChange('youtube_link', e.target.value)}
                                        placeholder="https://www.youtube.com/watch?v=..."
                                    />
                                </div>

                                <div className="space-y-2 md:col-span-2">
                                    <Label htmlFor="edit-description">쯔양 리뷰</Label>
                                    <Textarea
                                        id="edit-description"
                                        name="description"
                                        value={editFormData.description}
                                        onChange={(e) => handleEditFormChange('description', e.target.value)}
                                        placeholder="쯔양의 리뷰 내용을 입력하세요"
                                        rows={4}
                                    />
                                </div>
                            </div>

                            {/* 변경사항 미리보기 */}
                            {(() => {
                                const changes: Array<{ field: string; from: any; to: any }> = [];
                                const originalData = {
                                    restaurant_name: restaurantToEdit.name,
                                    address: restaurantToEdit.address,
                                    phone: restaurantToEdit.phone || '',
                                    category: Array.isArray(restaurantToEdit.category) ? restaurantToEdit.category[0] : restaurantToEdit.category,
                                    youtube_link: restaurantToEdit.youtube_link || '',
                                    description: restaurantToEdit.description || ''
                                };

                                Object.entries(editFormData).forEach(([key, value]) => {
                                    const fieldName = key === 'name' ? 'restaurant_name' : key;
                                    const originalValue = originalData[fieldName as keyof typeof originalData];
                                    if (originalValue !== value) {
                                        const fieldLabels: Record<string, string> = {
                                            name: '이름',
                                            address: '주소',
                                            phone: '전화번호',
                                            category: '카테고리',
                                            youtube_link: '유튜브 링크',
                                            description: '리뷰'
                                        };
                                        changes.push({
                                            field: fieldLabels[key] || key,
                                            from: originalValue,
                                            to: value
                                        });
                                    }
                                });

                                return changes.length > 0 && (
                                    <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                        <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">🔄 요청된 변경사항:</p>
                                        <div className="space-y-1">
                                            {changes.map((change, index) => (
                                                <div key={index} className="text-xs">
                                                    <span className="font-medium text-blue-700 dark:text-blue-300">{change.field}:</span>
                                                    <span className="text-muted-foreground ml-1">{change.from || '(없음)'} → {change.to || '(없음)'}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="flex gap-3 pt-4">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsEditModalOpen(false)}
                                    className="flex-1"
                                >
                                    취소
                                </Button>
                                <Button
                                    type="submit"
                                    className="flex-1 bg-gradient-primary hover:opacity-90"
                                >
                                    수정 요청 제출
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
});

GlobalMapPage.displayName = 'GlobalMapPage';

export default GlobalMapPage;

