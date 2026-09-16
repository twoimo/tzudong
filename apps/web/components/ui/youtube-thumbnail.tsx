'use client';

import Image from 'next/image';
import { useState, type CSSProperties } from 'react';
import { MapPin } from 'lucide-react';
import { getYoutubeThumbnailCandidates } from '@/lib/youtube-thumbnail';

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

type AttemptProps = {
    candidates: string[];
    alt: string;
    sizes?: string;
    className?: string;
    style?: CSSProperties;
    priority?: boolean;
    objectFit?: 'cover' | 'contain';
};

/**
 * 한 번의 시도(attempt)는 특정 videoId에 대한 candidate 사다리 진행 상태다.
 * placeholder 판정은 raw 원본 이미지만으로 해야 하므로(Next/Image의 naturalWidth는
 * density/srcset 보정값이라 96px 렌더링을 placeholder로 오판한다), 이 컴포넌트는
 * onError(404/전송 실패)로만 다음 후보로 내려간다. 모든 후보가 실패하면
 * index가 candidates.length에 도달하고 MapPin 폴백을 렌더링한다.
 */
function ThumbnailAttempt({
    candidates,
    alt,
    sizes,
    className,
    style,
    priority,
    objectFit,
}: AttemptProps) {
    const [index, setIndex] = useState(0);

    if (index >= candidates.length) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <MapPin className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
        );
    }

    return (
        <Image
            src={candidates[index]}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            className={className}
            style={{ objectFit, ...style }}
            onError={() => setIndex((current) => (current === index ? current + 1 : current))}
        />
    );
}

/**
 * YouTube 썸네일을 고화질 원본(maxresdefault)부터 candidate 사다리 순서로 렌더링한다.
 * Next/Image가 img.youtube.com을 remotePatterns로 AVIF/WebP 변환하므로, 원본이
 * 고해상도 jpg라도 브라우저에는 최적화된 .webp로 전달된다. HTTP 200으로 돌아오는
 * 120x90 placeholder는 raw 원본을 직접 probe하는 쪽(lib/youtube-thumbnail의
 * resolveYoutubeThumbnailCandidateIndex, EvaluationTableNew)에서만 판정하고
 * 이 컴포넌트는 onError 사다리와 terminal 폴백만 담당한다 (6 Pro P1, 2026-09-17).
 * videoId가 바뀌면 attempt를 새로 마운트해 이전 영상의 강등 index를 상속하지 않는다.
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

    return (
        <ThumbnailAttempt
            key={videoId}
            candidates={candidates}
            alt={alt}
            sizes={sizes}
            className={className}
            style={style}
            priority={priority}
            objectFit={objectFit}
        />
    );
}

