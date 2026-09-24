'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactEventHandler } from 'react';
import {
    getYoutubeThumbnailCandidates,
    resolveYoutubeThumbnailCeiling,
    shouldTryNextYoutubeThumbnailCandidate,
} from '@/lib/youtube-thumbnail';

interface YoutubeThumbnailProps {
    videoId: string | null | undefined;
    alt: string;
    sizes: string;
    className?: string;
    style?: CSSProperties;
    priority?: boolean;
    onLoad?: ReactEventHandler<HTMLImageElement>;
    onError?: ReactEventHandler<HTMLImageElement>;
}

const YOUTUBE_THUMBNAIL_DIMENSIONS = {
    maxresdefault: { width: 1280, height: 720 },
    sddefault: { width: 640, height: 480 },
    hqdefault: { width: 480, height: 360 },
    mqdefault: { width: 320, height: 180 },
    default: { width: 120, height: 90 },
} as const;

function getYoutubeThumbnailDimensions(src: string) {
    const quality = src.split('/').pop()?.replace('.jpg', '') as keyof typeof YOUTUBE_THUMBNAIL_DIMENSIONS | undefined;
    return quality ? YOUTUBE_THUMBNAIL_DIMENSIONS[quality] : undefined;
}

/**
 * YouTube 썸네일은 maxresdefault가 없는 영상에서도 200 응답과 120x90
 * 플레이스홀더를 반환할 수 있습니다. 최적화 전에 원본 픽셀 크기를 확인해
 * 고화질 후보를 순서대로 시도하고, 알려진 크기로 Next Image를 렌더링합니다.
 */
export function YoutubeThumbnail({
    videoId,
    alt,
    sizes,
    className,
    style,
    priority = false,
    onLoad,
    onError,
}: YoutubeThumbnailProps) {
    const candidates = useMemo(
        () => getYoutubeThumbnailCandidates(videoId, resolveYoutubeThumbnailCeiling(sizes)),
        [sizes, videoId],
    );
    const [candidateIndex, setCandidateIndex] = useState(0);
    const [paintedSrc, setPaintedSrc] = useState<string | null>(null);

    useEffect(() => {
        setCandidateIndex(0);
        setPaintedSrc(null);
    }, [videoId]);

    const safeCandidateIndex = Math.min(candidateIndex, Math.max(candidates.length - 1, 0));
    const src = candidates[safeCandidateIndex];
    const candidateDimensions = src ? getYoutubeThumbnailDimensions(src) : undefined;

    const advanceCandidate = useCallback(() => {
        setCandidateIndex((currentIndex) =>
            currentIndex === safeCandidateIndex
                ? Math.min(currentIndex + 1, candidates.length - 1)
                : currentIndex,
        );
    }, [candidates.length, safeCandidateIndex]);

    const probesPlaceholder = candidateDimensions?.width === 1280;
    useEffect(() => {
        if (!src || !probesPlaceholder) return;

        let cancelled = false;
        const probe = new window.Image();
        probe.onload = () => {
            if (cancelled) return;
            if (shouldTryNextYoutubeThumbnailCandidate({
                naturalWidth: probe.naturalWidth,
                naturalHeight: probe.naturalHeight,
                candidateIndex: safeCandidateIndex,
                totalCandidates: candidates.length,
            })) {
                advanceCandidate();
            }
        };
        probe.onerror = () => {
            if (!cancelled && safeCandidateIndex < candidates.length - 1) {
                advanceCandidate();
            }
        };
        probe.src = src;

        return () => {
            cancelled = true;
            probe.onload = null;
            probe.onerror = null;
        };
    }, [advanceCandidate, candidates.length, probesPlaceholder, safeCandidateIndex, src]);

    if (!src || !candidateDimensions) return null;

    const paintedDimensions = paintedSrc ? getYoutubeThumbnailDimensions(paintedSrc) : undefined;
    const incomingVisible = paintedSrc === src;

    return (
        <>
            {paintedSrc && paintedDimensions && paintedSrc !== src ? (
                <Image
                    src={paintedSrc}
                    alt=""
                    aria-hidden
                    width={paintedDimensions.width}
                    height={paintedDimensions.height}
                    sizes={sizes}
                    quality={85}
                    className={className}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        ...style,
                    }}
                />
            ) : null}
            <Image
                src={src}
                alt={alt}
                width={candidateDimensions.width}
                height={candidateDimensions.height}
                sizes={sizes}
                quality={85}
                priority={priority}
                className={className}
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    ...style,
                    opacity: incomingVisible || !paintedSrc ? style?.opacity : 0,
                }}
                data-youtube-thumbnail-quality={src.split('/').pop()?.replace('.jpg', '')}
                onLoad={(event) => {
                    setPaintedSrc(src);
                    onLoad?.(event);
                }}
                onError={(event) => {
                    if (safeCandidateIndex < candidates.length - 1) {
                        advanceCandidate();
                    } else {
                        onError?.(event);
                    }
                }}
            />
        </>
    );
}
