'use client';

import Image from 'next/image';
import { useState, type CSSProperties } from 'react';
import { MapPin } from 'lucide-react';
import {
    getYoutubeThumbnailCandidates,
    shouldTryNextYoutubeThumbnailCandidate,
} from '@/lib/youtube-thumbnail';

type YouTubeThumbnailProps = {
    videoId: string | null | undefined;
    alt: string;
    sizes?: string;
    className?: string;
    style?: CSSProperties;
    priority?: boolean;
    objectFit?: 'cover' | 'contain';
    fallbackIconClassName?: string;
};

/**
 * YouTube 썸네일을 고화질 원본(maxresdefault)부터 candidate 사다리 순서로 렌더링한다.
 * Next/Image가 img.youtube.com을 remotePatterns로 AVIF/WebP 변환하므로, 원본이
 * 고해상도 jpg라도 브라우저에는 최적화된 .webp로 전달된다. 120x90 placeholder처럼
 * HTTP 200으로 돌아오는 저화질 원본은 onLoad에서 감지해 다음 후보로 내려간다.
 */
export function YouTubeThumbnail({
    videoId,
    alt,
    sizes,
    className,
    style,
    priority,
    objectFit = 'cover',
    fallbackIconClassName,
}: YouTubeThumbnailProps) {
    const candidates = getYoutubeThumbnailCandidates(videoId);
    const [candidateIndex, setCandidateIndex] = useState(0);

    if (!videoId || candidates.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <MapPin
                    className={fallbackIconClassName ?? 'h-6 w-6 text-muted-foreground'}
                    aria-hidden="true"
                />
            </div>
        );
    }

    const index = Math.min(candidateIndex, candidates.length - 1);
    const src = candidates[index];
    const advance = () =>
        setCandidateIndex((i) => Math.min(i + 1, candidates.length - 1));

    return (
        <Image
            src={src}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            className={className}
            style={{ objectFit, ...style }}
            onLoad={(event) => {
                const el = event.currentTarget;
                if (
                    shouldTryNextYoutubeThumbnailCandidate({
                        naturalWidth: el.naturalWidth,
                        naturalHeight: el.naturalHeight,
                        candidateIndex: index,
                        totalCandidates: candidates.length,
                    })
                ) {
                    advance();
                }
            }}
            onError={advance}
        />
    );
}
