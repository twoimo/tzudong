'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/ui/carousel';
import { YoutubeThumbnail } from '@/components/ui/youtube-thumbnail';
import { YouTubeIcon } from '@/components/icons/YouTubeIcon';
import { EvidenceFrameImage, frameLabel, publicReviewedVideoFrames } from '@/components/restaurant/RestaurantEvidenceCarousel';
import { isLevel1SourceObserved } from '@/lib/evidence-engineering/frames';
import { openExternalUrl } from '@/lib/open-external-url';
import type { RestaurantEvidenceFrame } from '@/lib/evidence-engineering/types';

type Video = { videoId: string; watchUrl: string };
type MediaSlide = { key: string; sourceIndex: number } & (
    | { kind: 'video'; video: Video }
    | { kind: 'frame'; frame: RestaurantEvidenceFrame }
);
const carouselOptions = { loop: false, breakpoints: { '(prefers-reduced-motion: reduce)': { duration: 0 } } };
const timestamp = (frame: RestaurantEvidenceFrame) => `${Math.floor(frame.timestamp_ms / 60000)}:${String(Math.floor(frame.timestamp_ms / 1000) % 60).padStart(2, '0')}`;

export function restaurantMediaSlides(videos: readonly Video[], groups: readonly RestaurantEvidenceFrame[][]): MediaSlide[] {
    const reviewed = [...new Map(publicReviewedVideoFrames(groups).map(frame => [frame.frame_id, frame])).values()];
    const uniqueVideos = [...new Map(videos.map(video => [video.videoId, video])).values()];
    const sources = [...new Set([...uniqueVideos.map(video => video.videoId), ...reviewed.map(frame => frame.video_id)])];
    return sources.flatMap((id, sourceIndex) => {
        const video = uniqueVideos.find(item => item.videoId === id);
        const slides: MediaSlide[] = video ? [{ kind: 'video', key: `video:${id}`, video, sourceIndex }] : [];
        return [...slides, ...reviewed.filter(frame => frame.video_id === id)
            .sort((a, b) => a.timestamp_ms - b.timestamp_ms || a.frame_id.localeCompare(b.frame_id))
            .map(frame => ({ kind: 'frame' as const, key: `frame:${frame.frame_id}`, frame, sourceIndex }))];
    });
}

const slideLabel = (slide: MediaSlide) => `영상 ${slide.sourceIndex + 1} · ${slide.kind === 'video' ? '전체 영상' : `${frameLabel(slide.frame)} ${timestamp(slide.frame)}`}`;
function MediaImage({ slide, thumbnail = false }: { slide: MediaSlide; thumbnail?: boolean }) {
    return slide.kind === 'video'
        ? <YoutubeThumbnail videoId={slide.video.videoId} alt="" className="pointer-events-none object-cover" sizes={thumbnail ? '80px' : '(max-width: 400px) 100vw, 400px'} />
        : <EvidenceFrameImage frame={slide.frame} className="rounded-none" />;
}

export function RestaurantVideoCarousel({ videos, frames }: { videos: readonly Video[]; frames: readonly RestaurantEvidenceFrame[][] }) {
    const slides = useMemo(() => restaurantMediaSlides(videos, frames), [videos, frames]);
    const slideKeys = slides.map(slide => slide.key).join('|');
    const [api, setApi] = useState<CarouselApi>();
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const selectedKeyRef = useRef<string | null>(null);
    const region = useRef<HTMLDivElement>(null);
    const thumbnails = useRef<HTMLDivElement>(null);
    const captionId = useId();
    const current = Math.max(0, slides.findIndex(slide => slide.key === selectedKey));

    useEffect(() => {
        if (!api) return;
        // Retain the selected item when late frames are inserted before it.
        api.scrollTo(Math.max(0, slides.findIndex(slide => slide.key === selectedKeyRef.current)), true);
        const onSelect = () => {
            if (region.current?.querySelector('button:focus')) region.current.focus({ preventScroll: true });
            const index = api.selectedScrollSnap();
            selectedKeyRef.current = slides[index]?.key ?? null;
            setSelectedKey(selectedKeyRef.current);
            const item = thumbnails.current?.children[index] as HTMLElement | undefined;
            if (item && thumbnails.current) {
                const strip = thumbnails.current;
                if (item.offsetLeft < strip.scrollLeft) strip.scrollLeft = item.offsetLeft;
                else if (item.offsetLeft + item.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = item.offsetLeft + item.offsetWidth - strip.clientWidth;
            }
        };
        api.on('select', onSelect);
        return () => { api.off('select', onSelect); };
    }, [api, slides]);

    if (!slides.length) return null;
    const active = slides[current];
    return <section className="min-w-0 space-y-2" aria-label="쯔양 영상과 장면">
        <div className="flex min-w-0 items-center justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <YouTubeIcon className="h-4 w-4 shrink-0 text-red-500" />쯔양 영상과 장면
            </h3>
            {slides.length > 1 && <div className="flex shrink-0 items-center gap-0.5">
                <Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={!api || current === 0} onClick={() => api?.scrollPrev()} aria-label="이전 영상 또는 장면"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
                <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite" aria-atomic="true"><span className="sr-only">콘텐츠 </span>{current + 1}/{slides.length}</span>
                <Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={!api || current === slides.length - 1} onClick={() => api?.scrollNext()} aria-label="다음 영상 또는 장면"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
            </div>}
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            <Carousel key={slideKeys} ref={region} setApi={setApi} opts={carouselOptions} tabIndex={0} aria-label="쯔양 영상과 장면 넘기기" aria-describedby={captionId} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <CarouselContent className="ml-0 touch-pan-y">
                    {slides.map((slide, index) => <CarouselItem key={slide.key} className="pl-0" aria-label={`콘텐츠 ${index + 1}/${slides.length}`} aria-hidden={index !== current}>
                        <button type="button" tabIndex={index === current ? 0 : -1} className="group relative block aspect-video w-full cursor-pointer overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            onClick={() => openExternalUrl(slide.kind === 'video' ? slide.video.watchUrl : slide.frame.youtube_seek_url)} aria-label={`${slideLabel(slide)} 유튜브에서 열기`}>
                            {Math.abs(index - current) <= 1 && <MediaImage slide={slide} />}
                            {slide.kind === 'video' ? <span className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white group-hover:bg-black/80"><Play className="h-5 w-5 translate-x-px fill-current" aria-hidden="true" /></span></span>
                                : <span className="pointer-events-none absolute bottom-3 right-3 rounded bg-black/75 px-2 py-1 text-xs tabular-nums text-white">{timestamp(slide.frame)}</span>}
                        </button>
                    </CarouselItem>)}
                </CarouselContent>
            </Carousel>
            <div id={captionId} className="flex min-h-11 items-center justify-between gap-3 px-3 text-xs">
                <span className="min-w-0 font-medium">영상 {active.sourceIndex + 1} · {active.kind === 'video' ? '전체 영상' : isLevel1SourceObserved(active.frame) ? frameLabel(active.frame) : '영상 속 장면'}</span>
                <button type="button" onClick={() => openExternalUrl(active.kind === 'video' ? active.video.watchUrl : active.frame.youtube_seek_url)} className="flex min-h-11 shrink-0 items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">유튜브에서 보기<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </div>
        </div>
        {slides.length > 1 && <div ref={thumbnails} className="relative flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain py-1" role="group" aria-label="영상과 장면 바로 선택">
            {slides.map((slide, index) => <button key={slide.key} type="button" onClick={() => api?.scrollTo(index)} aria-label={`${slideLabel(slide)} 선택`} aria-pressed={index === current}
                className={`relative h-12 w-20 shrink-0 overflow-hidden rounded-md border-2 bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${index === current ? 'border-foreground' : 'border-transparent'}`}>
                <MediaImage slide={slide} thumbnail />
                {slide.kind === 'video' && <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20"><Play className="h-3.5 w-3.5 fill-white text-white" aria-hidden="true" /></span>}
            </button>)}
        </div>}
    </section>;
}
