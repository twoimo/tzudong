'use client';

import { useMemo } from 'react';

/**
 * 디바이스 성능 티어
 * - HIGH: iPhone 14 Pro+, iPad Pro, Galaxy S23+, Pixel 7+ (6GB+ RAM, 8코어+)
 * - MEDIUM: iPhone 12/13, iPad Air, Galaxy S21, Pixel 5 (4-6GB RAM, 6코어)
 * - LOW: iPhone SE, iPhone 11 이하, Galaxy A 시리즈, 저가 Android (<4GB RAM)
 */
export type PerformanceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DevicePerformance {
    /** 성능 티어 */
    tier: PerformanceTier;
    /** CPU 논리 코어 수 */
    cpuCores: number;
    /** RAM 용량 (GB), Chrome/Edge에서만 사용 가능, Safari는 null */
    memoryGB: number | null;
    /** 감지된 디바이스 모델 (예: "iPhone 12", "Galaxy S21") */
    deviceModel: string | null;
    /** 저성능 디바이스 여부 (LOW 티어) */
    isLowEndDevice: boolean;
    /** 고성능 디바이스 여부 (HIGH 티어) */
    isHighEndDevice: boolean;
}

/**
 * iPhone 모델별 성능 티어 매핑
 * User-Agent에서 iPhone 버전 추출 후 매핑
 */
const IPHONE_TIER_MAP: Record<string, PerformanceTier> = {
    // LOW 티어 (A13 이하, 4GB 미만)
    'iPhone SE': 'LOW',
    'iPhone 6': 'LOW',
    'iPhone 7': 'LOW',
    'iPhone 8': 'LOW',
    'iPhone X': 'LOW',
    'iPhone XR': 'LOW',
    'iPhone XS': 'LOW',
    'iPhone 11': 'LOW',

    // MEDIUM 티어 (A14-A15, 4-6GB)
    'iPhone 12': 'MEDIUM',
    'iPhone 12 mini': 'MEDIUM',
    'iPhone 12 Pro': 'MEDIUM',
    'iPhone 12 Pro Max': 'MEDIUM',
    'iPhone 13': 'MEDIUM',
    'iPhone 13 mini': 'MEDIUM',
    'iPhone 13 Pro': 'MEDIUM',
    'iPhone 13 Pro Max': 'MEDIUM',
    'iPhone 14': 'MEDIUM',
    'iPhone 14 Plus': 'MEDIUM',

    // HIGH 티어 (A16-A17 Pro, 6GB+)
    'iPhone 14 Pro': 'HIGH',
    'iPhone 14 Pro Max': 'HIGH',
    'iPhone 15': 'HIGH',
    'iPhone 15 Plus': 'HIGH',
    'iPhone 15 Pro': 'HIGH',
    'iPhone 15 Pro Max': 'HIGH',
    'iPhone 16': 'HIGH',
    'iPhone 16 Plus': 'HIGH',
    'iPhone 16 Pro': 'HIGH',
    'iPhone 16 Pro Max': 'HIGH',
};

/**
 * iPad 모델별 성능 티어 매핑
 */
const IPAD_TIER_MAP: Record<string, PerformanceTier> = {
    'iPad': 'MEDIUM',
    'iPad mini': 'MEDIUM',
    'iPad Air': 'MEDIUM',
    'iPad Pro': 'HIGH',
};

/**
 * User-Agent에서 디바이스 모델 추출
 */
function detectDeviceModel(userAgent: string): string | null {
    // iOS 디바이스 (iPhone/iPad)
    // iOS Safari는 정확한 모델을 노출하지 않음, 대신 iOS 버전으로 추정
    if (/iPhone/.test(userAgent)) {
        // iOS 버전으로 iPhone 세대 추정
        const iosVersionMatch = userAgent.match(/OS (\d+)_/);
        if (iosVersionMatch) {
            const iosVersion = parseInt(iosVersionMatch[1], 10);
            // iOS 18+ → iPhone 16 시리즈 (또는 최신)
            if (iosVersion >= 18) return 'iPhone 15'; // 최신 추정
            // iOS 17 → iPhone 14/15 시리즈
            if (iosVersion >= 17) return 'iPhone 14 Pro';
            // iOS 16 → iPhone 13/14 시리즈
            if (iosVersion >= 16) return 'iPhone 13';
            // iOS 15 → iPhone 12/13 시리즈
            if (iosVersion >= 15) return 'iPhone 12';
            // iOS 14 이하 → 구형 기기
            return 'iPhone 11';
        }
        return 'iPhone 12'; // 기본값
    }

    if (/iPad/.test(userAgent)) {
        if (/iPad Pro/.test(userAgent)) return 'iPad Pro';
        if (/iPad Air/.test(userAgent)) return 'iPad Air';
        if (/iPad mini/.test(userAgent)) return 'iPad mini';
        return 'iPad';
    }

    // Samsung Galaxy
    const galaxyMatch = userAgent.match(/SM-([A-Z])(\d{3})/);
    if (galaxyMatch) {
        const series = galaxyMatch[1];
        const model = parseInt(galaxyMatch[2], 10);

        // S 시리즈 (플래그십)
        if (series === 'S' || series === 'G') {
            if (model >= 900) return 'Galaxy S23'; // HIGH
            if (model >= 800) return 'Galaxy S21'; // MEDIUM
            return 'Galaxy S20'; // MEDIUM
        }
        // A 시리즈 (중저가)
        if (series === 'A') {
            if (model >= 50) return 'Galaxy A53'; // MEDIUM
            return 'Galaxy A33'; // LOW
        }
    }

    // Google Pixel
    const pixelMatch = userAgent.match(/Pixel (\d+)/);
    if (pixelMatch) {
        const pixelVersion = parseInt(pixelMatch[1], 10);
        if (pixelVersion >= 7) return 'Pixel 7'; // HIGH
        if (pixelVersion >= 5) return 'Pixel 5'; // MEDIUM
        return 'Pixel 4'; // LOW
    }

    return null;
}

/**
 * 디바이스 모델에서 성능 티어 결정
 */
function getTierFromModel(model: string | null): PerformanceTier | null {
    if (!model) return null;

    // iPhone 매핑
    for (const [key, tier] of Object.entries(IPHONE_TIER_MAP)) {
        if (model.includes(key)) return tier;
    }

    // iPad 매핑
    for (const [key, tier] of Object.entries(IPAD_TIER_MAP)) {
        if (model.includes(key)) return tier;
    }

    // Galaxy/Pixel 매핑
    if (model.includes('Galaxy S23') || model.includes('Galaxy S24')) return 'HIGH';
    if (model.includes('Galaxy S2') || model.includes('Galaxy A5')) return 'MEDIUM';
    if (model.includes('Galaxy A3')) return 'LOW';
    if (model.includes('Pixel 7') || model.includes('Pixel 8')) return 'HIGH';
    if (model.includes('Pixel 5') || model.includes('Pixel 6')) return 'MEDIUM';
    if (model.includes('Pixel 4') || model.includes('Pixel 3')) return 'LOW';

    return null;
}

/**
 * CPU 코어 수와 메모리로 성능 티어 추정
 */
function getTierFromHardware(cpuCores: number, memoryGB: number | null): PerformanceTier {
    // 메모리 기반 (Chrome/Edge)
    if (memoryGB !== null) {
        if (memoryGB >= 6) return 'HIGH';
        if (memoryGB >= 4) return 'MEDIUM';
        return 'LOW';
    }

    // CPU 코어 기반 (Safari 등 메모리 API 미지원)
    if (cpuCores >= 8) return 'HIGH';
    if (cpuCores >= 4) return 'MEDIUM';
    return 'LOW';
}

/**
 * [OPTIMIZATION] 디바이스 성능 정보를 한 번만 계산하는 헬퍼 함수
 * SSR에서는 기본값 반환, 브라우저에서는 즉시 계산
 */
function calculateDevicePerformance(): DevicePerformance {
    // SSR 환경
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return {
            tier: 'MEDIUM',
            cpuCores: 4,
            memoryGB: null,
            deviceModel: null,
            isLowEndDevice: false,
            isHighEndDevice: false,
        };
    }

    // 브라우저 환경 - 즉시 계산
    const userAgent = navigator.userAgent;
    const cpuCores = navigator.hardwareConcurrency || 4;
    const memoryGB = (navigator as any).deviceMemory ?? null;
    const deviceModel = detectDeviceModel(userAgent);

    // 1순위: 디바이스 모델 기반 티어
    let tier = getTierFromModel(deviceModel);

    // 2순위: 하드웨어 스펙 기반 티어
    if (!tier) {
        tier = getTierFromHardware(cpuCores, memoryGB);
    }

    return {
        tier,
        cpuCores,
        memoryGB,
        deviceModel,
        isLowEndDevice: tier === 'LOW',
        isHighEndDevice: tier === 'HIGH',
    };
}

/**
 * [OPTIMIZATION] 계산된 성능 정보를 캐싱하여 여러 컴포넌트에서 재사용
 * 모듈 레벨 캐시로 중복 계산 방지
 */
let cachedPerformance: DevicePerformance | null = null;

function getOrCalculatePerformance(): DevicePerformance {
    if (cachedPerformance === null) {
        cachedPerformance = calculateDevicePerformance();
    }
    return cachedPerformance;
}

/**
 * 디바이스 성능 티어를 감지하는 훅
 * 
 * [OPTIMIZATION] 
 * - 초기 렌더링에서 바로 올바른 성능 티어 사용
 * - useEffect 없이 동기적 계산으로 리렌더링 제거
 * - 모듈 레벨 캐시로 중복 계산 방지
 * 
 * @example
 * const { tier, isLowEndDevice } = useDevicePerformance();
 * 
 * if (isLowEndDevice) {
 *     // 애니메이션 비활성화
 * }
 */
export function useDevicePerformance(): DevicePerformance {
    // [OPTIMIZATION] useMemo 대신 모듈 레벨 캐시 사용
    // - useState/useEffect 없이 동기적 반환
    // - 여러 컴포넌트에서 호출해도 1회만 계산
    const performance = useMemo(() => getOrCalculatePerformance(), []);

    return performance;
}

/**
 * 성능 티어만 반환하는 간단한 훅
 */
export function usePerformanceTier(): PerformanceTier {
    const { tier } = useDevicePerformance();
    return tier;
}

