'use client';

import { useEffect, useState, useCallback } from "react";
import { NAVER_MAPS_CONFIG } from "@/config/maps";
import {
    isLocalNaverStyleFallbackHost,
    LOCAL_NAVER_MAP_STUB_SCRIPT_URL,
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
function loadLocalNaverStubFallback(
    setIsLoaded: (value: boolean) => void,
    setIsLoading: (value: boolean) => void,
    setLoadError: (value: Error | null) => void,
) {
    if (hasUsableNaverMaps()) {
        setIsLoaded(true);
        setIsLoading(false);
        return;
    }

    const existingStub = document.querySelector('script[data-local-naver-maps="true"]');
    const attachStub = (script: HTMLScriptElement) => {
        script.addEventListener('load', () => {
            if (hasUsableNaverMaps()) {
                setIsLoaded(true);
                setLoadError(null);
            } else {
                setLoadError(new Error('네이버 지도 API 초기화 실패'));
            }
            setIsLoading(false);
        });
        script.addEventListener('error', () => {
            setLoadError(new Error('네이버 지도 API 로딩 실패 - 네트워크 오류'));
            setIsLoading(false);
        });
    };

    if (existingStub instanceof HTMLScriptElement) {
        attachStub(existingStub);
        return;
    }

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.dataset.localNaverMaps = 'true';
    script.src = LOCAL_NAVER_MAP_STUB_SCRIPT_URL;
    script.async = true;
    attachStub(script);
    document.head.appendChild(script);
}

const EFFECTIVE_SCRIPT_URL = resolveNaverMapScriptUrl({
    clientId: NAVER_MAPS_CONFIG.clientId,
    configuredScriptUrl: process.env.NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL,
    useLocalStub: LOCAL_OFFLINE_MAP,
});

export function useNaverMaps(options: UseNaverMapsOptions = {}) {
    const { autoLoad = false, strategy = 'afterInteractive' } = options;

    // 초기 상태를 스크립트 로드 여부로 설정 (페이지 전환 시 즉시 감지)
    const [isLoaded, setIsLoaded] = useState(() => {
        return hasUsableNaverMaps();
    });
    const [loadError, setLoadError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // 수동으로 스크립트 로드하는 함수
    const load = useCallback(() => {
        // 이미 로드되었거나 로딩 중이면 무시
        if (isLoaded || isLoading) return;

        // Client ID 검증
        if (!NAVER_MAPS_CONFIG.clientId && !LOCAL_OFFLINE_MAP) {
            setLoadError(new Error("네이버 지도 Client ID가 설정되지 않았습니다."));
            return;
        }

        // 이미 로드되었는지 확인 - window 객체 재확인
        if (hasUsableNaverMaps()) {
            setIsLoaded(true);
            return;
        }

        // 이미 로딩 중인 스크립트가 있는지 확인
        const existingScript = document.querySelector(
            LOCAL_OFFLINE_MAP
                ? 'script[data-local-naver-maps="true"]'
                : 'script[src*="oapi.map.naver.com"]'
        );

        if (existingScript) {
            setIsLoading(true);
            existingScript.addEventListener("load", () => {
                installLocalNaverStyleHostFallback();
                if (hasUsableNaverMaps()) {
                    setIsLoaded(true);
                    setIsLoading(false);
                } else {
                    setLoadError(new Error("네이버 지도 API 초기화 실패"));
                    setIsLoading(false);
                }
            });
            existingScript.addEventListener("error", () => {
                setLoadError(new Error("네이버 지도 API 로딩 실패 - 네트워크 오류"));
                setIsLoading(false);
            });
            return;
        }

        // 스크립트 로드 실행 함수
        const injectScript = () => {
            installLocalNaverStyleHostFallback();
            setIsLoading(true);
            const script = document.createElement("script");
            script.type = "text/javascript";
            if (LOCAL_OFFLINE_MAP) script.dataset.localNaverMaps = "true";
            script.src = EFFECTIVE_SCRIPT_URL;
            script.async = true;

            script.onload = () => {
                installLocalNaverStyleHostFallback();
                if (hasUsableNaverMaps()) {
                    setIsLoaded(true);
                    setIsLoading(false);
                    return;
                }
                if (!LOCAL_OFFLINE_MAP) {
                    loadLocalNaverStubFallback(setIsLoaded, setIsLoading, setLoadError);
                    return;
                }
                setLoadError(new Error("네이버 지도 API 초기화 실패"));
                setIsLoading(false);
            };

            script.onerror = () => {
                if (!LOCAL_OFFLINE_MAP) {
                    loadLocalNaverStubFallback(setIsLoaded, setIsLoading, setLoadError);
                    return;
                }
                setLoadError(
                    new Error(
                        "네이버 지도 API 스크립트 로드 실패 - Client ID 또는 웹 서비스 URL을 확인해주세요."
                    )
                );
                setIsLoading(false);
            };

            document.head.appendChild(script);
        };

        // 전략에 따른 로드 실행
        if (strategy === 'lazyOnload') {
            // 브라우저 유휴 상태일 때 로드하거나 2초 후 로드
            const idleWindow = window as Window & {
                requestIdleCallback?: RequestIdleCallbackLike;
            };
            if (typeof idleWindow.requestIdleCallback === 'function') {
                idleWindow.requestIdleCallback(() => injectScript(), { timeout: 2000 });
            } else {
                setTimeout(injectScript, 2000);
            }
        } else {
            // afterInteractive: 즉시 비동기 로드
            injectScript();
        }

    }, [isLoaded, isLoading, strategy]);

    // autoLoad가 true면 로드 시도
    useEffect(() => {
        if (autoLoad) {
            load();
        }
    }, [autoLoad, load]);

    return { isLoaded, loadError, isLoading, load };
}
