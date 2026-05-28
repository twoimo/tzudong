import React, { useState, useEffect, useMemo, useCallback, useId, memo } from 'react';
import Image from 'next/image';
import { EvaluationRecord, LocationMatchResult } from '@/types/evaluation';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatCategoryText } from '@/lib/category-utils';
import { openExternalUrl } from '@/lib/open-external-url';
import {
    explainAddressConsistency,
    getAddressConsistencyAhpSummary,
    getAddressConsistencyBadgeClass,
    getAddressConsistencyOperatorGuidance,
    getAddressConsistencyStatus,
    getAddressConsistencyTriageSignals,
    type AddressConsistencyTriageTone,
} from '@/lib/admin-address-consistency';
import {
    getEvaluationBasisOrRerunText,
    getEvaluationCompletenessIssues,
    hasUsableEvaluationBasis,
    type EvaluationMetricKey,
} from '@/lib/admin-evaluation-completeness';

// 유틸리티 함수: YouTube 비디오 ID 추출 (컴포넌트 외부)
const getYoutubeVideoId = (url: string | undefined): string | null => {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&].*)?/,
        /(?:youtube\.com\/(?:embed|v)\/)([a-zA-Z0-9_-]{11})/,
        /(?:m\.youtube\.com\/watch\?v=|youtube\.com\/.*[?&]v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1] && match[1].length === 11) {
            return match[1];
        }
    }
    return null;
};

interface EvaluationDetailViewProps {
    record: EvaluationRecord;
    className?: string;
    autoHeight?: boolean; // true일 경우 내부 스크롤 없이 콘텐츠 높이에 맞춰 늘어남
}

type EvaluationTone = 'pink' | 'blue' | 'purple' | 'green' | 'indigo' | 'orange' | 'teal' | 'yellow';

const evaluationToneClasses: Record<EvaluationTone, { rail: string; badge: string; value: string }> = {
    pink: {
        rail: 'border-l-pink-500',
        badge: 'border-pink-200 bg-pink-50 text-pink-700',
        value: 'text-pink-700',
    },
    blue: {
        rail: 'border-l-blue-500',
        badge: 'border-blue-200 bg-blue-50 text-blue-700',
        value: 'text-blue-700',
    },
    purple: {
        rail: 'border-l-purple-500',
        badge: 'border-purple-200 bg-purple-50 text-purple-700',
        value: 'text-purple-700',
    },
    green: {
        rail: 'border-l-green-500',
        badge: 'border-green-200 bg-green-50 text-green-700',
        value: 'text-green-700',
    },
    indigo: {
        rail: 'border-l-indigo-500',
        badge: 'border-indigo-200 bg-indigo-50 text-indigo-700',
        value: 'text-indigo-700',
    },
    orange: {
        rail: 'border-l-orange-500',
        badge: 'border-orange-200 bg-orange-50 text-orange-700',
        value: 'text-orange-700',
    },
    teal: {
        rail: 'border-l-teal-500',
        badge: 'border-teal-200 bg-teal-50 text-teal-700',
        value: 'text-teal-700',
    },
    yellow: {
        rail: 'border-l-yellow-500',
        badge: 'border-yellow-200 bg-yellow-50 text-yellow-800',
        value: 'text-yellow-800',
    },
};

function SectionPanel({
    title,
    description,
    children,
    className,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
}) {
    const titleId = useId();

    return (
        <section
            aria-labelledby={titleId}
            className={cn('rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm', className)}
        >
            <div className="mb-3 min-w-0">
                <h3 id={titleId} className="text-sm font-bold tracking-[-0.02em] text-foreground sm:text-base">{title}</h3>
                {description && (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                )}
            </div>
            {children}
        </section>
    );
}

function NumberBadge({ index, tone }: { index: number; tone: EvaluationTone }) {
    return (
        <Badge
            variant="outline"
            className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg p-0 text-[11px] font-bold',
                evaluationToneClasses[tone].badge,
            )}
        >
            {index}
        </Badge>
    );
}

function EvalItem({
    index,
    title,
    tone,
    value,
    children,
}: {
    index: number;
    title: string;
    tone: EvaluationTone;
    value?: React.ReactNode;
    children?: React.ReactNode;
}) {
    return (
        <article
            className={cn(
                'rounded-xl border border-border/80 border-l-4 bg-background/85 p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)]',
                evaluationToneClasses[tone].rail,
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                <NumberBadge index={index} tone={tone} />
                <h4 className="min-w-0 flex-1 text-sm font-bold text-foreground">{title}</h4>
                {value && <div className="shrink-0">{value}</div>}
            </div>
            {children && <div className="mt-2 text-xs leading-5 text-muted-foreground">{children}</div>}
        </article>
    );
}

function SourceNameRow({
    label,
    value,
    provider,
    valueClassName,
}: {
    label: string;
    value: React.ReactNode;
    provider: string;
    valueClassName?: string;
}) {
    return (
        <div className="grid grid-cols-[86px_minmax(0,1fr)_auto] items-start gap-2 rounded-lg bg-muted/35 px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <span className={cn('min-w-0 overflow-wrap-anywhere text-xs font-bold text-foreground', valueClassName)}>{value}</span>
            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground">
                {provider}
            </Badge>
        </div>
    );
}

function ScoreValue({ value, tone, maxScore, rerunNeeded = false }: { value: number | null | undefined; tone: EvaluationTone; maxScore: number; rerunNeeded?: boolean }) {
    const hasValue = typeof value === 'number';
    const isMaxScore = hasValue && value >= maxScore;

    return (
        <span className={cn('text-sm font-extrabold tabular-nums', isMaxScore ? evaluationToneClasses[tone].value : 'text-foreground')}>
            {hasValue ? `${value}/${maxScore}` : '-'}
        </span>
    );
}

function BooleanBadge({ value, rerunNeeded = false }: { value: boolean | null | undefined; rerunNeeded?: boolean }) {
    if (value === undefined || value === null) {
        if (!rerunNeeded) {
            return (
                <Badge variant="outline" className="h-6 px-2 text-[11px] font-bold text-muted-foreground">
                    -
                </Badge>
            );
        }

        return (
            <Badge variant="outline" className="h-6 px-2 text-[11px] font-bold text-muted-foreground">
                -
            </Badge>
        );
    }

    return (
        <Badge className={cn('h-6 px-2 text-[11px] font-bold', value ? 'bg-emerald-600' : 'bg-destructive')}>
            {value ? '일치' : '불일치'}
        </Badge>
    );
}

function InfoItem({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('min-w-0 rounded-xl border border-border/70 bg-background/70 px-3 py-2', className)}>
            <dt className="text-[11px] font-semibold text-muted-foreground">{label}</dt>
            <dd className="mt-1 overflow-wrap-anywhere text-sm leading-5 text-foreground">{children}</dd>
        </div>
    );
}

function EvidenceNote({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
            <h4 className="text-xs font-bold tracking-[-0.01em] text-foreground">{title}</h4>
            <p className="mt-1 whitespace-pre-wrap break-keep text-xs leading-5 text-muted-foreground">
                {children}
            </p>
        </div>
    );
}

const addressGuidanceToneClasses: Record<AddressConsistencyTriageTone, string> = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    neutral: 'border-slate-200 bg-slate-50 text-slate-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-rose-200 bg-rose-50 text-rose-700',
    info: 'border-sky-200 bg-sky-50 text-sky-700',
};

export const EvaluationDetailView = memo(function EvaluationDetailView({ record, className, autoHeight = false }: EvaluationDetailViewProps) {
    // Operator flow anchor: review -> decision capture -> guarded apply -> readback/recrawl.

    const [embedError, setEmbedError] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const iframeRef = React.useRef<HTMLIFrameElement>(null);

    // 리코드 변경 시 상태 초기화
    useEffect(() => {
        setEmbedError(false);
        setVideoUrl(null);
    }, [record?.id]);

    // videoId 메모이제이션
    const videoId = useMemo(() => getYoutubeVideoId(record?.youtube_link), [record?.youtube_link]);

    // YouTube 임베드 가능 여부 확인 (noembed.com 프록시 사용 - CORS 지원)
    useEffect(() => {
        if (!videoId || embedError) return;

        const checkEmbedAvailability = async () => {
            try {
                // noembed.com은 CORS를 지원하는 oEmbed 프록시
                const response = await fetch(
                    `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`
                );

                if (!response.ok) {

                    setEmbedError(true);
                    return;
                }

                const data = await response.json();

                // noembed에서 에러 응답 시 (비공개, 삭제, 임베드 제한 등)
                if (data.error) {

                    setEmbedError(true);
                }
            } catch {
                // 네트워크 에러 시에는 그냥 iframe 시도
            }
        };

        checkEmbedAvailability();
    }, [videoId, embedError, record?.id]);

    // 비디오 URL 생성 로직
    useEffect(() => {
        if (record?.youtube_link && !embedError) {
            const vidId = getYoutubeVideoId(record.youtube_link);
            if (vidId) {
                const origin = typeof window !== 'undefined' ? window.location.origin : '';
                const url = `https://www.youtube.com/embed/${vidId}?autoplay=0&mute=0&playsinline=1&rel=0&enablejsapi=1&origin=${origin}&controls=1`;
                setVideoUrl(url);
            } else {
                setVideoUrl(null);
            }
        } else {
            setVideoUrl(null);
        }
    }, [record?.youtube_link, record?.id, embedError]);

    const openYoutubeLink = useCallback(() => {
        if (record?.youtube_link) {
            openExternalUrl(record.youtube_link);
        }
    }, [record?.youtube_link]);

    if (!record) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                <span className="text-4xl mb-4" aria-hidden="true">⚠️</span>
                <p className="text-lg">표시할 데이터가 없습니다.</p>
            </div>
        );
    }

    const locationMatchResult = record.evaluation_results?.location_match_TF as LocationMatchResult | undefined;
    const addressConsistency = explainAddressConsistency(record);
    const addressAhp = getAddressConsistencyAhpSummary(record);
    const addressGuidance = getAddressConsistencyOperatorGuidance(record);
    const addressSignals = getAddressConsistencyTriageSignals(record);
    const addressConsistencyStatus = getAddressConsistencyStatus(record);
    const evaluationCompletenessIssues = getEvaluationCompletenessIssues(record);
    const hasMetricIssue = (key: EvaluationMetricKey) => evaluationCompletenessIssues.some((issue) => issue.key === key);
    const getMetricBasisText = (key: EvaluationMetricKey, value: unknown) => {
        if (hasMetricIssue(key)) return getEvaluationBasisOrRerunText(value);
        return hasUsableEvaluationBasis(value) ? String(value) : '-';
    };
    const title = record.youtube_meta?.title || '-';
    const restaurantName = record.restaurant_name || record.name || '-';
    const formattedPublishedAt = record.youtube_meta?.publishedAt
        ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(record.youtube_meta.publishedAt))
        : '-';
    const needsAddressReview = addressConsistencyStatus === 'false' || addressConsistencyStatus === 'failed';
    const needsCategoryReview = !record.evaluation_results?.category_validity_TF?.eval_value || !record.evaluation_results?.category_TF?.eval_value;
    const needsMetricRerun = evaluationCompletenessIssues.length > 0;
    const isDeleted = record.status === 'deleted';
    const decisionState = isDeleted
        ? '삭제된 레코드'
        : needsMetricRerun
            ? '평가값 확인'
        : needsAddressReview || needsCategoryReview
            ? '관리자 확인 필요'
            : '승인 전 최종 확인';
    const decisionReasons = [
        isDeleted ? '삭제된 항목은 복구 전까지 적용 대상에서 제외됩니다.' : null,
        needsMetricRerun ? '평가값 또는 근거가 비어 있습니다.' : null,
        needsAddressReview ? addressConsistency.headline : null,
        needsCategoryReview ? '카테고리 판정에 확인이 필요한 항목이 있습니다.' : null,
    ].filter(Boolean) as string[];

    const RightContent = () => (
        <div className="space-y-4 p-3 text-sm sm:p-4">
            <SectionPanel title="판정 요약" description="검토 → 결정 기록 → 안전 적용 → 재확인 순서로 처리합니다." className={cn(needsAddressReview || isDeleted ? 'border-primary/25 bg-primary/5' : 'border-emerald-200 bg-emerald-50/40')}>
                <div className="space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <p className="text-lg font-extrabold tracking-[-0.04em] text-foreground">{restaurantName}</p>
                            <p className="mt-1 break-keep text-xs leading-5 text-muted-foreground">승인 전에는 영상 근거, 상호·주소 근거, 적용될 주소를 함께 확인하세요.</p>
                        </div>
                        <Badge className={cn('w-fit px-2.5 py-1 text-xs font-bold', needsAddressReview || isDeleted ? 'bg-primary' : 'bg-emerald-600')}>
                            {decisionState}
                        </Badge>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                        <InfoItem label="검토">영상·상호·주소 근거 확인</InfoItem>
                        <InfoItem label="결정 기록">수정·보류 사유 남기기</InfoItem>
                        <InfoItem label="안전 적용">적용 후 재확인·감사 기록</InfoItem>
                    </div>
                    {decisionReasons.length > 0 && (
                        <ul className="space-y-1 rounded-xl border border-primary/15 bg-background/75 p-3 text-xs leading-5 text-foreground">
                            {decisionReasons.slice(0, 3).map((reason, index) => (
                                <li key={`${record.id}-decision-reason-${index}`} className="flex gap-2 break-keep">
                                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                                    <span>{reason}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </SectionPanel>

            <SectionPanel title="검수 결과" description="영상 근거와 상호·주소 근거를 기준으로 승인 전 확인해야 할 항목입니다.">
                <div className="space-y-3">
                    <EvalItem index={0} title="맛집명 검증" tone="pink" value={record.approved_name ? <Badge className="bg-emerald-600 text-[11px]">승인됨 · {record.approved_name}</Badge> : null}>
                        <div className="space-y-1.5">
                            <SourceNameRow
                                label="원본 이름"
                                value={record.origin_name || record.restaurant_name || record.name || '-'}
                                provider="AI 추출"
                            />
                            <SourceNameRow
                                label="네이버"
                                value={record.naver_name ||
                                    locationMatchResult?.matched_name ||
                                    (locationMatchResult?.name &&
                                        !['Location Match', '주소 정합성', 'location_match_TF'].includes(locationMatchResult.name)
                                        ? locationMatchResult.name
                                        : '-')}
                                provider="지도 규칙"
                                valueClassName="text-blue-700"
                            />
                            <SourceNameRow
                                label="구글"
                                value={record.google_name || locationMatchResult?.google_name || '-'}
                                provider="지도 규칙"
                                valueClassName="text-orange-700"
                            />
                        </div>
                    </EvalItem>

                    <EvalItem
                        index={1}
                        title="방문 여부 정확성"
                        tone="blue"
                        value={<ScoreValue value={record.evaluation_results?.visit_authenticity?.eval_value} tone="blue" maxScore={3} rerunNeeded={hasMetricIssue('visit_authenticity')} />}
                    >
                        <p className="whitespace-pre-wrap break-keep">
                            {getMetricBasisText('visit_authenticity', record.evaluation_results?.visit_authenticity?.eval_basis)}
                        </p>
                    </EvalItem>

                    <EvalItem
                        index={2}
                        title="추론 합리성"
                        tone="purple"
                        value={<ScoreValue value={record.evaluation_results?.rb_inference_score?.eval_value} tone="purple" maxScore={2} rerunNeeded={hasMetricIssue('rb_inference_score')} />}
                    >
                        <p className="whitespace-pre-wrap break-keep">
                            {getMetricBasisText('rb_inference_score', record.evaluation_results?.rb_inference_score?.eval_basis)}
                        </p>
                    </EvalItem>

                    <EvalItem
                        index={3}
                        title="실제 근거 일치도"
                        tone="green"
                        value={<BooleanBadge value={record.evaluation_results?.rb_grounding_TF?.eval_value} rerunNeeded={hasMetricIssue('rb_grounding_TF')} />}
                    >
                        <p className="whitespace-pre-wrap break-keep">
                            {getMetricBasisText('rb_grounding_TF', record.evaluation_results?.rb_grounding_TF?.eval_basis)}
                        </p>
                    </EvalItem>

                    <EvalItem
                        index={4}
                        title="리뷰 충실도"
                        tone="indigo"
                        value={<ScoreValue value={record.evaluation_results?.review_faithfulness_score?.eval_value} tone="indigo" maxScore={1} rerunNeeded={hasMetricIssue('review_faithfulness_score')} />}
                    >
                        <p className="whitespace-pre-wrap break-keep">
                            {getMetricBasisText('review_faithfulness_score', record.evaluation_results?.review_faithfulness_score?.eval_basis)}
                        </p>
                    </EvalItem>

                    <EvalItem
                        index={5}
                        title="주소 정합성"
                        tone="orange"
                        value={<Badge className={cn('h-6 px-2 text-[11px] font-bold', getAddressConsistencyBadgeClass(record))}>{addressConsistency.label}</Badge>}
                    >
                        <div className="space-y-2">
                            <p className="font-semibold text-foreground">{addressConsistency.headline}</p>
                            <p className="whitespace-pre-wrap break-keep">{addressConsistency.reason}</p>
                            <div className="rounded-xl border border-orange-200/70 bg-orange-50/40 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-bold text-orange-950">운영 분류</span>
                                    <Badge
                                        variant="outline"
                                        className={cn('h-6 px-2 text-[11px] font-bold', addressGuidanceToneClasses[addressGuidance.tone])}
                                    >
                                        {addressGuidance.label}
                                    </Badge>
                                </div>
                                <dl className="mt-2 grid gap-2 text-xs leading-5 text-orange-950 sm:grid-cols-3">
                                    <InfoItem label="가능 원인" className="bg-background/75">{addressGuidance.possibleCause}</InfoItem>
                                    <InfoItem label="권장 처리" className="bg-background/75">{addressGuidance.recommendedAction}</InfoItem>
                                    <InfoItem label="안전장치" className="bg-background/75">{addressGuidance.safeguard}</InfoItem>
                                </dl>
                            </div>
                            <div className="rounded-xl border border-sky-200/70 bg-sky-50/45 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-bold text-sky-950">AHP 참고 점수</span>
                                    <Badge
                                        variant="outline"
                                        className={cn(
                                            'h-6 px-2 text-[11px] font-bold',
                                            addressAhp.score !== null && addressAhp.score >= 98
                                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                                : 'border-sky-300 bg-background/70 text-sky-700',
                                        )}
                                    >
                                        {addressAhp.score === null ? addressAhp.label : `${addressAhp.score}점 · ${addressAhp.label}`}
                                    </Badge>
                                </div>
                                <dl className="mt-2 grid gap-2 text-xs leading-5 text-sky-950 sm:grid-cols-3">
                                    <InfoItem label="최우선 확인" className="bg-background/75">{addressAhp.topFailingCriterion}</InfoItem>
                                    <InfoItem label="권장 액션" className="bg-background/75">{addressAhp.suggestedAction}</InfoItem>
                                    <InfoItem label="하드 게이트" className="bg-background/75">{addressAhp.hardGate}</InfoItem>
                                </dl>
                                {addressAhp.evidenceFamilies.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {addressAhp.evidenceFamilies.map((family) => (
                                            <Badge key={`${record.id}-ahp-family-${family}`} variant="outline" className="bg-background/70 text-[10px]">
                                                {family}
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {addressSignals.length > 0 && (
                                <div className="rounded-xl border border-amber-200/70 bg-amber-50/45 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-bold text-amber-950">추가 신호</span>
                                        {addressSignals.map((signal) => (
                                            <Badge
                                                key={`${record.id}-address-signal-${signal.kind}`}
                                                variant="outline"
                                                className={cn('h-6 px-2 text-[11px] font-bold', addressGuidanceToneClasses[signal.tone])}
                                            >
                                                {signal.label}
                                            </Badge>
                                        ))}
                                    </div>
                                    <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-950">
                                        {addressSignals.slice(0, 4).map((signal) => (
                                            <li key={`${record.id}-address-signal-message-${signal.kind}`} className="break-keep">
                                                <span className="font-semibold">{signal.label}</span> · {signal.message}
                                                {signal.evidence.length > 0 ? ` (${signal.evidence.slice(0, 2).join(' / ')})` : ''}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {addressConsistency.evidence.length > 0 && (
                                <ul className="space-y-1 rounded-lg border border-orange-200/70 bg-orange-50/50 p-2 text-orange-950">
                                    {addressConsistency.evidence.map((item, index) => (
                                        <li key={`${record.id}-address-consistency-${index}`} className="flex gap-2 overflow-wrap-anywhere">
                                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" aria-hidden="true" />
                                            <span>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <dl className="grid gap-1.5 sm:grid-cols-2">
                                <InfoItem label="지번">{record.jibun_address || '-'}</InfoItem>
                                <InfoItem label="도로명">{record.road_address || '-'}</InfoItem>
                            </dl>
                        </div>
                    </EvalItem>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <EvalItem
                            index={6}
                            title="카테고리 유효성"
                            tone="teal"
                            value={<BooleanBadge value={record.evaluation_results?.category_validity_TF?.eval_value} rerunNeeded={hasMetricIssue('category_validity_TF')} />}
                        />
                        <EvalItem
                            index={7}
                            title="카테고리 정합성"
                            tone="yellow"
                            value={<BooleanBadge value={record.evaluation_results?.category_TF?.eval_value} rerunNeeded={hasMetricIssue('category_TF')} />}
                        >
                            {record.evaluation_results?.category_TF?.category_revision && (
                                <p className="text-yellow-900">
                                    수정 제안 · {formatCategoryText(record.evaluation_results.category_TF.category_revision, '-')}
                                </p>
                            )}
                        </EvalItem>
                    </div>
                </div>
            </SectionPanel>

            <SectionPanel title="음식점 상세" description="승인 전 최종 적용될 이름, 주소, 좌표 정보를 확인합니다.">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <InfoItem label="음식점명">{restaurantName}</InfoItem>
                    <InfoItem label="카테고리">
                        {formatCategoryText(record.categories, '') || formatCategoryText(record.restaurant_info?.category, '-')}
                    </InfoItem>
                    <InfoItem label="원본 주소" className="sm:col-span-2">
                        {record.restaurant_info?.origin_address || '-'}
                    </InfoItem>
                    <InfoItem label="네이버 도로명">
                        {record.restaurant_info?.naver_address_info?.road_address || '-'}
                    </InfoItem>
                    <InfoItem label="네이버 지번">
                        {record.restaurant_info?.naver_address_info?.jibun_address || '-'}
                    </InfoItem>
                    {record.phone && <InfoItem label="전화번호">{record.phone}</InfoItem>}
                    <InfoItem label="좌표">
                        <span className="font-mono text-xs text-muted-foreground">{record.lat ?? '-'}, {record.lng ?? '-'}</span>
                    </InfoItem>
                </dl>

                <div className="my-4 h-px bg-border" role="none" />

                <div className="grid gap-3 lg:grid-cols-2">
                    <EvidenceNote title="추론 근거">
                        {record.reasoning_basis || '-'}
                    </EvidenceNote>
                    <EvidenceNote title="쯔양 리뷰 요약">
                        {record.restaurant_info?.tzuyang_review || '-'}
                    </EvidenceNote>
                </div>
            </SectionPanel>

            <div className="h-8" />
        </div>
    );

    return (
        <div className={cn('flex flex-col bg-background lg:flex-row', autoHeight ? 'h-auto' : 'h-full overflow-hidden', className)}>
            {/* 좌측: 영상 근거 */}
            <aside className={cn('flex w-full flex-col border-b bg-muted/25 lg:border-b-0 lg:border-r', autoHeight ? 'lg:w-[42%]' : 'lg:w-[48%] lg:overflow-hidden')} aria-label="영상 근거와 메타 정보">
                <div className="p-3 pb-0 sm:p-4 sm:pb-0">
                    <SectionPanel title="영상 근거" description="썸네일을 눌러 원본 YouTube 영상을 새 탭에서 확인합니다." className="p-3">
                        {videoUrl && !embedError ? (
                            <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
                                <iframe
                                    ref={iframeRef}
                                    width="100%"
                                    height="100%"
                                    src={`${videoUrl}&autoplay=0`}
                                    title={`${title} YouTube 영상`}
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; compute-pressure"
                                    allowFullScreen
                                    className="block h-full w-full"
                                />
                            </div>
                        ) : (
                            /* Facade Pattern: 썸네일 표시 (클릭 시 새 탭) */
                            <button
                                type="button"
                                className="group relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-muted text-left shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                                onClick={openYoutubeLink}
                                aria-label={`${title} 유튜브 영상 새 탭에서 열기`}
                            >
                                {videoId ? (
                                    <Image
                                        src={`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`}
                                        alt={`${title} 썸네일`}
                                        fill
                                        unoptimized
                                        sizes="(max-width: 768px) 100vw, 768px"
                                        className="object-cover transition-opacity duration-200 group-hover:opacity-90 motion-reduce:transition-none"
                                        onError={(e) => {
                                            const target = e.currentTarget;
                                            if (target.src.includes('maxresdefault')) {
                                                target.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                                            }
                                        }}
                                    />
                                ) : (
                                    <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-muted-foreground">
                                        <p className="text-sm">썸네일 없음</p>
                                    </div>
                                )}
                                <span className="absolute bottom-3 left-3 rounded-full bg-background/90 px-3 py-1 text-xs font-bold text-foreground shadow-sm backdrop-blur">
                                    원본 영상 열기
                                </span>
                            </button>
                        )}
                    </SectionPanel>
                </div>

                <div className={cn('w-full flex-1 min-h-0 p-3 sm:p-4', autoHeight ? '' : 'overflow-y-auto')}>
                    <SectionPanel title="영상 정보" description="검수 근거가 되는 원본 영상의 기본 정보입니다." className="p-3">
                        <dl className="grid grid-cols-1 gap-2 text-sm">
                            <InfoItem label="제목">
                                <span className="line-clamp-3 font-semibold" title={title}>{title}</span>
                            </InfoItem>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                                <InfoItem label="게시일">
                                    {formattedPublishedAt}
                                </InfoItem>
                                <InfoItem label="광고">
                                    {record.youtube_meta?.ads_info?.is_ads
                                        ? `있음 (${record.youtube_meta.ads_info.what_ads})`
                                        : '없음'}
                                </InfoItem>
                            </div>
                            <InfoItem label="링크">
                                <a
                                    href={record.youtube_link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="overflow-wrap-anywhere text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                                >
                                    {record.youtube_link || '-'}
                                </a>
                            </InfoItem>
                        </dl>
                    </SectionPanel>
                </div>
            </aside>

            {/* 우측: 평가 및 상세 정보 */}
            {autoHeight ? (
                <div className="h-auto w-full bg-muted/25 lg:w-[58%]">
                    <RightContent />
                </div>
            ) : (
                <ScrollArea className="h-full w-full bg-muted/25 lg:w-[52%]">
                    <RightContent />
                </ScrollArea>
            )}
        </div>
    );
});
