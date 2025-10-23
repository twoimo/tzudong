import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface OptimizedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'loading'> {
    src: string;
    alt: string;
    fallbackSrc?: string;
    priority?: boolean;
    quality?: number;
}

export const OptimizedImage = React.forwardRef<HTMLImageElement, OptimizedImageProps>(
    ({ src, alt, className, fallbackSrc, priority = false, quality = 75, ...props }, ref) => {
        const [isLoaded, setIsLoaded] = useState(false);
        const [hasError, setHasError] = useState(false);
        const [isInView, setIsInView] = useState(priority);
        const imgRef = useRef<HTMLImageElement>(null);

        // Intersection Observer for lazy loading
        useEffect(() => {
            if (priority || !imgRef.current) return;

            const observer = new IntersectionObserver(
                (entries) => {
                    const [entry] = entries;
                    if (entry.isIntersecting) {
                        setIsInView(true);
                        observer.disconnect();
                    }
                },
                { rootMargin: '50px' } // 50px before entering viewport
            );

            observer.observe(imgRef.current);

            return () => observer.disconnect();
        }, [priority]);

        const handleLoad = () => {
            setIsLoaded(true);
        };

        const handleError = () => {
            setHasError(true);
            if (fallbackSrc && src !== fallbackSrc) {
                // Try fallback image
                if (imgRef.current) {
                    imgRef.current.src = fallbackSrc;
                }
            }
        };

        const currentSrc = hasError && fallbackSrc ? fallbackSrc : src;

        return (
            <div className={cn("relative overflow-hidden", className)}>
                {/* Loading skeleton */}
                {!isLoaded && (
                    <div className="absolute inset-0 bg-muted animate-pulse rounded" />
                )}

                {/* Optimized image */}
                <img
                    ref={(el) => {
                        imgRef.current = el;
                        if (ref) {
                            if (typeof ref === 'function') {
                                ref(el);
                            } else {
                                ref.current = el;
                            }
                        }
                    }}
                    src={isInView ? currentSrc : undefined}
                    alt={alt}
                    loading={priority ? "eager" : "lazy"}
                    decoding="async"
                    onLoad={handleLoad}
                    onError={handleError}
                    className={cn(
                        "transition-opacity duration-300",
                        isLoaded ? "opacity-100" : "opacity-0",
                        className
                    )}
                    {...props}
                />
            </div>
        );
    }
);

OptimizedImage.displayName = "OptimizedImage";

export default OptimizedImage;
