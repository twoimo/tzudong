import { enqueueDraftWrite, waitForDraftAutosave, blockDraftUnload } from '@/lib/draft-write-queue';
import { DraftLoadError } from '@/components/ui/draft-load-error';
import { captureBrowserDraftEpoch, assertBrowserDraftWrite, isBrowserDraftEpochCurrent } from '@/lib/privacy/browser-draft-lifecycle';
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { saveDraft, getDraft, prepareDraftDeletion, type ReviewDraft } from "@/lib/reviewDraftDB";
import {
    buildReviewPhotoObjectPath,
    cleanupCanonicalReviewPhotoObjects,
    normalizeReviewPhotoFilename,
} from "@/lib/review-photo-url";
import {
    REVIEW_FOOD_PHOTO_MAX_COUNT,
    ReviewSaveOperation,
    type ReviewSaveDraft,
    type ReviewSaveUpload,
} from "@/lib/reviews/review-save-operation";
import {
    FEATURE_DATABASE_HELD_MESSAGE,
    fetchFeatureDatabaseReadiness,
} from "@/lib/runtime-feature-readiness-contract";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MOBILE_FULL_FORM_SHEET, mobileSheetStyles } from "@/components/ui/mobile-sheet-frame";
import { useImmediateMobileOrTablet } from "@/hooks/useDeviceType";
import {
    addAiFilledField,
    shouldSuppressOcrAutoNavigation,
    canReplaceSelectedRestaurantFromOcr,
    type ReviewOcrFieldKey,
} from "@/lib/ocr/review-modal-ocr-ux";
import { compressFoodImage } from "@/components/reviews/review-photo-files";
import { ReceiptPhotoGuide, ReceiptStep } from "@/components/reviews/receipt-step/ReceiptStep";
import type { OCRResult } from "@/components/reviews/receipt-step/receipt-ocr";
import { INITIAL_RECEIPT_SAVE_INPUTS, useReceiptStep, type ReceiptSaveInputs } from "@/components/reviews/receipt-step/use-receipt-step";

const REVIEW_CONTENT_MAX_LENGTH = 4_000;
// The controller retains exactly one operation in memory; draft persistence stays unchanged.
function createReviewSaveOperation(
    currentOwner: () => string | undefined,
    currentDraftRevision: () => ReviewDraft | null,
) {
    return new ReviewSaveOperation({
        currentOwner,
        captureDraftDeletion: draft => prepareDraftDeletion(draft.ownerId, draft.restaurantId, currentDraftRevision()),
        newId: () => {
            const reviewId = crypto.randomUUID();
            return reviewId;
        },
        prepare: async (draft, reviewId) => {
            const receipt = draft.verificationPhoto;
            const food = await Promise.all(draft.foodPhotos.map(compressFoodImage));
            const uploadTimestamp = Date.now();
            const verificationPhotoPath = buildReviewPhotoObjectPath(
                { ownerId: draft.ownerId, reviewId, purpose: 'verification' },
                `${uploadTimestamp}_verification_${normalizeReviewPhotoFilename(receipt.name, '.jpg') ?? 'receipt.jpg'}`,
            );
            if (!verificationPhotoPath) throw new Error('REVIEW_VERIFICATION_UPLOAD_FAILED');
            const uploads: ReviewSaveUpload[] = [{ path: verificationPhotoPath, purpose: 'verification', file: receipt }];
            food.forEach((file, i) => {
                const path = buildReviewPhotoObjectPath(
                    { ownerId: draft.ownerId, reviewId, purpose: 'food' },
                    `${uploadTimestamp}_food_${i}_${normalizeReviewPhotoFilename(file.name) ?? 'food.webp'}`,
                );
                if (!path) throw new Error('REVIEW_PHOTO_UPLOAD_FAILED');
                uploads.push({ path, purpose: 'food', file });
            });
            return uploads;
        },
        upload: ({ path, file, purpose }) => supabase.storage.from(purpose === 'verification' ? 'review-verifications' : 'review-photos').upload(path, file, {
            cacheControl: '3600', upsert: false,
        }),
        verifyUpload: async ({ path, file, purpose }) => {
            const { data, error } = await supabase.storage.from(purpose === 'verification' ? 'review-verifications' : 'review-photos').info(path);
            return !error && data !== null && data.size === file.size
                && (!file.type || data.contentType === file.type);
        },
        insert: async (draft, reviewId, uploads) => {
            const verificationPhoto = uploads.find(upload => upload.purpose === 'verification')!.path;
            const foodPhotos = uploads.filter(upload => upload.purpose === 'food').map(upload => upload.path);
            if (!draft.ocrResultRef && !draft.ocrResultRevision) {
                return supabase.from('reviews').insert({
                    id: reviewId,
                    user_id: draft.ownerId,
                    restaurant_id: draft.restaurantId,
                    title: draft.title,
                    content: draft.content,
                    visited_at: draft.visitedAt,
                    verification_photo: verificationPhoto,
                    food_photos: foodPhotos,
                    categories: draft.categories,
                    is_verified: false,
                });
            }
            if (!draft.ocrResultRef || !draft.ocrResultRevision) {
                return { error: { code: '42501', status: 422 } };
            }
            const { data: { session } } = await supabase.auth.getSession();
            const response = await fetch('/api/ocr/reviews/save', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                },
                body: JSON.stringify({
                    reviewId,
                    restaurantId: draft.restaurantId,
                    title: draft.title,
                    content: draft.content,
                    visitedAt: draft.visitedAt,
                    verificationPhoto,
                    foodPhotos,
                    categories: draft.categories,
                    ocrResultRef: draft.ocrResultRef,
                    ocrResultRevision: draft.ocrResultRevision,
                }),
            });
            if (response.ok) return { error: null };
            const code = response.status === 409
                ? '23505'
                : [400, 401, 403, 413, 422].includes(response.status) ? '42501' : 'transport';
            return { error: { code, status: response.status } };
        },
        read: (ownerId, reviewId) => supabase.from('reviews')
            .select('id, user_id, restaurant_id, verification_photo, food_photos, receipt_data, ocr_processed_at')
            .eq('id', reviewId).eq('user_id', ownerId).maybeSingle(),
        cleanup: async (ownerId, reviewId, uploads) => {
            const results = await Promise.all((['verification', 'food'] as const).map(purpose => (
                cleanupCanonicalReviewPhotoObjects(
                    uploads.filter(upload => upload.purpose === purpose).map(upload => upload.path),
                    { ownerId, reviewId, purpose },
                    supabase.storage.from(purpose === 'verification' ? 'review-verifications' : 'review-photos'),
                )
            )));
            return results.every(result => result.success);
        },
    });
}

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar, Upload, X as XIcon, AlertCircle, CircleAlert, CheckCircle2, Image as ImageIcon, Trash2, Plus, Search, ChevronDown, Loader2, Clock } from "lucide-react";

interface ReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    restaurant: { id: string; name: string } | null;
    onSuccess?: () => void;
    inline?: boolean; // Dialog 없이 콘텐츠만 렌더링 (데스크톱 나란히 배치용)
    presentation?: 'auto' | 'map-panel';
}

export type DesktopReviewMapPanelPosition = {
    x: number;
    y: number;
};

type DesktopReviewMapPanelDragState = {
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

const DESKTOP_REVIEW_MAP_PANEL_VIEWPORT_MARGIN = 16;
export const DESKTOP_REVIEW_MAP_PANEL_KEYBOARD_STEP = 24;
const DEFAULT_DESKTOP_REVIEW_MAP_PANEL_POSITION: DesktopReviewMapPanelPosition = { x: 0, y: 0 };
const REVIEW_MODAL_SCROLLBARLESS_CLASS = "[scrollbar-width:'none'] [&::-webkit-scrollbar]:hidden";

const clampDesktopReviewMapPanelAxis = (value: number, min: number, max: number) => {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
};

export function getDesktopReviewMapPanelKeyboardDelta(key: string, step = DESKTOP_REVIEW_MAP_PANEL_KEYBOARD_STEP): DesktopReviewMapPanelPosition | null {
    switch (key) {
        case 'ArrowLeft':
            return { x: -step, y: 0 };
        case 'ArrowRight':
            return { x: step, y: 0 };
        case 'ArrowUp':
            return { x: 0, y: -step };
        case 'ArrowDown':
            return { x: 0, y: step };
        default:
            return null;
    }
}

const CATEGORIES = [
    "치킨",
    "중식",
    "돈까스·회",
    "피자",
    "패스트푸드",
    "찜·탕",
    "족발·보쌈",
    "분식",
    "카페·디저트",
    "한식",
    "고기",
    "양식",
    "아시안",
    "야식",
    "도시락",
] as const;

type Category = typeof CATEGORIES[number];

interface RestaurantNameRow {
    id: string;
    name: string;
}

interface RestaurantNameQueryRow {
    id: string;
    name: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRestaurantNameQueryRow(value: unknown): value is RestaurantNameQueryRow {
    return isRecord(value)
        && typeof value.id === 'string'
        && (value.name === null || typeof value.name === 'string');
}

function normalizeRestaurantNameRow(value: unknown): RestaurantNameRow | null {
    if (!isRestaurantNameQueryRow(value)) return null;

    const id = value.id.trim();
    const name = value.name?.trim();
    if (!id || !name) return null;
    return { id, name };
}

function mapRestaurantNameRows(rows: readonly unknown[] | null): RestaurantNameRow[] {
    if (!rows) return [];

    return rows.flatMap((row) => {
        const normalized = normalizeRestaurantNameRow(row);
        return normalized ? [normalized] : [];
    });
}

function buildRestaurantSearchCandidates(value: string): string[] {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) return [];

    const tokens = normalized
        .split(' ')
        .map(token => token.trim())
        .filter(token => token.length >= 2);

    return Array.from(new Set([normalized, ...tokens])).sort((a, b) => b.length - a.length);
}

function scoreRestaurantNameMatch(restaurantName: string, receiptName: string): number {
    const normalizedRestaurantName = restaurantName.replace(/\s+/g, '').toLowerCase();
    const normalizedReceiptName = receiptName.replace(/\s+/g, '').toLowerCase();
    if (!normalizedRestaurantName || !normalizedReceiptName) return 0;
    if (normalizedRestaurantName === normalizedReceiptName) return 100;
    if (normalizedRestaurantName.includes(normalizedReceiptName) || normalizedReceiptName.includes(normalizedRestaurantName)) {
        return 90;
    }

    return buildRestaurantSearchCandidates(receiptName).reduce((score, token) => {
        const normalizedToken = token.replace(/\s+/g, '').toLowerCase();
        if (!normalizedToken) return score;
        if (normalizedRestaurantName.includes(normalizedToken)) {
            return Math.max(score, 40 + Math.min(normalizedToken.length * 5, 40));
        }
        return score;
    }, 0);
}

type ReviewFormStep = 1 | 2 | 3;
type OcrFocusTarget = "restaurant" | "date" | "time" | "category" | "review";

type ReviewSaveInputsSnapshot = ReceiptSaveInputs & {
    revision: number;
    ownerId: string | undefined;
    restaurantId: string | undefined;
    restaurantName: string | undefined;
    visitedDate: string;
    visitedTime: string;
    categories: Category[];
    content: string;
    foodPhotos: File[];
};

function sameReviewSaveInputsSnapshot(a: ReviewSaveInputsSnapshot, b: ReviewSaveInputsSnapshot): boolean {
    return a.revision === b.revision
        && a.ownerId === b.ownerId
        && a.restaurantId === b.restaurantId
        && a.restaurantName === b.restaurantName
        && a.visitedDate === b.visitedDate
        && a.visitedTime === b.visitedTime
        && a.categories.length === b.categories.length
        && a.categories.every((value, index) => value === b.categories[index])
        && a.content === b.content
        && a.verificationPhoto === b.verificationPhoto
        && a.foodPhotos.length === b.foodPhotos.length
        && a.foodPhotos.every((file, index) => file === b.foodPhotos[index])
        && a.verificationInputMode === b.verificationInputMode
        && a.isAnalyzing === b.isAnalyzing
        && a.ocrRunGeneration === b.ocrRunGeneration
        && a.ocrResultRef === b.ocrResultRef
        && a.ocrResultRevision === b.ocrResultRevision;
}

const REVIEW_FORM_STEPS: Array<{ id: ReviewFormStep; label: string }> = [
    { id: 1, label: "인증" },
    { id: 2, label: "방문 정보" },
    { id: 3, label: "리뷰" },
];

export function ReviewModal(props: ReviewModalProps) {
    const { user } = useAuth();
    // Owner transitions discard the previous composer's inputs and controller.
    // This is a memory boundary, not durable idempotency across remounts.
    return <ReviewComposer key={`${user?.id ?? 'signed-out'}:${captureBrowserDraftEpoch(user?.id ?? '').generation}:${props.restaurant?.id ?? 'choose'}`} {...props} />;
}

function ReviewComposer({ isOpen, onClose, restaurant, onSuccess, inline = false, presentation = 'auto' }: ReviewModalProps) {
    const { user } = useAuth();
    const isMobileOrTablet = useImmediateMobileOrTablet();
    const [visitedDate, setVisitedDate] = useState("");
    const [visitedTime, setVisitedTime] = useState("");
    const [categories, setCategories] = useState<Category[]>([]);
    const [content, setContent] = useState("");
    const [foodPhotos, setFoodPhotos] = useState<File[]>([]);
    const foodPhotosRef = useRef<File[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveRecovery, setSaveRecovery] = useState<'result-check' | 'edit' | 'draft-cleanup' | null>(null);
    const autoSaveInFlightRef = useRef<Promise<void> | null>(null);
    const consumerNotifiedRef = useRef(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

    const [ocrFocusTarget, setOcrFocusTarget] = useState<OcrFocusTarget | null>(null);
    const [aiFilledFields, setAiFilledFields] = useState<Set<ReviewOcrFieldKey>>(() => new Set());
    const lastOcrRevealSignatureRef = useRef<string | null>(null);
    const lastManualOcrInteractionAtRef = useRef(0);
    const userStepOverrideDuringOcrRef = useRef(false);
    const manuallyEditedOcrFieldsRef = useRef<Set<ReviewOcrFieldKey>>(new Set());
    const [currentStep, setCurrentStep] = useState<ReviewFormStep>(1);

    // 맛집 검색 상태
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<{ id: string; name: string }[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<{ id: string; name: string } | null>(restaurant);
    const reviewTargetRestaurant = selectedRestaurant || restaurant;
    // One bounded text revision, obtained only from our committed save or load.
    // Scope object identity also fences asynchronous completions across A -> B -> A.
    const draftScopeRef = useRef({ ownerId: user?.id, restaurantId: reviewTargetRestaurant?.id, revision: null as ReviewDraft | null });
    const draftLoadKey = `${user?.id ?? ''}:${reviewTargetRestaurant?.id ?? ''}:${isOpen}`;
    const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
    const [draftLoadFailed, setDraftLoadFailed] = useState(false);
    const saveOwnerRef = useRef(user?.id);
    const saveOperationRef = useRef<ReviewSaveOperation | null>(null);
    const submitInFlightRef = useRef(false);
    const closeRequestedRef = useRef(false);
    const composerOpenRef = useRef(isOpen);
    const saveInputRevisionRef = useRef(0);
    const latestSaveInputsRef = useRef<ReviewSaveInputsSnapshot>({
        revision: 0,
        ownerId: user?.id,
        restaurantId: reviewTargetRestaurant?.id,
        restaurantName: reviewTargetRestaurant?.name,
        visitedDate,
        visitedTime,
        categories,
        content,
        foodPhotos,
        ...INITIAL_RECEIPT_SAVE_INPUTS,
    });
    const reviseLatestSaveInputs = useCallback((patch: Partial<Omit<ReviewSaveInputsSnapshot, 'revision'>>) => {
        const revision = saveInputRevisionRef.current + 1;
        saveInputRevisionRef.current = revision;
        latestSaveInputsRef.current = { ...latestSaveInputsRef.current, ...patch, revision };
    }, []);
    const { data: featureReadiness, mutate: mutateFeatureReadiness, isValidating: isCheckingFeatureReadiness } = useSWR(
        isOpen && user ? '/api/runtime-compatibility/features' : null,
        () => fetchFeatureDatabaseReadiness(),
        { revalidateOnFocus: false, dedupingInterval: 60_000, shouldRetryOnError: false },
    );
    const featureHeld = featureReadiness?.status !== 'ready';

    const resetOcrAutofill = useCallback(() => {
        setAiFilledFields(new Set());
        lastOcrRevealSignatureRef.current = null;
        lastManualOcrInteractionAtRef.current = 0;
        userStepOverrideDuringOcrRef.current = false;
        manuallyEditedOcrFieldsRef.current = new Set();
    }, []);
    const stopOcrAutoNavigation = useCallback(() => {
        userStepOverrideDuringOcrRef.current = true;
    }, []);
    const receipt = useReceiptStep({
        isOpen,
        userId: user?.id,
        featureHeld,
        ocrContextRestaurant: reviewTargetRestaurant,
        reviseLatestSaveInputs,
        ocrEvents: {
            onModelAnalysisStart: resetOcrAutofill,
            onPhotoOnly: stopOcrAutoNavigation,
            onFields: applyReceiptOcrFields,
            onResult: applyReceiptOcrResult,
        },
    });
    const {
        verificationPhoto,
        verificationInputMode,
        isAnalyzing,
        ocrResultRef,
        ocrResultRevision,
        verificationInputModeRef,
        ocrRunGenerationRef,
        replaceVerificationPhoto,
        setReceiptVerificationInputMode,
        resetReceiptStep,
        cancelPendingReceiptSelection,
        noteOcrFieldApplied,
        noteOcrNavigationSuppressed,
    } = receipt;

    useLayoutEffect(() => {
        if (draftScopeRef.current.ownerId !== user?.id || draftScopeRef.current.restaurantId !== reviewTargetRestaurant?.id || !isOpen) {
            draftScopeRef.current = { ownerId: user?.id, restaurantId: reviewTargetRestaurant?.id, revision: null };
            closeRequestedRef.current = false;
            setLoadedDraftKey(null);
        }
        saveOwnerRef.current = user?.id;
        composerOpenRef.current = isOpen;
        reviseLatestSaveInputs({
            ownerId: user?.id,
            restaurantId: reviewTargetRestaurant?.id,
            restaurantName: reviewTargetRestaurant?.name,
            visitedDate,
            visitedTime,
            categories,
            content,
            verificationPhoto,
            foodPhotos,
            verificationInputMode,
            isAnalyzing,
            ocrRunGeneration: ocrRunGenerationRef.current,
            ocrResultRef,
            ocrResultRevision,
        });
        saveOperationRef.current ??= createReviewSaveOperation(() => saveOwnerRef.current, () => draftScopeRef.current.revision);
    }, [user?.id, isOpen, visitedDate, visitedTime, categories, content, verificationPhoto, foodPhotos, reviewTargetRestaurant?.id, reviewTargetRestaurant?.name, verificationInputMode, isAnalyzing, ocrResultRef, ocrResultRevision, ocrRunGenerationRef, reviseLatestSaveInputs]);

    useLayoutEffect(() => {
        const operation = saveOperationRef.current!;
        if (isOpen) {
            closeRequestedRef.current = false;
            consumerNotifiedRef.current = false;
        } else {
            void operation.cancel();
        }
        return () => {
            composerOpenRef.current = false;
            saveOwnerRef.current = undefined;
            draftScopeRef.current = { ...draftScopeRef.current, revision: null };
            // A dispatched insert cannot be safely aborted. The controller waits
            // for it and preserves objects whenever its outcome stays unknown.
            operation.requestCancel();
            void operation.cancel();
        };
    }, [isOpen, user?.id]);


    // 드래그 앤 드롭을 위한 ref들
    const foodPhotosDropRef = useRef<HTMLDivElement>(null);
    const foodPhotosFileInputRef = useRef<HTMLInputElement>(null);
    const mobileFrameRef = useRef<HTMLDivElement>(null);
    const mobileScrollRef = useRef<HTMLDivElement>(null);
    const desktopReviewMapPanelRef = useRef<HTMLElement>(null);
    const desktopReviewMapPanelOpenerRef = useRef<HTMLElement | null>(null);
    const desktopReviewMapPanelDragRef = useRef<DesktopReviewMapPanelDragState | null>(null);
    const [desktopReviewMapPanelPosition, setDesktopReviewMapPanelPosition] = useState<DesktopReviewMapPanelPosition>(DEFAULT_DESKTOP_REVIEW_MAP_PANEL_POSITION);
    const shouldRenderMapPanel = presentation === 'map-panel' && !isMobileOrTablet;

    const getClampedDesktopReviewMapPanelPosition = useCallback((clientX: number, clientY: number): DesktopReviewMapPanelPosition | null => {
        const dragState = desktopReviewMapPanelDragRef.current;
        if (!dragState || typeof window === 'undefined') return null;

        const deltaX = clientX - dragState.startX;
        const deltaY = clientY - dragState.startY;
        const minLeft = DESKTOP_REVIEW_MAP_PANEL_VIEWPORT_MARGIN;
        const minTop = DESKTOP_REVIEW_MAP_PANEL_VIEWPORT_MARGIN;
        const maxLeft = window.innerWidth - dragState.panelWidth - DESKTOP_REVIEW_MAP_PANEL_VIEWPORT_MARGIN;
        const maxTop = window.innerHeight - dragState.panelHeight - DESKTOP_REVIEW_MAP_PANEL_VIEWPORT_MARGIN;
        const clampedLeft = clampDesktopReviewMapPanelAxis(dragState.initialLeft + deltaX, minLeft, maxLeft);
        const clampedTop = clampDesktopReviewMapPanelAxis(dragState.initialTop + deltaY, minTop, maxTop);

        return {
            x: dragState.originX + clampedLeft - dragState.initialLeft,
            y: dragState.originY + clampedTop - dragState.initialTop,
        };
    }, []);

    const handleDesktopReviewMapPanelPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (!shouldRenderMapPanel || event.button !== 0) return;

        const target = event.target;
        if (target instanceof Element && target.closest('button, input, textarea, select, a, [role="button"]')) return;

        const panel = desktopReviewMapPanelRef.current;
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        desktopReviewMapPanelDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            initialLeft: rect.left,
            initialTop: rect.top,
            originX: desktopReviewMapPanelPosition.x,
            originY: desktopReviewMapPanelPosition.y,
            panelWidth: rect.width,
            panelHeight: rect.height,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    }, [desktopReviewMapPanelPosition.x, desktopReviewMapPanelPosition.y, shouldRenderMapPanel]);

    const handleDesktopReviewMapPanelPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (desktopReviewMapPanelDragRef.current?.pointerId !== event.pointerId) return;

        const nextPosition = getClampedDesktopReviewMapPanelPosition(event.clientX, event.clientY);
        if (nextPosition) {
            setDesktopReviewMapPanelPosition(nextPosition);
        }
    }, [getClampedDesktopReviewMapPanelPosition]);

    const handleDesktopReviewMapPanelPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (desktopReviewMapPanelDragRef.current?.pointerId !== event.pointerId) return;

        desktopReviewMapPanelDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const handleDesktopReviewMapPanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!shouldRenderMapPanel || typeof window === 'undefined') return;

        const delta = getDesktopReviewMapPanelKeyboardDelta(event.key);
        if (!delta) return;

        const panel = desktopReviewMapPanelRef.current;
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        const minLeft = DESKTOP_REVIEW_MAP_PANEL_VIEWPORT_MARGIN;
        const minTop = DESKTOP_REVIEW_MAP_PANEL_VIEWPORT_MARGIN;
        const maxLeft = window.innerWidth - rect.width - DESKTOP_REVIEW_MAP_PANEL_VIEWPORT_MARGIN;
        const maxTop = window.innerHeight - rect.height - DESKTOP_REVIEW_MAP_PANEL_VIEWPORT_MARGIN;
        const clampedLeft = clampDesktopReviewMapPanelAxis(rect.left + delta.x, minLeft, maxLeft);
        const clampedTop = clampDesktopReviewMapPanelAxis(rect.top + delta.y, minTop, maxTop);

        setDesktopReviewMapPanelPosition((currentPosition) => ({
            x: currentPosition.x + clampedLeft - rect.left,
            y: currentPosition.y + clampedTop - rect.top,
        }));
        event.preventDefault();
    }, [shouldRenderMapPanel]);

    useEffect(() => {
        if ((!shouldRenderMapPanel && !inline) || !isOpen) return;

        desktopReviewMapPanelOpenerRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const frame = window.requestAnimationFrame(() => {
            desktopReviewMapPanelRef.current?.focus({ preventScroll: true });
        });

        return () => {
            window.cancelAnimationFrame(frame);
            if (desktopReviewMapPanelOpenerRef.current?.isConnected) {
                desktopReviewMapPanelOpenerRef.current.focus({ preventScroll: true });
            }
            desktopReviewMapPanelOpenerRef.current = null;
        };
    }, [inline, isOpen, shouldRenderMapPanel]);

    useEffect(() => {
        if ((!shouldRenderMapPanel && !inline) || !isOpen || loadedDraftKey !== draftLoadKey) return;
        // Loading the text draft replaces the temporary panel body. Restore
        // its focus only if the reader has not moved to another control.
        if (document.activeElement === document.body || document.activeElement === desktopReviewMapPanelOpenerRef.current) {
            desktopReviewMapPanelRef.current?.focus({ preventScroll: true });
        }
    }, [draftLoadKey, inline, isOpen, loadedDraftKey, shouldRenderMapPanel]);

    useEffect(() => {
        if (isOpen) return;

        desktopReviewMapPanelDragRef.current = null;
        setDesktopReviewMapPanelPosition(DEFAULT_DESKTOP_REVIEW_MAP_PANEL_POSITION);
    }, [isOpen]);

    // 드래그 상태
    const [isFoodPhotosDragging, setIsFoodPhotosDragging] = useState(false);

    const getOcrFocusClass = useCallback((target: OcrFocusTarget) => (
        ocrFocusTarget === target
            ? "rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5"
            : ""
    ), [ocrFocusTarget]);

    const isOcrNavigationSuppressed = useCallback(() => (
        shouldSuppressOcrAutoNavigation({
            lastManualInteractionAt: lastManualOcrInteractionAtRef.current,
            userStepOverride: userStepOverrideDuringOcrRef.current,
        })
    ), []);

    const markManualOcrInteraction = useCallback((field?: ReviewOcrFieldKey) => {
        lastManualOcrInteractionAtRef.current = Date.now();
        if (field) {
            manuallyEditedOcrFieldsRef.current.add(field);
        }
    }, []);

    const markAiFilledField = useCallback((field: ReviewOcrFieldKey) => {
        setAiFilledFields(prev => addAiFilledField(prev, field));
    }, []);

    const renderAiFilledBadge = useCallback((field: ReviewOcrFieldKey) => (
        aiFilledFields.has(field) ? (
            <Badge variant="secondary" className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                AI 입력 · 확인 필요
            </Badge>
        ) : null
    ), [aiFilledFields]);

    const focusOcrTarget = useCallback((target: OcrFocusTarget, delayMs = 0) => {
        window.setTimeout(() => {
            if (isOcrNavigationSuppressed()) {
                noteOcrNavigationSuppressed();
                return;
            }

            const nextStep: ReviewFormStep = target === "review" ? 3 : 2;

            setOcrFocusTarget(target);
            if (isMobileOrTablet) {
                setCurrentStep(nextStep);
            }

            window.setTimeout(() => {
                if (isOcrNavigationSuppressed()) return;
                const root = mobileFrameRef.current ?? document;
                const element = root.querySelector<HTMLElement>(`[data-ocr-focus="${target}"]`);
                if (!element) return;

                element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

                // 모바일에서는 자동 focus가 키보드/날짜 피커를 띄워 오히려 흐름을 방해하므로
                // 시각적 focus(스크롤+하이라이트)만 적용한다. 데스크톱은 입력 위치를 실제 focus한다.
                if (!isMobileOrTablet) {
                    const focusTarget = element.matches("input, textarea, button")
                        ? element
                        : element.querySelector<HTMLElement>("input, textarea, button");
                    focusTarget?.focus({ preventScroll: true });
                }
            }, isMobileOrTablet ? 240 : 40);

            window.setTimeout(() => {
                setOcrFocusTarget(current => current === target ? null : current);
            }, 2200);
        }, delayMs);
    }, [isMobileOrTablet, isOcrNavigationSuppressed, noteOcrNavigationSuppressed]);

    const getOcrFocusTargetForPatch = useCallback((data: Partial<OCRResult>): OcrFocusTarget | null => {
        if (data.date) return "date";
        if (data.time) return "time";
        if (data.store_name) return "restaurant";
        if (data.category) return "category";
        if (data.review_draft) return "review";
        return null;
    }, []);

    const revealOcrAutoFillSequence = useCallback((data: Partial<OCRResult>) => {
        const signature = JSON.stringify({
            store_name: data.store_name ?? null,
            date: data.date ?? null,
            time: data.time ?? null,
            category: data.category ?? null,
            review_draft: data.review_draft ?? null,
            items_count: data.items?.length ?? 0,
        });
        if (lastOcrRevealSignatureRef.current === signature) {
            return;
        }
        lastOcrRevealSignatureRef.current = signature;

        const step2Target = getOcrFocusTargetForPatch({
            store_name: data.store_name,
            date: data.date,
            time: data.time,
            category: data.category,
        });
        const hasReviewContent = Boolean(data.review_draft || data.items?.length);

        if (step2Target) {
            focusOcrTarget(step2Target, 0);
        }

        if (hasReviewContent) {
            focusOcrTarget("review", step2Target ? 2600 : 0);
        }
    }, [focusOcrTarget, getOcrFocusTargetForPatch]);

    const foodPhotoUrls = useMemo(() => {
        return foodPhotos.map(photo => URL.createObjectURL(photo));
    }, [foodPhotos]);

    // URL 정리 (메모리 누수 방지)
    useEffect(() => {
        return () => {
            foodPhotoUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [foodPhotoUrls]);

    // 메모이제이션된 이벤트 핸들러들
    const appendFoodPhotos = useCallback((files: File[]) => {
        if (files.length === 0) return;
        const current = foodPhotosRef.current;
        const requestedCount = current.length + files.length;
        if (requestedCount > REVIEW_FOOD_PHOTO_MAX_COUNT) {
            toast({
                title: "음식 사진이 너무 많습니다",
                description: `음식 사진은 최대 ${REVIEW_FOOD_PHOTO_MAX_COUNT}장까지 등록할 수 있습니다. 현재 ${current.length}장을 유지했으니 사진을 제거한 뒤 다시 선택해 주세요.`,
                variant: "destructive",
            });
            return;
        }
        const next = [...current, ...files];
        foodPhotosRef.current = next;
        setFoodPhotos(next);
    }, []);

    const handleFoodPhotosChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        appendFoodPhotos(Array.from(e.target.files || []));

        // input 초기화 (같은 파일 재선택 가능하도록)
        e.target.value = '';
    }, [appendFoodPhotos]);

    const removeFoodPhoto = useCallback((index: number) => {
        const next = foodPhotosRef.current.filter((_, i) => i !== index);
        foodPhotosRef.current = next;
        setFoodPhotos(next);
    }, []);

    // 드래그 앤 드롭 핸들러 (useCallback으로 메모이제이션)
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleFoodPhotosDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsFoodPhotosDragging(true);
    }, []);

    const handleFoodPhotosDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsFoodPhotosDragging(false);
    }, []);

    const handleFoodPhotosDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsFoodPhotosDragging(false);

        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(file => file.type.startsWith('image/'));

        appendFoodPhotos(imageFiles);
    }, [appendFoodPhotos]);

    // 파일 선택기 열기 함수들 (useCallback으로 메모이제이션)
    const openFoodPhotosFileDialog = useCallback(() => {
        foodPhotosFileInputRef.current?.click();
    }, []);

    // 맛집 검색 핸들러
    const handleSearchRestaurant = useCallback(async (query: string) => {
        if (query.trim().length < 2) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, name:approved_name')
                .ilike('approved_name', `%${query}%`)
                .limit(10)
                .overrideTypes<RestaurantNameQueryRow[], { merge: false }>();

            if (error) throw error;
            setSearchResults(mapRestaurantNameRows(data));
        } catch (error) {
            console.error('맛집 검색 실패:');
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    }, []);

    const findRestaurantFromReceiptName = useCallback(async (receiptStoreName: string): Promise<RestaurantNameRow | null> => {
        const candidates = buildRestaurantSearchCandidates(receiptStoreName);
        if (candidates.length === 0) return null;

        const { data: exactRestaurants, error: exactError } = await supabase
            .from('restaurants')
            .select('id, name:approved_name')
            .eq('approved_name', receiptStoreName)
            .limit(1)
            .overrideTypes<RestaurantNameQueryRow[], { merge: false }>();

        const exactMatches = mapRestaurantNameRows(exactRestaurants);
        if (!exactError && exactMatches.length > 0) {
            return exactMatches[0];
        }

        const fallbackResults = await Promise.all(
            candidates.map(async (candidate) => {
                const { data } = await supabase
                    .from('restaurants')
                    .select('id, name:approved_name')
                    .ilike('approved_name', `%${candidate}%`)
                    .limit(5)
                    .overrideTypes<RestaurantNameQueryRow[], { merge: false }>();
                return mapRestaurantNameRows(data);
            }),
        );

        const deduped = new Map<string, RestaurantNameRow>();
        for (const row of fallbackResults.flat()) {
            deduped.set(row.id, row);
        }

        const [bestMatch] = Array.from(deduped.values())
            .map(row => ({ row, score: scoreRestaurantNameMatch(row.name, receiptStoreName) }))
            .filter(match => match.score > 0)
            .sort((a, b) => b.score - a.score);

        return bestMatch?.row ?? null;
    }, []);

    // 검색어 디바운스
    useEffect(() => {
        const timer = setTimeout(() => {
            handleSearchRestaurant(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery, handleSearchRestaurant]);

    // 맛집 정보가 변경되면 선택된 맛집 업데이트
    useEffect(() => {
        if (restaurant) {
            setSelectedRestaurant(restaurant);
        }
    }, [restaurant]);

    // 기존 로컬 스토리지 기반 임시 저장 로직 제거됨 (IndexedDB로 통합)

    // 모달 닫을 때나 성공 시 초안 삭제 (이 부분은 handleSubmit 성공 시와 handleClose에서 처리해야 함)
    // handleClose에서는 삭제하지 않음 (임시 저장 의도). handleSubmit 성공 시에만 삭제.

    const markOcrFieldApplied = useCallback((label: string, field?: ReviewOcrFieldKey) => {
        if (field) {
            markAiFilledField(field);
        }
        noteOcrFieldApplied(label);
    }, [markAiFilledField, noteOcrFieldApplied]);

    const applyOcrFieldPatch = useCallback((data: Partial<OCRResult>) => {
        const manuallyEdited = manuallyEditedOcrFieldsRef.current;
        if (data.store_name && !restaurant && !manuallyEdited.has("restaurant")) {
            setSearchQuery(data.store_name);
            markOcrFieldApplied("맛집", "restaurant");
        }
        if (data.date && !manuallyEdited.has("date")) {
            setVisitedDate(data.date);
            markOcrFieldApplied("방문일", "date");
        }
        if (data.time && !manuallyEdited.has("time")) {
            setVisitedTime(data.time);
            markOcrFieldApplied("시간", "time");
        }
        if (data.category && !manuallyEdited.has("category")) {
            const validCategory = CATEGORIES.find(c => c === data.category);
            if (validCategory) {
                setCategories([validCategory]);
                markOcrFieldApplied("카테고리", "category");
            }
        }
        if (data.review_draft && !manuallyEdited.has("review")) {
            setContent(data.review_draft);
            markOcrFieldApplied("리뷰 초안", "review");
        }
    }, [markOcrFieldApplied, restaurant]);

    function applyReceiptOcrFields(data: Partial<OCRResult>, isLastPatch: boolean) {
        applyOcrFieldPatch(data);
        if (isLastPatch) {
            revealOcrAutoFillSequence(data);
        } else {
            const target = getOcrFocusTargetForPatch(data);
            if (target && target !== "review") {
                focusOcrTarget(target);
            }
        }
    }

    async function applyReceiptOcrResult(data: OCRResult, isCurrentOcrRun: () => boolean) {
        const autoFilledParts: string[] = [];
        // 캐시/일반 fallback 응답도 SSE 최종 응답과 동일하게 폼에 반영하고,
        // 모바일에서는 방문 정보(2단계) -> 리뷰(3단계) 순서로 실제 입력 위치를 보여준다.
        applyOcrFieldPatch(data);
        revealOcrAutoFillSequence(data);

        // 1. 맛집 자동 검색 및 설정
        // 수정: 이미 선택된 맛집이 있어도(selectedRestaurant) OCR 결과가 있으면 교체 시도 (단, props로 고정된 restaurant가 없어야 함)
        const manuallyEdited = manuallyEditedOcrFieldsRef.current;

        const canApplyOcrRestaurant = canReplaceSelectedRestaurantFromOcr({
            hasSelectedRestaurant: Boolean(selectedRestaurant),
            manuallyEditedRestaurant: manuallyEdited.has("restaurant"),
            fieldTrust: data.field_trust,
        });

        if (data.store_name && !restaurant && canApplyOcrRestaurant) {
            const matchedRestaurant = await findRestaurantFromReceiptName(data.store_name);
            if (!isCurrentOcrRun()) return;

            if (matchedRestaurant) {
                setSelectedRestaurant(matchedRestaurant);
                setSearchQuery(matchedRestaurant.name);
                autoFilledParts.push("맛집");

                // 만약 기존에 선택된 맛집과 다르다면 알림
                if (selectedRestaurant && selectedRestaurant.id !== matchedRestaurant.id) {
                    toast({
                        title: "맛집 정보 업데이트",
                        description: `영수증 정보에 맞춰 맛집이 '${matchedRestaurant.name}'(으)로 변경되었습니다.`,
                    });
                }
            } else {
                // 정확한 일치가 없으면 검색어로 설정하여 목록 노출 유도
                setSearchQuery(data.store_name);
                setSelectedRestaurant(null); // 기존 선택 해제하여 검색 유도

                // 검색 결과가 나오도록 잠시 대기 후 토스트 메시지 (useEffect에 의해 검색 실행됨)
                toast({
                    title: "맛집을 선택해주세요",
                    description: `'${data.store_name}' 검색 결과를 확인하고 선택해주세요.`,
                });
            }
        } else if (data.store_name && restaurant && !manuallyEdited.has("restaurant")) {
            // 이미 선택된 경우 검증만 수행
            const currentName = selectedRestaurant?.name || restaurant?.name || "";
            if (!currentName.includes(data.store_name) && !data.store_name.includes(currentName)) {
                toast({
                    title: "정보 불일치 주의",
                    description: `선택된 맛집(${currentName})과 영수증(${data.store_name})이 달라 보입니다.`,
                    variant: "destructive"
                });
            }
        }

        // 2. 날짜 및 시간
        if (data.date && !manuallyEdited.has("date")) {
            autoFilledParts.push("방문일");
        }
        if (data.time && !manuallyEdited.has("time")) {
            autoFilledParts.push("시간");
        }

        // 3. 카테고리
        if (data.category && !manuallyEdited.has("category")) {
            // 카테고리 유효성 검사
            const validCategory = CATEGORIES.find(c => c === data.category);
            if (validCategory) {
                autoFilledParts.push("카테고리");
            }
        }

        // 4. 리뷰 내용 (자동 생성된 초안 사용)
        if (data.review_draft && !manuallyEdited.has("review")) {
            autoFilledParts.push("리뷰 내용");
        } else if (data.items && data.items.length > 0 && !manuallyEdited.has("review")) {
            // 초안이 없으면 기존 방식대로 메뉴 목록 추가
            const menuText = data.items.map(item => `- ${item.name}: ${item.price?.toLocaleString() || 0}원`).join('\\n');
            const totalText = data.total_amount ? `\\n총 결제금액: ${data.total_amount.toLocaleString()}원` : '';
            const newContent = content ? `${content}\\n\\n[영수증 메뉴]\\n${menuText}${totalText}` : `[영수증 메뉴]\\n${menuText}${totalText}`;
            setContent(newContent);
            markAiFilledField("review");
        }

        // 결과 리포트
        if (autoFilledParts.length > 0) {
            toast({
                title: "영수증 자동 입력 완료",
                description: `${autoFilledParts.join(', ')} 정보가 자동으로 입력되었습니다.`,
            });
        } else {
            toast({
                title: "스마트 스캔 완료",
                description: "영수증을 분석했으나 자동 입력할 정보를 찾지 못했습니다.",
            });
        }
    }
    // Use the scoped pre-write snapshot; a newer composer may already have saved
    // another draft at this key. Submit/close refs stop queued autosaves here.
    const clearDraft = useCallback(async (): Promise<boolean> => {
        try {
            await autoSaveInFlightRef.current;
            if (!await saveOperationRef.current?.clearSavedDraft()) return false;
            setLastSavedAt(null);
            return true;
        } catch {
            return false;
        }
    }, []);

    const notifySavedReview = useCallback(() => {
        if (consumerNotifiedRef.current) return;
        consumerNotifiedRef.current = true;
        try { onSuccess?.(); }
        catch {
            toast({ title: "등록 후 화면 갱신 실패", description: "내 리뷰에서 등록 결과를 확인해주세요.", variant: "destructive" });
        }
    }, [onSuccess]);

    const handleSubmit = async () => {
        const submittedInputs = latestSaveInputsRef.current;
        const saveInputsStillCurrent = () => sameReviewSaveInputsSnapshot(
            submittedInputs,
            latestSaveInputsRef.current,
        )
            && saveOwnerRef.current === submittedInputs.ownerId
            && verificationInputModeRef.current === submittedInputs.verificationInputMode
            && ocrRunGenerationRef.current === submittedInputs.ocrRunGeneration;
        const notifyInputsChanged = () => toast({
            title: "입력 내용이 변경되었습니다",
            description: "현재 내용을 확인한 뒤 다시 등록해주세요.",
        });
        if (submittedInputs.foodPhotos.length > REVIEW_FOOD_PHOTO_MAX_COUNT) {
            toast({
                title: "음식 사진이 너무 많습니다",
                description: `음식 사진은 최대 ${REVIEW_FOOD_PHOTO_MAX_COUNT}장까지 등록할 수 있습니다. 현재 ${submittedInputs.foodPhotos.length}장에서 초과한 사진을 직접 제거해 주세요.`,
                variant: "destructive",
            });
            return;
        }
        const liveReadiness = await fetchFeatureDatabaseReadiness();
        void mutateFeatureReadiness(liveReadiness, { revalidate: false });
        if (liveReadiness.status !== 'ready') {
            toast({ title: "리뷰 기능 준비 중", description: FEATURE_DATABASE_HELD_MESSAGE });
            return;
        }
        if (!saveInputsStillCurrent()) {
            notifyInputsChanged();
            return;
        }
        const normalizedContent = submittedInputs.content.trim();
        // 필수 항목 검증
        if (!submittedInputs.visitedDate || !submittedInputs.visitedTime || !submittedInputs.restaurantId
            || !submittedInputs.restaurantName || submittedInputs.categories.length === 0 || !normalizedContent
            || !submittedInputs.verificationPhoto || submittedInputs.foodPhotos.length === 0) {
            toast({
                title: "필수 항목 누락",
                description: "모든 필수 항목을 입력해주세요",
                variant: "destructive",
            });
            return;
        }

        // 리뷰 내용 길이 검증 (최소 20자)
        if (normalizedContent.length < 20) {
            toast({
                title: "리뷰 내용이 너무 짧습니다",
                description: "최소 20자 이상 작성해주세요 (현재 " + normalizedContent.length + "자)",
                variant: "destructive",
            });
            return;
        }
        if (normalizedContent.length > REVIEW_CONTENT_MAX_LENGTH) {
            toast({
                title: "리뷰 내용이 너무 깁니다",
                description: `리뷰 내용은 최대 ${REVIEW_CONTENT_MAX_LENGTH.toLocaleString()}자까지 작성할 수 있습니다.`,
                variant: "destructive",
            });
            return;
        }

        const submissionMode = submittedInputs.verificationInputMode;
        if (submissionMode === "ai"
            && (submittedInputs.isAnalyzing
                || !submittedInputs.ocrResultRef || !submittedInputs.ocrResultRevision
                || ocrRunGenerationRef.current !== submittedInputs.ocrRunGeneration)) {
            toast({
                title: "영수증 분석을 확인해주세요",
                description: "AI 분석이 끝난 뒤 등록하거나 사진만 첨부를 선택해주세요.",
            });
            return;
        }

        if (!submittedInputs.ownerId) {
            toast({
                title: "로그인 필요",
                description: "리뷰를 작성하려면 로그인이 필요합니다",
                variant: "destructive",
            });
            return;
        }

        if (submitInFlightRef.current || closeRequestedRef.current) return;
        const timeWithSeconds = submittedInputs.visitedTime.split(':').length === 2
            ? `${submittedInputs.visitedTime}:00`
            : submittedInputs.visitedTime;
        const visitedAt = `${submittedInputs.visitedDate}T${timeWithSeconds}`;
        if (Number.isNaN(new Date(visitedAt).getTime())) {
            toast({ title: "방문 일시 확인", description: "올바른 방문 날짜와 시간을 입력해주세요.", variant: "destructive" });
            return;
        }
        const draft: ReviewSaveDraft = {
            ownerId: submittedInputs.ownerId,
            restaurantId: submittedInputs.restaurantId,
            title: `${submittedInputs.restaurantName} 방문 후기`,
            content: normalizedContent,
            visitedAt,
            categories: submittedInputs.categories,
            verificationPhoto: submittedInputs.verificationPhoto,
            foodPhotos: submittedInputs.foodPhotos,
            ocrResultRef: submissionMode === "manual" ? null : submittedInputs.ocrResultRef,
            ocrResultRevision: submissionMode === "manual" ? null : submittedInputs.ocrResultRevision,
        };
        submitInFlightRef.current = true;
        setIsSubmitting(true);
        try {
            await autoSaveInFlightRef.current;
            if (!saveInputsStillCurrent()) {
                notifyInputsChanged();
                return;
            }
            if (closeRequestedRef.current) return;
            const result = await saveOperationRef.current!.submit(draft);
            const changedDuringSave = !saveInputsStillCurrent();
            if (saveOwnerRef.current !== submittedInputs.ownerId) {
                // A known commit survives unmount/auth changes. Finish only the
                // captured local draft cleanup; do not notify a different owner
                // or update an unmounted form, and never remove saved photos.
                if (result === 'saved' || result === 'saved-previous') await saveOperationRef.current!.clearSavedDraft();
                return;
            }
            if (closeRequestedRef.current) return; // handleClose owns cancellation readback and notification.
            if (!composerOpenRef.current) {
                if (result === 'saved' || result === 'saved-previous') {
                    await clearDraft();
                    notifySavedReview();
                }
                return;
            }
            if (result === 'saved-previous' || (result === 'saved' && changedDuringSave)) {
                if (!await clearDraft()) {
                    setSaveRecovery('draft-cleanup');
                    toast({ title: "리뷰는 등록되었습니다", description: "임시 저장 정리를 완료하지 못했습니다. 이 창에서 다시 시도해주세요." });
                    return;
                }
                setSaveRecovery('edit');
                toast({ title: "이전 내용으로 등록되었습니다", description: "등록 후 변경한 내용은 유지했습니다. 저장된 리뷰는 내 리뷰에서 확인하고 수정해주세요." });
                return;
            }
            if (result === 'saved') {
                if (!await clearDraft()) {
                    setSaveRecovery('draft-cleanup');
                    toast({ title: "리뷰는 등록되었습니다", description: "임시 저장 정리를 완료하지 못했습니다. 이 창에서 다시 시도해주세요." });
                    return;
                }
                toast({ title: "리뷰 등록 완료", description: "관리자 승인 후 리뷰가 공개되고 스탬프가 지급됩니다." });
                notifySavedReview();
                await handleClose();
            } else if (result !== 'cancelled') {
                if (result === 'blocked' && saveOperationRef.current!.hasPendingConfirmation()) {
                    setSaveRecovery('result-check');
                }
                toast({
                    title: result === 'blocked' ? "저장 상태 확인 필요" : "리뷰 등록 실패",
                    description: result === 'blocked'
                        ? "저장 결과 또는 사진 정리를 확인하지 못했습니다. 이 창에서 다시 시도해주세요."
                        : "리뷰를 저장하지 못했습니다. 입력한 내용을 유지했으니 다시 시도해주세요.",
                    variant: "destructive",
                });
            }
        } catch {
            toast({ title: "등록 후 화면 갱신 실패", description: "내 리뷰에서 등록 결과를 확인해주세요.", variant: "destructive" });
        } finally {
            submitInFlightRef.current = false;
            if (saveOwnerRef.current === submittedInputs.ownerId) setIsSubmitting(false);
        }
    };

    const handleConfirmSaveResult = async () => {
        const ownerAtStart = saveOwnerRef.current;
        if (!ownerAtStart || submitInFlightRef.current || closeRequestedRef.current) return;
        submitInFlightRef.current = true;
        setIsSubmitting(true);
        try {
            const confirmation = await saveOperationRef.current!.confirmPending();
            if (confirmation.status !== 'saved') {
                if (saveOwnerRef.current === ownerAtStart && composerOpenRef.current && !closeRequestedRef.current) {
                    setSaveRecovery('result-check');
                    toast({
                        title: "저장 결과를 아직 확인하지 못했습니다",
                        description: "기존 저장 요청은 그대로 보존했습니다. 새 리뷰를 등록하지 않았으며 잠시 후 다시 확인해 주세요.",
                        variant: "destructive",
                    });
                }
                return;
            }
            if (saveOwnerRef.current !== ownerAtStart) {
                await saveOperationRef.current!.clearSavedDraft();
                return;
            }
            if (closeRequestedRef.current) return;
            const draftCleared = await clearDraft();
            if (saveOwnerRef.current !== ownerAtStart || closeRequestedRef.current) return;
            if (!composerOpenRef.current) {
                if (draftCleared) notifySavedReview();
                return;
            }
            if (!draftCleared) {
                setSaveRecovery('draft-cleanup');
                toast({ title: "리뷰는 등록되었습니다", description: "임시 저장 정리를 완료하지 못했습니다. 이 창에서 다시 시도해주세요." });
                return;
            }
            setSaveRecovery('edit');
            toast({ title: "이전 내용으로 등록되었습니다", description: "현재 입력은 유지했습니다. 저장된 리뷰는 내 리뷰에서 확인하고 수정해주세요." });
        } finally {
            submitInFlightRef.current = false;
            if (saveOwnerRef.current === ownerAtStart && composerOpenRef.current && !closeRequestedRef.current) {
                setIsSubmitting(false);
            }
        }
    };

    const handleRetryDraftCleanup = async () => {
        const ownerAtStart = saveOwnerRef.current;
        if (!ownerAtStart || submitInFlightRef.current || closeRequestedRef.current) return;
        submitInFlightRef.current = true;
        setIsSubmitting(true);
        try {
            const draftCleared = await clearDraft();
            if (saveOwnerRef.current !== ownerAtStart || closeRequestedRef.current) return;
            if (!composerOpenRef.current) {
                if (draftCleared) notifySavedReview();
                return;
            }
            if (!draftCleared) {
                setSaveRecovery('draft-cleanup');
                toast({ title: "임시 저장 정리 필요", description: "잠시 후 다시 시도해 주세요.", variant: "destructive" });
                return;
            }
            setSaveRecovery('edit');
            toast({ title: "임시 저장 정리 완료", description: "현재 입력은 유지했습니다." });
        } finally {
            submitInFlightRef.current = false;
            if (saveOwnerRef.current === ownerAtStart && composerOpenRef.current && !closeRequestedRef.current) {
                setIsSubmitting(false);
            }
        }
    };

    const handleClose = useCallback(async () => {
        if (closeRequestedRef.current) return;
        const ownerAtStart = saveOwnerRef.current;
        const scopeAtStart = draftScopeRef.current;
        const inputsAtStart = latestSaveInputsRef.current;
        const stepAtStart = currentStep;
        const stillCurrent = () => composerOpenRef.current && saveOwnerRef.current === ownerAtStart
            && draftScopeRef.current === scopeAtStart;
        closeRequestedRef.current = true;
        cancelPendingReceiptSelection();
        const cancellation = await saveOperationRef.current!.cancel();
        if (!stillCurrent()) return;
        if (cancellation.status === 'blocked') {
            closeRequestedRef.current = false;
            if (saveOperationRef.current!.hasPendingConfirmation()) setSaveRecovery('result-check');
            toast({ title: "저장 상태 확인 필요", description: "저장 결과 또는 사진 정리를 확인하지 못했습니다. 이 창에서 다시 시도해주세요.", variant: "destructive" });
            return;
        }
        if (cancellation.status === 'saved') {
            const draftCleared = await clearDraft();
            if (!stillCurrent()) return;
            if (!draftCleared) {
                closeRequestedRef.current = false;
                setSaveRecovery('draft-cleanup');
                toast({ title: "리뷰는 등록되었습니다", description: "임시 저장 정리를 완료하지 못했습니다. 이 창에서 다시 시도해주세요." });
                return;
            }
            if (!consumerNotifiedRef.current) {
                toast({ title: "리뷰가 등록되었습니다", description: "닫기 전에 저장이 완료되어 등록된 리뷰는 유지됩니다." });
            }
            notifySavedReview();
            saveOperationRef.current!.releaseSaved();
        }
        // Closing cancels the debounce. Flush the final bounded text revision
        // before resetting the form; media remains excluded by the draft boundary.
        if (cancellation.status !== 'saved' && ownerAtStart && inputsAtStart.restaurantId) {
            await autoSaveInFlightRef.current;
            if (!stillCurrent()) return;
            const { visitedDate, visitedTime, categories, content } = inputsAtStart;
            const previous = scopeAtStart.revision;
            const hasChanges = !previous || previous.visitedDate !== visitedDate || previous.visitedTime !== visitedTime
                || previous.content !== content || previous.currentStep !== stepAtStart
                || JSON.stringify(previous.categories) !== JSON.stringify(categories);
            if (hasChanges && (visitedDate || visitedTime || categories.length > 0 || content || previous)) {
                try {
                    const committed = await saveDraft({
                        userId: ownerAtStart, restaurantId: inputsAtStart.restaurantId,
                        visitedDate, visitedTime, categories, content, currentStep: stepAtStart,
                    });
                    if (!stillCurrent()) return;
                    if (!committed) throw new Error('DRAFT_NOT_SAVED');
                    scopeAtStart.revision = committed;
                } catch {
                    if (!stillCurrent()) return;
                    closeRequestedRef.current = false;
                    toast({ title: "임시 저장 실패", description: "마지막 입력을 저장하지 못했습니다. 입력을 유지했으니 다시 닫기를 시도해주세요.", variant: "destructive" });
                    return;
                }
            }
        }
        setSaveRecovery(null);
        setVisitedDate("");
        setVisitedTime("");
        setCategories([]);
        setContent("");
        resetReceiptStep();
        foodPhotosRef.current = [];
        setFoodPhotos([]);
        setOcrFocusTarget(null);
        setAiFilledFields(new Set());
        setCurrentStep(1);
        onClose();
    }, [onClose, cancelPendingReceiptSelection, resetReceiptStep, clearDraft, notifySavedReview, currentStep]);

    const handleDesktopReviewDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        void handleClose();
    }, [handleClose]);

    const handleDialogOpenAutoFocus = () => {
        desktopReviewMapPanelOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    };
    const handleDialogCloseAutoFocus = (event: Event) => {
        if (desktopReviewMapPanelOpenerRef.current?.isConnected) {
            event.preventDefault();
            desktopReviewMapPanelOpenerRef.current.focus({ preventScroll: true });
        }
        desktopReviewMapPanelOpenerRef.current = null;
    };

    const saveRecoveryNotice = saveRecovery ? (
        <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p>{saveRecovery === 'result-check'
                ? "저장 결과를 확인해 주세요."
                : saveRecovery === 'edit'
                    ? "이전 내용으로 등록되었습니다. 현재 입력은 유지됩니다."
                    : "임시 저장 정리가 필요합니다."}</p>
            {saveRecovery === 'result-check' ? (
                <Button type="button" variant="outline" size="sm" className="mt-2 h-11 sm:h-8" onClick={handleConfirmSaveResult} disabled={isSubmitting}>
                    저장 결과 확인
                </Button>
            ) : saveRecovery === 'draft-cleanup' ? (
                <Button type="button" variant="outline" size="sm" className="mt-2 h-11 sm:h-8" onClick={handleRetryDraftCleanup} disabled={isSubmitting}>
                    임시 저장 정리
                </Button>
            ) : (
                <a className="mt-2 inline-block underline underline-offset-4" href="/mypage/reviews" target="_blank" rel="noopener noreferrer">
                    등록된 리뷰 확인 (새 탭)
                </a>
            )}
        </div>
    ) : null;

    // 폼 유효성 검사 메모이제이션 (리뷰 내용 20~4,000자)
    const normalizedContentLength = content.trim().length;
    const isFormValid = useMemo(() => {
        return visitedDate && visitedTime && reviewTargetRestaurant?.id && categories.length > 0
            && normalizedContentLength >= 20 && normalizedContentLength <= REVIEW_CONTENT_MAX_LENGTH
            && verificationPhoto && foodPhotos.length > 0 && foodPhotos.length <= REVIEW_FOOD_PHOTO_MAX_COUNT;
    }, [visitedDate, visitedTime, reviewTargetRestaurant?.id, categories.length, normalizedContentLength, verificationPhoto, foodPhotos.length]);

    const isOcrBindingReadyForSubmit = verificationInputMode === "manual"
        || (!isAnalyzing && Boolean(ocrResultRef && ocrResultRevision));
    const canSubmitReview = Boolean(isFormValid && isOcrBindingReadyForSubmit);

    const isStepValid = useMemo<Record<ReviewFormStep, boolean>>(() => ({
        1: Boolean(verificationPhoto) && !isAnalyzing,
        2: Boolean(visitedDate && visitedTime && reviewTargetRestaurant?.id && categories.length > 0),
        3: Boolean(normalizedContentLength >= 20 && normalizedContentLength <= REVIEW_CONTENT_MAX_LENGTH
            && foodPhotos.length > 0 && foodPhotos.length <= REVIEW_FOOD_PHOTO_MAX_COUNT),
    }), [categories.length, foodPhotos.length, isAnalyzing, normalizedContentLength, reviewTargetRestaurant?.id, verificationPhoto, visitedDate, visitedTime]);

    const getStepValidationMessage = useCallback((step: ReviewFormStep) => {
        if (step === 1) {
            if (isAnalyzing) return "AI 분석이 끝난 뒤 다음 단계로 이동할 수 있어요.";
            return "영수증 인증 사진을 먼저 첨부해주세요.";
        }

        if (step === 2) {
            return "방문 맛집, 방문 날짜/시간, 카테고리를 모두 입력해주세요.";
        }

        if (normalizedContentLength > REVIEW_CONTENT_MAX_LENGTH) {
            return `리뷰 내용은 최대 ${REVIEW_CONTENT_MAX_LENGTH.toLocaleString()}자까지 작성할 수 있습니다.`;
        }
        if (foodPhotos.length > REVIEW_FOOD_PHOTO_MAX_COUNT) {
            return `음식 사진은 최대 ${REVIEW_FOOD_PHOTO_MAX_COUNT}장까지 등록할 수 있습니다.`;
        }
        return "음식 사진 1장 이상과 리뷰 내용 20자 이상을 입력해주세요.";
    }, [foodPhotos.length, isAnalyzing, normalizedContentLength]);

    const handleNextStep = useCallback(() => {
        userStepOverrideDuringOcrRef.current = true;
        lastManualOcrInteractionAtRef.current = Date.now();
        if (!isStepValid[currentStep]) {
            toast({
                title: "아직 다음 단계로 이동할 수 없어요",
                description: getStepValidationMessage(currentStep),
                variant: "destructive",
            });
            return;
        }

        setCurrentStep((step) => Math.min(step + 1, 3) as ReviewFormStep);
    }, [currentStep, getStepValidationMessage, isStepValid]);

    const handlePreviousStep = useCallback(() => {
        userStepOverrideDuringOcrRef.current = true;
        lastManualOcrInteractionAtRef.current = Date.now();
        setCurrentStep((step) => Math.max(step - 1, 1) as ReviewFormStep);
    }, []);

    // 임시 저장된 데이터 불러오기 (IndexedDB)
    const loadDraft = useCallback(async () => {
        const targetRestaurantId = selectedRestaurant?.id || restaurant?.id;
        if (!user?.id || !targetRestaurantId) return;

        const scope = draftScopeRef.current;
        if (scope.ownerId !== user.id || scope.restaurantId !== targetRestaurantId || !composerOpenRef.current
            || submitInFlightRef.current || closeRequestedRef.current) return;
        const previousRevision = scope.revision;
        setDraftLoadFailed(false);
        try {
            await waitForDraftAutosave(`${user.id}:review:${targetRestaurantId}`);
            const draft = await getDraft(user.id, targetRestaurantId);
            if (draftScopeRef.current !== scope || scope.revision !== previousRevision || !composerOpenRef.current
                || saveOwnerRef.current !== user.id || submitInFlightRef.current || closeRequestedRef.current) return;
            if (draft) {
                scope.revision = draft;
                setVisitedDate(draft.visitedDate);
                setVisitedTime(draft.visitedTime);
                setCategories(draft.categories as Category[]);
                setContent(draft.content);

                // 사진 복원
                if (draft.verificationPhoto) {
                    replaceVerificationPhoto(draft.verificationPhoto);
                }
                if (draft.foodPhotos && draft.foodPhotos.length > 0) {
                    foodPhotosRef.current = draft.foodPhotos;
                    setFoodPhotos(draft.foodPhotos);
                }
                if (draft.currentStep && REVIEW_FORM_STEPS.some((step) => step.id === draft.currentStep)) {
                    setCurrentStep(draft.currentStep);
                }

                setLastSavedAt(new Date(draft.savedAt));
            }
            setLoadedDraftKey(draftLoadKey);
        } catch {
            if (draftScopeRef.current === scope && composerOpenRef.current) setDraftLoadFailed(true);
        }
    }, [user?.id, selectedRestaurant?.id, restaurant?.id, replaceVerificationPhoto, draftLoadKey]);

    // 자동 저장 (IndexedDB)
    const autoSave = useCallback(async () => {
        const targetRestaurantId = selectedRestaurant?.id || restaurant?.id;
        if (!user?.id || !targetRestaurantId || submitInFlightRef.current || closeRequestedRef.current) return;

        // 내용이 하나라도 있을 때만 저장 (빈 문자열이라도 저장 - 지운 경우 대응)
        // 모든 필드가 초기값인 경우에만 저장 스킵
        const hasAnyContent = visitedDate || visitedTime || categories.length > 0 || content || verificationPhoto || foodPhotos.length > 0;
        const scope = draftScopeRef.current;
        if (loadedDraftKey !== draftLoadKey) return;
        // Clearing the last field is still a revision of an existing draft.
        if (!hasAnyContent && !scope.revision) return;
        if (scope.ownerId !== user.id || scope.restaurantId !== targetRestaurantId || !composerOpenRef.current) return;
        const epoch = captureBrowserDraftEpoch(user.id);
        const pendingSave = enqueueDraftWrite(`${user.id}:review:${targetRestaurantId}`, { owner: scope, isCurrent: () => isBrowserDraftEpochCurrent(user.id, epoch, true), async run() {
            if (submitInFlightRef.current || closeRequestedRef.current) return true;
            try {
                assertBrowserDraftWrite(user.id, epoch);
                if (draftScopeRef.current === scope && composerOpenRef.current) setIsSaving(true);
                const committed = await saveDraft({
                    userId: user.id, restaurantId: targetRestaurantId,
                    visitedDate, visitedTime, categories, content, verificationPhoto, foodPhotos, currentStep,
                });
                if (draftScopeRef.current === scope && saveOwnerRef.current === user.id && composerOpenRef.current) {
                    scope.revision = committed;
                    setLastSavedAt(committed ? new Date(committed.savedAt) : null);
                }
                return true;
            } catch {
                console.error('자동 저장 실패:');
                return false;
            } finally {
                if (draftScopeRef.current === scope && composerOpenRef.current) setIsSaving(false);
            }
        } }).then(() => {});
        autoSaveInFlightRef.current = pendingSave;
        await pendingSave;
        if (autoSaveInFlightRef.current === pendingSave) autoSaveInFlightRef.current = null;
    }, [user?.id, selectedRestaurant?.id, restaurant?.id, visitedDate, visitedTime, categories, content, verificationPhoto, foodPhotos, currentStep, loadedDraftKey, draftLoadKey]);

    useEffect(() => {
        const scope = draftScopeRef.current;
        if (!isOpen || !user?.id || !scope.restaurantId) return;
        const epoch = captureBrowserDraftEpoch(user.id);
        const original = scope.revision;
        const persisted = original && original.visitedDate === visitedDate && original.visitedTime === visitedTime
            && JSON.stringify(original.categories) === JSON.stringify(categories) && original.content === content
            && original.currentStep === currentStep;
        if (!isSubmitting && !saveOperationRef.current?.hasPendingConfirmation() && !verificationPhoto && !foodPhotos.length
            && (persisted || (!original && !(visitedDate || visitedTime || categories.length || content)))) return;
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (draftScopeRef.current !== scope || !composerOpenRef.current
                || !isBrowserDraftEpochCurrent(user.id, epoch, true)) return;
            if (isSubmitting || saveOperationRef.current?.hasPendingConfirmation()) {
                blockDraftUnload(event);
                return;
            }
            const revision = scope.revision;
            const hasText = Boolean(visitedDate || visitedTime || categories.length || content);
            const sameText = revision && revision.visitedDate === visitedDate && revision.visitedTime === visitedTime
                && JSON.stringify(revision.categories) === JSON.stringify(categories) && revision.content === content
                && revision.currentStep === currentStep;
            // Media deliberately never enters text drafts. Do not imply that a
            // completed text save can restore an in-memory attachment after reload.
            if (verificationPhoto || foodPhotos.length || ((hasText || revision) && !sameText)) blockDraftUnload(event);
        };
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [isOpen, user?.id, visitedDate, visitedTime, categories, content, currentStep, verificationPhoto, foodPhotos, isSubmitting, lastSavedAt]);

    // Admit committed text before switching to another restaurant unmounts
    // this composer. The shared queue serializes/coalesces writes per target.
    useLayoutEffect(() => {
        if (isOpen && !isSubmitting) void autoSave();
    }, [isOpen, isSubmitting, autoSave]);

    const handleUseReceiptPhotoOnly = () => {
        setReceiptVerificationInputMode("manual");
        setCurrentStep(2);
    };

    const renderFeatureHoldNotice = () => featureHeld ? (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="status" aria-live="polite">
            <p className="font-semibold">리뷰 기능 준비 중</p>
            <p className="mt-1">{FEATURE_DATABASE_HELD_MESSAGE}</p>
            <p>이용할 수 있을 때 사진을 선택하고 리뷰를 등록할 수 있습니다</p>
            <Button type="button" variant="outline" className="min-h-11 bg-background" disabled={isCheckingFeatureReadiness} onClick={() => void mutateFeatureReadiness()}>
                {isCheckingFeatureReadiness ? '확인 중' : '이용 가능 여부 다시 확인'}
            </Button>
        </div>
    ) : null;

    // 초기 로딩 및 모달 열릴 때 임시 저장 불러오기
    useEffect(() => {
        if (isOpen && user?.id && reviewTargetRestaurant?.id) {
            void loadDraft();
        }
    }, [isOpen, user?.id, reviewTargetRestaurant?.id, loadDraft]);

    useEffect(() => {
        if (!isOpen || !isMobileOrTablet) return;

        mobileScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    }, [currentStep, isMobileOrTablet, isOpen]);

    const renderFoodPhotosSection = useCallback(() => (
        <div className="space-y-2">
            <Label className="flex items-center gap-2">
                음식 사진 <span className="text-red-500">*</span>
            </Label>

            {foodPhotos.length > REVIEW_FOOD_PHOTO_MAX_COUNT && (
                <p role="alert" className="text-sm text-destructive">
                    음식 사진은 최대 {REVIEW_FOOD_PHOTO_MAX_COUNT}장까지 등록할 수 있습니다. 현재 {foodPhotos.length}장이므로 초과한 사진을 직접 제거해 주세요.
                </p>
            )}

            {foodPhotos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    {foodPhotos.map((photo, index) => (
                        <div key={index} className="relative group">
                            <Card className="p-2 shadow-none">
                                <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                                    <Image
                                        src={foodPhotoUrls[index] || ''}
                                        alt={`음식 사진 ${index + 1}`}
                                        fill
                                        unoptimized
                                        sizes="(max-width: 640px) 45vw, 180px"
                                        className="object-cover"
                                    />
                                </div>
                                <div className="mt-2 space-y-1">
                                    <p className="text-xs font-medium truncate" title={photo.name}>{photo.name}</p>
                                    <p className="text-xs text-muted-foreground">{(photo.size / 1024 / 1024).toFixed(1)}MB</p>
                                </div>
                            </Card>
                            <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                className="mt-2 min-h-11 w-full gap-2 rounded-lg border border-border bg-background text-muted-foreground shadow-none hover:bg-destructive/5 hover:text-destructive"
                                aria-label={`음식 사진 ${index + 1} 제거`}
                                onClick={() => removeFoodPhoto(index)}
                            >
                                <XIcon className="h-4 w-4" aria-hidden="true" />
                                제거
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <Card
                ref={foodPhotosDropRef}
                className={`p-6 border-dashed transition-colors cursor-pointer ${isFoodPhotosDragging
                    ? 'border-primary bg-primary/5'
                    : foodPhotos.length > 0
                        ? 'border-green-300 bg-green-50/50'
                        : 'border-border hover:border-primary/50'
                    }`}
                onDragOver={handleDragOver}
                onDragEnter={handleFoodPhotosDragEnter}
                onDragLeave={handleFoodPhotosDragLeave}
                onDrop={featureHeld ? undefined : handleFoodPhotosDrop}
                aria-disabled={featureHeld}
                onClick={featureHeld ? undefined : openFoodPhotosFileDialog}
                aria-invalid={foodPhotos.length > REVIEW_FOOD_PHOTO_MAX_COUNT}
            >
                <div className="flex flex-col items-center gap-4">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isFoodPhotosDragging ? 'bg-primary/10' : 'bg-muted'}`}>
                        <Upload className={`h-8 w-8 transition-colors ${isFoodPhotosDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="text-center space-y-2">
                        <p className="font-medium">
                            {isFoodPhotosDragging ? '여기에 사진들을 놓아주세요' : '음식 사진을 업로드해주세요'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            방문할 때 찍은 음식 사진을 선택하거나 이 영역에 끌어다 놓으세요
                        </p>
                        <div className="flex gap-2 justify-center">
                            <Button type="button" variant="outline" size="sm" className="min-h-11 gap-2" disabled={featureHeld} onClick={(e) => { e.stopPropagation(); openFoodPhotosFileDialog(); }}>
                                <Plus className="h-4 w-4" />
                                사진 추가
                            </Button>
                            {foodPhotos.length > 0 && (
                                <Badge variant="secondary" className="px-3 py-1">
                                    {foodPhotos.length} / {REVIEW_FOOD_PHOTO_MAX_COUNT}장
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>
                <input ref={foodPhotosFileInputRef} type="file" disabled={featureHeld} accept="image/*" multiple onChange={handleFoodPhotosChange} className="hidden" />
            </Card>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-muted-foreground">
                <span>음식 사진은 최대 {REVIEW_FOOD_PHOTO_MAX_COUNT}장까지 첨부할 수 있습니다</span>
            </div>
        </div>
    ), [featureHeld, foodPhotoUrls, foodPhotos, handleDragOver, handleFoodPhotosChange, handleFoodPhotosDragEnter, handleFoodPhotosDragLeave, handleFoodPhotosDrop, isFoodPhotosDragging, openFoodPhotosFileDialog, removeFoodPhoto]);

    const renderReviewContentSection = useCallback((id: string) => (
        <div data-ocr-focus="review" className={`space-y-3 ${getOcrFocusClass("review")}`}>
            <Label htmlFor={id} className="flex items-center gap-2">
                리뷰 내용 <span className="text-red-500">*</span>
                {renderAiFilledBadge("review")}
            </Label>

            <Card className="border-border bg-muted/40 p-4">
                <div className="space-y-2 text-sm text-foreground">
                    <p className="font-semibold flex items-center gap-1">
                        리뷰에 담으면 좋은 내용
                    </p>
                    <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                        <li>어떤 메뉴를 드셨나요?</li>
                        <li>맛은 어떠셨나요?</li>
                        <li>분위기나 서비스는 어땠나요?</li>
                        <li>추천하고 싶은 메뉴가 있나요?</li>
                    </ul>
                </div>
            </Card>

            <Textarea
                id={id}
                placeholder="먹은 메뉴와 맛, 다시 방문할 때 참고할 점을 적어주세요"
                value={content}
                aria-invalid={normalizedContentLength > REVIEW_CONTENT_MAX_LENGTH}
                aria-describedby={`${id}-length`}
                onChange={(e) => {
                    markManualOcrInteraction("review");
                    setContent(e.target.value);
                }}
                rows={8}
                className="min-h-40 resize-y"
            />
            <p id={`${id}-length`} className={`text-xs text-right ${normalizedContentLength > REVIEW_CONTENT_MAX_LENGTH ? 'text-destructive' : 'text-muted-foreground'}`}>
                {normalizedContentLength.toLocaleString()} / 최대 {REVIEW_CONTENT_MAX_LENGTH.toLocaleString()}자 (앞뒤 공백 제외, 최소 20자)
            </p>
        </div>
    ), [content, getOcrFocusClass, markManualOcrInteraction, normalizedContentLength, renderAiFilledBadge]);

    if (isOpen && user?.id && reviewTargetRestaurant?.id && loadedDraftKey !== draftLoadKey) {
        const pendingContent = <div className="space-y-3 p-4">
            {draftLoadFailed ? <DraftLoadError onRetry={() => void loadDraft()} /> : <p role="status">임시 저장 내용을 확인하고 있어요.</p>}
            <Button type="button" variant="outline" onClick={onClose}>리뷰 작성 닫기</Button>
        </div>;
        if (inline) return <section ref={desktopReviewMapPanelRef} role="dialog" tabIndex={-1} aria-label="리뷰 작성" onKeyDown={handleDesktopReviewDialogKeyDown}>{pendingContent}</section>;
        if (shouldRenderMapPanel) return <section ref={desktopReviewMapPanelRef} role="dialog" tabIndex={-1} onKeyDown={handleDesktopReviewDialogKeyDown} aria-label="리뷰 작성" className="fixed bottom-24 right-6 top-6 z-[85] w-[min(420px,calc(100vw-2rem))] overflow-auto rounded-3xl border border-border bg-background shadow-2xl">{pendingContent}</section>;
        if (isMobileOrTablet) return <BottomSheet isOpen onClose={onClose} {...MOBILE_FULL_FORM_SHEET} ariaLabel="리뷰 작성">{pendingContent}</BottomSheet>;
        return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent onOpenAutoFocus={handleDialogOpenAutoFocus} onCloseAutoFocus={handleDialogCloseAutoFocus}><DialogHeader><DialogTitle>리뷰 작성</DialogTitle><DialogDescription>이 기기의 임시 저장 내용을 확인합니다.</DialogDescription></DialogHeader>{pendingContent}</DialogContent></Dialog>;
    }

    // inline 모드: Dialog 없이 콘텐츠만 렌더링
    if (inline) {
        return (
            <section ref={desktopReviewMapPanelRef} role="dialog" tabIndex={-1} aria-label="리뷰 작성" onKeyDown={handleDesktopReviewDialogKeyDown} className="flex h-full flex-col overflow-hidden">
                {/* 헤더 */}
                <div className="px-6 pt-6 pb-4 border-b relative shrink-0">
                    {lastSavedAt && (
                        <div className="absolute top-1.5 left-6 flex items-center gap-1 text-xs text-muted-foreground">
                            {isSaving ? (
                                <>
                                    <div className="animate-spin h-2.5 w-2.5 border border-primary border-t-transparent rounded-full" />
                                    <span>저장 중</span>
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />
                                    <span className="text-green-600">
                                        저장됨 {lastSavedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </>
                            )}
                        </div>
                    )}
                    <div className="flex items-start justify-between gap-2 pt-3">
                        <div className="flex-1">
                            <h2 className="text-xl font-semibold text-foreground flex items-center gap-3">
                                쯔동여지도 리뷰 작성
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                맛집 방문 후기를 공유해주세요
                            </p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={handleClose} className="h-11 w-11 rounded-lg hover:bg-muted" aria-label="리뷰 작성 닫기">
                            <XIcon className="h-5 w-5" />
                        </Button>
                    </div>
                </div>

                <div className={`flex-1 overflow-y-auto px-6 py-4 ${REVIEW_MODAL_SCROLLBARLESS_CLASS}`}>
                    <div className="space-y-6">

                        <ReceiptPhotoGuide />

                        <div className="space-y-2">
                            <ReceiptStep receipt={receipt} featureHeld={featureHeld} featureHoldNotice={renderFeatureHoldNotice()} onUsePhotoOnly={handleUseReceiptPhotoOnly} />
                        </div>

                        {/* 하단 폼 영역 (맛집 정보 ~ 리뷰 내용) */}
                        <div className="space-y-6 relative rounded-xl">

                            {/* 방문 맛집 정보 */}
                            <div data-ocr-focus="restaurant" className={`space-y-2 ${getOcrFocusClass("restaurant")} ${(!selectedRestaurant && searchQuery && !isSearching)
                                ? "ring-2 ring-primary ring-offset-2 rounded-lg p-1 bg-primary/5"
                                : ""
                                }`}>
                                <Label htmlFor="review-restaurant-search" className="flex items-center gap-2">
                                    방문한 쯔양 맛집 <span className="text-red-500">*</span>
                                    {renderAiFilledBadge("restaurant")}
                                </Label>
                                {(selectedRestaurant || restaurant) ? (
                                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                                        <span className="font-medium text-green-800 flex-1">
                                            {(selectedRestaurant || restaurant)?.name}
                                        </span>
                                        {!restaurant && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    markManualOcrInteraction("restaurant");
                                                    setSelectedRestaurant(null);
                                                    setSearchQuery("");
                                                }}
                                                className="min-h-11 px-3 text-sm"
                                            >
                                                변경
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                id="review-restaurant-search"
                                                aria-required="true"
                                                placeholder="맛집 이름 검색"
                                                value={searchQuery}
                                                onChange={(e) => {
                                                    markManualOcrInteraction("restaurant");
                                                    setSearchQuery(e.target.value);
                                                }}
                                                inputMode="search"
                                                enterKeyHint="search"
                                                autoComplete="off"
                                                autoCapitalize="off"
                                                autoCorrect="off"
                                                className="pl-9"
                                            />
                                        </div>
                                        {isSearching && (
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                                                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                                                검색 중...
                                            </div>
                                        )}
                                        {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                                            <div className="text-sm text-muted-foreground p-2">
                                                검색 결과가 없습니다.
                                            </div>
                                        )}
                                        {searchResults.length > 0 && (
                                            <div className={`border rounded-lg overflow-hidden max-h-48 overflow-y-auto ${REVIEW_MODAL_SCROLLBARLESS_CLASS}`}>
                                                {searchResults.map((result) => (
                                                    <button
                                                        key={result.id}
                                                        onClick={() => {
                                                            markManualOcrInteraction("restaurant");
                                                            setSelectedRestaurant(result);
                                                            setSearchQuery("");
                                                            setSearchResults([]);
                                                        }}
                                                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0 text-sm"
                                                    >
                                                        {result.name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {searchQuery.length < 2 && (
                                            <p className="text-xs text-muted-foreground">
                                                2글자 이상 입력하면 검색됩니다.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 방문 날짜 및 시간 */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div data-ocr-focus="date" className={`space-y-2 ${getOcrFocusClass("date")}`}>
                                    <Label htmlFor="inline-visitDate" className="flex items-center gap-2">
                                        <Calendar className="h-4 w-4" />
                                        방문 날짜 <span className="text-red-500">*</span>
                                        {renderAiFilledBadge("date")}
                                    </Label>
                                    <Input
                                        id="inline-visitDate"
                                        type="date"
                                        value={visitedDate}
                                        onChange={(e) => {
                                            markManualOcrInteraction("date");
                                            setVisitedDate(e.target.value);
                                        }}
                                        max={new Date().toISOString().split('T')[0]}
                                        min={new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                                        enterKeyHint="next"
                                    />
                                </div>

                                <div data-ocr-focus="time" className={`space-y-2 ${getOcrFocusClass("time")}`}>
                                    <Label htmlFor="inline-visitTime" className="flex items-center gap-2">
                                        <Clock className="h-4 w-4" />
                                        방문 시간 <span className="text-red-500">*</span>
                                        {renderAiFilledBadge("time")}
                                    </Label>
                                    <Input
                                        id="inline-visitTime"
                                        type="time"
                                        step="60"
                                        value={visitedTime}
                                        onChange={(e) => {
                                            markManualOcrInteraction("time");
                                            setVisitedTime(e.target.value);
                                        }}
                                        enterKeyHint="next"
                                    />
                                </div>
                            </div>

                            {/* 카테고리 */}
                            <div data-ocr-focus="category" className={`space-y-2 ${getOcrFocusClass("category")}`}>
                                <Label className="flex items-center gap-2">
                                    카테고리 <span className="text-red-500">*</span>
                                    {renderAiFilledBadge("category")}
                                </Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="min-h-11 w-full justify-between">
                                            <span className="truncate">
                                                {categories.length > 0
                                                    ? `${categories.length}개 선택됨`
                                                    : "어떤 종류의 음식을 드셨나요?"
                                                }
                                            </span>
                                            <ChevronDown className="h-4 w-4 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64" align="start">
                                        <div className="space-y-2">
                                            <h4 className="font-semibold text-sm">카테고리 선택</h4>
                                            <div className={`space-y-2 max-h-48 overflow-y-auto ${REVIEW_MODAL_SCROLLBARLESS_CLASS}`}>
                                                {CATEGORIES.map((cat) => (
                                                    <div key={cat} className="flex min-h-11 items-center gap-2">
                                                        <Checkbox
                                                            id={`inline-category-${cat}`}
                                                            checked={categories.includes(cat)}
                                                            onCheckedChange={(checked) => {
                                                                markManualOcrInteraction("category");
                                                                if (checked) {
                                                                    setCategories([...categories, cat]);
                                                                } else {
                                                                    setCategories(categories.filter(c => c !== cat));
                                                                }
                                                            }}
                                                        />
                                                        <Label htmlFor={`inline-category-${cat}`} className="flex min-h-11 flex-1 cursor-pointer items-center text-sm">
                                                            {cat}
                                                        </Label>
                                                    </div>
                                                ))}
                                            </div>
                                            {categories.length > 0 && (
                                                <div className="pt-2 border-t">
                                                    <Button variant="outline" size="sm" onClick={() => {
                                                        markManualOcrInteraction("category");
                                                        setCategories([]);
                                                    }} className="w-full">
                                                        선택 해제
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                                {categories.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {categories.map((category) => (
                                            <button
                                                key={category}
                                                type="button"
                                                    onClick={() => {
                                                        markManualOcrInteraction("category");
                                                        setCategories(categories.filter(c => c !== category));
                                                    }}
                                                aria-label={`${category} 카테고리 선택 해제`}
                                                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-secondary px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            >
                                                {category}
                                                <XIcon className="h-4 w-4" aria-hidden="true" />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {renderReviewContentSection("inline-content")}
                            {renderFoodPhotosSection()}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between px-6 py-4 border-t border-border bg-muted/50 gap-3 sm:gap-0 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <div className="flex items-center justify-center sm:justify-start gap-4">
                        <div className="text-xs text-muted-foreground">
                            {isFormValid ? (
                                <span className="text-green-600 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    모든 필수 항목이 입력되었습니다
                                </span>
                            ) : (
                                <span className="text-amber-600 flex items-center gap-1">
                                    <CircleAlert className="h-3 w-3" />
                                    필수 항목을 모두 입력해주세요
                                </span>
                            )}
                        </div>
                    </div>
                    {saveRecoveryNotice}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={handleClose} className="flex-1 sm:flex-none">
                            취소
                        </Button>
                        <Button onClick={handleSubmit} disabled={featureHeld || !canSubmitReview || isSubmitting || saveRecovery !== null} className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 sm:flex-none">
                            {isSubmitting ? "등록 중..." : "리뷰 등록"}
                        </Button>
                    </div>
                </div>
            </section>
        );
    }

    if (isMobileOrTablet || shouldRenderMapPanel) {
        const mobileTitleId = 'review-sheet-title';
        const mobileDescriptionId = 'review-sheet-description';

        const reviewSheetContent = isOpen ? (
                    <div
                        ref={mobileScrollRef}
                        className={`h-full overflow-y-auto overscroll-contain bg-background ${REVIEW_MODAL_SCROLLBARLESS_CLASS}`}
                        style={{ WebkitOverflowScrolling: 'touch' }}
                    >
                        <div ref={mobileFrameRef} className={`relative isolate ${mobileSheetStyles.frame}`}>
                            <div
                                className={`${mobileSheetStyles.header}${shouldRenderMapPanel ? ' cursor-move select-none touch-none' : ''}`}
                                data-desktop-map-review-drag-handle={shouldRenderMapPanel ? "true" : undefined}
                                title={shouldRenderMapPanel ? "마우스로 드래그해서 리뷰 작성 창 이동" : undefined}
                                role={shouldRenderMapPanel ? "group" : undefined}
                                tabIndex={shouldRenderMapPanel ? 0 : undefined}
                                aria-label={shouldRenderMapPanel ? "리뷰 작성 창 이동 핸들" : undefined}
                                onKeyDown={shouldRenderMapPanel ? handleDesktopReviewMapPanelKeyDown : undefined}
                                onPointerDown={shouldRenderMapPanel ? handleDesktopReviewMapPanelPointerDown : undefined}
                                onPointerMove={shouldRenderMapPanel ? handleDesktopReviewMapPanelPointerMove : undefined}
                                onPointerUp={shouldRenderMapPanel ? handleDesktopReviewMapPanelPointerEnd : undefined}
                                onPointerCancel={shouldRenderMapPanel ? handleDesktopReviewMapPanelPointerEnd : undefined}
                            >
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs font-medium text-muted-foreground">
                                            {currentStep} / {REVIEW_FORM_STEPS.length} · {REVIEW_FORM_STEPS[currentStep - 1].label}
                                        </p>
                                        <h2 id={mobileTitleId} className="truncate text-xl font-semibold text-foreground">
                                            쯔동여지도 리뷰 작성
                                        </h2>
                                    </div>
                                    <Button type="button" variant="ghost" size="icon" onClick={handleClose} aria-label="리뷰 작성 닫기">
                                        <XIcon className="h-5 w-5" />
                                    </Button>
                                </div>
                                <p id={mobileDescriptionId} className="text-sm text-muted-foreground">
                                    영수증 인증부터 후기 등록까지 3단계로 쉽게 작성해주세요.
                                </p>
                                <div className="mt-3 grid grid-cols-3 gap-1.5" aria-label="리뷰 작성 단계 진행률">
                                    {REVIEW_FORM_STEPS.map((step) => (
                                        <div key={step.id} className="space-y-1">
                                            <div className={`h-1.5 rounded-full ${step.id <= currentStep ? 'bg-brand-tangerine' : 'bg-muted'}`} />
                                            <span className={`block text-center text-xs ${step.id === currentStep ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                                                {step.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-2 min-h-4">
                                    {lastSavedAt ? (
                                        <div className="flex items-center gap-1 text-xs leading-none text-muted-foreground" aria-live="polite">
                                            {isSaving ? (
                                                <>
                                                    <div className="h-2.5 w-2.5 animate-spin rounded-full border border-primary border-t-transparent" />
                                                    <span>저장 중</span>
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />
                                                    <span className="text-green-600">
                                                        저장됨 {lastSavedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div className={mobileSheetStyles.content}>
                                <div className="space-y-4">
                                {currentStep === 1 && (
                                    <>
                                        <ReceiptPhotoGuide />
                                        <ReceiptStep receipt={receipt} featureHeld={featureHeld} featureHoldNotice={renderFeatureHoldNotice()} onUsePhotoOnly={handleUseReceiptPhotoOnly} />
                                    </>
                                )}

                                {currentStep === 2 && (
                                    <>
                                        {/* 방문 맛집 정보 */}
                                        <div data-ocr-focus="restaurant" className={`space-y-2 ${getOcrFocusClass("restaurant")} ${(!selectedRestaurant && searchQuery && !isSearching)
                                    ? "ring-2 ring-primary ring-offset-2 rounded-lg p-1 bg-primary/5"
                                    : ""
                                    }`}>
                                    <Label htmlFor="review-restaurant-search" className="flex items-center gap-2">
                                        방문한 쯔양 맛집 <span className="text-red-500">*</span>
                                        {renderAiFilledBadge("restaurant")}
                                    </Label>
                                    {(selectedRestaurant || restaurant) ? (
                                        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                                            <span className="font-medium text-green-800 flex-1">
                                                {(selectedRestaurant || restaurant)?.name}
                                            </span>
                                            {!restaurant && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        markManualOcrInteraction("restaurant");
                                                        setSelectedRestaurant(null);
                                                        setSearchQuery("");
                                                    }}
                                                    className="min-h-11 px-3 text-sm"
                                                >
                                                    변경
                                                </Button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                                <Input
                                                    id="review-restaurant-search"
                                                aria-required="true"
                                                placeholder="맛집 이름 검색"
                                                    value={searchQuery}
                                                    onChange={(e) => {
                                                        markManualOcrInteraction("restaurant");
                                                        setSearchQuery(e.target.value);
                                                    }}
                                                    inputMode="search"
                                                    enterKeyHint="search"
                                                    autoComplete="off"
                                                    autoCapitalize="off"
                                                    autoCorrect="off"
                                                    className="pl-9"
                                                />
                                            </div>
                                            {isSearching && (
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                                                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                                                    검색 중...
                                                </div>
                                            )}
                                            {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                                                <div className="text-sm text-muted-foreground p-2">
                                                    검색 결과가 없습니다.
                                                </div>
                                            )}
                                            {searchResults.length > 0 && (
                                                <div className={`border rounded-lg overflow-hidden max-h-48 overflow-y-auto ${REVIEW_MODAL_SCROLLBARLESS_CLASS}`}>
                                                    {searchResults.map((result) => (
                                                        <button
                                                            key={result.id}
                                                            onClick={() => {
                                                                markManualOcrInteraction("restaurant");
                                                                setSelectedRestaurant(result);
                                                                setSearchQuery("");
                                                                setSearchResults([]);
                                                            }}
                                                            className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0 text-sm"
                                                        >
                                                            {result.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {searchQuery.length < 2 && (
                                                <p className="text-xs text-muted-foreground">
                                                    2글자 이상 입력하면 검색됩니다.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                        </div>

                                        {/* 방문 날짜 및 시간 */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div data-ocr-focus="date" className={`space-y-2 ${getOcrFocusClass("date")}`}>
                                        <Label htmlFor="visitDate" className="flex items-center gap-2">
                                            <Calendar className="h-4 w-4" />
                                            방문 날짜 <span className="text-red-500">*</span>
                                            {renderAiFilledBadge("date")}
                                        </Label>
                                        <Input
                                            id="visitDate"
                                            type="date"
                                            value={visitedDate}
                                            onChange={(e) => {
                                                markManualOcrInteraction("date");
                                                setVisitedDate(e.target.value);
                                            }}
                                            max={new Date().toISOString().split('T')[0]}
                                            min={new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                                            enterKeyHint="next"
                                        />
                                    </div>

                                    <div data-ocr-focus="time" className={`space-y-2 ${getOcrFocusClass("time")}`}>
                                        <Label htmlFor="visitTime" className="flex items-center gap-2">
                                            <Clock className="h-4 w-4" />
                                            방문 시간 <span className="text-red-500">*</span>
                                            {renderAiFilledBadge("time")}
                                        </Label>
                                        <Input
                                            id="visitTime"
                                            type="time"
                                            step="60"
                                            value={visitedTime}
                                            onChange={(e) => {
                                                markManualOcrInteraction("time");
                                                setVisitedTime(e.target.value);
                                            }}
                                            enterKeyHint="next"
                                        />
                                    </div>
                                        </div>

                                        {/* 카테고리 */}
                                        <div data-ocr-focus="category" className={`space-y-2 ${getOcrFocusClass("category")}`}>
                                    <Label className="flex items-center gap-2">
                                        카테고리 <span className="text-red-500">*</span>
                                        {renderAiFilledBadge("category")}
                                    </Label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                className="min-h-11 w-full justify-between"
                                            >
                                                <span className="truncate">
                                                    {categories.length > 0
                                                        ? `${categories.length}개 선택됨`
                                                        : "어떤 종류의 음식을 드셨나요?"
                                                    }
                                                </span>
                                                <ChevronDown className="h-4 w-4 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-64" align="start">
                                            <div className="space-y-2">
                                                <h4 className="font-semibold text-sm">카테고리 선택</h4>
                                                <div className={`space-y-2 max-h-48 overflow-y-auto ${REVIEW_MODAL_SCROLLBARLESS_CLASS}`}>
                                                    {CATEGORIES.map((cat) => (
                                                        <div key={cat} className="flex min-h-11 items-center gap-2">
                                                            <Checkbox
                                                                id={`review-category-${cat}`}
                                                                checked={categories.includes(cat)}
                                                                onCheckedChange={(checked) => {
                                                                    markManualOcrInteraction("category");
                                                                    if (checked) {
                                                                        setCategories([...categories, cat]);
                                                                    } else {
                                                                        setCategories(categories.filter(c => c !== cat));
                                                                    }
                                                                }}
                                                            />
                                                            <Label
                                                                htmlFor={`review-category-${cat}`}
                                                                className="flex min-h-11 flex-1 cursor-pointer items-center text-sm"
                                                            >
                                                                {cat}
                                                            </Label>
                                                        </div>
                                                    ))}
                                                </div>
                                                {categories.length > 0 && (
                                                    <div className="pt-2 border-t">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                                markManualOcrInteraction("category");
                                                                setCategories([]);
                                                            }}
                                                            className="w-full"
                                                        >
                                                            선택 해제
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                    {categories.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {categories.map((category) => (
                                                <button
                                                    key={category}
                                                    type="button"
                                                        onClick={() => {
                                                            markManualOcrInteraction("category");
                                                            setCategories(categories.filter(c => c !== category));
                                                        }}
                                                    aria-label={`${category} 카테고리 선택 해제`}
                                                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-secondary px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                >
                                                    {category}
                                                    <XIcon className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                        </div>
                                    </>
                                )}


                                {currentStep === 3 && (
                                    <>
                                        {renderReviewContentSection("content")}
                                        {renderFoodPhotosSection()}
                                    </>
                                )}
                            </div>
                        </div>

                        {isSubmitting && (
                            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-50">
                                <div className="flex flex-col items-center gap-4">
                                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                    <p className="text-lg font-medium">리뷰 등록 중...</p>
                                    <p className="text-sm text-muted-foreground">잠시만 기다려주세요.</p>
                                </div>
                            </div>
                        )}

                        {/* 푸터 */}
                        <div className={`${mobileSheetStyles.footer} space-y-3`}>
                            <div className="flex items-center justify-center text-xs text-muted-foreground">
                                {currentStep === 3 && isFormValid ? (
                                    <span className="flex items-center gap-1 text-green-600">
                                        <CheckCircle2 className="h-3 w-3" />
                                        모든 필수 항목이 입력되었습니다
                                    </span>
                                ) : isStepValid[currentStep] ? (
                                    <span className="flex items-center gap-1 text-green-600">
                                        <CheckCircle2 className="h-3 w-3" />
                                        다음 단계로 이동할 수 있어요
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1 text-amber-600">
                                        <AlertCircle className="h-3 w-3" />
                                        {getStepValidationMessage(currentStep)}
                                    </span>
                                )}
                            </div>

                            {saveRecoveryNotice}
                            <div className="flex gap-2">
                                {currentStep === 1 ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handleClose}
                                        disabled={isSubmitting}
                                        className="flex-1"
                                    >
                                        취소
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handlePreviousStep}
                                        disabled={isSubmitting}
                                        className="flex-1"
                                    >
                                        이전
                                    </Button>
                                )}

                                {currentStep < 3 ? (
                                    <Button
                                        type="button"
                                        onClick={handleNextStep}
                                        disabled={featureHeld || !isStepValid[currentStep] || isSubmitting}
                                        className={`${mobileSheetStyles.primaryAction} flex-1`}
                                    >
                                        다음
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        onClick={handleSubmit}
                                        disabled={featureHeld || !canSubmitReview || isSubmitting || saveRecovery !== null}
                                        className={`${mobileSheetStyles.primaryAction} flex-1`}
                                    >
                                        {isSubmitting ? "등록 중..." : "리뷰 등록"}
                                    </Button>
                                )}
                            </div>
                            </div>
                        </div>
                    </div>
        ) : null;

        if (shouldRenderMapPanel) {
            if (!isOpen) return null;

            return (
                <section
                    ref={desktopReviewMapPanelRef}
                    className="fixed bottom-24 right-6 top-6 z-[85] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
                    style={{ transform: `translate3d(${desktopReviewMapPanelPosition.x}px, ${desktopReviewMapPanelPosition.y}px, 0)` }}
                    data-desktop-map-review-panel="true"
                    onKeyDown={handleDesktopReviewDialogKeyDown}
                    role="dialog"
                    tabIndex={-1}
                    aria-labelledby={mobileTitleId}
                    aria-describedby={mobileDescriptionId}
                >
                    {reviewSheetContent}
                </section>
            );
        }

        return (
            <BottomSheet
                isOpen={isOpen}
                onClose={handleClose}
                {...MOBILE_FULL_FORM_SHEET}
                disableContentScroll
                layoutSource="review-modal"
                className="z-[110]"
                ariaLabelledBy={mobileTitleId}
                ariaDescribedBy={mobileDescriptionId}
            >
                {reviewSheetContent}
            </BottomSheet>
        );
    }

    return (
        <>
            <Dialog open={isOpen} onOpenChange={handleClose}>
                {isOpen && (
                    <DialogContent onOpenAutoFocus={handleDialogOpenAutoFocus} onCloseAutoFocus={handleDialogCloseAutoFocus} className={`w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border-border/70 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none sm:p-6 ${REVIEW_MODAL_SCROLLBARLESS_CLASS}`}>
                        <DialogHeader className="relative space-y-3">
                            {/* 자동 저장 상태 표시 - 좌측 상단 */}
                            {lastSavedAt && (
                                <div className="absolute top-1.5 left-6 flex items-center gap-1 text-xs text-muted-foreground">
                                    {isSaving ? (
                                        <>
                                            <div className="animate-spin h-2.5 w-2.5 border border-primary border-t-transparent rounded-full" />
                                            <span>저장 중</span>
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />
                                            <span className="text-green-600">
                                                저장됨 {lastSavedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}

                            <div className="flex items-start justify-between gap-2 pt-3">
                                <div className="flex-1">
                                    <p className="text-xs font-medium text-muted-foreground">
                                        영수증 인증 · 방문 정보 · 리뷰
                                    </p>
                                    <DialogTitle className="text-xl font-semibold text-foreground">
                                        쯔동여지도 리뷰 작성
                                    </DialogTitle>
                                    <DialogDescription>
                                        영수증 인증부터 후기 등록까지 필요한 정보를 한 화면에서 차근차근 작성해주세요.
                                    </DialogDescription>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5" aria-label="리뷰 작성 안내 단계">
                                {REVIEW_FORM_STEPS.map((step) => (
                                    <div key={step.id} className="space-y-1">
                                        <div className="h-1.5 rounded-full bg-brand-tangerine" />
                                        <span className="block text-center text-xs font-medium text-muted-foreground">
                                            {step.label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </DialogHeader>

                        <div className="space-y-6 mt-2">
                            <div className="space-y-6">
                                <ReceiptPhotoGuide />

                                <div className="space-y-2">
                                    <ReceiptStep receipt={receipt} featureHeld={featureHeld} featureHoldNotice={renderFeatureHoldNotice()} onUsePhotoOnly={handleUseReceiptPhotoOnly} />
                                </div>

                                {/* 방문 맛집 정보 */}
                                <div data-ocr-focus="restaurant" className={`space-y-2 ${getOcrFocusClass("restaurant")} ${(!selectedRestaurant && searchQuery && !isSearching)
                                    ? "ring-2 ring-primary ring-offset-2 rounded-lg p-1 bg-primary/5"
                                    : ""
                                    }`}>
                                    <Label htmlFor="review-restaurant-search" className="flex items-center gap-2">
                                        방문한 쯔양 맛집 <span className="text-red-500">*</span>
                                        {renderAiFilledBadge("restaurant")}
                                    </Label>
                                    {(selectedRestaurant || restaurant) ? (
                                        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                                            <span className="font-medium text-green-800 flex-1">
                                                {(selectedRestaurant || restaurant)?.name}
                                            </span>
                                            {!restaurant && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        markManualOcrInteraction("restaurant");
                                                        setSelectedRestaurant(null);
                                                        setSearchQuery("");
                                                    }}
                                                    className="min-h-11 px-3 text-sm"
                                                >
                                                    변경
                                                </Button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                                <Input
                                                    id="review-restaurant-search"
                                                aria-required="true"
                                                placeholder="맛집 이름 검색"
                                                    value={searchQuery}
                                                    onChange={(e) => {
                                                        markManualOcrInteraction("restaurant");
                                                        setSearchQuery(e.target.value);
                                                    }}
                                                    inputMode="search"
                                                    enterKeyHint="search"
                                                    autoComplete="off"
                                                    autoCapitalize="off"
                                                    autoCorrect="off"
                                                    className="pl-9"
                                                />
                                            </div>
                                            {isSearching && (
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                                                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                                                    검색 중...
                                                </div>
                                            )}
                                            {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                                                <div className="text-sm text-muted-foreground p-2">
                                                    검색 결과가 없습니다.
                                                </div>
                                            )}
                                            {searchResults.length > 0 && (
                                                <div className={`border rounded-lg overflow-hidden max-h-48 overflow-y-auto ${REVIEW_MODAL_SCROLLBARLESS_CLASS}`}>
                                                    {searchResults.map((result) => (
                                                        <button
                                                            key={result.id}
                                                            onClick={() => {
                                                                markManualOcrInteraction("restaurant");
                                                                setSelectedRestaurant(result);
                                                                setSearchQuery("");
                                                                setSearchResults([]);
                                                            }}
                                                            className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0 text-sm"
                                                        >
                                                            {result.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {searchQuery.length < 2 && (
                                                <p className="text-xs text-muted-foreground">
                                                    2글자 이상 입력하면 검색됩니다.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* 방문 날짜 및 시간 */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div data-ocr-focus="date" className={`space-y-2 ${getOcrFocusClass("date")}`}>
                                        <Label htmlFor="visitDate" className="flex items-center gap-2">
                                            <Calendar className="h-4 w-4" />
                                            방문 날짜 <span className="text-red-500">*</span>
                                            {renderAiFilledBadge("date")}
                                        </Label>
                                        <Input
                                            id="visitDate"
                                            type="date"
                                            value={visitedDate}
                                            onChange={(e) => {
                                                markManualOcrInteraction("date");
                                                setVisitedDate(e.target.value);
                                            }}
                                            max={new Date().toISOString().split('T')[0]}
                                            min={new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                                            enterKeyHint="next"
                                        />
                                    </div>

                                    <div data-ocr-focus="time" className={`space-y-2 ${getOcrFocusClass("time")}`}>
                                        <Label htmlFor="visitTime" className="flex items-center gap-2">
                                            <Clock className="h-4 w-4" />
                                            방문 시간 <span className="text-red-500">*</span>
                                            {renderAiFilledBadge("time")}
                                        </Label>
                                        <Input
                                            id="visitTime"
                                            type="time"
                                            step="60"
                                            value={visitedTime}
                                            onChange={(e) => {
                                                markManualOcrInteraction("time");
                                                setVisitedTime(e.target.value);
                                            }}
                                            enterKeyHint="next"
                                        />
                                    </div>
                                </div>

                                {/* 카테고리 */}
                                <div data-ocr-focus="category" className={`space-y-2 ${getOcrFocusClass("category")}`}>
                                    <Label className="flex items-center gap-2">
                                        카테고리 <span className="text-red-500">*</span>
                                        {renderAiFilledBadge("category")}
                                    </Label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                className="min-h-11 w-full justify-between"
                                            >
                                                <span className="truncate">
                                                    {categories.length > 0
                                                        ? `${categories.length}개 선택됨`
                                                        : "어떤 종류의 음식을 드셨나요?"
                                                    }
                                                </span>
                                                <ChevronDown className="h-4 w-4 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-64" align="start">
                                            <div className="space-y-2">
                                                <h4 className="font-semibold text-sm">카테고리 선택</h4>
                                                <div className={`space-y-2 max-h-48 overflow-y-auto ${REVIEW_MODAL_SCROLLBARLESS_CLASS}`}>
                                                    {CATEGORIES.map((cat) => (
                                                        <div key={cat} className="flex min-h-11 items-center gap-2">
                                                            <Checkbox
                                                                id={`review-category-${cat}`}
                                                                checked={categories.includes(cat)}
                                                                onCheckedChange={(checked) => {
                                                                    markManualOcrInteraction("category");
                                                                    if (checked) {
                                                                        setCategories([...categories, cat]);
                                                                    } else {
                                                                        setCategories(categories.filter(c => c !== cat));
                                                                    }
                                                                }}
                                                            />
                                                            <Label
                                                                htmlFor={`review-category-${cat}`}
                                                                className="flex min-h-11 flex-1 cursor-pointer items-center text-sm"
                                                            >
                                                                {cat}
                                                            </Label>
                                                        </div>
                                                    ))}
                                                </div>
                                                {categories.length > 0 && (
                                                    <div className="pt-2 border-t">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                                markManualOcrInteraction("category");
                                                                setCategories([]);
                                                            }}
                                                            className="w-full"
                                                        >
                                                            선택 해제
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                    {categories.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {categories.map((category) => (
                                                <button
                                                    key={category}
                                                    type="button"
                                                        onClick={() => {
                                                            markManualOcrInteraction("category");
                                                            setCategories(categories.filter(c => c !== category));
                                                        }}
                                                    aria-label={`${category} 카테고리 선택 해제`}
                                                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-secondary px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                >
                                                    {category}
                                                    <XIcon className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {renderReviewContentSection("content")}
                                {renderFoodPhotosSection()}
                            </div>
                        </div>

                        {isSubmitting && (
                            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-50">
                                <div className="flex flex-col items-center gap-4">
                                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                    <p className="text-lg font-medium">리뷰 등록 중...</p>
                                    <p className="text-sm text-muted-foreground">잠시만 기다려주세요.</p>
                                </div>
                            </div>
                        )}

                        {/* 푸터 */}
                        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between pt-4 gap-3 sm:gap-0">
                            <div className="flex items-center justify-center sm:justify-start gap-4">
                                {/* 폼 유효성 상태 */}
                                <div className="text-xs text-muted-foreground">
                                    {isFormValid ? (
                                        <span className="text-green-600 flex items-center gap-1">
                                            <CheckCircle2 className="h-3 w-3" />
                                            모든 필수 항목이 입력되었습니다
                                        </span>
                                    ) : (
                                        <span className="text-amber-600 flex items-center gap-1">
                                            <AlertCircle className="h-3 w-3" />
                                            필수 항목을 모두 입력해주세요
                                        </span>
                                    )}
                                </div>
                            </div>

                            {saveRecoveryNotice}
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={handleClose}
                                    disabled={isSubmitting}
                                    className="flex-1 sm:flex-none"
                                >
                                    취소
                                </Button>
                                <Button
                                    onClick={handleSubmit}
                                    disabled={featureHeld || !canSubmitReview || isSubmitting || saveRecovery !== null}
                                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 sm:flex-none"
                                >
                                    {isSubmitting ? "등록 중..." : "리뷰 등록"}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                )}
            </Dialog >
        </>
    );
}
