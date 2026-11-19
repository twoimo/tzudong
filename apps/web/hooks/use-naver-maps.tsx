'use client';

import { useEffect, useState, useCallback, useRef } from "react";
import { NAVER_MAPS_CONFIG } from "@/config/maps";
import { markInitialLoadMilestone } from '@/lib/performance/initial-load-milestones';
import {
    isLocalNaverStyleFallbackHost,
    resolveNaverMapScriptUrl,
    rewriteNaverStyleUrlForLocalhost,
    shouldUseLocalNaverMapStub,
} from '@/lib/naver-map-provider-mode';

declare global {
    interface Window {
        naver: {
            maps: Record<string, unknown>;
        };
    }
}
const LOCAL_NIGHTLY = process.env.NIGHTLY_LOCAL_ENV_ONLY === '1' && process.env.NODE_ENV === 'test';
const LIVE_NAVER_CLIENT_ID = (process.env.NEXT_PUBLIC_NAVER_CLIENT_ID || '').trim();
const HAS_LIVE_NAVER_CLIENT_ID = Boolean(
    LIVE_NAVER_CLIENT_ID
    && LIVE_NAVER_CLIENT_ID !== 'test'
    && !/^(?:approved[-_]local|replace[-_]with|your[-_])/i.test(LIVE_NAVER_CLIENT_ID),
);
const LOCAL_OFFLINE_MAP = shouldUseLocalNaverMapStub({
    isLiveProviderSmoke: process.env.NEXT_PUBLIC_TZUDONG_NAVER_LIVE_PROVIDER_SMOKE === '1',
    isLocalNightly: LOCAL_NIGHTLY,
    isLocalRuntime: process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME === '1',
    hasLiveClientId: HAS_LIVE_NAVER_CLIENT_ID,
});

interface UseNaverMapsOptions {
    /** true면 즉시 로드, false면 수동 로드 (기본값: false - 지연 로딩) */
    autoLoad?: boolean;
    /** 로딩 전략: 'afterInteractive' (즉시 비동기) | 'lazyOnload' (지연 로드) */
    strategy?: 'afterInteractive' | 'lazyOnload';
}

type IdleCallbackHandle = number;
type RequestIdleCallbackLike = (callback: () => void, options?: { timeout: number }) => IdleCallbackHandle;

function installLocalNaverStyleHostFallback() {
    if (typeof window === 'undefined') return;
    const hostname = window.location.hostname;
    if (!isLocalNaverStyleFallbackHost(hostname)) return;
    const flaggedWindow = window as Window & { __tzudongNrbeFallback?: boolean };
    if (flaggedWindow.__tzudongNrbeFallback) return;
    flaggedWindow.__tzudongNrbeFallback = true;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;
        const redirected = rewriteNaverStyleUrlForLocalhost(raw, hostname);
        if (redirected === raw) return nativeFetch(input, init);
        if (typeof input === 'string') return nativeFetch(redirected, init);
        if (input instanceof URL) return nativeFetch(new URL(redirected), init);
        return nativeFetch(new Request(redirected, input), init);
    }) as typeof window.fetch;

    const NativeXHR = window.XMLHttpRequest;
    class LocalNaverStyleXHR extends NativeXHR {
        open(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
            const raw = typeof url === 'string' ? url : url.toString();
            return super.open(method, rewriteNaverStyleUrlForLocalhost(raw, hostname), async ?? true, username, password);
        }
    }
    window.XMLHttpRequest = LocalNaverStyleXHR;

    const patchUrlAccessor = (proto: typeof HTMLScriptElement.prototype | typeof HTMLImageElement.prototype) => {
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
        if (!descriptor?.set || !descriptor.get || (descriptor.set as { __tzudongNrbeFallback?: boolean }).__tzudongNrbeFallback) {
            return;
        }
        const nativeSet = descriptor.set;
        const nativeGet = descriptor.get;
        const patchedSet = function patchedSrc(this: HTMLScriptElement | HTMLImageElement, value: string) {
            nativeSet.call(this, rewriteNaverStyleUrlForLocalhost(String(value), hostname));
        };
        (patchedSet as { __tzudongNrbeFallback?: boolean }).__tzudongNrbeFallback = true;
        Object.defineProperty(proto, 'src', {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: nativeGet,
            set: patchedSet,
        });
    };
    patchUrlAccessor(HTMLScriptElement.prototype);
    patchUrlAccessor(HTMLImageElement.prototype);
}

function hasUsableNaverMaps() {
    if (typeof window === 'undefined') return false;

    const maps = window.naver?.maps;
    return Boolean(
        maps
        && maps.Map
        && maps.LatLng
        && maps.Point
        && maps.Event
    );
}
const EFFECTIVE_SCRIPT_URL = resolveNaverMapScriptUrl({
    clientId: NAVER_MAPS_CONFIG.clientId,
    configuredScriptUrl: process.env.NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL,
    useLocalStub: LOCAL_OFFLINE_MAP,
});
const SHARED_SCRIPT_SELECTOR = LOCAL_OFFLINE_MAP
    ? 'script[data-local-naver-maps="true"]'
    : 'script[data-tzudong-naver-maps="true"], script[src*="oapi.map.naver.com"]';

export function useNaverMaps(options: UseNaverMapsOptions = {}) {
    const { autoLoad = false, strategy = 'afterInteractive' } = options;

    // 초기 상태를 스크립트 로드 여부로 설정 (페이지 전환 시 즉시 감지)
    const [isLoaded, setIsLoaded] = useState(() => {
        return hasUsableNaverMaps();
    });
    const [loadError, setLoadError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const scheduledLoadRef = useRef<(() => void) | null>(null);

    // A retry belongs to the shared provider, not only to the consumer that
    // requested it. Capture script completion for every mounted consumer;
    // remove the subscription when that consumer leaves.
    useEffect(() => {
        const observeScript = (event: Event) => {
            const script = event.target;
            if (!(script instanceof HTMLScriptElement)) return;
            if (!script.matches(SHARED_SCRIPT_SELECTOR)) return;

            scheduledLoadRef.current?.();
            scheduledLoadRef.current = null;
            setIsLoading(false);
            if (event.type === 'load' && hasUsableNaverMaps()) {
                markInitialLoadMilestone('naverSdkReady');
                installLocalNaverStyleHostFallback();
                setIsLoaded(true);
                setLoadError(null);
            } else if (!hasUsableNaverMaps()) {
                markInitialLoadMilestone('naverSdkError');
                setLoadError(new Error(event.type === 'load'
                    ? '네이버 지도 API 초기화 실패'
                    : '네이버 지도 API 로딩 실패 - 네트워크 오류'));
            }
        };
        if (hasUsableNaverMaps()) markInitialLoadMilestone('naverSdkReady');
        document.addEventListener('load', observeScript, true);
        document.addEventListener('error', observeScript, true);
        return () => {
            scheduledLoadRef.current?.();
            scheduledLoadRef.current = null;
            document.removeEventListener('load', observeScript, true);
            document.removeEventListener('error', observeScript, true);
        };
    }, []);

    // 수동으로 스크립트 로드하는 함수
    const load = useCallback(() => {
        // 이미 로드되었거나 로딩 중이면 무시
        if (isLoaded || isLoading || scheduledLoadRef.current) return;

        setLoadError(null);

        // Client ID 검증
        if (!NAVER_MAPS_CONFIG.clientId && !LOCAL_OFFLINE_MAP) {
            markInitialLoadMilestone('naverSdkError');
            setLoadError(new Error("네이버 지도 Client ID가 설정되지 않았습니다."));
            return;
        }

        // 이미 로드되었는지 확인 - window 객체 재확인
        if (hasUsableNaverMaps()) {
            markInitialLoadMilestone('naverSdkReady');
            setIsLoaded(true);
            return;
        }

        // 이미 로딩 중인 스크립트가 있는지 확인
        const existingScript = document.querySelector(SHARED_SCRIPT_SELECTOR);

        if (existingScript) {
            setIsLoading(true);
            return;
        }

        // 스크립트 로드 실행 함수
        const injectScript = () => {
            // Another consumer may have completed or injected the shared SDK
            // while this consumer was waiting for an idle callback.
            if (hasUsableNaverMaps()) {
                setIsLoaded(true);
                setIsLoading(false);
                return;
            }
            if (document.querySelector(SHARED_SCRIPT_SELECTOR)) return;
            installLocalNaverStyleHostFallback();
            setIsLoading(true);
            const script = document.createElement("script");
            script.type = "text/javascript";
            script.dataset.tzudongNaverMaps = "true";
            if (LOCAL_OFFLINE_MAP) script.dataset.localNaverMaps = "true";
            script.src = EFFECTIVE_SCRIPT_URL;
            script.async = true;

            script.onload = () => {
                script.onload = null;
                script.onerror = null;
                installLocalNaverStyleHostFallback();
                if (hasUsableNaverMaps()) {
                    markInitialLoadMilestone('naverSdkReady');
                    setIsLoaded(true);
                    setIsLoading(false);
                    return;
                }
                // A failed live provider must never become a test map. Remove
                // this failed owned script so a user retry can request it again.
                script.remove();
                markInitialLoadMilestone('naverSdkError');
                setLoadError(new Error("네이버 지도 API 초기화 실패"));
                setIsLoading(false);
            };

            script.onerror = () => {
                markInitialLoadMilestone('naverSdkError');
                script.onload = null;
                script.onerror = null;
                script.remove();
                setLoadError(
                    new Error(
                        "네이버 지도 API 스크립트 로드 실패 - Client ID 또는 웹 서비스 URL을 확인해주세요."
                    )
                );
                setIsLoading(false);
            };

            markInitialLoadMilestone('naverSdkRequested');
            document.head.appendChild(script);
        };

        // 전략에 따른 로드 실행
        if (strategy === 'lazyOnload') {
            setIsLoading(true);
            let cancelled = false;
            const run = () => {
                scheduledLoadRef.current = null;
                if (!cancelled) injectScript();
            };
            // 브라우저 유휴 상태일 때 로드하거나 2초 후 로드
            const idleWindow = window as Window & {
                requestIdleCallback?: RequestIdleCallbackLike;
                cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
            };
            if (typeof idleWindow.requestIdleCallback === 'function') {
                let handle: IdleCallbackHandle | undefined;
                scheduledLoadRef.current = () => {
                    cancelled = true;
                    if (handle !== undefined) idleWindow.cancelIdleCallback?.(handle);
                };
                handle = idleWindow.requestIdleCallback(run, { timeout: 2000 });
            } else {
                let handle: number | undefined;
                scheduledLoadRef.current = () => {
                    cancelled = true;
                    if (handle !== undefined) window.clearTimeout(handle);
                };
                handle = window.setTimeout(run, 2000);
            }
        } else {
            // afterInteractive: 즉시 비동기 로드
            injectScript();
        }

    }, [isLoaded, isLoading, strategy]);

    // autoLoad가 true면 로드 시도
    useEffect(() => {
        // After a provider failure, wait for an explicit retry. A loading-state
        // change must not create an unbounded automatic request loop.
        if (autoLoad && !loadError) {
            load();
        }
    }, [autoLoad, load, loadError]);

    return { isLoaded, loadError, isLoading, load };
}
