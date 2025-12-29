/**
 * 마커 풀링 (Object Pool) 시스템
 * 
 * 마커 객체를 재사용하여 생성/삭제 오버헤드를 제거하고
 * 가비지 컬렉션 부담을 현저히 감소시킵니다.
 * 
 * @example
 * const pool = MarkerPool.getInstance();
 * const marker = pool.acquire('restaurant-123', position, icon);
 * // ... 사용 후
 * pool.release('restaurant-123');
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 싱글톤 마커 풀 클래스
 */
export class MarkerPool {
    private static instance: MarkerPool | null = null;

    /** 사용 가능한 마커 풀 */
    private pool: any[] = [];

    /** 현재 활성화된 마커 맵 (ID → Marker) */
    private active: Map<string, any> = new Map();

    /** 풀 최대 크기 (메모리 제한) */
    private readonly MAX_POOL_SIZE = 1000;

    /** 통계 (디버깅용) */
    private stats = {
        created: 0,
        reused: 0,
        released: 0,
    };

    private constructor() {
        // 싱글톤 패턴
    }

    /**
     * 싱글톤 인스턴스 가져오기
     */
    public static getInstance(): MarkerPool {
        if (!MarkerPool.instance) {
            MarkerPool.instance = new MarkerPool();
        }
        return MarkerPool.instance;
    }

    /**
     * 마커 획득 (풀에서 재사용 or 새로 생성)
     * 
     * @param id 마커 고유 ID (레스토랑 ID 등)
     * @param position 마커 위치
     * @param icon 마커 아이콘
     * @param map 지도 인스턴스
     * @returns 마커 객체
     */
    public acquire(
        id: string,
        position: any,
        icon: any,
        map: any
    ): any {
        // 이미 활성화된 마커가 있으면 반환
        if (this.active.has(id)) {
            const existingMarker = this.active.get(id)!;
            // 위치와 아이콘 업데이트
            existingMarker.setPosition(position);
            existingMarker.setIcon(icon);
            if (existingMarker.getMap() !== map) {
                existingMarker.setMap(map);
            }
            return existingMarker;
        }

        let marker: any;

        // 풀에서 재사용 가능한 마커 가져오기
        if (this.pool.length > 0) {
            marker = this.pool.pop()!;
            marker.setPosition(position);
            marker.setIcon(icon);
            marker.setMap(map);
            this.stats.reused++;
        } else {
            // 새 마커 생성
            marker = new window.naver.maps.Marker({
                position,
                icon,
                map,
            });
            this.stats.created++;
        }

        this.active.set(id, marker);
        return marker;
    }

    /**
     * 마커 반환 (풀로 돌려보내기)
     * 
     * @param id 마커 ID
     */
    public release(id: string): void {
        const marker = this.active.get(id);
        if (!marker) return;

        // 지도에서 제거
        marker.setMap(null);

        // 풀 크기 제한 체크
        if (this.pool.length < this.MAX_POOL_SIZE) {
            this.pool.push(marker);
        } else {
            // 풀이 가득 차면 마커 완전 삭제
            // Naver Maps API에는 명시적 destroy가 없으므로 참조만 제거
        }

        this.active.delete(id);
        this.stats.released++;
    }

    /**
     * 여러 마커 한번에 반환
     * 
     * @param ids 마커 ID 배열
     */
    public releaseMultiple(ids: string[]): void {
        ids.forEach((id) => this.release(id));
    }

    /**
     * 모든 마커 반환
     */
    public releaseAll(): void {
        const ids = Array.from(this.active.keys());
        this.releaseMultiple(ids);
    }

    /**
     * 특정 ID 목록만 유지하고 나머지 반환
     * 
     * @param keepIds 유지할 마커 ID 배열
     */
    public releaseExcept(keepIds: Set<string>): void {
        const toRelease = Array.from(this.active.keys()).filter(
            (id) => !keepIds.has(id)
        );
        this.releaseMultiple(toRelease);
    }

    /**
     * 마커 업데이트 (위치나 아이콘 변경)
     * 
     * @param id 마커 ID
     * @param updates 업데이트할 속성
     */
    public update(
        id: string,
        updates: {
            position?: any;
            icon?: any;
            zIndex?: number;
        }
    ): void {
        const marker = this.active.get(id);
        if (!marker) return;

        if (updates.position) {
            marker.setPosition(updates.position);
        }
        if (updates.icon) {
            marker.setIcon(updates.icon);
        }
        if (updates.zIndex !== undefined) {
            marker.setZIndex(updates.zIndex);
        }
    }

    /**
     * 활성 마커 가져오기
     * 
     * @param id 마커 ID
     * @returns 마커 객체 (없으면 undefined)
     */
    public get(id: string): any | undefined {
        return this.active.get(id);
    }

    /**
     * 마커 존재 여부 확인
     * 
     * @param id 마커 ID
     * @returns 존재하면 true
     */
    public has(id: string): boolean {
        return this.active.has(id);
    }

    /**
     * 풀 전체 정리 (컴포넌트 언마운트 시)
     */
    public clear(): void {
        // 모든 활성 마커 지도에서 제거
        this.active.forEach((marker) => {
            marker.setMap(null);
        });

        // 풀의 모든 마커도 정리
        this.pool.forEach((marker) => {
            marker.setMap(null);
        });

        this.active.clear();
        this.pool = [];
    }

    /**
     * 통계 정보 가져오기 (디버깅용)
     */
    public getStats() {
        return {
            ...this.stats,
            activeCount: this.active.size,
            poolSize: this.pool.length,
            hitRate: this.stats.reused / (this.stats.created + this.stats.reused) || 0,
        };
    }

    /**
     * 통계 초기화
     */
    public resetStats(): void {
        this.stats = {
            created: 0,
            reused: 0,
            released: 0,
        };
    }

    /**
     * 콘솔에 통계 출력
     */
    public logStats(): void {
        const stats = this.getStats();
        console.table({
            'Active Markers': stats.activeCount,
            'Pool Size': stats.poolSize,
            'Total Created': stats.created,
            'Total Reused': stats.reused,
            'Total Released': stats.released,
            'Hit Rate': `${(stats.hitRate * 100).toFixed(1)}%`,
        });
    }
}

/**
 * 마커 풀 싱글톤 인스턴스 (편의 export)
 */
export const markerPool = MarkerPool.getInstance();
