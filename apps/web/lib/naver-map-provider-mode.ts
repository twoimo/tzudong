type NaverMapProviderModeInput = {
    isLiveProviderSmoke: boolean;
    isLocalNightly: boolean;
    isLocalRuntime: boolean;
    hasLiveClientId?: boolean;
};

const LOCAL_NAVER_STYLE_FALLBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
export const LOCAL_NAVER_MAP_STUB_SCRIPT_URL = '/__local/naver-maps.js';

export function shouldUseLocalNaverMapStub({
    isLiveProviderSmoke,
    isLocalNightly,
    isLocalRuntime,
    hasLiveClientId = false,
}: NaverMapProviderModeInput) {
    if (isLocalNightly) return true;
    if (isLiveProviderSmoke) return false;
    if (isLocalRuntime && hasLiveClientId) return false;
    return isLocalRuntime;
}

export function resolveNaverMapScriptUrl({
    clientId,
    configuredScriptUrl,
    useLocalStub,
}: {
    clientId: string;
    configuredScriptUrl?: string;
    useLocalStub: boolean;
}) {
    if (useLocalStub) return LOCAL_NAVER_MAP_STUB_SCRIPT_URL;

    const configured = configuredScriptUrl?.trim();
    return configured || `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`;
}

export function isLocalNaverStyleFallbackHost(hostname: string) {
    return LOCAL_NAVER_STYLE_FALLBACK_HOSTS.has(hostname);
}

export function rewriteNaverStyleUrlForLocalhost(url: string, hostname: string) {
    if (!isLocalNaverStyleFallbackHost(hostname)) return url;

    return url
        .replace(/^https?:\/\/nrbe\.map\.naver\.net\//, 'https://nrbe.pstatic.net/')
        .replace(/^http:\/\/static\.naver\.net\//, 'https://static.naver.net/');
}
