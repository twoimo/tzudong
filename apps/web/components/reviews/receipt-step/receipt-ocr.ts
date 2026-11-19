import type { OcrProgressStage } from "@/lib/ocr/review-modal-ocr-ux";

const SUPPORTED_RECEIPT_MIME_TYPES = new Set([
    "image/avif",
    "image/jpeg",
    "image/png",
    "image/webp",
]);
export const RECEIPT_IMAGE_ACCEPT = "image/avif,image/jpeg,image/png,image/webp";
export const isSupportedReceiptImage = (file: File): boolean => SUPPORTED_RECEIPT_MIME_TYPES.has(file.type);

interface OCRItem {
    name: string;
    price: number | null;
}

type OcrFieldTrustPayload = {
    field?: string;
    level?: 'high' | 'medium' | 'low';
    source?: string;
    reason?: string;
    needsReview?: boolean;
};

export interface OCRResult {
    store_name?: string;
    date?: string;
    time?: string;
    items?: OCRItem[];
    total_amount?: number;
    category?: string;
    review_draft?: string;
    confidence?: number;
    field_trust?: OcrFieldTrustPayload[];
    needs_review?: string[];
    ocr_result_ref?: string;
    ocr_result_revision?: string;
    cache_reused?: boolean;
}

export type OcrProgressState = {
    message: string;
    stage: OcrProgressStage;
    model?: string;
    fields: string[];
    fallbackUsed?: boolean;
};

export type OcrStreamPayload = {
    code?: string;
    message?: string;
    model?: string;
    stage?: OcrProgressStage;
    data?: Partial<OCRResult>;
    final?: boolean;
    attempt?: { model?: string; ok?: boolean; elapsedMs?: number };
    detail?: string;
    terminal?: boolean;
    status?: number;
};

export type OcrFallbackNotice = {
    type: 'fallback' | 'error' | 'pending';
    message: string;
    detail?: string;
};

export class OcrStreamHttpError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = 'OcrStreamHttpError';
        this.status = status;
        this.code = code;
    }
}

export type OcrQuotaPayload = {
    used: number;
    max: number | null;
    remaining: number | null;
    unlimited?: boolean;
    resetAt: string;
};

export type OcrRestaurantContextSource = {
    id?: string | null;
    name?: string | null;
    road_address?: string | null;
    jibun_address?: string | null;
    category?: string | null;
    categories?: string[] | null;
};

export function appendSelectedRestaurantOcrContext(formData: FormData, restaurant: OcrRestaurantContextSource | null | undefined) {
    if (restaurant?.id) formData.append('selectedRestaurantId', restaurant.id);
    if (restaurant?.name) formData.append('selectedRestaurantName', restaurant.name);
    if (restaurant?.road_address) formData.append('selectedRestaurantRoadAddress', restaurant.road_address);
    if (restaurant?.jibun_address) formData.append('selectedRestaurantJibunAddress', restaurant.jibun_address);
    const category = restaurant?.category ?? restaurant?.categories?.[0];
    if (category) formData.append('selectedRestaurantCategory', category);
}

export function parseOcrStreamFrame(frame: string): { event: string; payload: OcrStreamPayload } | null {
    let event = 'message';
    const dataLines: string[] = [];

    for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
            event = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trim());
        }
    }

    if (dataLines.length === 0) return null;
    try {
        return { event, payload: JSON.parse(dataLines.join('\n')) as OcrStreamPayload };
    } catch {
        return null;
    }
}

export function isAbortError(error: unknown) {
    return (error instanceof DOMException && error.name === 'AbortError')
        || (error instanceof Error && error.name === 'AbortError');
}

export function isTerminalOcrStreamError(error: unknown) {
    return error instanceof OcrStreamHttpError
        && ([400, 401, 403, 413, 415, 422, 429].includes(error.status)
            || ['FEATURE_DATABASE_HELD', 'OCR_RESULT_PROCESSING', 'OCR_RESULT_INDETERMINATE'].includes(error.code ?? ''));
}

export function isPendingOcrStreamError(error: unknown) {
    return error instanceof OcrStreamHttpError
        && ['OCR_RESULT_PROCESSING', 'OCR_RESULT_INDETERMINATE'].includes(error.code ?? '');
}
