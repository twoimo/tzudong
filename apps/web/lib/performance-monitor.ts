/**
 * 성능 모니터링 유틸리티
 * 
 * 개발 환경에서 마커 렌더링, 클러스터 계산 등의
 * 성능을 추적하고 병목 지점을 식별합니다.
 */

export class PerformanceMonitor {
    private metrics: Map<string, number[]> = new Map();
    private enabled: boolean;

    constructor(enabled: boolean = process.env.NODE_ENV === 'development') {
        this.enabled = enabled;
    }

    /**
     * 측정 시작
     * 
     * @param label 측정 라벨
     */
    public startMeasure(label: string): void {
        if (!this.enabled) return;
        performance.mark(`${label}-start`);
    }

    /**
     * 측정 종료 및 기록
     * 
     * @param label 측정 라벨
     */
    public endMeasure(label: string): void {
        if (!this.enabled) return;

        performance.mark(`${label}-end`);
        performance.measure(label, `${label}-start`, `${label}-end`);

        const measure = performance.getEntriesByName(label)[0];
        if (!measure) return;

        const history = this.metrics.get(label) || [];
        history.push(measure.duration);

        // 최근 100개만 유지
        if (history.length > 100) {
            history.shift();
        }

        this.metrics.set(label, history);

        performance.clearMarks(`${label}-start`);
        performance.clearMarks(`${label}-end`);
        performance.clearMeasures(label);
    }

    /**
     * 평균 소요 시간 가져오기
     * 
     * @param label 측정 라벨
     * @returns 평균 시간 (ms)
     */
    public getAverageDuration(label: string): number {
        const history = this.metrics.get(label) || [];
        if (history.length === 0) return 0;

        return history.reduce((a, b) => a + b, 0) / history.length;
    }

    /**
     * 최근 소요 시간 가져오기
     * 
     * @param label 측정 라벨
     * @returns 최근 시간 (ms)
     */
    public getLastDuration(label: string): number {
        const history = this.metrics.get(label) || [];
        return history[history.length - 1] || 0;
    }

    /**
     * 리포트 출력
     */
    public report(): void {
        if (!this.enabled) return;

        const data = Array.from(this.metrics.entries()).map(([label, history]) => ({
            Operation: label,
            'Avg (ms)': this.getAverageDuration(label).toFixed(2),
            'Last (ms)': history[history.length - 1].toFixed(2),
            'Min (ms)': Math.min(...history).toFixed(2),
            'Max (ms)': Math.max(...history).toFixed(2),
            Count: history.length,
        }));

        console.group('🚀 Performance Report');
        console.table(data);
        console.groupEnd();
    }

    /**
     * 특정 라벨 데이터 초기화
     * 
     * @param label 측정 라벨 (없으면 전체 초기화)
     */
    public reset(label?: string): void {
        if (label) {
            this.metrics.delete(label);
        } else {
            this.metrics.clear();
        }
    }

    /**
     * 자동 리포트 시작 (주기적 출력)
     * 
     * @param intervalMs 리포트 주기 (ms)
     * @returns 인터벌 ID (정리용)
     */
    public startAutoReport(intervalMs: number = 5000): NodeJS.Timeout {
        return setInterval(() => this.report(), intervalMs);
    }
}

/**
 * 싱글톤 인스턴스
 */
export const perfMonitor = new PerformanceMonitor();
