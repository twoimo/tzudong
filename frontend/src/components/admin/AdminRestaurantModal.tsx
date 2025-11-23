import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Restaurant, RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ChevronDown, X } from "lucide-react";

// 해외 국가 목록
const OVERSEAS_COUNTRIES = [
    "미국", "USA", "United States",
    "일본", "Japan",
    "대만", "Taiwan",
    "태국", "Thailand",
    "인도네시아", "Indonesia",
    "튀르키예", "Turkey", "Türkiye",
    "헝가리", "Hungary",
    "오스트레일리아", "Australia"
];

interface AdminRestaurantModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant?: Restaurant | null;
    onSuccess: (updatedRestaurant?: Restaurant) => void;
}

export function AdminRestaurantModal({
    isOpen,
    onClose,
    restaurant,
    onSuccess,
}: AdminRestaurantModalProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [customCategory, setCustomCategory] = useState(""); // 커스텀 카테고리 입력용
    const [isGeocodingNaver, setIsGeocodingNaver] = useState(false);
    const [isGeocodingGoogle, setIsGeocodingGoogle] = useState(false);
    const [isGeocoded, setIsGeocoded] = useState(false); // 재지오코딩 완료 여부
    const [geocodingResults, setGeocodingResults] = useState<Array<{
        road_address: string;
        jibun_address: string;
        english_address: string;
        address_elements: any;
        x: string;
        y: string;
    }>>([]);
    const [selectedGeocodingIndex, setSelectedGeocodingIndex] = useState<number | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        searchAddress: "", // 검색용 주소 입력
        road_address: "",
        jibun_address: "",
        english_address: "",
        address_elements: null as any,
        phone: "",
        categories: [] as string[],
        youtube_reviews: [] as { id: string; youtube_link: string; tzuyang_review: string }[],
        lat: "",
        lng: "",
    });

    useEffect(() => {
        if (restaurant) {
            // mergedRestaurants에서 모든 유튜브 링크-리뷰 쌍 추출
            const youtubeReviews = restaurant.mergedRestaurants?.map(r => ({
                id: r.id,
                youtube_link: r.youtube_link || "",
                tzuyang_review: r.tzuyang_review || "",
            })) || (restaurant.youtube_link ? [{
                id: restaurant.id,
                youtube_link: restaurant.youtube_link,
                tzuyang_review: restaurant.tzuyang_review || "",
            }] : []);

            setFormData({
                name: restaurant.name || "",
                searchAddress: restaurant.road_address || restaurant.jibun_address || "",
                road_address: restaurant.road_address || "",
                jibun_address: restaurant.jibun_address || "",
                english_address: restaurant.english_address || "",
                address_elements: restaurant.address_elements || null,
                phone: restaurant.phone || "",
                categories: Array.isArray(restaurant.categories)
                    ? restaurant.categories
                    : (restaurant.categories ? [restaurant.categories] : []),
                youtube_reviews: youtubeReviews,
                lat: String(restaurant.lat || ""),
                lng: String(restaurant.lng || ""),
            });
            setIsGeocoded(true); // 기존 데이터는 이미 지오코딩됨
        } else {
            resetForm();
        }
    }, [restaurant]);

    const resetForm = () => {
        setFormData({
            name: "",
            searchAddress: "",
            road_address: "",
            jibun_address: "",
            english_address: "",
            address_elements: null,
            phone: "",
            categories: [],
            youtube_reviews: [],
            lat: "",
            lng: "",
        });
        setIsGeocoded(false);
        setGeocodingResults([]);
        setSelectedGeocodingIndex(null);
    };

    // 시/군/구까지만 추출
    const extractCityDistrictGu = (address: string): string | null => {
        const regex = /(.*?[시도]\s+.*?[시군구])/;
        const match = address.match(regex);
        return match ? match[1] : null;
    };

    // 중복 제거 (지번 주소 기준)
    const removeDuplicateAddresses = (addresses: Array<{
        road_address: string;
        jibun_address: string;
        english_address: string;
        address_elements: any;
        x: string;
        y: string;
    }>) => {
        const seen = new Set<string>();
        return addresses.filter(addr => {
            if (seen.has(addr.jibun_address)) {
                return false;
            }
            seen.add(addr.jibun_address);
            return true;
        });
    };

    // 해외 주소 감지 함수
    const isOverseasAddress = (address: string, englishAddress?: string): boolean => {
        const checkText = `${address} ${englishAddress || ''}`;
        return OVERSEAS_COUNTRIES.some(country => checkText.includes(country));
    };

    // Google Geocoding API 호출 함수
    const geocodeWithGoogle = async (address: string, limit: number = 3) => {
        try {
            const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
            if (!apiKey) throw new Error('Google Maps API key not found');

            const response = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
            );
            const data = await response.json();

            if (data.status !== 'OK' || !data.results || data.results.length === 0) {
                return [];
            }

            return data.results.slice(0, limit).map((result: any) => {
                const location = result.geometry.location;
                return {
                    road_address: result.formatted_address,
                    jibun_address: result.formatted_address,
                    english_address: result.formatted_address,
                    address_elements: result.address_components,
                    x: String(location.lng),
                    y: String(location.lat),
                };
            });
        } catch (error) {
            console.error('Google Geocoding 에러:', error);
            throw error;
        }
    };

    // 지오코딩 함수 (여러 개 결과 반환)
    const geocodeAddressMultiple = async (name: string, address: string, limit: number = 3) => {
        try {
            const { data, error } = await supabase.functions.invoke('naver-geocode', {
                body: { query: address, count: limit }
            });

            if (error) throw new Error(error.message || JSON.stringify(error));
            if (!data || data.error) throw new Error(data?.error || '지오코딩 실패');
            if (!data.addresses || data.addresses.length === 0) return [];

            return data.addresses.slice(0, limit).map((addr: any) => ({
                road_address: addr.roadAddress,
                jibun_address: addr.jibunAddress,
                english_address: addr.englishAddress,
                address_elements: addr.addressElements,
                x: addr.x,
                y: addr.y,
            }));
        } catch (error) {
            console.error('지오코딩 에러:', error);
            throw error;
        }
    };

    // 재지오코딩 버튼 핸들러 - 네이버
    const handleGeocodeNaver = async () => {
        const trimmedAddress = formData.searchAddress.trim();
        const trimmedName = formData.name.trim();

        if (!trimmedAddress) {
            toast.error('주소를 입력해주세요');
            return;
        }

        if (!trimmedName) {
            toast.error('음식점명을 입력해주세요');
            return;
        }

        setIsGeocodingNaver(true);
        setGeocodingResults([]);
        setSelectedGeocodingIndex(null);
        setIsGeocoded(false);

        try {
            toast.info('네이버 Geocoding API로 검색 중...');
            
            // 1. name + 전체 주소로 지오코딩 (최대 3개)
            const fullAddressResults = await geocodeAddressMultiple(trimmedName, trimmedAddress, 3);

            // 2. name + 시/군/구까지만 (최대 3개)
            const shortAddress = extractCityDistrictGu(trimmedAddress);
            const shortAddressResults = shortAddress
                ? await geocodeAddressMultiple(trimmedName, shortAddress, 3)
                : [];

            // 3. 합치고 중복 제거
            const allResults = [...fullAddressResults, ...shortAddressResults];
            const uniqueResults = removeDuplicateAddresses(allResults);

            if (uniqueResults.length > 0) {
                setGeocodingResults(uniqueResults);
                toast.success(`${uniqueResults.length}개의 주소 후보를 찾았습니다. 하나를 선택해주세요.`);
            } else {
                toast.error('주소를 찾을 수 없습니다');
            }
        } catch (error) {
            console.error('Naver Geocoding error:', error);
            toast.error('네이버 지오코딩에 실패했습니다');
        } finally {
            setIsGeocodingNaver(false);
        }
    };

    // 재지오코딩 버튼 핸들러 - 구글
    const handleGeocodeGoogle = async () => {
        const trimmedAddress = formData.searchAddress.trim();
        const trimmedName = formData.name.trim();

        if (!trimmedAddress) {
            toast.error('주소를 입력해주세요');
            return;
        }

        if (!trimmedName) {
            toast.error('음식점명을 입력해주세요');
            return;
        }

        setIsGeocodingGoogle(true);
        setGeocodingResults([]);
        setSelectedGeocodingIndex(null);
        setIsGeocoded(false);

        try {
            toast.info('Google Geocoding API로 검색 중...');
            
            // 1. name + 전체 주소로 지오코딩
            const fullAddressResults = await geocodeWithGoogle(`${trimmedName} ${trimmedAddress}`, 3);
            
            // 2. 주소만으로 지오코딩
            const addressOnlyResults = await geocodeWithGoogle(trimmedAddress, 3);
            
            // 3. 합치고 중복 제거
            const allResults = [...fullAddressResults, ...addressOnlyResults];
            const uniqueResults = removeDuplicateAddresses(allResults);

            if (uniqueResults.length > 0) {
                setGeocodingResults(uniqueResults);
                toast.success(`${uniqueResults.length}개의 주소 후보를 찾았습니다. 하나를 선택해주세요.`);
            } else {
                toast.error('주소를 찾을 수 없습니다');
            }
        } catch (error) {
            console.error('Google Geocoding error:', error);
            toast.error('Google 지오코딩에 실패했습니다');
        } finally {
            setIsGeocodingGoogle(false);
        }
    };

    // 지오코딩 결과 선택
    const handleSelectGeocodingResult = (index: number) => {
        const selected = geocodingResults[index];
        setSelectedGeocodingIndex(index);
        setFormData(prev => ({
            ...prev,
            road_address: selected.road_address,
            jibun_address: selected.jibun_address,
            english_address: selected.english_address,
            address_elements: selected.address_elements,
            lat: selected.y,
            lng: selected.x,
        }));
        setIsGeocoded(true);
        toast.success('주소가 선택되었습니다');
    };

    // 네이버 지오코딩 API (단일 - 기존 호환용)
    const geocodeWithNaver = async (address: string) => {
        try {
            const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
            const clientSecret = import.meta.env.VITE_NAVER_MAP_CLIENT_SECRET;

            const response = await fetch(
                `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`,
                {
                    headers: {
                        'X-NCP-APIGW-API-KEY-ID': clientId,
                        'X-NCP-APIGW-API-KEY': clientSecret,
                    }
                }
            );

            const data = await response.json();

            if (data.addresses && data.addresses.length > 0) {
                const result = data.addresses[0];
                return {
                    road_address: result.roadAddress || "",
                    jibun_address: result.jibunAddress || "",
                    english_address: result.englishAddress || "",
                    address_elements: result.addressElements || [],
                    lat: parseFloat(result.y),
                    lng: parseFloat(result.x),
                };
            }
            return null;
        } catch (error) {
            console.error("Naver Geocoding error:", error);
            return null;
        }
        toast.success('주소가 선택되었습니다');
    };

    const handleAddressBlur = async () => {
        // 더 이상 사용하지 않음
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name.trim()) {
            toast.error("이름은 필수입니다");
            return;
        }

        if (!isGeocoded) {
            toast.error("재지오코딩을 먼저 수행해주세요");
            return;
        }

        const lat = parseFloat(formData.lat);
        const lng = parseFloat(formData.lng);

        if (isNaN(lat) || isNaN(lng)) {
            toast.error("올바른 좌표를 입력해주세요");
            return;
        }

        setIsSubmitting(true);

        try {
            if (restaurant) {
                // 공통 필드: 모든 레코드에 적용
                const commonData = {
                    name: formData.name.trim(),
                    road_address: formData.road_address.trim(),
                    jibun_address: formData.jibun_address.trim() || null,
                    english_address: formData.english_address.trim() || null,
                    address_elements: formData.address_elements || null,
                    phone: formData.phone.trim() || null,
                    categories: formData.categories,
                    lat,
                    lng,
                };

                // 1. 공통 필드를 모든 mergedRestaurants 레코드에 업데이트
                if (restaurant.mergedRestaurants && restaurant.mergedRestaurants.length > 0) {
                    const ids = restaurant.mergedRestaurants.map(r => r.id);
                    const { error: commonError } = await supabase
                        .from("restaurants")
                        .update(commonData)
                        .in("id", ids);

                    if (commonError) throw commonError;
                } else {
                    // mergedRestaurants가 없으면 현재 restaurant만 업데이트
                    const { error: commonError } = await supabase
                        .from("restaurants")
                        .update(commonData)
                        .eq("id", restaurant.id);

                    if (commonError) throw commonError;
                }

                // 2. 각 유튜브 링크-리뷰 쌍을 해당 레코드에 개별 업데이트
                for (const review of formData.youtube_reviews) {
                    const { error: reviewError } = await supabase
                        .from("restaurants")
                        .update({
                            youtube_link: review.youtube_link.trim() || null,
                            tzuyang_review: review.tzuyang_review.trim() || null,
                        })
                        .eq("id", review.id);

                    if (reviewError) {
                        console.error(`레코드 ${review.id} 업데이트 실패:`, reviewError);
                    }
                }

                toast.success("맛집이 수정되었습니다");
                
                // 첫 번째 레코드의 업데이트된 데이터 가져오기
                const { data: fetchedRestaurant } = await supabase
                    .from("restaurants")
                    .select("*")
                    .eq("id", restaurant.id)
                    .single();

                onSuccess(fetchedRestaurant || undefined);
            } else {
                // 새 맛집 등록
                const restaurantData = {
                    name: formData.name.trim(),
                    road_address: formData.road_address.trim(),
                    jibun_address: formData.jibun_address.trim() || null,
                    english_address: formData.english_address.trim() || null,
                    address_elements: formData.address_elements || null,
                    phone: formData.phone.trim() || null,
                    categories: formData.categories,
                    youtube_link: formData.youtube_reviews[0]?.youtube_link?.trim() || null,
                    tzuyang_review: formData.youtube_reviews[0]?.tzuyang_review?.trim() || null,
                    lat,
                    lng,
                };

                const { error } = await supabase.from("restaurants").insert(restaurantData);
                if (error) throw error;

                toast.success("맛집이 등록되었습니다");
                onSuccess();
            }

            resetForm();
            onClose();
        } catch (error) {
            console.error("Restaurant submission error:", error);
            const errorMessage = error instanceof Error ? error.message : "작업에 실패했습니다";
            toast.error(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!restaurant) return;

        if (!confirm("정말로 이 맛집을 삭제하시겠습니까?\n\n삭제된 데이터는 복구할 수 없습니다.")) {
            return;
        }

        setIsSubmitting(true);

        try {
            // 해결책 1: 코드 레벨에서 제보 먼저 삭제 (임시 해결책)
            // 참고: 데이터베이스 레벨에서 CASCADE DELETE 설정을 권장합니다.
            // 새 마이그레이션 파일: 20251021200000_update_restaurant_submissions_cascade.sql

            const { error: submissionsError } = await supabase
                .from("restaurant_submissions")
                .delete()
                .eq("approved_restaurant_id", restaurant.id);

            if (submissionsError) {
                console.error("Submissions deletion error:", submissionsError);
                // 제보 삭제 실패 시에도 계속 진행 (외래 키 제약 조건으로 어차피 실패할 것임)
            }

            // 레스토랑 삭제
            const { error } = await supabase
                .from("restaurants")
                .delete()
                .eq("id", restaurant.id);

            if (error) throw error;

            toast.success("맛집이 삭제되었습니다");
            onSuccess();
            onClose();
        } catch (error) {
            console.error("Restaurant deletion error:", error);
            const errorMessage = error instanceof Error ? error.message : "삭제에 실패했습니다";
            toast.error(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl">
                        {restaurant ? "🏪 맛집 수정" : "🏪 맛집 등록"}
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">이름 *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="맛집 이름"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>카테고리 *</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="w-full justify-between"
                                    >
                                        <span className="truncate">
                                            {formData.categories.length > 0
                                                ? `${formData.categories.length}개 선택됨`
                                                : "카테고리 선택"
                                            }
                                        </span>
                                        <ChevronDown className="h-4 w-4 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64" align="start">
                                    <div className="space-y-2">
                                        <h4 className="font-semibold text-sm">카테고리 선택</h4>

                                        {/* 커스텀 카테고리 입력 */}
                                        <div className="flex gap-2 pb-2 border-b">
                                            <Input
                                                placeholder="새 카테고리 입력"
                                                value={customCategory}
                                                onChange={(e) => setCustomCategory(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && customCategory.trim()) {
                                                        e.preventDefault();
                                                        const newCategory = customCategory.trim();
                                                        if (!formData.categories.includes(newCategory)) {
                                                            setFormData({
                                                                ...formData,
                                                                categories: [...formData.categories, newCategory]
                                                            });
                                                        }
                                                        setCustomCategory("");
                                                    }
                                                }}
                                                className="flex-1"
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => {
                                                    const newCategory = customCategory.trim();
                                                    if (newCategory && !formData.categories.includes(newCategory)) {
                                                        setFormData({
                                                            ...formData,
                                                            categories: [...formData.categories, newCategory]
                                                        });
                                                        setCustomCategory("");
                                                    }
                                                }}
                                                disabled={!customCategory.trim()}
                                            >
                                                추가
                                            </Button>
                                        </div>

                                        <div className="space-y-2 max-h-48 overflow-y-auto">
                                            {RESTAURANT_CATEGORIES.map((category) => (
                                                <div key={category} className="flex items-center space-x-2">
                                                    <Checkbox
                                                        id={`admin-category-${category}`}
                                                        checked={formData.categories.includes(category)}
                                                        onCheckedChange={(checked) => {
                                                            if (checked) {
                                                                setFormData({
                                                                    ...formData,
                                                                    categories: [...formData.categories, category]
                                                                });
                                                            } else {
                                                                setFormData({
                                                                    ...formData,
                                                                    categories: formData.categories.filter(c => c !== category)
                                                                });
                                                            }
                                                        }}
                                                    />
                                                    <Label
                                                        htmlFor={`admin-category-${category}`}
                                                        className="text-sm cursor-pointer flex-1"
                                                    >
                                                        {category}
                                                    </Label>
                                                </div>
                                            ))}
                                        </div>
                                        {formData.categories.length > 0 && (
                                            <div className="pt-2 border-t">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setFormData({ ...formData, categories: [] })}
                                                    className="w-full"
                                                >
                                                    선택 해제
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </PopoverContent>
                            </Popover>
                            {formData.categories.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {formData.categories.map((category) => (
                                        <Badge key={category} variant="secondary" className="text-xs">
                                            {category}
                                            <button
                                                type="button"
                                                onClick={() => setFormData({
                                                    ...formData,
                                                    categories: formData.categories.filter(c => c !== category)
                                                })}
                                                className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 재지오코딩 섹션 */}
                    <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                        <div className="space-y-2">
                            <Label htmlFor="searchAddress">주소 검색 *</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="searchAddress"
                                    value={formData.searchAddress}
                                    onChange={(e) => setFormData({ ...formData, searchAddress: e.target.value })}
                                    placeholder="서울시 강남구... or Las Vegas..."
                                    className="flex-1"
                                />
                                <Button
                                    type="button"
                                    onClick={handleGeocodeNaver}
                                    disabled={isGeocodingNaver || isGeocodingGoogle || !formData.searchAddress.trim() || !formData.name.trim()}
                                    variant={isGeocodingNaver ? "default" : "outline"}
                                    className="whitespace-nowrap"
                                >
                                    {isGeocodingNaver ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            검색 중...
                                        </>
                                    ) : (
                                        "네이버 지오코딩"
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={handleGeocodeGoogle}
                                    disabled={isGeocodingNaver || isGeocodingGoogle || !formData.searchAddress.trim() || !formData.name.trim()}
                                    variant={isGeocodingGoogle ? "default" : "outline"}
                                    className="whitespace-nowrap"
                                >
                                    {isGeocodingGoogle ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            검색 중...
                                        </>
                                    ) : (
                                        "Google 지오코딩"
                                    )}
                                </Button>
                            </div>
                            {isGeocoded && selectedGeocodingIndex !== null && (
                                <p className="text-xs text-green-600">✓ 지오코딩 완료</p>
                            )}
                        </div>

                        {/* 지오코딩 결과 목록 */}
                        {geocodingResults.length > 0 && (
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold">주소 후보 선택 ({geocodingResults.length}개)</Label>
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {geocodingResults.map((result, index) => (
                                        <Card
                                            key={index}
                                            className={`p-3 cursor-pointer transition-all ${
                                                selectedGeocodingIndex === index
                                                    ? 'border-primary bg-primary/5'
                                                    : 'hover:border-primary/50'
                                            }`}
                                            onClick={() => handleSelectGeocodingResult(index)}
                                        >
                                            <div className="space-y-1 text-sm">
                                                <div className="flex items-center justify-between">
                                                    <p className="font-medium">도로명: {result.road_address}</p>
                                                    {selectedGeocodingIndex === index && (
                                                        <Badge variant="default" className="text-xs">선택됨</Badge>
                                                    )}
                                                </div>
                                                <p className="text-muted-foreground">지번: {result.jibun_address}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    좌표: {result.y}, {result.x}
                                                </p>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 선택된 지오코딩 결과 표시 */}
                        {isGeocoded && selectedGeocodingIndex !== null && (
                            <div className="space-y-2 text-sm p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                                <p className="font-semibold text-green-700 dark:text-green-300">✓ 선택된 주소</p>
                                <div className="space-y-1">
                                    <div>
                                        <Label className="text-xs text-muted-foreground">도로명 주소</Label>
                                        <p className="text-sm">{formData.road_address}</p>
                                    </div>
                                    <div>
                                        <Label className="text-xs text-muted-foreground">지번 주소</Label>
                                        <p className="text-sm">{formData.jibun_address}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <Label className="text-xs text-muted-foreground">위도</Label>
                                            <p className="text-sm">{formData.lat}</p>
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">경도</Label>
                                            <p className="text-sm">{formData.lng}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="phone">전화번호</Label>
                        <Input
                            id="phone"
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            placeholder="02-1234-5678"
                        />
                    </div>

                    {/* 유튜브 링크 & 쯔양 리뷰 목록 */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <Label className="text-base font-semibold">유튜브 링크 & 쯔양 리뷰</Label>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setFormData({
                                    ...formData,
                                    youtube_reviews: [...formData.youtube_reviews, {
                                        id: `new-${Date.now()}`,
                                        youtube_link: "",
                                        tzuyang_review: "",
                                    }]
                                })}
                            >
                                + 추가
                            </Button>
                        </div>

                        {formData.youtube_reviews.length === 0 ? (
                            <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                                등록된 유튜브 링크가 없습니다. '+ 추가' 버튼을 눌러 추가하세요.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {formData.youtube_reviews.map((review, index) => (
                                    <Card key={review.id} className="p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-sm font-medium">링크 #{index + 1}</Label>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setFormData({
                                                    ...formData,
                                                    youtube_reviews: formData.youtube_reviews.filter((_, i) => i !== index)
                                                })}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor={`youtube_link_${index}`} className="text-xs">유튜브 링크</Label>
                                            <Input
                                                id={`youtube_link_${index}`}
                                                value={review.youtube_link}
                                                onChange={(e) => {
                                                    const newReviews = [...formData.youtube_reviews];
                                                    newReviews[index].youtube_link = e.target.value;
                                                    setFormData({ ...formData, youtube_reviews: newReviews });
                                                }}
                                                placeholder="https://youtube.com/watch?v=..."
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor={`tzuyang_review_${index}`} className="text-xs">쯔양 리뷰</Label>
                                            <Textarea
                                                id={`tzuyang_review_${index}`}
                                                value={review.tzuyang_review}
                                                onChange={(e) => {
                                                    const newReviews = [...formData.youtube_reviews];
                                                    newReviews[index].tzuyang_review = e.target.value;
                                                    setFormData({ ...formData, youtube_reviews: newReviews });
                                                }}
                                                placeholder="쯔양이 어떤 리뷰를 남겼는지 입력해주세요..."
                                                rows={3}
                                            />
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2">
                        {restaurant && (
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={handleDelete}
                                disabled={isSubmitting}
                            >
                                삭제
                            </Button>
                        )}
                        <div className="flex-1" />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button
                            type="submit"
                            className="bg-gradient-primary hover:opacity-90"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    처리 중...
                                </>
                            ) : restaurant ? (
                                "수정"
                            ) : (
                                "등록"
                            )}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

