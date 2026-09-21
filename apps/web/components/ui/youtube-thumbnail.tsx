'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState, type CSSProperties, type ReactEventHandler } from 'react';
import {
    getYoutubeThumbnailCandidates,
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

/**
 * YouTube 썸네일은 maxresdefault가 없는 영상에서도 200 응답과 120x90
 * 플레이스홀더를 반환할 수 있습니다. 실제 픽셀 크기를 확인해 고화질
 * 후보를 순서대로 시도하고, Next Image 최적화 경로로 렌더링합니다.
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
        () => getYoutubeThumbnailCandidates(videoId),
        [videoId],
    );
    const [candidateIndex, setCandidateIndex] = useState(0);

    useEffect(() => {
        setCandidateIndex(0);
    }, [videoId]);

    if (candidates.length === 0) return null;

    const safeCandidateIndex = Math.min(candidateIndex, candidates.length - 1);
    const src = candidates[safeCandidateIndex];

    const advanceCandidate = () => {
        setCandidateIndex((currentIndex) =>
            Math.min(currentIndex + 1, candidates.length - 1),
        );
    };

    return (
        <Image
            src={src}
            alt={alt}
            fill
            sizes={sizes}
            quality={85}
            priority={priority}
            className={className}
            style={style}
            data-youtube-thumbnail-quality={src.split('/').pop()?.replace('.jpg', '')}
            onLoad={(event) => {
                if (shouldTryNextYoutubeThumbnailCandidate({
                    naturalWidth: event.currentTarget.naturalWidth,
                    naturalHeight: event.currentTarget.naturalHeight,
                    candidateIndex: safeCandidateIndex,
                    totalCandidates: candidates.length,
                })) {
                    advanceCandidate();
                }
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
    );
}
