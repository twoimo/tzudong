import { useState, type DragEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { OCR_PROGRESS_STEPS, getOcrProgressRank } from "@/lib/ocr/review-modal-ocr-ux";
import { RECEIPT_IMAGE_ACCEPT, isSupportedReceiptImage } from "./receipt-ocr";
import type { ReceiptStepState } from "./use-receipt-step";

function ObjectUrlPreviewImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
    if (!src) {
        return null;
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element -- Local blob URLs are already browser-local previews; Next Image can fail to paint them on Android pickers.
        <img
            src={src}
            alt={alt}
            className={className}
            loading="eager"
            decoding="sync"
        />
    );
}

export function ReceiptPhotoGuide() {
    return (
        <Card className="border-border bg-muted/40 p-4">
            <div className="space-y-2 text-sm text-foreground">
                <p className="font-semibold flex items-center gap-1">
                    영수증 사진 안내
                </p>
                <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                    <li><b>영수증 전체</b>가 잘리지 않도록 촬영해주세요</li>
                    <li><b>AI 자동 분석</b> 또는 <b>사진만 첨부</b> 후 직접 입력이 가능합니다</li>
                    <li>방문일은 <span className="text-red-600 font-semibold">3개월 이내</span>여야 합니다</li>
                </ul>
            </div>
        </Card>
    );
}

type ReceiptStepProps = {
    receipt: ReceiptStepState;
    featureHeld: boolean;
    featureHoldNotice: ReactNode;
    onUsePhotoOnly(): void;
};

export function ReceiptStep({ receipt, featureHeld, featureHoldNotice, onUsePhotoOnly }: ReceiptStepProps) {
    const {
        verificationPhoto,
        verificationPhotoUrl,
        verificationInputMode,
        isAnalyzing,
        ocrProgress,
        ocrFallbackNotice,
        quota,
        ocrLimitReached,
        canForceOcrRefresh,
        forceOcrRefresh,
        verificationFileInputRef,
        handleVerificationPhotoSelected,
        handleVerificationPhotoChange,
        replaceVerificationPhoto,
        setReceiptVerificationInputMode,
        toggleForceOcrRefresh,
        handleRetryReceiptOcr,
        handleCheckReceiptOcr,
    } = receipt;
    const [isVerificationDragging, setIsVerificationDragging] = useState(false);
    const isTerminalError = ocrFallbackNotice?.type === 'error';

    const handleDragOver = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleVerificationDragEnter = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsVerificationDragging(true);
    };

    const handleVerificationDragLeave = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsVerificationDragging(false);
    };

    const handleVerificationDrop = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsVerificationDragging(false);

        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(isSupportedReceiptImage);

        if (imageFiles.length > 0) {
            void handleVerificationPhotoSelected(imageFiles[0]);
        }
    };

    const openVerificationFileDialog = () => {
        verificationFileInputRef.current?.click();
    };

    return (
        <>
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="flex items-center gap-2">
                        인증 사진 <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Button
                            type="button"
                            variant={verificationInputMode === "ai" ? "default" : "outline"}
                            aria-pressed={verificationInputMode === "ai"}
                            size="sm"
                            className="min-h-11 px-3 text-sm"
                            disabled={featureHeld || ocrLimitReached}
                            onClick={() => setReceiptVerificationInputMode("ai")}
                        >
                            AI 자동 입력
                        </Button>
                        <Button
                            type="button"
                            variant={verificationInputMode === "manual" ? "default" : "outline"}
                            aria-pressed={verificationInputMode === "manual"}
                            size="sm"
                            className="min-h-11 px-3 text-sm"
                            disabled={featureHeld}
                            onClick={() => setReceiptVerificationInputMode("manual")}
                        >
                            사진만 첨부
                        </Button>
                        {quota ? (
                            <Badge
                                variant="outline"
                                className={`text-xs font-normal border-primary/20 ${quota.unlimited
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : quota.remaining === 0
                                        ? 'bg-amber-50 text-amber-600'
                                        : 'bg-primary/5 text-primary'}`}
                            >
                                AI 분석 남은 횟수: {quota.unlimited ? '무제한' : `${quota.remaining}/${quota.max}회`}
                            </Badge>
                        ) : null}
                    </div>
                </div>
                {verificationInputMode === "manual" && (
                    <p className="text-xs text-muted-foreground">
                        AI 분석 없이 사진만 첨부합니다. 방문 맛집/일시/카테고리/리뷰 내용을 직접 입력해주세요.
                    </p>
                )}
                {ocrLimitReached && (
                    <p className="text-xs text-amber-600">
                        AI 분석 한도를 모두 사용했습니다. 사진 첨부 후 필요한 정보를 직접 입력해주세요.
                    </p>
                )}
                {canForceOcrRefresh ? (
                    <button
                        type="button"
                        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${forceOcrRefresh
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'}`}
                        onClick={toggleForceOcrRefresh}
                        aria-pressed={forceOcrRefresh}
                    >
                        <span className={`h-2 w-2 rounded-full ${forceOcrRefresh ? 'bg-primary' : 'bg-muted-foreground/50'}`} />
                        {forceOcrRefresh ? '이번 분석은 캐시 없이 재호출' : 'OCR 다시 분석'}
                    </button>
                ) : null}
                {featureHoldNotice}
                {ocrFallbackNotice ? (
                    <div className={`rounded-lg border px-3 py-2 text-xs ${isTerminalError ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-border bg-secondary text-foreground'}`} role="status" aria-live="polite">
                        <p className="font-semibold">{ocrFallbackNotice.message}</p>
                        {ocrFallbackNotice.detail ? <p className="mt-1 opacity-80">{ocrFallbackNotice.detail}</p> : null}
                        {ocrFallbackNotice.type === 'pending' ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="min-h-11 bg-background px-3 text-sm"
                                    disabled={!verificationPhoto || isAnalyzing}
                                    onClick={handleCheckReceiptOcr}
                                >
                                    결과 확인
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="min-h-11 bg-background px-3 text-sm"
                                    onClick={onUsePhotoOnly}
                                >
                                    직접 입력
                                </Button>
                            </div>
                        ) : isTerminalError ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="min-h-11 border-destructive/30 bg-background px-3 text-sm text-destructive hover:bg-destructive/10"
                                    onClick={onUsePhotoOnly}
                                >
                                    사진만 첨부하고 직접 입력
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="min-h-11 border-destructive/30 bg-background px-3 text-sm text-destructive hover:bg-destructive/10"
                                    disabled={!verificationPhoto || isAnalyzing || ocrLimitReached}
                                    onClick={handleRetryReceiptOcr}
                                >
                                    다시 분석
                                </Button>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
            <Card
                className={`relative p-6 border-dashed transition-colors ${isVerificationDragging
                    ? 'border-primary bg-primary/5 cursor-pointer'
                    : verificationPhoto
                        ? 'border-green-300 bg-green-50/50 cursor-pointer'
                        : 'border-border hover:border-primary/50 cursor-pointer'
                    }`}
                onDragOver={handleDragOver}
                onDragEnter={handleVerificationDragEnter}
                onDragLeave={handleVerificationDragLeave}
                onDrop={featureHeld ? undefined : handleVerificationDrop}
                aria-disabled={featureHeld}
                onClick={featureHeld ? undefined : openVerificationFileDialog}
            >
                <div className="flex flex-col items-center gap-4">
                    {verificationPhoto ? (
                        <div className="w-full space-y-3">
                            <div className="flex items-center justify-center relative">
                                <div className="relative">
                                    <div className="relative mx-auto h-[min(42dvh,26rem)] w-full max-w-[min(92vw,28rem)] rounded-lg overflow-hidden border-2 border-green-200 bg-background">
                                        <ObjectUrlPreviewImage
                                            src={verificationPhotoUrl}
                                            alt="인증 사진 미리보기"
                                            className="h-full w-full object-contain"
                                        />
                                    </div>
                                    <div className="absolute -top-2 -right-2 bg-green-500 text-white rounded-full p-1">
                                        <CheckCircle2 className="h-4 w-4" />
                                    </div>
                                </div>
                            </div>
                            <div className="text-center">
                                <Badge variant="default" className="gap-1 mb-2 bg-green-500">
                                    <CheckCircle2 className="h-3 w-3" />
                                    영수증 사진 첨부됨
                                </Badge>
                                <p className="text-sm font-medium">{verificationPhoto.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {(verificationPhoto.size / 1024 / 1024).toFixed(1)}MB
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full gap-2"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    replaceVerificationPhoto(null);
                                }}
                            >
                                <Trash2 className="h-4 w-4" />
                                사진 제거
                            </Button>
                        </div>
                    ) : (
                        <div className="w-full text-center space-y-3">
                            <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isVerificationDragging ? 'bg-primary/10' : 'bg-muted'
                                }`}>
                                <ImageIcon className={`h-8 w-8 transition-colors ${isVerificationDragging ? 'text-primary' : 'text-muted-foreground'
                                    }`} />
                            </div>
                            <div>
                                <p className="font-medium mb-1">
                                    {isVerificationDragging ? '여기에 사진을 놓아주세요' : '영수증 인증 사진을 업로드해주세요'}
                                </p>
                                <p className="text-sm text-muted-foreground mb-3">
                                    {verificationInputMode === "ai" ? (
                                        <span className="text-primary font-medium">영수증의 가게명과 방문 정보를 읽어 입력합니다. 입력된 내용은 직접 확인해주세요.</span>
                                    ) : (
                                        <span className="font-medium">AI 분석 없이 인증 사진만 첨부됩니다. 필요한 정보는 아래에서 직접 입력해주세요.</span>
                                    )}
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="min-h-11 gap-2"
                                    disabled={featureHeld}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openVerificationFileDialog();
                                    }}
                                >
                                    <Plus className="h-4 w-4" />
                                    사진 선택
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
                <input ref={verificationFileInputRef} type="file" disabled={featureHeld} accept={RECEIPT_IMAGE_ACCEPT} onChange={handleVerificationPhotoChange} className="hidden" />

                {isAnalyzing && (
                    <div className="absolute inset-0 z-50 bg-background/95 flex flex-col items-center justify-center text-center p-6 rounded-xl border border-primary/20">
                        <div className="relative mb-4">
                            <div className="rounded-full border border-border bg-background p-3">
                                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
                            </div>
                        </div>
                        <h3 className="mb-2 text-lg font-semibold text-foreground">영수증을 읽고 있습니다</h3>
                        <p className="text-sm text-muted-foreground mb-4" aria-live="polite">
                            {ocrProgress?.message || '가게명과 방문 정보를 확인하고 있습니다'}
                        </p>
                        {ocrProgress?.fields.length ? (
                            <div className="mb-3 flex flex-wrap justify-center gap-1.5">
                                {ocrProgress.fields.map((field) => (
                                    <Badge key={field} variant="secondary" className="bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-200">
                                        ✓ {field}
                                    </Badge>
                                ))}
                            </div>
                        ) : null}
                        {ocrProgress ? (
                            <div className="mb-3 grid w-full max-w-xs grid-cols-5 gap-1" aria-label="AI 분석 진행 단계">
                                {OCR_PROGRESS_STEPS.map((step) => {
                                    const isDone = getOcrProgressRank(ocrProgress.stage) >= getOcrProgressRank(step.stage);
                                    return (
                                        <div key={step.stage} className={`rounded-full px-2 py-1 text-xs font-medium ${isDone ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                                            {step.label}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}
                        {ocrProgress?.fallbackUsed ? (
                            <p className="mb-3 rounded-md bg-secondary px-2 py-1 text-xs text-foreground">분석을 계속하고 있습니다. 잠시만 기다려주세요.</p>
                        ) : null}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3 text-green-600" />
                            <span>분석된 데이터는 AI 학습에 사용되지 않습니다</span>
                        </div>
                    </div>
                )}
            </Card>
        </>
    );
}
