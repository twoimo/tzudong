import {
    useState,
    useEffect,
    useCallback,
    useRef,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MOBILE_FULL_FORM_SHEET, mobileSheetStyles } from "@/components/ui/mobile-sheet-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { RESTAURANT_MERGE_SELECT } from "@/hooks/use-restaurants";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/no-toast";
import { Loader2, ChevronDown, X } from "lucide-react";
import { checkRestaurantDuplicate } from '@/lib/db-conflict-checker';
import { canonicalizeYoutubeLink, extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import { useImmediateMobileOrTablet } from "@/hooks/useDeviceType";
import { cn } from "@/lib/utils";
import {
    ADMIN_MODAL_ACTION,
    ADMIN_MODAL_CONTENT_MD_FLEX,
    ADMIN_MODAL_CONTENT_SM,
    ADMIN_MODAL_FOOTER,
    ADMIN_MODAL_FOOTER_DIVIDER,
    ADMIN_MODAL_SCROLL_BODY,
} from "@/components/admin/admin-modal-styles";

// YouTube 메타데이터 가져오기 함수
const fetchYouTubeMeta = async (youtubeLink: string) => {
    const videoId = extractVideoIdFromYoutubeLink(youtubeLink);
    if (!videoId) {
        console.error('Invalid YouTube URL:', youtubeLink);
        return null;
    }

    try {
        // YouTube Data API v3 호출
        const apiKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY_BYEON;
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
    const keyString = (canonicalizeYoutubeLink(youtubeLink) || "") + (name || "") + (tzuyangReview || "");

    // SHA-256 해시 생성 (Web Crypto API 사용)
    const encoder = new TextEncoder();
    const data = encoder.encode(keyString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
};

const isRestaurantIdentityDuplicateError = (error: unknown): boolean => {
    if (!error || typeof error !== "object") return false;

    const candidate = error as { code?: string; message?: string; details?: string };
    const combinedMessage = `${candidate.message || ""} ${candidate.details || ""}`;

    return candidate.code === "23505" && combinedMessage.includes("idx_restaurants_active_video_identity");
};

interface AdminRestaurantModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant?: Restaurant | null;
    onSuccess: (updatedRestaurant?: Restaurant) => void;
    presentation?: 'auto' | 'map-panel';
}

type DesktopAdminRestaurantPanelPosition = {
    x: number;
    y: number;
};

type DesktopAdminRestaurantPanelDragState = {
    pointerId: number;
    startX: number;
    startY: number;
    initialLeft: number;
    initialTop: number;
    originX: number;
    originY: number;
    panelWidth: number;
    panelHeight: number;
};

const DESKTOP_ADMIN_RESTAURANT_PANEL_VIEWPORT_MARGIN = 16;
const DESKTOP_ADMIN_RESTAURANT_PANEL_KEYBOARD_STEP = 24;
const DEFAULT_DESKTOP_ADMIN_RESTAURANT_PANEL_POSITION: DesktopAdminRestaurantPanelPosition = { x: 0, y: 0 };

const clampDesktopAdminRestaurantPanelAxis = (value: number, min: number, max: number) => {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
};

type AddressElement = Record<string, unknown>;
type AddressElementsValue = AddressElement | AddressElement[] | null;

interface GeocodingResultItem {
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: AddressElementsValue;
    x: string;
    y: string;
}

interface NaverGeocodeAddressItem {
    roadAddress: string;
    jibunAddress: string;
    englishAddress: string;
    addressElements: AddressElementsValue;
    x: string;
    y: string;
}

interface NaverGeocodeResponse {
    error?: string;
    addresses?: NaverGeocodeAddressItem[];
}

export function AdminRestaurantModal({
    isOpen,
    onClose,
    restaurant,
    onSuccess,
    presentation = 'auto',
}: AdminRestaurantModalProps) {
    const isMobileOrTablet = useImmediateMobileOrTablet();
    const shouldRenderMapPanel = presentation === 'map-panel' && !isMobileOrTablet;
    const shouldRenderSheetFrame = isMobileOrTablet || shouldRenderMapPanel;
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletedReviewIds, setDeletedReviewIds] = useState<string[]>([]); // X 버튼으로 삭제된 기존 레코드 ID 추적
    const [customCategory, setCustomCategory] = useState(""); // 커스텀 카테고리 입력용
    const [isGeocodingNaver, setIsGeocodingNaver] = useState(false);
    const [isGeocoded, setIsGeocoded] = useState(false); // 재지오코딩 완료 여부
    const [geocodingResults, setGeocodingResults] = useState<GeocodingResultItem[]>([]);
    const [selectedGeocodingIndex, setSelectedGeocodingIndex] = useState<number | null>(null);
    const [desktopAdminRestaurantPanelPosition, setDesktopAdminRestaurantPanelPosition] = useState<DesktopAdminRestaurantPanelPosition>(DEFAULT_DESKTOP_ADMIN_RESTAURANT_PANEL_POSITION);
    const adminRestaurantFormRef = useRef<HTMLFormElement>(null);
    const desktopAdminRestaurantPanelRef = useRef<HTMLElement>(null);
    const desktopAdminRestaurantPanelDragRef = useRef<DesktopAdminRestaurantPanelDragState | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        searchAddress: "", // 검색용 주소 입력
        road_address: "",
        jibun_address: "",
        english_address: "",
        address_elements: null as AddressElementsValue,
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
                address_elements: (restaurant.address_elements as AddressElementsValue) || null,
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

    useEffect(() => {
        if (!isOpen || !isMobileOrTablet) return;

        const scrollContainer = adminRestaurantFormRef.current?.parentElement;
        scrollContainer?.scrollTo({ top: 0, behavior: 'instant' });
    }, [isMobileOrTablet, isOpen, restaurant?.id]);

    useEffect(() => {
        if (isOpen) return;

        desktopAdminRestaurantPanelDragRef.current = null;
        setDesktopAdminRestaurantPanelPosition(DEFAULT_DESKTOP_ADMIN_RESTAURANT_PANEL_POSITION);
    }, [isOpen]);

    const getClampedDesktopAdminRestaurantPanelPosition = useCallback((clientX: number, clientY: number): DesktopAdminRestaurantPanelPosition | null => {
        const dragState = desktopAdminRestaurantPanelDragRef.current;
        if (!dragState || typeof window === 'undefined') return null;

        const deltaX = clientX - dragState.startX;
        const deltaY = clientY - dragState.startY;
        const minLeft = DESKTOP_ADMIN_RESTAURANT_PANEL_VIEWPORT_MARGIN;
        const minTop = DESKTOP_ADMIN_RESTAURANT_PANEL_VIEWPORT_MARGIN;
        const maxLeft = window.innerWidth - dragState.panelWidth - DESKTOP_ADMIN_RESTAURANT_PANEL_VIEWPORT_MARGIN;
        const maxTop = window.innerHeight - dragState.panelHeight - DESKTOP_ADMIN_RESTAURANT_PANEL_VIEWPORT_MARGIN;
        const clampedLeft = clampDesktopAdminRestaurantPanelAxis(dragState.initialLeft + deltaX, minLeft, maxLeft);
        const clampedTop = clampDesktopAdminRestaurantPanelAxis(dragState.initialTop + deltaY, minTop, maxTop);

        return {
            x: dragState.originX + clampedLeft - dragState.initialLeft,
            y: dragState.originY + clampedTop - dragState.initialTop,
        };
    }, []);

    const handleDesktopAdminRestaurantPanelPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!shouldRenderMapPanel || event.button !== 0) return;

        const target = event.target as HTMLElement | null;
        if (target?.closest('button,input,textarea,select,a,[role="button"],[data-radix-popper-content-wrapper]')) {
            return;
        }

        const panel = desktopAdminRestaurantPanelRef.current;
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        desktopAdminRestaurantPanelDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            initialLeft: rect.left,
            initialTop: rect.top,
            originX: desktopAdminRestaurantPanelPosition.x,
            originY: desktopAdminRestaurantPanelPosition.y,
            panelWidth: rect.width,
            panelHeight: rect.height,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    }, [desktopAdminRestaurantPanelPosition.x, desktopAdminRestaurantPanelPosition.y, shouldRenderMapPanel]);

    const handleDesktopAdminRestaurantPanelPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (desktopAdminRestaurantPanelDragRef.current?.pointerId !== event.pointerId) return;

        const nextPosition = getClampedDesktopAdminRestaurantPanelPosition(event.clientX, event.clientY);
        if (nextPosition) {
            setDesktopAdminRestaurantPanelPosition(nextPosition);
        }
    }, [getClampedDesktopAdminRestaurantPanelPosition]);

    const handleDesktopAdminRestaurantPanelPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (desktopAdminRestaurantPanelDragRef.current?.pointerId !== event.pointerId) return;

        desktopAdminRestaurantPanelDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const moveDesktopAdminRestaurantPanelByKeyboard = useCallback((deltaX: number, deltaY: number) => {
        const panel = desktopAdminRestaurantPanelRef.current;
        if (!panel || typeof window === 'undefined') return;

        const rect = panel.getBoundingClientRect();
        const minLeft = DESKTOP_ADMIN_RESTAURANT_PANEL_VIEWPORT_MARGIN;
        const minTop = DESKTOP_ADMIN_RESTAURANT_PANEL_VIEWPORT_MARGIN;
        const maxLeft = window.innerWidth - rect.width - DESKTOP_ADMIN_RESTAURANT_PANEL_VIEWPORT_MARGIN;
        const maxTop = window.innerHeight - rect.height - DESKTOP_ADMIN_RESTAURANT_PANEL_VIEWPORT_MARGIN;
        const clampedLeft = clampDesktopAdminRestaurantPanelAxis(rect.left + deltaX, minLeft, maxLeft);
        const clampedTop = clampDesktopAdminRestaurantPanelAxis(rect.top + deltaY, minTop, maxTop);

        setDesktopAdminRestaurantPanelPosition((current) => ({
            x: current.x + clampedLeft - rect.left,
            y: current.y + clampedTop - rect.top,
        }));
    }, []);

    const handleDesktopAdminRestaurantPanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
        const step = event.shiftKey ? DESKTOP_ADMIN_RESTAURANT_PANEL_KEYBOARD_STEP * 2 : DESKTOP_ADMIN_RESTAURANT_PANEL_KEYBOARD_STEP;
        const keyboardMoves: Partial<Record<string, [number, number]>> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
        };
        const move = keyboardMoves[event.key];

        if (!move) return;

        event.preventDefault();
        moveDesktopAdminRestaurantPanelByKeyboard(move[0], move[1]);
    }, [moveDesktopAdminRestaurantPanelByKeyboard]);

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
        address_elements: AddressElementsValue;
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

    // 지오코딩 함수 (여러 개 결과 반환)
    const geocodeAddressMultiple = async (name: string, address: string, limit: number = 3) => {
        try {
            const { data, error } = await supabase.functions.invoke('naver-geocode', {
                body: { query: address, count: limit }
            });
            const geocodeData = data as NaverGeocodeResponse | null;

            if (error) throw new Error(error.message || JSON.stringify(error));
            if (!geocodeData || geocodeData.error) throw new Error(geocodeData?.error || '지오코딩 실패');
            if (!geocodeData.addresses || geocodeData.addresses.length === 0) return [];

            return geocodeData.addresses.slice(0, limit).map((addr) => ({
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
                const { error: commonError } = await supabase
                    .from("restaurants" as never)
                    .update(commonData as never)
                    .in("id", existingIds);

                if (commonError) throw commonError;

                // 3. 각 기존 유튜브 링크-리뷰 쌍을 해당 레코드에 개별 업데이트
                for (const review of formData.youtube_reviews) {
                    if (review.id.startsWith('new-')) continue; // 새 레코드는 스킵

                    const { error: reviewError } = await supabase
                        .from("restaurants" as never)
                        .update({
                            youtube_link: review.youtube_link.trim() || null,
                            tzuyang_review: review.tzuyang_review.trim() || null,
                        } as never)
                        .eq("id", review.id);

                    if (reviewError) {
                        console.error(`레코드 ${review.id} 업데이트 실패:`, reviewError);
                    }
                }

                // 4. 새로운 유튜브 링크-리뷰가 있으면 신규 레코드 생성
                let hasError = false; // 에러 플래그

                for (const newReview of newReviews) {
                    const youtubeLink = canonicalizeYoutubeLink(newReview.youtube_link.trim()) || newReview.youtube_link.trim();
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
                        const matchedYoutubeVideoId = extractVideoIdFromYoutubeLink(duplicateCheck.matchedRestaurant?.youtube_link);
                        const currentYoutubeVideoId = extractVideoIdFromYoutubeLink(youtubeLink);

                        if (currentYoutubeVideoId && matchedYoutubeVideoId === currentYoutubeVideoId) {
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
                    const { error: insertError } = await supabase
                        .from("restaurants" as never)
                        .insert({
                            ...commonData,
                            // DB 스키마 기준: restaurants는 trace_id가 unique key
                            trace_id: uniqueId,
                            youtube_link: youtubeLink,
                            tzuyang_review: tzuyangReview,
                            youtube_meta: youtubeMeta,
                            source_type: 'admin',
                            status: 'approved',
                            geocoding_success: true,
                            is_missing: false,
                            is_not_selected: false,
                        } as never);

                    if (insertError) {
                        console.error('신규 레코드 추가 실패:', insertError);
                        if (isRestaurantIdentityDuplicateError(insertError)) {
                            toast.error(`❌ 중복: "${formData.name.trim()}" 음식점에 동일 영상 레코드가 이미 존재합니다.`);
                            hasError = true;
                            break;
                        }
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
                    .select(RESTAURANT_MERGE_SELECT)
                    .in("id", existingIds);

                if (allUpdatedRestaurants && allUpdatedRestaurants.length > 0) {
                    const typedUpdatedRestaurants = allUpdatedRestaurants as Restaurant[];
                    const primaryRestaurant = typedUpdatedRestaurants.find((updatedRestaurant) => updatedRestaurant.id === restaurant.id);
                    const mergedChildren = typedUpdatedRestaurants.filter((updatedRestaurant) => updatedRestaurant.id !== restaurant.id);

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
                const primaryYoutubeLink = canonicalizeYoutubeLink(formData.youtube_reviews[0]?.youtube_link?.trim() || null);
                const primaryReviewText = formData.youtube_reviews[0]?.tzuyang_review?.trim() || "";

                if (primaryYoutubeLink && formData.jibun_address.trim()) {
                    const duplicateCheck = await checkRestaurantDuplicate(
                        formData.name.trim(),
                        formData.jibun_address.trim(),
                        undefined,
                        primaryYoutubeLink
                    );

                    const matchedYoutubeVideoId = extractVideoIdFromYoutubeLink(duplicateCheck.matchedRestaurant?.youtube_link);
                    const currentYoutubeVideoId = extractVideoIdFromYoutubeLink(primaryYoutubeLink);

                    if (duplicateCheck.isDuplicate && currentYoutubeVideoId && matchedYoutubeVideoId === currentYoutubeVideoId) {
                        toast.error(`❌ 중복: "${formData.name.trim()}" 음식점에 이미 동일한 유튜브 링크가 존재합니다.`);
                        setIsSubmitting(false);
                        return;
                    }
                }

                const restaurantData = {
                    approved_name: formData.name.trim(), // approved_name 동기화
                    road_address: formData.road_address.trim(),
                    jibun_address: formData.jibun_address.trim() || null,
                    english_address: formData.english_address.trim() || null,
                    address_elements: formData.address_elements || null,
                    phone: formData.phone.trim() || null,
                    categories: formData.categories,
                    youtube_link: primaryYoutubeLink,
                    tzuyang_review: primaryReviewText || null,
                    lat,
                    lng,
                    trace_id: primaryYoutubeLink
                        ? await generateUniqueId(primaryYoutubeLink, formData.name.trim(), primaryReviewText)
                        : null,
                    status: 'approved',
                    geocoding_success: true,
                    is_missing: false,
                    is_not_selected: false,
                    source_type: 'admin',
                };

                const { error } = await supabase.from("restaurants" as never).insert(restaurantData as never);
                if (error) {
                    if (isRestaurantIdentityDuplicateError(error)) {
                        throw new Error(`"${formData.name.trim()}" 음식점에 동일 영상 레코드가 이미 존재합니다.`);
                    }
                    throw error;
                }

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

    const adminRestaurantTitle = restaurant ? "맛집 수정" : "맛집 등록";
    const adminRestaurantDescription = restaurant ? "맛집 정보를 수정합니다" : "새로운 맛집을 등록합니다";
    const adminRestaurantTitleId = "admin-restaurant-sheet-title";
    const adminRestaurantDescriptionId = "admin-restaurant-sheet-description";
    const adminRestaurantFormClass = shouldRenderMapPanel
        ? "flex h-full min-h-0 flex-col bg-background"
        : isMobileOrTablet
            ? mobileSheetStyles.frame
            : "mt-4";
    const adminRestaurantBodyClass = shouldRenderSheetFrame
        ? cn(mobileSheetStyles.content, "min-h-0 flex-1 overflow-y-auto")
        : "space-y-4";
    const adminRestaurantFooterClass = shouldRenderSheetFrame
        ? cn(mobileSheetStyles.footer, "!mt-0 !flex !flex-row !flex-wrap items-center justify-end gap-2")
        : ADMIN_MODAL_FOOTER_DIVIDER;

    const adminRestaurantProgressSteps = [
        {
            label: "기본",
            isComplete: Boolean(formData.name.trim() && formData.categories.length > 0),
        },
        {
            label: "주소",
            isComplete: isGeocoded && Boolean(formData.road_address || formData.jibun_address),
        },
        {
            label: "영상",
            isComplete: formData.youtube_reviews.some((review) => review.youtube_link.trim()),
        },
    ];
    const adminRestaurantStatusChips = [
        `${formData.categories.length}개 카테고리`,
        `${formData.youtube_reviews.length}개 영상`,
        isGeocoded ? "좌표 확인됨" : "주소 확인 필요",
    ];

    const adminRestaurantSheetHeader = (
        <div
            className={cn(mobileSheetStyles.header, shouldRenderMapPanel && "cursor-move select-none touch-none")}
            data-desktop-map-admin-restaurant-drag-handle={shouldRenderMapPanel ? "true" : undefined}
            title={shouldRenderMapPanel ? "빈 영역을 드래그하거나 화살표 키로 맛집 수정 창 이동" : undefined}
            onKeyDown={shouldRenderMapPanel ? handleDesktopAdminRestaurantPanelKeyDown : undefined}
            onPointerDown={shouldRenderMapPanel ? handleDesktopAdminRestaurantPanelPointerDown : undefined}
            onPointerMove={shouldRenderMapPanel ? handleDesktopAdminRestaurantPanelPointerMove : undefined}
            onPointerUp={shouldRenderMapPanel ? handleDesktopAdminRestaurantPanelPointerEnd : undefined}
            onPointerCancel={shouldRenderMapPanel ? handleDesktopAdminRestaurantPanelPointerEnd : undefined}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium text-red-700 dark:text-red-300">관리자 편집</p>
                    <h2 id={adminRestaurantTitleId} className="truncate text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                        {adminRestaurantTitle}
                    </h2>
                    <p id={adminRestaurantDescriptionId} className="mt-1 text-sm text-muted-foreground">
                        {adminRestaurantDescription}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="맛집 수정 상태 요약">
                        {adminRestaurantStatusChips.map((chip) => (
                            <Badge key={chip} variant="outline" className="rounded-full bg-background/70 text-[11px]">
                                {chip}
                            </Badge>
                        ))}
                    </div>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="맛집 수정 창 닫기" onClick={onClose}>
                    <X className="h-5 w-5" />
                </Button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5" aria-label="맛집 수정 단계 진행률">
                {adminRestaurantProgressSteps.map((step) => (
                    <div key={step.label} className="space-y-1">
                        <div className={cn("h-1.5 rounded-full", step.isComplete ? "bg-red-800" : "bg-muted")} />
                        <span className={cn("block text-center text-[11px]", step.isComplete ? "font-semibold text-foreground" : "text-muted-foreground")}>
                            {step.label}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderAdminRestaurantSection = ({
        title,
        description,
        badge,
        children,
    }: {
        title: string;
        description: string;
        badge?: string;
        children: ReactNode;
    }) => (
        <section className="rounded-2xl border border-border bg-card/95 p-4 shadow-sm" aria-label={title}>
            <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                </div>
                {badge && (
                    <Badge variant="secondary" className="shrink-0 rounded-full text-[11px]">
                        {badge}
                    </Badge>
                )}
            </div>
            {children}
        </section>
    );

    const adminRestaurantForm = (
        <form
            ref={adminRestaurantFormRef}
            onSubmit={handleSubmit}
            className={adminRestaurantFormClass}
        >
            {shouldRenderSheetFrame && adminRestaurantSheetHeader}
            <div className={adminRestaurantBodyClass}>
                <div className="space-y-4">
                    <div className="rounded-2xl border border-red-200/70 bg-red-50/70 p-3 text-sm leading-6 text-red-950 shadow-sm dark:border-red-950/70 dark:bg-red-950/25 dark:text-red-100">
                        지도에 바로 반영되는 관리자 편집 화면입니다. 제보하기와 같은 흐름으로 기본 정보, 주소/좌표, 영상 리뷰를 순서대로 확인하세요.
                    </div>

                    {renderAdminRestaurantSection({
                        title: "1. 기본 정보",
                        description: "상호, 카테고리, 연락처처럼 목록과 상세 패널에 바로 보이는 정보를 정리합니다.",
                        badge: formData.categories.length > 0 ? `${formData.categories.length}개 선택` : "필수",
                        children: (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                                </div>

                                <div className="space-y-2">
                                    <Label>카테고리 *</Label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="w-full justify-between rounded-xl"
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
                                            <div className="max-h-[400px] space-y-2 overflow-y-auto p-4" style={{ overscrollBehavior: 'contain' }}>
                                                <h4 className="text-sm font-semibold">카테고리 선택</h4>

                                                <div className="flex gap-2 border-b pb-2">
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
                                                                className="flex-1 cursor-pointer text-sm"
                                                            >
                                                                {category}
                                                            </Label>
                                                        </div>
                                                    ))}
                                                </div>
                                                {formData.categories.length > 0 && (
                                                    <div className="border-t pt-2">
                                                        <Button
                                                            type="button"
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
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {formData.categories.map((category) => (
                                                <Badge key={category} variant="secondary" className="rounded-full text-xs">
                                                    {category}
                                                    <button
                                                        type="button"
                                                        aria-label={`${category} 카테고리 제거`}
                                                        onClick={() => setFormData({
                                                            ...formData,
                                                            categories: formData.categories.filter(c => c !== category)
                                                        })}
                                                        className="ml-1 rounded-full p-0.5 hover:bg-secondary-foreground/20"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ),
                    })}

                    {renderAdminRestaurantSection({
                        title: "2. 주소와 좌표",
                        description: "주소를 검색하고 후보 중 하나를 선택하면 지도 좌표와 도로명/지번 주소가 함께 갱신됩니다.",
                        badge: isGeocoded ? "확인됨" : "검색 필요",
                        children: (
                            <div className="space-y-3">
                                <div className="space-y-2">
                                    <Label htmlFor="searchAddress">주소 검색 *</Label>
                                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
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
                                            disabled={isGeocodingNaver || !formData.searchAddress.trim() || !formData.name.trim()}
                                            variant={isGeocodingNaver ? "default" : "outline"}
                                            className="rounded-xl"
                                        >
                                            {isGeocodingNaver ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    검색 중...
                                                </>
                                            ) : (
                                                "네이버 주소 검색"
                                            )}
                                        </Button>
                                    </div>
                                    {isGeocoded && selectedGeocodingIndex !== null && (
                                        <p className="text-xs font-medium text-green-600">✓ 주소와 좌표를 선택했습니다</p>
                                    )}
                                </div>

                                {geocodingResults.length > 0 && (
                                    <div className="space-y-2">
                                        <Label className="text-sm font-semibold">주소 후보 선택 ({geocodingResults.length}개)</Label>
                                        <div className="space-y-2 overflow-y-auto rounded-xl border bg-muted/20 p-2 sm:max-h-64">
                                            {geocodingResults.map((result, index) => (
                                                <Card
                                                    key={index}
                                                    className={cn(
                                                        "cursor-pointer space-y-1 rounded-xl p-3 text-sm transition-all",
                                                        selectedGeocodingIndex === index
                                                            ? 'border-primary bg-primary/5 shadow-sm'
                                                            : 'hover:border-primary/50',
                                                    )}
                                                    onClick={() => handleSelectGeocodingResult(index)}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="font-medium">도로명: {result.road_address}</p>
                                                        {selectedGeocodingIndex === index && (
                                                            <Badge variant="default" className="shrink-0 text-xs">선택됨</Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-muted-foreground">지번: {result.jibun_address}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        좌표: {result.y}, {result.x}
                                                    </p>
                                                </Card>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {isGeocoded && selectedGeocodingIndex !== null && (
                                    <div className="space-y-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950/20">
                                        <p className="font-semibold text-green-700 dark:text-green-300">✓ 선택된 주소</p>
                                        <div className="space-y-2">
                                            <div>
                                                <Label className="text-xs text-muted-foreground">도로명 주소</Label>
                                                <p className="break-words text-sm">{formData.road_address}</p>
                                            </div>
                                            <div>
                                                <Label className="text-xs text-muted-foreground">지번 주소</Label>
                                                <p className="break-words text-sm">{formData.jibun_address}</p>
                                            </div>
                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                        ),
                    })}

                    {renderAdminRestaurantSection({
                        title: "3. 유튜브 링크 & 쯔양 리뷰",
                        description: "병합된 영상/리뷰를 한 줄씩 확인하고, 빠진 영상은 추가합니다.",
                        badge: `${formData.youtube_reviews.length}개`,
                        children: (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <Label className="text-sm font-semibold">영상 리뷰 목록</Label>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="rounded-full"
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
                                    <div className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                                        등록된 유튜브 링크가 없습니다. &apos;+ 추가&apos; 버튼을 눌러 추가하세요.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {formData.youtube_reviews.map((review, index) => (
                                            <Card key={review.id} className="space-y-3 rounded-2xl p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <Label className="text-sm font-medium">링크 #{index + 1}</Label>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        aria-label={`링크 ${index + 1} 삭제`}
                                                        onClick={() => {
                                                            const reviewToDelete = formData.youtube_reviews[index];
                                                            if (!reviewToDelete.id.startsWith('new-')) {
                                                                setDeletedReviewIds([...deletedReviewIds, reviewToDelete.id]);
                                                            }
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
                        ),
                    })}
                </div>
            </div>

            <DialogFooter className={adminRestaurantFooterClass}>
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
    );

    const deleteConfirmDialog = (
        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <AlertDialogContent className={ADMIN_MODAL_CONTENT_SM}>
                <AlertDialogHeader>
                    <AlertDialogTitle>맛집 삭제 확인</AlertDialogTitle>
                    <AlertDialogDescription className={ADMIN_MODAL_SCROLL_BODY}>
                        정말로 이 맛집을 삭제하시겠습니까?
                        <br />
                        <br />
                        <span className="font-semibold text-destructive">
                            지도에서는 즉시 숨겨지며, 필요 시 데이터베이스에서 상태를 되돌릴 수 있습니다.
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
    );

    if (isMobileOrTablet) {
        return (
            <>
                <BottomSheet
                    isOpen={isOpen}
                    onClose={onClose}
                    {...MOBILE_FULL_FORM_SHEET}
                    layoutSource="admin-restaurant-modal"
                    className="z-[120]"
                    ariaLabelledBy={adminRestaurantTitleId}
                    ariaDescribedBy={adminRestaurantDescriptionId}
                    focusTrapAllowSelectors={[]}
                >
                    {adminRestaurantForm}
                </BottomSheet>
                {deleteConfirmDialog}
            </>
        );
    }

    if (shouldRenderMapPanel) {
        if (!isOpen) return null;

        return (
            <>
                <section
                    ref={desktopAdminRestaurantPanelRef}
                    className="fixed bottom-24 right-6 top-6 z-[95] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-border bg-background/95 shadow-2xl backdrop-blur-sm will-change-transform"
                    style={{ transform: `translate3d(${desktopAdminRestaurantPanelPosition.x}px, ${desktopAdminRestaurantPanelPosition.y}px, 0)` }}
                    data-desktop-map-admin-restaurant-panel="true"
                    role="dialog"
                    tabIndex={-1}
                    aria-labelledby={adminRestaurantTitleId}
                    aria-describedby={adminRestaurantDescriptionId}
                    onKeyDown={handleDesktopAdminRestaurantPanelKeyDown}
                >
                    {adminRestaurantForm}
                </section>
                {deleteConfirmDialog}
            </>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={ADMIN_MODAL_CONTENT_MD_FLEX}>
                <DialogHeader>
                    <DialogTitle className="text-2xl">
                        {adminRestaurantTitle}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {adminRestaurantDescription}
                    </DialogDescription>
                </DialogHeader>

                {adminRestaurantForm}
            </DialogContent>

            {deleteConfirmDialog}
        </Dialog>
    );

}

