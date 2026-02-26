'use client';

import { useEffect } from 'react';
import { onCLS, onFCP, onLCP, onINP, type Metric } from 'web-vitals';

/**
 * Web Vitals 측정 및 로깅
 * @see https://web.dev/vitals/
 */
export function WebVitals() {
    useEffect(() => {
        const handleMetric = (metric: Metric) => {
            // 개발 환경에서 콘솔 출력
            if (process.env.NODE_ENV === 'development') {
                console.log(`[Web Vitals] ${metric.name}:`, {
                    value: metric.value,
                    rating: metric.rating,
                    delta: metric.delta,
                });
            }

            // 프로덕션 환경에서는 분석 서비스로 전송
            // 예: Google Analytics, Vercel Analytics 등
            if (process.env.NODE_ENV === 'production') {
                // 여기에 분석 서비스 전송 코드 추가
                // sendToAnalytics(metric);
            }
        };

        // 핵심 Web Vitals 측정 (FID는 INP로 대체됨 - web-vitals v4+)
        onCLS(handleMetric);
        onFCP(handleMetric);
        onLCP(handleMetric);
        onINP(handleMetric); // INP가 FID를 대체
    }, []);

    return null;
}
