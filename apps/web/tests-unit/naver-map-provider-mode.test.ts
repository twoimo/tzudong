import { describe, expect, test } from 'bun:test';

import {
    isLocalNaverStyleFallbackHost,
    resolveNaverMapScriptUrl,
    rewriteNaverStyleUrlForLocalhost,
    shouldUseLocalNaverMapStub,
} from '../lib/naver-map-provider-mode';

describe('Naver map provider mode', () => {
    test('uses the deterministic stub for ordinary local and Playwright runtimes', () => {
        expect(shouldUseLocalNaverMapStub({
            isLiveProviderSmoke: false,
            isLocalNightly: false,
            isLocalRuntime: true,
        })).toBe(true);
        expect(shouldUseLocalNaverMapStub({
            isLiveProviderSmoke: true,
            isLocalNightly: false,
            isLocalRuntime: true,
        })).toBe(false);
        expect(shouldUseLocalNaverMapStub({
            isLiveProviderSmoke: false,
            isLocalNightly: false,
            isLocalRuntime: true,
            hasLiveClientId: true,
        })).toBe(false);
        expect(shouldUseLocalNaverMapStub({
            isLiveProviderSmoke: true,
            isLocalNightly: true,
            isLocalRuntime: true,
        })).toBe(true);
        expect(shouldUseLocalNaverMapStub({
            isLiveProviderSmoke: false,
            isLocalNightly: false,
            isLocalRuntime: false,
        })).toBe(false);
    });

    test('pins the checked-in stub path when local mode wins over hostile inherited input', () => {
        expect(resolveNaverMapScriptUrl({
            clientId: '',
            configuredScriptUrl: 'https://hostile.invalid/naver-maps.js',
            useLocalStub: true,
        })).toBe('/__local/naver-maps.js');
        expect(resolveNaverMapScriptUrl({
            clientId: 'live-client-id',
            configuredScriptUrl: '  ',
            useLocalStub: false,
        })).toBe('https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=live-client-id');
    });

    test('rewrites blocked style hosts only on admitted loopback hostnames', () => {
        expect(isLocalNaverStyleFallbackHost('localhost')).toBe(true);
        expect(isLocalNaverStyleFallbackHost('127.0.0.1')).toBe(true);
        expect(isLocalNaverStyleFallbackHost('tzudong.example')).toBe(false);

        expect(rewriteNaverStyleUrlForLocalhost(
            'http://static.naver.net/maps/example.png',
            'localhost',
        )).toBe('https://static.naver.net/maps/example.png');
        expect(rewriteNaverStyleUrlForLocalhost(
            'https://nrbe.map.naver.net/styles/example.json',
            '127.0.0.1',
        )).toBe('https://nrbe.pstatic.net/styles/example.json');
        expect(rewriteNaverStyleUrlForLocalhost(
            'http://static.naver.net/maps/example.png',
            'tzudong.example',
        )).toBe('http://static.naver.net/maps/example.png');
        expect(rewriteNaverStyleUrlForLocalhost(
            'http://static.naver.net.evil.invalid/maps/example.png',
            'localhost',
        )).toBe('http://static.naver.net.evil.invalid/maps/example.png');
    });
});
