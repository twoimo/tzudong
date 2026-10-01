'use client';

import { useEffect } from 'react';
import { onCLS, onFCP, onLCP, onINP, type Metric } from 'web-vitals';
import { debugLog } from '@/lib/debug-log';
import { fieldVitalBucket, shouldCollectFieldVitals, FIELD_VITAL_NAMES, FIELD_NAVIGATIONS, type FieldVitalName, type FieldNavigation } from '@/lib/performance/field-vitals';

let productionCollectorRegistered = false;

/**
 * Web Vitals 측정 및 로깅
 * @see https://web.dev/vitals/
 */
export function WebVitals() {
    useEffect(() => {
        const release = process.env.NEXT_PUBLIC_TZUDONG_FIELD_RELEASE ?? '';
        const collect = /^[a-f0-9]{40}$/.test(release) && shouldCollectFieldVitals({
            production: process.env.NODE_ENV === 'production',
            hostname: location.hostname,
            pathname: location.pathname,
            search: location.search,
            webdriver: navigator.webdriver,
        });
        if (process.env.NODE_ENV === 'production' && productionCollectorRegistered) return;
        if (process.env.NODE_ENV === 'production') productionCollectorRegistered = true;
        // QA suppresses delivery, not observer overhead, so lab measurements
        // retain the same Web Vitals observer work as eligible production visits.
        const device = matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
        // At most three identifiers in memory; no identifier is sent or stored.
        const lastSentId = new Map<string, string>();
        const handleMetric = (metric: Metric) => {
            // 개발 환경에서 콘솔 출력
            if (process.env.NODE_ENV === 'development') {
                debugLog(`[Web Vitals] ${metric.name}:`, {
                    value: metric.value,
                    rating: metric.rating,
                    delta: metric.delta,
                });
            }

            if (collect && FIELD_VITAL_NAMES.includes(metric.name as FieldVitalName)) {
                if (lastSentId.get(metric.name) === metric.id) return;
                const name = metric.name as FieldVitalName;
                const bucket = fieldVitalBucket(name, metric.value);
                const navigation = metric.navigationType as FieldNavigation;
                if (bucket === null || !FIELD_NAVIGATIONS.includes(navigation)) return;
                lastSentId.set(metric.name, metric.id);
                // Anonymous daily histogram only. Never include Metric entries,
                // URL, identity, cookies, location or the raw metric object.
                void fetch('/api/performance/web-vitals', {
                    method: 'POST',
                    credentials: 'omit',
                    referrerPolicy: 'no-referrer',
                    keepalive: true,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        version: 1,
                        device,
                        metric: name,
                        navigation,
                        bucket,
                        release,
                    }),
                }).catch(() => undefined);
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
