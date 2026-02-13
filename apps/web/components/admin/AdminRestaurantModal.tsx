import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Restaurant, RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ChevronDown, X } from "lucide-react";
import { checkRestaurantDuplicate } from '@/lib/db-conflict-checker';
import {
    ADMIN_MODAL_ACTION,
    ADMIN_MODAL_CONTENT_MD_FLEX,
    ADMIN_MODAL_CONTENT_SM,
    ADMIN_MODAL_FOOTER,
    ADMIN_MODAL_FOOTER_DIVIDER,
    ADMIN_MODAL_SCROLL_BODY,
} from "./admin-modal-styles";

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

// YouTube Video ID 추출 함수
const extractVideoId = (url: string): string | null => {
    const patterns = [
        /youtube\.com\/watch\?v=([^&]+)/,  // Standard watch URL
        /youtu\.be\/([^?]+)/,              // Shortened URL
        /youtube\.com\/embed\/([^?]+)/,    // Embed URL
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
};

// YouTube 메타데이터 가져오기 함수
const fetchYouTubeMeta = async (youtubeLink: string) => {
    const videoId = extractVideoId(youtubeLink);
    if (!videoId) {
        console.error('Invalid YouTube URL:', youtubeLink);
        return null;
    }

    try {
        // YouTube Data API v3 호출
        const apiKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY_BYEON || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
        if (!apiKey) {
            console.error('YouTube API key not found');
            return null;
        }

        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`
        );

        if (!response.ok) {
            throw new Error('YouTube API request failed');
        }

        const data = await response.json();

        if (!data.items || data.items.length === 0) {
            console.error('Video not found:', videoId);
            return null;
        }

        const video = data.items[0];
        const snippet = video.snippet;
        const contentDetails = video.contentDetails;

        // ISO 8601 duration을 초로 변환
        const parseDuration = (duration: string): number => {
            const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (!match) return 0;

            const hours = parseInt(match[1] || '0');
            const minutes = parseInt(match[2] || '0');
            const seconds = parseInt(match[3] || '0');

            return hours * 3600 + minutes * 60 + seconds;
        };

        const durationSeconds = parseDuration(contentDetails.duration);
        const description = snippet.description || '';
        const adKeywords = ['유료', '광고', '지원', '협찬'];
        const isAds = adKeywords.some(keyword => description.toLowerCase().includes(keyword));

        return {
            title: snippet.title,
            publishedAt: snippet.publishedAt,
            is_shorts: durationSeconds <= 180,
            duration: durationSeconds,
            ads_info: {
                is_ads: isAds,
                what_ads: isAds ? '수동 확인 필요' : null  // 간단히 처리 (OpenAI 없이)
            }
        };
    } catch (error) {
        console.error('Error fetching YouTube metadata:', error);
        return null;
    }
};

// unique_id 생성 함수 (Python 버전과 동일하게 SHA-256 사용)
// youtube_link + name + tzuyang_review 순서로 해시
const generateUniqueId = async (youtubeLink: string, name: string, tzuyangReview: string): Promise<string> => {
    const keyString = (youtubeLink || "") + (name || "") + (tzuyangReview || "");

    // SHA-256 해시 생성 (Web Crypto API 사용)
    const encoder = new TextEncoder();
    const data = encoder.encode(keyString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
};

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
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletedReviewIds, setDeletedReviewIds] = useState<string[]>([]); // X 버튼으로 삭제된 기존 레코드 ID 추적
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
        if (isOpen && restaurant) {
            // 모달이 열릴 때마다 데이터베이스의 원본 데이터로 초기화
            setDeletedReviewIds([]); // 삭제 추적 초기화
            // mergedRestaurants에서 status가 'approved'인 유튜브 링크-리뷰 쌍만 추출
            const youtubeReviews = restaurant.mergedRestaurants
                ?.filter(r => r.status === 'approved') // 승인된 것만
                .map(r => ({
                    id: r.id,
                    youtube_link: r.youtube_link || "",
                    tzuyang_review: r.tzuyang_review || "",
                })) || (restaurant.youtube_link && restaurant.status === 'approved' ? [{
                    id: restaurant.id,
                    youtube_link: restaurant.youtube_link,
                    tzuyang_review: restaurant.tzuyang_review || "",
                }] : []);

            // 병합된 모든 레스토랑에서 카테고리 수집 (중복 제거)
            // restaurant.categories에 이미 병합된 카테고리가 있지만, mergedRestaurants에서 누락된 것도 수집
            const allCategories: string[] = [];

            // 1. 먼저 restaurant.categories 추가 (이미 병합된 값)
            if (Array.isArray(restaurant.categories)) {
                restaurant.categories.forEach((cat: string) => {
                    if (!allCategories.includes(cat)) {
                        allCategories.push(cat);
                    }
                });
            } else if (restaurant.categories) {
                const cat = restaurant.categories as unknown as string;
                if (!allCategories.includes(cat)) {
                    allCategories.push(cat);
                }
            }

            // 2. mergedRestaurants에서 추가 카테고리 수집
            if (restaurant.mergedRestaurants && restaurant.mergedRestaurants.length > 0) {
                restaurant.mergedRestaurants.forEach(r => {
                    if (Array.isArray(r.categories)) {
                        r.categories.forEach((cat: string) => {
                            if (!allCategories.includes(cat)) {
                                allCategories.push(cat);
                            }
                        });
                    } else if (r.categories) {
                        const cat = r.categories as unknown as string;
                        if (!allCategories.includes(cat)) {
                            allCategories.push(cat);
                        }
                    }
                });
            }

            setFormData({
                name: restaurant.name || "",
                searchAddress: restaurant.road_address || restaurant.jibun_address || "",
                road_address: restaurant.road_address || "",
                jibun_address: restaurant.jibun_address || "",
                english_address: restaurant.english_address || "",
                address_elements: restaurant.address_elements || null,
                phone: restaurant.phone || "",
                categories: allCategories,
                youtube_reviews: youtubeReviews,
                lat: String(restaurant.lat || ""),
                lng: String(restaurant.lng || ""),
            });
            setIsGeocoded(true); // 기존 데이터는 이미 지오코딩됨
            setGeocodingResults([]); // 지오코딩 결과 초기화
            setSelectedGeocodingIndex(null); // 선택 인덱스 초기화
        } else if (isOpen && !restaurant) {
            resetForm();
        }
    }, [restaurant, isOpen]);

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
            const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
            if (!apiKey) throw new Error('Google Maps API key not found');

            const response = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
            );
            const data = await response.json();

            if (data.status !== 'OK') {
                const errorMsg = data.error_message || data.status;
                console.error('Google Geocoding API Error:', data.status, errorMsg);
                throw new Error(`Google API 오류: ${data.status} (${errorMsg})`);
            }

            if (!data.results || data.results.length === 0) {
                return [];
            }

            return data.results.slice(0, limit).map((result: any) => {
                const location = result.geometry.location;
                return {
                    road_address: result.formatted_address,
                    jibun_address: '', // Google은 지번 주소 제공 안 함
                    english_address: '', // Google은 별도 영어 주소 제공 안 함
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
            const clientId = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;
            const clientSecret = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_SECRET;

            const response = await fetch(
                `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`,
                {
                    headers: {
                        'X-NCP-APIGW-API-KEY-ID': clientId || '',
                        'X-NCP-APIGW-API-KEY': clientSecret || '',
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

        // 유튜브 링크-리뷰 필수 입력 검증
        for (const review of formData.youtube_reviews) {
            if (!review.youtube_link.trim() || !review.tzuyang_review.trim()) {
                toast.error("모든 유튜브 링크와 쯔양 리뷰를 입력해주세요");
                return;
            }
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
                    approved_name: formData.name.trim(), // approved_name 동기화
                    road_address: formData.road_address.trim(),
                    jibun_address: formData.jibun_address.trim() || null,
                    english_address: formData.english_address.trim() || null,
                    address_elements: formData.address_elements || null,
                    phone: formData.phone.trim() || null,
                    categories: formData.categories,
                    lat,
                    lng,
                };

                // 기존 레코드 ID들 수집
                const existingIds = restaurant.mergedRestaurants && restaurant.mergedRestaurants.length > 0
                    ? restaurant.mergedRestaurants.map(r => r.id)
                    : [restaurant.id];

                // 기존 유튜브 링크들
                const existingYoutubeLinks = formData.youtube_reviews
                    .filter(r => existingIds.includes(r.id))
                    .map(r => r.youtube_link.trim());

                // 새로운 유튜브 링크들 (id가 'new-'로 시작하는 것들)
                const newReviews = formData.youtube_reviews.filter(r => r.id.startsWith('new-'));

                // 1. X 버튼으로 삭제된 레코드를 소프트 삭제 (status = 'deleted')
                if (deletedReviewIds.length > 0) {
                    const { error: deleteError } = await supabase
                        .from('restaurants')
                        // @ts-expect-error - Supabase 자동 생성 타입 문제
                        .update({
                            status: 'deleted',
                            updated_at: new Date().toISOString(),
                        })
                        .in('id', deletedReviewIds);

                    if (deleteError) {
                        console.error('소프트 삭제 실패:', deleteError);
                        toast.error('일부 항목 삭제에 실패했습니다');
                    } else {

                    }
                }

                // 2. 공통 필드를 모든 기존 레코드에 업데이트
                const { error: commonError } = await (supabase
                    .from("restaurants") as any)
                    .update(commonData)
                    .in("id", existingIds);

                if (commonError) throw commonError;

                // 3. 각 기존 유튜브 링크-리뷰 쌍을 해당 레코드에 개별 업데이트
                for (const review of formData.youtube_reviews) {
                    if (review.id.startsWith('new-')) continue; // 새 레코드는 스킵

                    const { error: reviewError } = await (supabase
                        .from("restaurants") as any)
                        .update({
                            youtube_link: review.youtube_link.trim() || null,
                            tzuyang_review: review.tzuyang_review.trim() || null,
                        })
                        .eq("id", review.id);

                    if (reviewError) {
                        console.error(`레코드 ${review.id} 업데이트 실패:`, reviewError);
                    }
                }

                // 4. 새로운 유튜브 링크-리뷰가 있으면 신규 레코드 생성
                let hasError = false; // 에러 플래그

                for (const newReview of newReviews) {
                    const youtubeLink = newReview.youtube_link.trim();
                    const tzuyangReview = newReview.tzuyang_review.trim();

                    // unique_id 생성 (youtube_link + name + 쯔양리뷰) - Python과 동일
                    const uniqueId = await generateUniqueId(
                        youtubeLink,
                        formData.name.trim(),
                        tzuyangReview
                    );

                    // 중복 검사
                    const duplicateCheck = await checkRestaurantDuplicate(
                        formData.name.trim(),
                        formData.jibun_address.trim(),
                        undefined, // 신규 레코드이므로 id는 없음
                        youtubeLink
                    );

                    if (duplicateCheck.isDuplicate) {
                        // 중복 발견 - 유튜브 링크 비교
                        const matchedYoutubeLink = duplicateCheck.matchedRestaurant?.youtube_link?.trim() || null;

                        if (youtubeLink === matchedYoutubeLink) {
                            // 같은 유튜브 링크 - 중복 에러
                            toast.error(`❌ 중복: "${formData.name.trim()}" 음식점에 이미 동일한 유튜브 링크가 존재합니다.`);
                            hasError = true;
                            break; // 더 이상 진행하지 않음
                        }
                        // 유튜브 링크가 다르면 계속 진행 (아래 INSERT)
                    }

                    // YouTube 메타데이터 가져오기
                    toast.info('YouTube 메타데이터를 가져오는 중...');
                    const youtubeMeta = await fetchYouTubeMeta(youtubeLink);

                    if (!youtubeMeta) {
                        toast.warning(`YouTube 메타데이터를 가져올 수 없습니다: ${youtubeLink}`);
                    }

                    // 신규 레코드 생성
                    const { error: insertError } = await (supabase
                        .from("restaurants") as any)
                        .insert({
                            ...commonData,
                            unique_id: uniqueId,
                            youtube_link: youtubeLink,
                            tzuyang_review: tzuyangReview,
                            youtube_meta: youtubeMeta,
                            source_type: 'admin',
                            status: 'approved',
                            geocoding_success: true,
                            is_missing: false,
                            is_not_selected: false,
                        });

                    if (insertError) {
                        console.error('신규 레코드 추가 실패:', insertError);
                        toast.error(`신규 유튜브 링크 추가 실패: ${insertError.message}`);
                        hasError = true;
                        break;
                    } else {

                        toast.success(`✅ 신규 유튜브 링크 추가 성공!`);
                    }
                }

                // 에러가 있으면 모달을 닫지 않음
                if (hasError) {
                    setIsSubmitting(false);
                    return;
                }

                toast.success("맛집이 수정되었습니다");

                // [BUG FIX] 병합된 레스토랑 정보가 손실되지 않도록 전체 그룹 재조회 및 구성
                const { data: allUpdatedRestaurants } = await supabase
                    .from("restaurants")
                    .select("*, name:approved_name")
                    .in("id", existingIds);

                if (allUpdatedRestaurants && allUpdatedRestaurants.length > 0) {
                    const primaryRestaurant = (allUpdatedRestaurants as any[]).find(r => r.id === restaurant.id);
                    const mergedChildren = (allUpdatedRestaurants as any[]).filter(r => r.id !== restaurant.id);

                    if (primaryRestaurant) {
                        const finalRestaurant = {
                            ...primaryRestaurant,
                            mergedRestaurants: mergedChildren.length > 0 ? mergedChildren : (restaurant.mergedRestaurants || [])
                        };
                        onSuccess(finalRestaurant as unknown as Restaurant);
                    } else {
                        onSuccess(undefined);
                    }
                } else {
                    onSuccess(undefined);
                }
            } else {
                // 새 맛집 등록
                const restaurantData = {
                    approved_name: formData.name.trim(), // approved_name 동기화
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

                const { error } = await (supabase.from("restaurants") as any).insert(restaurantData);
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

        setIsSubmitting(true);

        try {
            // 소프트 삭제: status를 'deleted'로 변경
            const { error } = await supabase
                .from("restaurants")
                // @ts-expect-error - Supabase 자동 생성 타입 문제
                .update({
                    status: 'deleted',
                    updated_at: new Date().toISOString(),
                })
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
            <DialogContent className={ADMIN_MODAL_CONTENT_MD_FLEX}>
                <DialogHeader>
                    <DialogTitle className="text-2xl">
                        {restaurant ? "맛집 수정" : "맛집 등록"}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {restaurant ? "맛집 정보를 수정합니다" : "새로운 맛집을 등록합니다"}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="mt-4">
                    <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">이름 *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="맛집 이름"
                                autoComplete="off"
                                enterKeyHint="next"
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
                                <PopoverContent
                                    className="w-64 p-0"
                                    align="start"
                                    onWheel={(e) => e.stopPropagation()}
                                    onTouchMove={(e) => e.stopPropagation()}
                                >
                                    <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
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

                                        <div className="space-y-2">
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
                                    autoComplete="street-address"
                                    enterKeyHint="search"
                                />
                                <Button
                                    type="button"
                                    onClick={handleGeocodeNaver}
                                    disabled={isGeocodingNaver || isGeocodingGoogle || !formData.searchAddress.trim() || !formData.name.trim()}
                                    variant={isGeocodingNaver ? "default" : "outline"}
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
                                            className={`p-3 cursor-pointer transition-all ${selectedGeocodingIndex === index
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
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            placeholder="02-1234-5678"
                            autoComplete="tel"
                            enterKeyHint="next"
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
                                                onClick={() => {
                                                    const reviewToDelete = formData.youtube_reviews[index];
                                                    // 기존 레코드(new-로 시작하지 않는 ID)면 삭제 목록에 추가
                                                    if (!reviewToDelete.id.startsWith('new-')) {
                                                        setDeletedReviewIds([...deletedReviewIds, reviewToDelete.id]);
                                                    }
                                                    // UI에서 제거
                                                    setFormData({
                                                        ...formData,
                                                        youtube_reviews: formData.youtube_reviews.filter((_, i) => i !== index)
                                                    });
                                                }}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor={`youtube_link_${index}`} className="text-xs">유튜브 링크</Label>
                                            <Input
                                                id={`youtube_link_${index}`}
                                                type="url"
                                                value={review.youtube_link}
                                                onChange={(e) => {
                                                    const newReviews = [...formData.youtube_reviews];
                                                    newReviews[index].youtube_link = e.target.value;
                                                    setFormData({ ...formData, youtube_reviews: newReviews });
                                                }}
                                                placeholder="https://youtube.com/watch?v=..."
                                                autoComplete="url"
                                                enterKeyHint="next"
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
                    </div>

                    <DialogFooter className={ADMIN_MODAL_FOOTER_DIVIDER}>
                        {restaurant && (
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={() => setShowDeleteConfirm(true)}
                                disabled={isSubmitting}
                                className={`${ADMIN_MODAL_ACTION} mr-auto`}
                            >
                                삭제
                            </Button>
                        )}
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className={ADMIN_MODAL_ACTION}
                        >
                            취소
                        </Button>
                        <Button
                            type="submit"
                            className={`${ADMIN_MODAL_ACTION} bg-gradient-primary hover:opacity-90`}
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
                    </DialogFooter>
                </form>
            </DialogContent>

            {/* 삭제 확인 모달 */}
            <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <AlertDialogContent className={ADMIN_MODAL_CONTENT_SM}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>맛집 삭제 확인</AlertDialogTitle>
                        <AlertDialogDescription className={ADMIN_MODAL_SCROLL_BODY}>
                            정말로 이 맛집을 삭제하시겠습니까?
                            <br />
                            <br />
                            <span className="font-semibold text-destructive">
                                삭제된 데이터는 복구할 수 없습니다.
                            </span>
                            {restaurant && (
                                <div className="mt-4 p-3 bg-muted rounded-md">
                                    <p className="font-medium">{restaurant.name}</p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {restaurant.jibun_address || restaurant.road_address}
                                    </p>
                                </div>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className={ADMIN_MODAL_FOOTER}>
                        <AlertDialogCancel className={ADMIN_MODAL_ACTION}>취소</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className={`${ADMIN_MODAL_ACTION} bg-destructive hover:bg-destructive/90`}
                        >
                            삭제
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Dialog>
    );
}

