/**
 * 디바이스 성능 감지 유틸리티
 * 
 * 디바이스 하드웨어 사양을 감지하여 성능 등급을 반환합니다.
 * 클러스터링 최적화, 렌더링 품질 조정 등에 활용됩니다.
 */
import { debugLog } from '@/lib/debug-log';

/**
 * 디바이스 성능 등급
 */
export type DevicePerformanceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * 성능 등급별 클러스터 옵션
 */
export interface PerformanceClusterOptions {
    maxZoom: number;
    radius: number;
    minPoints: number;
}

/**
 * Navigator 인터페이스 확장 (deviceMemory, hardwareConcurrency)
 */
interface NavigatorWithMemory extends Navigator {
    deviceMemory?: number;
}

/**
 * 저사양 디바이스 User-Agent 패턴
 * Chrome DevTools 기본 디바이스 목록 기반
 */
const LOW_END_DEVICE_PATTERNS = [
    // BlackBerry
    /BlackBerry\s?Z30/i,
    /PlayBook/i,
    // Samsung 구형
    /SM-N900|GT-N7100|SM-G730|GT-I9300|SM-G900/i, // Galaxy Note 3, S III 등
    // Nexus
    /Nexus\s?(4|5|6|7|10)/i,
    // Nokia
    /Lumia\s?(520|630|930|950)/i,
    /Nokia\s?N9/i,
    // LG
    /LG-D160|LG-D320|Optimus/i,
    // Motorola
    /Moto\s?G|XT1068|XT1032/i,
    // Kindle
    /Kindle|KFTT|KFOT/i,
];

/**
 * User-Agent에서 저사양 디바이스 감지
 */
const isLowEndDeviceByUA = (): boolean => {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent;
    return LOW_END_DEVICE_PATTERNS.some(pattern => pattern.test(ua));
};

/**
 * 디바이스 성능 등급 감지
 * 
 * 우선순위:
 * 1. User-Agent 기반 저사양 디바이스 감지
 * 2. navigator.deviceMemory (RAM)
 * 3. navigator.hardwareConcurrency (CPU 코어)
 * 4. 화면 크기 기반 추정
 * 
 * @returns 성능 등급 (LOW, MEDIUM, HIGH)
 */
export const getDevicePerformanceLevel = (): DevicePerformanceLevel => {
    // SSR 환경 처리
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return 'MEDIUM';
    }

    // 1. UA 기반 저사양 디바이스 감지
    if (isLowEndDeviceByUA()) {
        if (process.env.NODE_ENV === 'development') {
            debugLog('[DevicePerformance] LOW - User-Agent 패턴 매칭');
        }
        return 'LOW';
    }

    const nav = navigator as NavigatorWithMemory;

    // 2. deviceMemory API (GB 단위)
    const memory = nav.deviceMemory;

    // 3. hardwareConcurrency (CPU 코어 수)
    const cores = nav.hardwareConcurrency;

    // 4. 성능 등급 결정
    let level: DevicePerformanceLevel;

    if (memory !== undefined) {
        if (memory <= 2) {
            level = 'LOW';
        } else if (memory <= 4) {
            level = 'MEDIUM';
        } else {
            level = 'HIGH';
        }
    } else if (cores !== undefined) {
        if (cores <= 2) {
            level = 'LOW';
        } else if (cores <= 4) {
            level = 'MEDIUM';
        } else {
            level = 'HIGH';
        }
    } else {
        // API 미지원 시 화면 크기로 추정
        const screenWidth = window.screen.width;
        const pixelRatio = window.devicePixelRatio || 1;
        const effectiveWidth = screenWidth * pixelRatio;

        if (effectiveWidth <= 720) {
            level = 'LOW';
        } else if (effectiveWidth <= 1440) {
            level = 'MEDIUM';
        } else {
            level = 'HIGH';
        }
    }

    if (process.env.NODE_ENV === 'development') {
        debugLog(`[DevicePerformance] ${level} - Memory: ${memory ?? 'N/A'}GB, Cores: ${cores ?? 'N/A'}`);
    }

    return level;
};

/**
 * 성능 등급별 클러스터 옵션 반환
 * 
 * @param level 성능 등급 (undefined 시 자동 감지)
 * @returns 클러스터 옵션
 */
export const getPerformanceBasedClusterOptions = (
    level?: DevicePerformanceLevel
): PerformanceClusterOptions => {
    const performanceLevel = level ?? getDevicePerformanceLevel();

    switch (performanceLevel) {
        case 'LOW':
            return {
                maxZoom: 14,   // 줌 15부터 개별 마커
                radius: 60,   // 더 넓은 클러스터링
                minPoints: 3, // 최소 3개부터 클러스터
            };
        case 'MEDIUM':
            return {
                maxZoom: 13,  // 줌 14부터 개별 마커
                radius: 50,   // 균형
                minPoints: 2,
            };
        case 'HIGH':
        default:
            return {
                maxZoom: 12,  // 줌 13부터 개별 마커
                radius: 40,   // 정밀한 클러스터링
                minPoints: 2,
            };
    }
};

/**
 * 캐시된 성능 등급 (런타임 중 변하지 않음)
 */
let cachedPerformanceLevel: DevicePerformanceLevel | null = null;

/**
 * 캐시된 성능 등급 가져오기 (싱글톤)
 */
export const getCachedPerformanceLevel = (): DevicePerformanceLevel => {
    if (cachedPerformanceLevel === null) {
        cachedPerformanceLevel = getDevicePerformanceLevel();
    }
    return cachedPerformanceLevel;
};

/**
 * 캐시 초기화 (테스트용)
 */
export const resetPerformanceCache = (): void => {
    cachedPerformanceLevel = null;
};
