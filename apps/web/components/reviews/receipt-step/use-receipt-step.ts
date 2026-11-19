import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
import useSWR from "swr";
import imageCompression from "browser-image-compression";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { FEATURE_DATABASE_HELD_MESSAGE } from "@/lib/runtime-feature-readiness-contract";
import { reconcileInterruptedOcrReadback } from "@/lib/ocr/review-modal-ocr-ux";
import {
    prepareVerificationUploadFile,
    ReceiptUploadPreparationError,
} from "@/lib/ocr/receipt-upload-preparation";
import { createLatestSelection } from "@/lib/ocr/latest-selection";
import { generateSafeFilename } from "@/components/reviews/review-photo-files";
import {
    appendSelectedRestaurantOcrContext,
    isAbortError,
    isPendingOcrStreamError,
    isSupportedReceiptImage,
    isTerminalOcrStreamError,
    OcrStreamHttpError,
    parseOcrStreamFrame,
    type OCRResult,
    type OcrFallbackNotice,
    type OcrProgressState,
    type OcrQuotaPayload,
    type OcrRestaurantContextSource,
    type OcrStreamPayload,
} from "./receipt-ocr";

export type VerificationInputMode = "ai" | "manual";

export type ReceiptSaveInputs = {
    verificationPhoto: File | null;
    verificationInputMode: VerificationInputMode;
    isAnalyzing: boolean;
    ocrRunGeneration: number;
    ocrResultRef: string | null;
    ocrResultRevision: string | null;
};

export const INITIAL_RECEIPT_SAVE_INPUTS: ReceiptSaveInputs = {
    verificationPhoto: null,
    verificationInputMode: "ai",
    isAnalyzing: false,
    ocrRunGeneration: 0,
    ocrResultRef: null,
    ocrResultRevision: null,
};

export type ReceiptOcrEvents = {
    onModelAnalysisStart(): void;
    onPhotoOnly(): void;
    onFields(data: Partial<OCRResult>, isLastPatch: boolean): void;
    onResult(data: OCRResult, isCurrentOcrRun: () => boolean): Promise<void>;
};

type ReceiptStepOptions = {
    isOpen: boolean;
    userId: string | undefined;
    featureHeld: boolean;
    ocrContextRestaurant: OcrRestaurantContextSource | null;
    reviseLatestSaveInputs(patch: Partial<ReceiptSaveInputs>): void;
    ocrEvents: ReceiptOcrEvents;
};

type ReadonlyRef<T> = { readonly current: T };

export type ReceiptStepState = {
    verificationPhoto: File | null;
    verificationPhotoUrl: string | null;
    verificationInputMode: VerificationInputMode;
    isAnalyzing: boolean;
    ocrProgress: OcrProgressState | null;
    ocrFallbackNotice: OcrFallbackNotice | null;
    ocrResultRef: string | null;
    ocrResultRevision: string | null;
    quota: OcrQuotaPayload | undefined;
    ocrLimitReached: boolean;
    canForceOcrRefresh: boolean;
    forceOcrRefresh: boolean;
    verificationFileInputRef: RefObject<HTMLInputElement | null>;
    verificationInputModeRef: ReadonlyRef<VerificationInputMode>;
    ocrRunGenerationRef: ReadonlyRef<number>;
    handleVerificationPhotoSelected(file: File): Promise<void>;
    handleVerificationPhotoChange(e: ChangeEvent<HTMLInputElement>): void;
    replaceVerificationPhoto(file: File | null, expectedGeneration?: number): boolean;
    setReceiptVerificationInputMode(mode: VerificationInputMode): void;
    toggleForceOcrRefresh(): void;
    handleRetryReceiptOcr(): void;
    handleCheckReceiptOcr(): void;
    resetReceiptStep(): void;
    cancelPendingReceiptSelection(): void;
    noteOcrFieldApplied(label: string): void;
    noteOcrNavigationSuppressed(): void;
};

export function useReceiptStep({
    isOpen,
    userId,
    featureHeld,
    ocrContextRestaurant,
    reviseLatestSaveInputs,
    ocrEvents: { onModelAnalysisStart, onPhotoOnly, onFields, onResult },
}: ReceiptStepOptions): ReceiptStepState {
    const [verificationPhoto, setVerificationPhoto] = useState(INITIAL_RECEIPT_SAVE_INPUTS.verificationPhoto);
    const [verificationPhotoUrl, setVerificationPhotoUrl] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(INITIAL_RECEIPT_SAVE_INPUTS.isAnalyzing);
    const [ocrProgress, setOcrProgress] = useState<OcrProgressState | null>(null);
    const [verificationInputMode, setVerificationInputMode] = useState(INITIAL_RECEIPT_SAVE_INPUTS.verificationInputMode);
    const [forceOcrRefresh, setForceOcrRefresh] = useState(false);
    const [ocrFallbackNotice, setOcrFallbackNotice] = useState<OcrFallbackNotice | null>(null);
    const [ocrResultRef, setOcrResultRef] = useState(INITIAL_RECEIPT_SAVE_INPUTS.ocrResultRef);
    const [ocrResultRevision, setOcrResultRevision] = useState(INITIAL_RECEIPT_SAVE_INPUTS.ocrResultRevision);
    const ocrRunGenerationRef = useRef(INITIAL_RECEIPT_SAVE_INPUTS.ocrRunGeneration);
    const verificationInputModeRef = useRef(INITIAL_RECEIPT_SAVE_INPUTS.verificationInputMode);
    const ocrAbortControllerRef = useRef<AbortController | null>(null);
    const ocrRecoveryContextRef = useRef<{ file: File; restaurant: OcrRestaurantContextSource | null } | null>(null);
    const verificationSelectionRef = useRef(createLatestSelection());
    const receiptOcrPreparationRef = useRef(createLatestSelection());
    const verificationFileInputRef = useRef<HTMLInputElement>(null);
    const verificationPhotoUrlRef = useRef<string | null>(null);

    useLayoutEffect(() => {
        const verificationSelection = verificationSelectionRef.current;
        const receiptOcrPreparation = receiptOcrPreparationRef.current;
        if (!isOpen) verificationSelection.invalidate();
        return () => {
            verificationSelection.invalidate();
            receiptOcrPreparation.invalidate();
            ocrRunGenerationRef.current += 1;
            ocrAbortControllerRef.current?.abort();
            ocrAbortControllerRef.current = null;
            ocrRecoveryContextRef.current = null;
        };
    }, [isOpen, userId]);

    // SWR을 사용한 쿼터 조회 (자동 캐싱 및 중복 요청 제거)
    const { data: quota, mutate: mutateQuota } = useSWR(
        isOpen && userId ? '/api/ocr/quota' : null,
        async (url) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Quota fetch failed');
            return res.json() as Promise<OcrQuotaPayload>;
        },
        {
            revalidateOnFocus: false, // 포커스 시 재조회 방지 (너무 잦은 조회 방지)
            dedupingInterval: 60000,  // 1분 내 중복 요청 방지
        }
    );
    const ocrLimitReached = quota?.unlimited ? false : quota?.remaining === 0;
    const canForceOcrRefresh = process.env.NODE_ENV !== "production" || quota?.unlimited === true;

    const setReceiptVerificationInputMode = useCallback((mode: VerificationInputMode) => {
        verificationInputModeRef.current = mode;
        setVerificationInputMode(mode);
        if (mode !== "manual") {
            reviseLatestSaveInputs({ verificationInputMode: mode });
            return;
        }

        // Keep the selected photo/preparation alive, but revoke every AI start or
        // readback lease so a late compressor/status result cannot change the form.
        receiptOcrPreparationRef.current.invalidate();
        const ocrRunGeneration = ocrRunGenerationRef.current + 1;
        ocrRunGenerationRef.current = ocrRunGeneration;
        ocrAbortControllerRef.current?.abort();
        ocrAbortControllerRef.current = null;
        onPhotoOnly();
        setOcrResultRef(null);
        setOcrResultRevision(null);
        reviseLatestSaveInputs({
            verificationInputMode: mode,
            isAnalyzing: false,
            ocrRunGeneration,
            ocrResultRef: null,
            ocrResultRevision: null,
        });
        setIsAnalyzing(false);
        setOcrProgress(null);
        setOcrFallbackNotice(null);
    }, [onPhotoOnly, reviseLatestSaveInputs]);

    // 인증 사진 미리보기 URL은 렌더 중 생성하지 않고 이벤트에서 동기 갱신해
    // 모바일 파일 선택기 복귀 직후 바텀시트가 재계산되며 깜빡이는 일을 줄인다.
    const replaceVerificationPhoto = useCallback((file: File | null, expectedGeneration?: number) => {
        if (expectedGeneration === undefined) {
            verificationSelectionRef.current.invalidate();
            receiptOcrPreparationRef.current.invalidate();
        } else if (!verificationSelectionRef.current.isCurrent(expectedGeneration)) {
            return false;
        }
        const ocrRunGeneration = ocrRunGenerationRef.current + 1;
        ocrRunGenerationRef.current = ocrRunGeneration;
        ocrAbortControllerRef.current?.abort();
        ocrAbortControllerRef.current = null;
        ocrRecoveryContextRef.current = null;
        setIsAnalyzing(false);
        setOcrProgress(null);
        if (verificationPhotoUrlRef.current) {
            URL.revokeObjectURL(verificationPhotoUrlRef.current);
        }

        const nextUrl = file ? URL.createObjectURL(file) : null;
        verificationPhotoUrlRef.current = nextUrl;
        setVerificationPhotoUrl(nextUrl);
        setVerificationPhoto(file);
        setOcrResultRef(null);
        setOcrResultRevision(null);
        reviseLatestSaveInputs({
            verificationPhoto: file,
            isAnalyzing: false,
            ocrRunGeneration,
            ocrResultRef: null,
            ocrResultRevision: null,
        });
        return true;
    }, [reviseLatestSaveInputs]);

    // URL 정리 (메모리 누수 방지)
    useEffect(() => {
        return () => {
            if (verificationPhotoUrlRef.current) {
                URL.revokeObjectURL(verificationPhotoUrlRef.current);
                verificationPhotoUrlRef.current = null;
            }
        };
    }, []);

    const handleVerificationPhotoSelected = async (file: File) => {
        const selection = verificationSelectionRef.current.begin();
        const selectionGeneration = selection.generation;
        const ocrPreparation = verificationInputModeRef.current === "ai"
            ? receiptOcrPreparationRef.current.begin()
            : null;
        const ocrRunGeneration = ocrRunGenerationRef.current + 1;
        ocrRunGenerationRef.current = ocrRunGeneration;
        reviseLatestSaveInputs({ isAnalyzing: false, ocrRunGeneration });
        ocrAbortControllerRef.current?.abort();
        ocrAbortControllerRef.current = null;
        setIsAnalyzing(false);
        setOcrProgress(null);
        try {
            if (featureHeld) {
                toast({ title: "리뷰 기능 준비 중", description: FEATURE_DATABASE_HELD_MESSAGE });
                return;
            }
            if (!isSupportedReceiptImage(file)) {
                toast({
                    title: "지원하지 않는 영수증 형식",
                    description: "JPG, PNG, WebP 또는 AVIF 이미지를 선택해 주세요.",
                    variant: "destructive",
                });
                return;
            }
            const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
            const preparedFile = await prepareVerificationUploadFile({
                file,
                filename: generateSafeFilename(`.${ext}`),
                compress: imageCompression,
                signal: selection.signal,
            });
            if (!selection.isCurrent() || !replaceVerificationPhoto(preparedFile, selectionGeneration)) return;
            verificationFileInputRef.current?.blur();
            if (ocrPreparation?.isCurrent() && verificationInputModeRef.current === "ai") {
                // Android 파일 선택기 복귀 직후 requestAnimationFrame이 누락되는 케이스가 있어
                // macrotask로 OCR을 시작한다. 상태 업데이트는 이미 큐에 들어가므로 미리보기가 먼저 그려진다.
                window.setTimeout(() => {
                    if (verificationSelectionRef.current.isCurrent(selectionGeneration)
                        && ocrPreparation.isCurrent()
                        && verificationInputModeRef.current === "ai") {
                        void analyzeReceipt(preparedFile, selectionGeneration);
                    }
                }, 0);
            }
        } catch (error) {
            if (!selection.isCurrent() || selection.signal.aborted) return;
            toast({
                title: "영수증 사진을 준비하지 못했습니다",
                description: error instanceof ReceiptUploadPreparationError && error.code === 'too_large'
                    ? "5MB 이하 이미지로 다시 선택해 주세요. 분석 요청은 전송되지 않았습니다."
                    : "JPG, PNG, WebP 또는 AVIF 이미지를 선택해 주세요.",
                variant: "destructive",
            });
        } finally {
            selection.complete();
            ocrPreparation?.complete();
        }
    };

    const handleVerificationPhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            void handleVerificationPhotoSelected(file);
        }
        e.target.value = '';
    };

    const handleOcrStreamEvent = useCallback((event: string, payload: OcrStreamPayload) => {
        if (event === 'progress' && payload.message) {
            setOcrProgress(prev => ({
                message: payload.message ?? prev?.message ?? 'AI가 영수증을 분석하고 있어요.',
                stage: payload.stage ?? prev?.stage ?? 'prepare',
                model: payload.model ?? prev?.model,
                fields: prev?.fields ?? [],
                fallbackUsed: prev?.fallbackUsed,
            }));
            return;
        }

        if (event === 'model_attempt' && payload.attempt?.model) {
            setOcrProgress(prev => ({
                message: payload.attempt?.ok === false
                    ? '더 정확한 모델로 다시 확인하고 있어요.'
                    : 'AI 분석 결과를 정리하고 있어요.',
                stage: payload.attempt?.ok === false ? 'model_retry' : 'model_start',
                model: payload.attempt?.model,
                fields: prev?.fields ?? [],
                fallbackUsed: prev?.fallbackUsed,
            }));
            return;
        }

        if (event === 'field_patch' && payload.data) {
            onFields(payload.data, Boolean(payload.final));
            setOcrProgress(prev => ({
                message: payload.final ? '자동 입력 결과를 최종 확인하고 있어요.' : '인식한 정보를 바로 입력하고 있어요.',
                stage: payload.final ? 'finalize' : 'patching',
                model: payload.model ?? prev?.model,
                fields: prev?.fields ?? [],
                fallbackUsed: prev?.fallbackUsed,
            }));
        }
    }, [onFields]);

    const analyzeReceiptWithStream = useCallback(async (file: File, token: string, signal: AbortSignal, forceRefresh: boolean): Promise<OCRResult> => {
        const formData = new FormData();
        formData.append('image', file);
        const context = ocrContextRestaurant;
        const recoveryContext = context ? { ...context, categories: context.categories?.slice() } : null;
        ocrRecoveryContextRef.current = { file, restaurant: recoveryContext };
        appendSelectedRestaurantOcrContext(formData, recoveryContext);
        if (forceRefresh) {
            formData.append('force', '1');
        }

        signal.throwIfAborted();
        const response = await fetch('/api/ocr/extract/stream', {
            method: 'POST',
            body: formData,
            signal,
            headers: { 'Authorization': `Bearer ${token}` },
            credentials: 'include',
        });

        signal.throwIfAborted();
        if (!response.ok || !response.body) {
            const errorData = await response.json().catch(() => ({}));
            throw new OcrStreamHttpError(errorData.error || 'OCR 스트리밍 분석 실패', response.status, errorData.code);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalData: OCRResult | null = null;

        while (true) {
            const { done, value } = await reader.read();
            signal.throwIfAborted();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop() ?? '';

            for (const frame of frames) {
                const parsed = parseOcrStreamFrame(frame);
                if (!parsed) continue;
                if (parsed.event === 'error') {
                    const streamErrorMessage = parsed.payload.detail || parsed.payload.message || 'OCR 스트리밍 분석 실패';
                    if (parsed.payload.terminal) {
                        throw new OcrStreamHttpError(streamErrorMessage, parsed.payload.status ?? 422, parsed.payload.code);
                    }
                    throw new Error(streamErrorMessage);
                }
                handleOcrStreamEvent(parsed.event, parsed.payload);
                if (parsed.event === 'done' && parsed.payload.data) {
                    finalData = parsed.payload.data as OCRResult;
                }
            }
        }

        signal.throwIfAborted();
        const parsed = parseOcrStreamFrame(buffer + decoder.decode());
        if (parsed) {
            if (parsed.event === 'error') {
                const streamErrorMessage = parsed.payload.detail || parsed.payload.message || 'OCR 스트리밍 분석 실패';
                if (parsed.payload.terminal) {
                    throw new OcrStreamHttpError(streamErrorMessage, parsed.payload.status ?? 422, parsed.payload.code);
                }
                throw new Error(streamErrorMessage);
            }
            handleOcrStreamEvent(parsed.event, parsed.payload);
            if (parsed.event === 'done' && parsed.payload.data) {
                finalData = parsed.payload.data as OCRResult;
            }
        }

        if (!finalData) throw new Error('OCR 스트리밍 결과가 비어 있습니다.');
        return finalData;
    }, [handleOcrStreamEvent, ocrContextRestaurant]);

    const readReceiptOcrStatus = useCallback(async (file: File, token: string, signal: AbortSignal): Promise<OCRResult> => {
        const formData = new FormData();
        formData.append('image', file);
        const recovery = ocrRecoveryContextRef.current;
        appendSelectedRestaurantOcrContext(formData,
            recovery?.file === file ? recovery.restaurant : ocrContextRestaurant);
        const response = await fetch('/api/ocr/results/status', {
            method: 'POST',
            body: formData,
            signal,
            headers: { 'Authorization': `Bearer ${token}` },
            credentials: 'include',
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status !== 200) {
            throw new OcrStreamHttpError(payload.error || 'OCR 결과 확인 실패', response.status, payload.code);
        }
        return payload as OCRResult;
    }, [ocrContextRestaurant]);

    // OCR 분석 실행 (모달 내부에서 처리)
    async function analyzeReceipt(
        file: File,
        expectedSelectionGeneration?: number,
        statusOnly = false,
    ) {
        if (expectedSelectionGeneration !== undefined
            && !verificationSelectionRef.current.isCurrent(expectedSelectionGeneration)) return;
        if (featureHeld) {
            setOcrFallbackNotice({ type: 'error', message: FEATURE_DATABASE_HELD_MESSAGE });
            return;
        }
        // OCR 결과 캐시는 provider/model/prompt/preprocess-aware server cache만 사용한다.
        // file metadata 기반 sessionStorage cache는 provider 전환 실험을 오염시킬 수 있어 사용하지 않는다.
        setIsAnalyzing(true);
        setOcrProgress({ message: statusOnly ? '저장된 분석 결과를 확인하고 있어요.' : '영수증 사진을 준비하고 있어요.', stage: 'prepare', fields: [] });
        setOcrFallbackNotice(null);
        if (!statusOnly) {
            onModelAnalysisStart();
        }
        ocrAbortControllerRef.current?.abort();
        const ocrRunGeneration = ocrRunGenerationRef.current + 1;
        ocrRunGenerationRef.current = ocrRunGeneration;
        reviseLatestSaveInputs({ isAnalyzing: true, ocrRunGeneration });
        const abortController = new AbortController();
        ocrAbortControllerRef.current = abortController;
        const shouldForceOcrRefresh = canForceOcrRefresh && forceOcrRefresh;
        const isCurrentOcrRun = () => !abortController.signal.aborted
            && ocrRunGenerationRef.current === ocrRunGeneration;
        try {
            let data: OCRResult;

            if (!userId) {
                throw new Error('로그인이 필요한 서비스입니다');
            }

            // [보안] 3. 토큰 직접 조회 (쿠키 전송 실패 대비)
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!isCurrentOcrRun()) return;

            if (!token) {
                throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
            }

            try {
                data = statusOnly
                    ? await readReceiptOcrStatus(file, token, abortController.signal)
                    : await analyzeReceiptWithStream(file, token, abortController.signal, shouldForceOcrRefresh);
            } catch (streamError) {
                if (!isCurrentOcrRun() || isAbortError(streamError)) return;
                if (statusOnly) throw streamError;
                if (isTerminalOcrStreamError(streamError) && !isPendingOcrStreamError(streamError)) {
                    if (streamError instanceof OcrStreamHttpError && streamError.status === 429) {
                        mutateQuota();
                    }
                    throw streamError;
                }
                setOcrFallbackNotice({
                    type: 'pending',
                    message: '분석 연결이 끊겨 저장된 결과를 확인하고 있어요.',
                    detail: '같은 사진을 AI에 다시 보내지 않습니다.',
                });
                data = await reconcileInterruptedOcrReadback({
                    signal: abortController.signal,
                    readStatus: () => readReceiptOcrStatus(file, token, abortController.signal),
                    isProcessingError: error => error instanceof OcrStreamHttpError
                        && error.code === 'OCR_RESULT_PROCESSING',
                });
            }

            if (!isCurrentOcrRun()) return;
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!data.ocr_result_ref || !uuidPattern.test(data.ocr_result_ref)
                || !data.ocr_result_revision || !uuidPattern.test(data.ocr_result_revision)) {
                throw new Error('OCR 검증 결과를 확인할 수 없습니다.');
            }
            setOcrResultRef(data.ocr_result_ref);
            setOcrResultRevision(data.ocr_result_revision);
            reviseLatestSaveInputs({
                ocrResultRef: data.ocr_result_ref,
                ocrResultRevision: data.ocr_result_revision,
            });

            // 4. provider/model/prompt/preprocess-aware server cache에만 저장한다.
            // 클라이언트 sessionStorage cache는 Track 1 정확도 실험 동안 사용하지 않는다.

            await onResult(data, isCurrentOcrRun);
            if (!isCurrentOcrRun()) return;

            // 분석 성공 시 쿼터 갱신 (실시간 반영)
            mutateQuota();

        } catch (error) {
            if (!isCurrentOcrRun() || isAbortError(error)) return;
            if (isPendingOcrStreamError(error)) {
                setOcrFallbackNotice({
                    type: 'pending',
                    message: '분석 결과를 확인하고 있어요.',
                    detail: '같은 사진을 다시 보내지 않았습니다. 직접 입력을 계속할 수 있어요.',
                });
                return;
            }
            setOcrFallbackNotice({
                type: 'error',
                message: 'AI 분석에 실패했어요. 사진은 유지되니 직접 입력하거나 다시 시도할 수 있어요.',
                detail: error instanceof Error ? error.message : undefined,
            });
            toast({
                title: "스마트 스캔 실패",
                description: "영수증을 분석하지 못했습니다. 직접 입력해주세요.",
                variant: "destructive"
            });
        } finally {
            if (ocrAbortControllerRef.current === abortController) {
                ocrAbortControllerRef.current = null;
            }
            if (ocrRunGenerationRef.current === ocrRunGeneration) {
                reviseLatestSaveInputs({ isAnalyzing: false, ocrRunGeneration });
                setIsAnalyzing(false);
                setOcrProgress(null);
            }
        }
    }

    const handleRetryReceiptOcr = () => {
        if (featureHeld || ocrFallbackNotice?.type === 'pending' || !verificationPhoto || isAnalyzing || ocrLimitReached) return;
        void analyzeReceipt(verificationPhoto);
    };

    const handleCheckReceiptOcr = () => {
        if (featureHeld || !verificationPhoto || isAnalyzing) return;
        void analyzeReceipt(verificationPhoto, undefined, true);
    };

    useEffect(() => {
        if (!ocrLimitReached) return;
        if (verificationInputMode !== "ai") return;
        setReceiptVerificationInputMode("manual");
    }, [ocrLimitReached, setReceiptVerificationInputMode, verificationInputMode]);

    useEffect(() => {
        if (canForceOcrRefresh) return;
        setForceOcrRefresh(false);
    }, [canForceOcrRefresh]);

    const toggleForceOcrRefresh = useCallback(() => setForceOcrRefresh(value => !value), []);

    const resetReceiptStep = useCallback(() => {
        replaceVerificationPhoto(null);
        setReceiptVerificationInputMode("ai");
        setForceOcrRefresh(false);
        setOcrProgress(null);
        setOcrFallbackNotice(null);
    }, [replaceVerificationPhoto, setReceiptVerificationInputMode]);

    const cancelPendingReceiptSelection = useCallback(() => {
        verificationSelectionRef.current.invalidate();
    }, []);

    const noteOcrFieldApplied = useCallback((label: string) => {
        setOcrProgress(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                fields: prev.fields.includes(label) ? prev.fields : [...prev.fields, label],
            };
        });
    }, []);

    const noteOcrNavigationSuppressed = useCallback(() => {
        setOcrProgress(prev => prev
            ? { ...prev, message: '사용자 입력 중이라 자동 이동 없이 값만 채웠어요.' }
            : prev);
    }, []);

    return {
        verificationPhoto,
        verificationPhotoUrl,
        verificationInputMode,
        isAnalyzing,
        ocrProgress,
        ocrFallbackNotice,
        ocrResultRef,
        ocrResultRevision,
        quota,
        ocrLimitReached,
        canForceOcrRefresh,
        forceOcrRefresh,
        verificationFileInputRef,
        verificationInputModeRef,
        ocrRunGenerationRef,
        handleVerificationPhotoSelected,
        handleVerificationPhotoChange,
        replaceVerificationPhoto,
        setReceiptVerificationInputMode,
        toggleForceOcrRefresh,
        handleRetryReceiptOcr,
        handleCheckReceiptOcr,
        resetReceiptStep,
        cancelPendingReceiptSelection,
        noteOcrFieldApplied,
        noteOcrNavigationSuppressed,
    };
}
