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
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "@/lib/no-toast";
import { getAdminEvaluationDisplayName } from '@/lib/admin-evaluation-name';
import { isEvaluationRecordStatus } from '@/lib/admin/normalize-evaluation-record';
import { useRecordAction } from '@/lib/admin/use-record-action';
import { isRecordActionCancelled, recordActionErrorMessage, type RecordActionInput } from '@/lib/admin/record-action-client';
import type { RecordActionReceipt, RestaurantRecordChanges } from '@/lib/admin/record-action-contract';
import { normalizeCanonicalYouTubeWatchUrl } from '@/lib/youtube-url';
import { RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS } from "@/lib/admin/restaurant-destructive-action-contract";
import { Loader2, ChevronDown, X } from "lucide-react";
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
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

        return null;
    }

    try {
        const response = await fetch('/api/youtube-meta', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({ youtube_link: youtubeLink }),
        });

        if (!response.ok) {
            throw new Error('YouTube metadata request failed');
        }

        return response.json();
    } catch {

        return null;
    }
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

const getDesktopAdminRestaurantPanelFocusableElements = (container: HTMLElement | null) =>
    Array.from(
        container?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
    ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');

type AddressElement = Record<string, unknown>;
type AddressElementsValue = AddressElement | AddressElement[] | null;
type RestaurantMergeQueryRow = Pick<
    Restaurant,
    | "id"
    | "approved_name"
    | "phone"
    | "categories"
    | "status"
    | "source_type"
    | "youtube_meta"
    | "evaluation_results"
    | "reasoning_basis"
    | "tzuyang_review"
    | "trace_id"
    | "origin_address"
    | "road_address"
    | "jibun_address"
    | "english_address"
    | "address_elements"
    | "geocoding_success"
    | "geocoding_false_stage"
    | "is_missing"
    | "is_not_selected"
    | "lat"
    | "lng"
    | "youtube_link"
    | "review_count"
    | "created_by"
    | "updated_by_admin_id"
    | "db_error_message"
    | "db_error_details"
    | "search_count"
    | "weekly_search_count"
    | "origin_name"
    | "naver_name"
    | "google_name"
    | "trace_id_name_source"
    | "channel_name"
    | "description_map_url"
    | "recollect_version"
    | "created_at"
    | "updated_at"
> & {
    name: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isNullableString = (value: unknown): value is string | null =>
    typeof value === "string" || value === null;

const isNullableNumber = (value: unknown): value is number | null =>
    (typeof value === "number" && Number.isFinite(value)) || value === null;

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

const isJsonValue = (value: unknown): value is Json => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (!isRecord(value)) return false;
    return Object.values(value).every(isJsonValue);
};

const parseRestaurantMergeQueryRow = (value: unknown): RestaurantMergeQueryRow | null => {
    if (
        !isRecord(value)
        || typeof value.id !== "string"
        || !isNullableString(value.name)
        || !isNullableString(value.approved_name)
        || !isNullableString(value.phone)
        || !isStringArray(value.categories)
        || !isEvaluationRecordStatus(value.status)
        || typeof value.source_type !== "string"
        || !isJsonValue(value.youtube_meta)
        || !isJsonValue(value.evaluation_results)
        || !isNullableString(value.reasoning_basis)
        || !isNullableString(value.tzuyang_review)
        || !isNullableString(value.trace_id)
        || !isJsonValue(value.origin_address)
        || !isNullableString(value.road_address)
        || !isNullableString(value.jibun_address)
        || !isNullableString(value.english_address)
        || !isJsonValue(value.address_elements)
        || typeof value.geocoding_success !== "boolean"
        || !isNullableNumber(value.geocoding_false_stage)
        || typeof value.is_missing !== "boolean"
        || typeof value.is_not_selected !== "boolean"
        || !isNullableNumber(value.lat)
        || !isNullableNumber(value.lng)
        || !isNullableString(value.youtube_link)
        || !isNullableNumber(value.review_count)
        || !isNullableString(value.created_by)
        || !isNullableString(value.updated_by_admin_id)
        || !isNullableString(value.db_error_message)
        || !isJsonValue(value.db_error_details)
        || !isNullableNumber(value.search_count)
        || !isNullableNumber(value.weekly_search_count)
        || !isNullableString(value.origin_name)
        || !isNullableString(value.naver_name)
        || !isNullableString(value.google_name)
        || !isNullableString(value.trace_id_name_source)
        || !isNullableString(value.channel_name)
        || !isNullableString(value.description_map_url)
        || !isJsonValue(value.recollect_version)
        || typeof value.created_at !== "string"
        || typeof value.updated_at !== "string"
        || !Number.isFinite(Date.parse(value.updated_at))
    ) {
        return null;
    }

    return {
        id: value.id,
        name: getAdminEvaluationDisplayName({ name: value.name, approved_name: value.approved_name, origin_name: value.origin_name, naver_name: value.naver_name, evaluation_results: isRecord(value.evaluation_results) ? value.evaluation_results : null }),
        approved_name: value.approved_name,
        phone: value.phone,
        categories: value.categories,
        status: value.status,
        source_type: value.source_type,
        youtube_meta: value.youtube_meta,
        evaluation_results: value.evaluation_results,
        reasoning_basis: value.reasoning_basis,
        tzuyang_review: value.tzuyang_review,
        trace_id: value.trace_id,
        origin_address: value.origin_address,
        road_address: value.road_address,
        jibun_address: value.jibun_address,
        english_address: value.english_address,
        address_elements: value.address_elements,
        geocoding_success: value.geocoding_success,
        geocoding_false_stage: value.geocoding_false_stage,
        is_missing: value.is_missing,
        is_not_selected: value.is_not_selected,
        lat: value.lat,
        lng: value.lng,
        youtube_link: value.youtube_link,
        review_count: value.review_count,
        created_by: value.created_by,
        updated_by_admin_id: value.updated_by_admin_id,
        db_error_message: value.db_error_message,
        db_error_details: value.db_error_details,
        search_count: value.search_count,
        weekly_search_count: value.weekly_search_count,
        origin_name: value.origin_name,
        naver_name: value.naver_name,
        google_name: value.google_name,
        trace_id_name_source: value.trace_id_name_source,
        channel_name: value.channel_name,
        description_map_url: value.description_map_url,
        recollect_version: value.recollect_version,
        created_at: value.created_at,
        updated_at: value.updated_at,
    };
};

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

export function AdminRestaurantModal(props: AdminRestaurantModalProps) {
    return props.isOpen ? <AdminRestaurantEditor {...props} /> : null;
}

function AdminRestaurantEditor({
    isOpen,
    onClose,
    restaurant: incomingRestaurant,
    onSuccess,
    presentation = 'auto',
}: AdminRestaurantModalProps) {
    const isMobileOrTablet = useImmediateMobileOrTablet();
    const shouldRenderMapPanel = presentation === 'map-panel' && !isMobileOrTablet;
    const shouldRenderSheetFrame = isMobileOrTablet || shouldRenderMapPanel;
    const [restaurant] = useState(incomingRestaurant);
    const [working, setIsSubmitting] = useState(false);
    const [confirmedReceipt, setConfirmedReceipt] = useState<RecordActionReceipt | null>(null);
    const [discardOpen, setDiscardOpen] = useState(false);
    const initializedRef = useRef(false);
    const initialFormRef = useRef('');
    const refreshAfterAction = async (receipt: RecordActionReceipt) => {
        setConfirmedReceipt(receipt);
        try {
            if (receipt.targetIds.length === 0 || receipt.targetIds.length > 25) throw new Error('RECORD_CURRENT_READ_FAILED');
            const rows: Array<RestaurantMergeQueryRow | null> = [];
            for (let offset = 0; offset < receipt.targetIds.length; offset += 5) {
                const current = await Promise.all(receipt.targetIds.slice(offset, offset + 5).map(async id => {
                    const response = await fetch(`/api/admin/evaluations/${encodeURIComponent(id)}`, { cache: 'no-store' });
                    const value = response.ok ? await response.json() : null;
                    const row = parseRestaurantMergeQueryRow(value?.record);
                    return row?.id === id && !value?.record?.read_summary ? row : null;
                }));
                rows.push(...current);
            }
            if (rows.length !== receipt.targetIds.length || rows.some(row => !row || !receipt.targetIds.includes(row.id)) || new Set(rows.map(row => row?.id)).size !== receipt.targetIds.length) throw new Error('RECORD_CURRENT_READ_FAILED');
            const active = rows.filter((row): row is RestaurantMergeQueryRow => !!row && row.status === 'approved');
            const primary = active.find(row => row.id === restaurant?.id) ?? active[0];
            if (restaurant && primary) {
                onSuccess({ ...restaurant, ...primary,
                    mergedRestaurants: active.map(row => ({ ...restaurant, ...row })),
                    youtube_links: active.flatMap(row => row.youtube_link ? [row.youtube_link] : []),
                    tzuyang_reviews: active.flatMap(row => row.tzuyang_review ? [row.tzuyang_review] : []),
                    mergedYoutubeLinks: active.flatMap(row => row.youtube_link ? [row.youtube_link] : []),
                    mergedTzuyangReviews: active.flatMap(row => row.tzuyang_review ? [row.tzuyang_review] : []),
                    mergedYoutubeMetas: undefined,
                });
            } else { onSuccess(); }
            toast.success('작업 결과 확인 완료');
            onClose();
        } catch {
            toast.error('적용은 확인되었습니다. 저장을 반복하지 말고 현재 정보를 다시 불러와 주세요.');
        }
    };
    const recordActions = useRecordAction(receipt => {
        if (receipt.action.startsWith('restaurant.') && (!restaurant || receipt.targetIds.includes(restaurant.id))) void refreshAfterAction(receipt);
    }, { recover: true });
    const isSubmitting = working || recordActions.busy || confirmedReceipt !== null;

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteReason, setDeleteReason] = useState("");
    const [deleteConfirmation, setDeleteConfirmation] = useState("");
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
    const requestClose = useCallback(() => {
        if (isSubmitting || isGeocodingNaver) return;
        if (JSON.stringify(formData) !== initialFormRef.current || deletedReviewIds.length > 0) { setDiscardOpen(true); return; }
        onClose();
    }, [isSubmitting, isGeocodingNaver, formData, deletedReviewIds, onClose]);

    const resetForm = useCallback(() => {
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
    }, []);

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        if (isOpen && restaurant) {
            // 모달이 열릴 때마다 데이터베이스의 원본 데이터로 초기화
            setDeletedReviewIds([]); // 삭제 추적 초기화
            setDeleteReason("");
            setDeleteConfirmation("");
            // mergedRestaurants에서 status가 'approved'인 유튜브 링크-리뷰 쌍만 추출
            const youtubeReviews = Array.from(new Map([restaurant, ...(restaurant.mergedRestaurants ?? [])].map(row => [row.id, row])).values())
                .filter(row => row.status === 'approved')
                .map(row => ({ id: row.id, youtube_link: row.youtube_link || '', tzuyang_review: row.tzuyang_review || '' }));

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

            const initialForm = {
                name: restaurant.name || "",
                searchAddress: restaurant.road_address || restaurant.jibun_address || "",
                road_address: restaurant.road_address || "",
                jibun_address: restaurant.jibun_address || "",
                english_address: restaurant.english_address || "",
                address_elements: (restaurant.address_elements as AddressElementsValue) || null,
                phone: restaurant.phone || "",
                categories: allCategories,
                youtube_reviews: youtubeReviews,
                lat: String(restaurant.lat ?? ""),
                lng: String(restaurant.lng ?? ""),
            };
            initialFormRef.current = JSON.stringify(initialForm);
            setFormData(initialForm);
            setIsGeocoded(true); // 기존 데이터는 이미 지오코딩됨
            setGeocodingResults([]); // 지오코딩 결과 초기화
            setSelectedGeocodingIndex(null); // 선택 인덱스 초기화
        } else if (isOpen && !restaurant) {
            initialFormRef.current = JSON.stringify({ name: "", searchAddress: "", road_address: "", jibun_address: "", english_address: "", address_elements: null, phone: "", categories: [], youtube_reviews: [], lat: "", lng: "" });
            resetForm();
        }
    }, [restaurant, isOpen, resetForm]);

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

    const handleDesktopAdminRestaurantDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            requestClose();
            return;
        }

        if (event.key !== 'Tab') return;

        const focusableElements = getDesktopAdminRestaurantPanelFocusableElements(desktopAdminRestaurantPanelRef.current);
        if (focusableElements.length === 0) {
            event.preventDefault();
            desktopAdminRestaurantPanelRef.current?.focus({ preventScroll: true });
            return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement;

        if (event.shiftKey && activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus({ preventScroll: true });
        } else if (!event.shiftKey && activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus({ preventScroll: true });
        }
    }, [requestClose]);

    useEffect(() => {
        if (!shouldRenderMapPanel || !isOpen) return;

        const frame = window.requestAnimationFrame(() => {
            const [firstFocusableElement] = getDesktopAdminRestaurantPanelFocusableElements(
                desktopAdminRestaurantPanelRef.current,
            );
            (firstFocusableElement ?? desktopAdminRestaurantPanelRef.current)?.focus({ preventScroll: true });
        });

        return () => window.cancelAnimationFrame(frame);
    }, [isOpen, shouldRenderMapPanel]);


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

            if (error) throw new Error('NAVER_GEOCODE_REQUEST_FAILED');
            if (!geocodeData || geocodeData.error) throw new Error('NAVER_GEOCODE_PROVIDER_FAILED');
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
        if (isSubmitting || isGeocodingNaver) return;
        if (!formData.name.trim()) { toast.error('맛집 이름을 입력해주세요'); return; }
        const initial = JSON.parse(initialFormRef.current || '{}') as Partial<typeof formData>;
        const newReviews = restaurant ? formData.youtube_reviews.filter(review => review.id.startsWith('new-')) : formData.youtube_reviews;
        const geoKeys = ['road_address', 'jibun_address', 'english_address', 'address_elements', 'lat', 'lng'] as const;
        const geoChanged = geoKeys.some(key => JSON.stringify(formData[key]) !== JSON.stringify(initial[key]));
        const needsCompleteLocation = !restaurant || newReviews.length > 0 || geoChanged;
        if ((!isGeocoded && (needsCompleteLocation || formData.searchAddress !== initial.searchAddress))) { toast.error('주소를 재지오코딩하고 결과를 선택해주세요'); return; }
        if (needsCompleteLocation && (!formData.lat.trim() || !formData.lng.trim() || !Number.isFinite(Number(formData.lat)) || !Number.isFinite(Number(formData.lng)))) { toast.error('좌표를 확인해주세요'); return; }
        if ((!restaurant && newReviews.length === 0) || newReviews.some(review => !normalizeCanonicalYouTubeWatchUrl(review.youtube_link) || !review.tzuyang_review.trim())) {
            toast.error('새 영상 링크와 쯔양 리뷰를 입력해주세요'); return;
        }
        const originalRows = new Map([...(restaurant ? [restaurant, ...(restaurant.mergedRestaurants ?? [])] : [])].map(row => [row.id, row]));
        const perTargetChanges: Array<{ id: string; changes: RestaurantRecordChanges }> = [];
        for (const review of formData.youtube_reviews.filter(row => !row.id.startsWith('new-') && !!restaurant)) {
            const original = originalRows.get(review.id);
            const changes: RestaurantRecordChanges = {};
            if (review.youtube_link.trim() !== (original?.youtube_link ?? '').trim()) {
                const canonical = normalizeCanonicalYouTubeWatchUrl(review.youtube_link);
                if (review.youtube_link.trim() && !canonical) { toast.error('변경한 영상 링크를 확인해주세요'); return; }
                changes.youtube_link = canonical;
            }
            if (review.tzuyang_review.trim() !== (original?.tzuyang_review ?? '').trim()) changes.tzuyang_review = review.tzuyang_review.trim() || null;
            if (Object.keys(changes).length > 0) perTargetChanges.push({ id: review.id, changes });
        }
        setIsSubmitting(true);
        try {
            const completeChanges: RestaurantRecordChanges = {
                approved_name: formData.name.trim(), phone: formData.phone.trim() || null,
                categories: formData.categories as RestaurantRecordChanges['categories'],
                road_address: formData.road_address.trim(), jibun_address: formData.jibun_address.trim(),
                english_address: formData.english_address.trim() || null, address_elements: formData.address_elements,
                lat: Number(formData.lat), lng: Number(formData.lng), geocoding_success: true,
            };
            const changes: RestaurantRecordChanges = {};
            if (!restaurant || formData.name.trim() !== initial.name?.trim()) changes.approved_name = completeChanges.approved_name;
            if (!restaurant || formData.phone.trim() !== initial.phone?.trim()) changes.phone = completeChanges.phone;
            if (!restaurant || JSON.stringify(formData.categories) !== JSON.stringify(initial.categories)) changes.categories = completeChanges.categories;
            if (!restaurant || geoChanged) Object.assign(changes, Object.fromEntries(
                [...geoKeys, 'geocoding_success'].map(key => [key, completeChanges[key as keyof RestaurantRecordChanges]]),
            ));
            const toVideoChanges = (review: typeof formData.youtube_reviews[number]): RestaurantRecordChanges => ({
                youtube_link: normalizeCanonicalYouTubeWatchUrl(review.youtube_link), tzuyang_review: review.tzuyang_review.trim(),
            });
            const additions: RestaurantRecordChanges[] = [];
            for (const review of newReviews) {
                const video = toVideoChanges(review);
                const meta = await fetchYouTubeMeta(video.youtube_link!);
                const ads = meta?.ads_info && typeof meta.ads_info === 'object' ? meta.ads_info : meta;
                const whatAds = ads?.what_ads;
                // Keep only the public DTO fields; provider diagnostics never enter a request or log.
                const youtube_meta: RestaurantRecordChanges['youtube_meta'] = meta && typeof meta === 'object' ? {
                    ...(typeof meta.title === 'string' ? { title: meta.title } : {}),
                    ...(typeof (meta.published_at ?? meta.publishedAt) === 'string' ? { published_at: meta.published_at ?? meta.publishedAt } : {}),
                    ...(typeof meta.duration === 'number' ? { duration: meta.duration } : {}),
                    ...(typeof meta.is_shorts === 'boolean' ? { is_shorts: meta.is_shorts } : {}),
                    ...(typeof ads?.is_ads === 'boolean' ? { is_ads: ads.is_ads } : {}),
                    ...(typeof whatAds === 'string' ? { what_ads: [whatAds] } : whatAds === null ? { what_ads: null } : Array.isArray(whatAds) && whatAds.every((item: unknown) => typeof item === 'string') ? { what_ads: whatAds } : {}),
                } : undefined;
                if (!youtube_meta) toast.warning('영상 메타데이터를 가져오지 못했습니다. 입력한 영상과 리뷰를 확인해주세요.');
                additions.push({ ...completeChanges, ...video, ...(youtube_meta ? { youtube_meta } : {}) });
            }
            let input: RecordActionInput;
            if (restaurant && Object.keys(changes).length === 0 && perTargetChanges.length === 0 && deletedReviewIds.length === 0 && additions.length === 0) { toast.error('변경한 내용이 없습니다'); return; }
            if (restaurant) {
                const targetIds = Array.from(new Set([restaurant.id, ...(restaurant.mergedRestaurants ?? []).map(row => row.id)]));
                input = { action: 'restaurant.edit', targetIds, payload: { changes,
                    perTargetChanges,
                    removeIds: deletedReviewIds, additions,
                } };
            } else {
                const payload = { changes: additions[0], additions: additions.slice(1) };
                input = { action: 'restaurant.create', targetIds: [], payload };
            }
            await refreshAfterAction(await recordActions.run(input));
        } catch (error) {
            if (!isRecordActionCancelled(error)) toast.error(recordActionErrorMessage(error));
        } finally { setIsSubmitting(false); }
    };

    const handleDelete = async () => {
        if (!restaurant || isSubmitting || !deleteReason.trim() || deleteConfirmation.trim() !== RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant) return;
        setShowDeleteConfirm(false);
        setIsSubmitting(true);
        try {
            await refreshAfterAction(await recordActions.run({ action: 'restaurant.delete', targetIds: [restaurant.id], payload: { reason: deleteReason.trim() } }));
        } catch (error) {
            if (!isRecordActionCancelled(error)) toast.error(recordActionErrorMessage(error));
        } finally { setIsSubmitting(false); }
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
            role={shouldRenderMapPanel ? "group" : undefined}
            tabIndex={shouldRenderMapPanel ? 0 : undefined}
            aria-label={shouldRenderMapPanel ? "맛집 수정 창 이동 핸들" : undefined}
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
                            <Badge key={chip} variant="outline" className="rounded-full bg-background/70 text-2xs">
                                {chip}
                            </Badge>
                        ))}
                    </div>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="맛집 수정 창 닫기" onClick={requestClose}>
                    <X className="h-5 w-5" />
                </Button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5" aria-label="맛집 수정 단계 진행률">
                {adminRestaurantProgressSteps.map((step) => (
                    <div key={step.label} className="space-y-1">
                        <div className={cn("h-1.5 rounded-full", step.isComplete ? "bg-red-800" : "bg-muted")} />
                        <span className={cn("block text-center text-2xs", step.isComplete ? "font-semibold text-foreground" : "text-muted-foreground")}>
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
                    <Badge variant="secondary" className="shrink-0 rounded-full text-2xs">
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
            <fieldset disabled={isSubmitting || isGeocodingNaver} className={adminRestaurantBodyClass}>
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
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-label={`주소 후보 ${index + 1}: ${result.road_address || result.jibun_address}`}
                                                    onClick={() => handleSelectGeocodingResult(index)}
                                                    onKeyDown={event => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            handleSelectGeocodingResult(index);
                                                        }
                                                    }}
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
                                                        type={review.id.startsWith('new-') ? 'url' : 'text'}
                                                        inputMode="url"
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
            </fieldset>
            {confirmedReceipt && <Button type="button" variant="outline" onClick={() => void refreshAfterAction(confirmedReceipt)}>현재 정보 다시 불러오기</Button>}

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
                            onClick={requestClose}
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
                        <div className="mt-4 space-y-3">
                            <div className="space-y-1">
                                <Label htmlFor="restaurant-delete-reason">삭제 사유</Label>
                                <Textarea
                                    id="restaurant-delete-reason"
                                    value={deleteReason}
                                    onChange={(event) => setDeleteReason(event.target.value)}
                                    placeholder="삭제 사유를 입력해 주세요"
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="restaurant-delete-confirmation">
                                    확인 문구: {RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant}
                                </Label>
                                <Input
                                    id="restaurant-delete-confirmation"
                                    value={deleteConfirmation}
                                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                                    placeholder={RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant}
                                    disabled={isSubmitting}
                                />
                            </div>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className={ADMIN_MODAL_FOOTER}>
                    <AlertDialogCancel className={ADMIN_MODAL_ACTION}>취소</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(event) => {
                            event.preventDefault();
                            void handleDelete();
                        }}
                        disabled={
                            isSubmitting ||
                            !deleteReason.trim() ||
                            deleteConfirmation.trim() !== RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant
                        }
                        className={`${ADMIN_MODAL_ACTION} bg-destructive hover:bg-destructive/90`}
                    >
                        삭제
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );

    const guardedDialogs = <>
        {recordActions.dialog}
        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent className={ADMIN_MODAL_CONTENT_SM}>
            <AlertDialogHeader><AlertDialogTitle>변경 내용을 버릴까요?</AlertDialogTitle><AlertDialogDescription>저장하지 않은 편집 내용이 있습니다.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>계속 편집</AlertDialogCancel><AlertDialogAction onClick={onClose}>변경 버리기</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent></AlertDialog>
    </>;

    if (isMobileOrTablet) {
        return (
            <>
                <BottomSheet
                    isOpen={isOpen && !recordActions.busy && !discardOpen && !showDeleteConfirm}
                    onClose={requestClose}
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
                {guardedDialogs}
            </>
        );
    }

    if (shouldRenderMapPanel) {
        if (!isOpen) return null;

        return (
            <>
                <section
                    hidden={recordActions.busy || discardOpen || showDeleteConfirm}
                    ref={desktopAdminRestaurantPanelRef}
                    className="fixed bottom-24 right-6 top-6 z-[95] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-border bg-background/95 shadow-2xl"
                    style={{ transform: `translate3d(${desktopAdminRestaurantPanelPosition.x}px, ${desktopAdminRestaurantPanelPosition.y}px, 0)` }}
                    data-desktop-map-admin-restaurant-panel="true"
                    role="dialog"
                    tabIndex={-1}
                    aria-modal="true"
                    aria-labelledby={adminRestaurantTitleId}
                    aria-describedby={adminRestaurantDescriptionId}
                    onKeyDown={handleDesktopAdminRestaurantDialogKeyDown}
                >
                    {adminRestaurantForm}
                </section>
                {deleteConfirmDialog}
                {guardedDialogs}
            </>
        );
    }

    return (
        <>
        <Dialog open={isOpen} onOpenChange={next => { if (!next) requestClose(); }}>
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
        {guardedDialogs}
        </>
    );

}
