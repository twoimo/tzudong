'use client';

import { useMemo, useCallback } from 'react';
import { useDevicePerformance, PerformanceTier } from './useDevicePerformance';
import { useDeviceType } from './useDeviceType';

/**
 * 지도 최적화 설정
 */
export interface MapOptimizationSettings {
    // 클러스터링 설정
    /** 클러스터 반경 (픽셀) - 줌 레벨에 따라 동적 조정 */
    getClusterRadius: (zoom: number) => number;
    /** 클러스터 최소 포인트 수 */
    clusterMinPoints: number;
    /** 클러스터 애니메이션 활성화 여부 */
    clusterAnimationEnabled: boolean;
    /** 클러스터 애니메이션 주기 (ms), 0이면 비활성화 */
    clusterAnimationInterval: number;

    // 이벤트 처리 설정
    /** idle 이벤트 디바운스 시간 (ms) */
    idleDebounceMs: number;
    /** 지도 업데이트 디바운스 시간 (ms) */
    mapUpdateDebounceMs: number;

    // 마커 렌더링 설정
    /** 가시영역 필터링 활성화 여부 */
    viewportFilterEnabled: boolean;
    /** 마커 배치 처리 크기 (한 프레임에 처리할 마커 수) */
    markerBatchSize: number;

    // 애니메이션 설정
    /** 부드러운 팬 애니메이션 활성화 여부 */
    enableSmoothPan: boolean;
    /** 지도 이동 애니메이션 duration (ms) */
    panDuration: number;
    /** morph 애니메이션 duration (ms) */
    morphDuration: number;

    // 바텀시트 설정
    /** 바텀시트 GPU 가속 사용 여부 (transform 방식) */
    useGpuAcceleratedBottomSheet: boolean;

    // 디버깅
    /** 성능 로깅 활성화 여부 */
    performanceLoggingEnabled: boolean;
}

/**
 * 티어별 기본 클러스터 반경 (줌 7 기준)
 */
const BASE_CLUSTER_RADIUS: Record<PerformanceTier, number> = {
    HIGH: 40,
    MEDIUM: 60,
    LOW: 80,
};

/**
 * 티어별 최소 클러스터 반경 (고줌에서)
 */
const MIN_CLUSTER_RADIUS: Record<PerformanceTier, number> = {
    HIGH: 30,
    MEDIUM: 40,
    LOW: 50,
};

/**
 * 줌 레벨에 따른 동적 클러스터 반경 계산
 * 
 * - 낮은 줌 (전국 뷰): 반경을 적게 → 더 많은 마커/클러스터 표시
 * - 높은 줌 (지역 뷰): 반경을 크게 → 개별 마커 표시
 * 
 * @param zoom 현재 줌 레벨
 * @param tier 성능 티어
 * @returns 클러스터 반경 (픽셀)
 */
function calculateClusterRadius(zoom: number, tier: PerformanceTier): number {
    const baseRadius = BASE_CLUSTER_RADIUS[tier];
    const minRadius = MIN_CLUSTER_RADIUS[tier];

    // 전국 뷰 (줌 7 이하): 마커가 더 많이 보이도록 반경 축소
    // 낮은 줌에서는 클러스터가 덜 뭉치도록
    if (zoom <= 7) {
        // 줌 7에서 기본 반경의 60%
        // 줌 6에서 기본 반경의 50%
        // 줌 5에서 기본 반경의 40%
        const factor = Math.max(0.4, 0.6 - (7 - zoom) * 0.1);
        return Math.round(baseRadius * factor);
    }

    // 중간 줌 (8-12): 기본 반경
    if (zoom <= 12) {
        return baseRadius;
    }

    // 높은 줌 (13+): 반경 증가하여 클러스터링 감소
    // 개별 마커가 더 많이 보이도록
    const factor = 1 + (zoom - 12) * 0.2;
    return Math.round(Math.max(baseRadius * factor, minRadius));
}

/**
 * 티어별 지도 최적화 설정 (순수 데이터, 함수 제외)
 */
type OptimizationPreset = Omit<MapOptimizationSettings, 'getClusterRadius'>;

const OPTIMIZATION_PRESETS: Record<PerformanceTier, OptimizationPreset> = {
    HIGH: {
        clusterMinPoints: 5,
        clusterAnimationEnabled: true,
        clusterAnimationInterval: 5000,
        idleDebounceMs: 150,
        mapUpdateDebounceMs: 150,
        viewportFilterEnabled: true,
        markerBatchSize: 100,
        enableSmoothPan: true,
        panDuration: 300,
        morphDuration: 400,
        useGpuAcceleratedBottomSheet: false, // HIGH는 리플로우도 감당 가능
        performanceLoggingEnabled: false,
    },
    MEDIUM: {
        clusterMinPoints: 3,
        clusterAnimationEnabled: false, // 애니메이션 비활성화
        clusterAnimationInterval: 0,
        idleDebounceMs: 250, // 디바운스 증가
        mapUpdateDebounceMs: 200,
        viewportFilterEnabled: true,
        markerBatchSize: 50, // 배치 크기 감소
        enableSmoothPan: true,
        panDuration: 250, // 애니메이션 속도 증가
        morphDuration: 350,
        useGpuAcceleratedBottomSheet: true, // GPU 가속 사용
        performanceLoggingEnabled: false,
    },
    LOW: {
        clusterMinPoints: 2, // 더 적극적인 클러스터링
        clusterAnimationEnabled: false,
        clusterAnimationInterval: 0,
        idleDebounceMs: 400, // 디바운스 크게 증가
        mapUpdateDebounceMs: 300,
        viewportFilterEnabled: true,
        markerBatchSize: 20, // 배치 크기 최소화
        enableSmoothPan: false, // 부드러운 팬 비활성화
        panDuration: 150, // 최소 애니메이션
        morphDuration: 200,
        useGpuAcceleratedBottomSheet: true,
        performanceLoggingEnabled: false,
    },
};

/**
 * 디바이스 성능에 따른 지도 최적화 설정을 반환하는 훅
 * 
 * [OPTIMIZATION] useCallback으로 getClusterRadius 함수 참조 안정화
 * - 의존성에 tier만 있어도 함수 참조가 유지됨
 * - 불필요한 useEffect 재실행 방지
 * 
 * @example
 * const { 
 *     getClusterRadius, 
 *     clusterAnimationEnabled,
 *     idleDebounceMs 
 * } = useMapOptimization();
 * 
 * // 줌 레벨에 따른 동적 클러스터 반경
 * const radius = getClusterRadius(currentZoom);
 */
export function useMapOptimization(): MapOptimizationSettings {
    const { tier } = useDevicePerformance();
    const { isMobileOrTablet } = useDeviceType();

    // [OPTIMIZATION] getClusterRadius를 useCallback으로 분리하여 참조 안정성 보장
    const getClusterRadius = useCallback(
        (zoom: number) => calculateClusterRadius(zoom, tier),
        [tier] // tier가 변경될 때만 새 함수 생성
    );

    // [OPTIMIZATION] 나머지 설정은 useMemo로 메모이제이션
    const settings = useMemo((): MapOptimizationSettings => {
        const preset = OPTIMIZATION_PRESETS[tier];

        // 모바일/태블릿에서는 추가 최적화 적용
        const adjustedPreset: OptimizationPreset = isMobileOrTablet ? {
            ...preset,
            // 모바일에서는 디바운스 약간 증가
            idleDebounceMs: Math.max(preset.idleDebounceMs, 200),
            // 모바일에서는 항상 GPU 가속 바텀시트 사용
            useGpuAcceleratedBottomSheet: true,
        } : preset;

        return {
            ...adjustedPreset,
            getClusterRadius, // 안정적인 함수 참조
        };
    }, [tier, isMobileOrTablet, getClusterRadius]);

    return settings;
}

/**
 * 클러스터 반경만 반환하는 간단한 훅
 */
export function useClusterRadius(): (zoom: number) => number {
    const { getClusterRadius } = useMapOptimization();
    return getClusterRadius;
}

