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

type MarkerClickEvent = unknown;

interface MarkerAnchorLike {
    x: number;
    y: number;
}

interface MarkerIconLike {
    content?: unknown;
    anchor?: MarkerAnchorLike | null;
    [key: string]: unknown;
}

interface MarkerPositionLike {
    equals?: (position: unknown) => boolean;
}

interface PooledMarker {
    __onClick?: (event: MarkerClickEvent) => void;
    getMap: () => unknown;
    setMap: (map: unknown | null) => void;
    getPosition: () => MarkerPositionLike | null;
    setPosition: (position: unknown) => void;
    getIcon: () => MarkerIconLike | null;
    setIcon: (icon: MarkerIconLike) => void;
    getElement: () => HTMLElement | null;
    setZIndex: (zIndex: number) => void;
}

/**
 * 싱글톤 마커 풀 클래스
 */
export class MarkerPool {
    private static instance: MarkerPool | null = null;

    /** 사용 가능한 마커 풀 */
    private pool: PooledMarker[] = [];

    /** 현재 활성화된 마커 맵 (ID → Marker) */
    private active: Map<string, PooledMarker> = new Map();

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
        position: unknown,
        icon: MarkerIconLike,
        map: unknown,
        onClick?: () => void
    ): PooledMarker {
        let marker: PooledMarker;
        let isNew = false;

        // 1. 이미 활성화된 마커 재사용
        if (this.active.has(id)) {
            marker = this.active.get(id)!;
        }
        // 2. 풀에서 가져오기
        else if (this.pool.length > 0) {
            marker = this.pool.pop()!;
            this.stats.reused++;
        }
        // 3. 새 마커 생성
        else {
            marker = new window.naver.maps.Marker({
                position, // 초기값
                icon,     // 초기값
                map,      // 초기값
            }) as PooledMarker;
            isNew = true;
            this.stats.created++;

            // [PERFORMANCE] 이벤트 위임: 마커 생성 시 단 1회만 리스너 등록
            // 이후 핸들러 교체는 __onClick 프로퍼티만 변경하여 zero-overhead 달성
            window.naver.maps.Event.addListener(marker, 'click', (e: MarkerClickEvent) => {
                if (marker.__onClick) {
                    marker.__onClick(e);
                }
            });
        }

        // [PERFORMANCE] 불필요한 DOM 조작/렌더링 방지
        // 값이 실제로 변경되었을 때만 setter 호출

        // 1. Map 설정 (새로 생성된 경우 이미 설정됨)
        if (!isNew && marker.getMap() !== map) {
            marker.setMap(map);
        }

        // 2. 위치 업데이트 (새로 생성된 경우 이미 설정됨)
        if (!isNew) {
            const currentPos = marker.getPosition();
            // LatLng.equals 메서드 활용 또는 좌표값 비교
            if (!currentPos?.equals || !currentPos.equals(position)) {
                marker.setPosition(position);
            }
        }

        // 3. 아이콘 업데이트 (컨텐츠/앵커 비교)
        if (!isNew) {
            const currentIcon = marker.getIcon();
            const currentAnchor = currentIcon?.anchor ?? null;
            const nextAnchor = icon.anchor ?? null;
            // content가 다르거나 anchor가 다르면 업데이트
            const isContentDifferent = currentIcon?.content !== icon.content;
            const isAnchorDifferent =
                (currentAnchor?.x ?? null) !== (nextAnchor?.x ?? null) ||
                (currentAnchor?.y ?? null) !== (nextAnchor?.y ?? null);

            if (isContentDifferent || isAnchorDifferent) {
                marker.setIcon(icon);
            }
        }

        // 4. 이벤트 핸들러 교체 (프로퍼티 할당 O(1))
        marker.__onClick = onClick;

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

        // [UX] 즉시 삭제 대신 페이드아웃 적용
        // 깜빡임 없는 전환(Seamless Transition)을 위해 300ms 동안 유지
        const element = marker.getElement();
        if (element) {
            element.classList.add('marker-fade-out');
        }

        this.active.delete(id);

        // CSS Transition 시간(300ms) 후 실제 제거 및 풀 반환
        setTimeout(() => {
            // 지도에서 제거
            marker.setMap(null);

            // 다음 재사용을 위해 상태 초기화
            if (element) {
                element.classList.remove('marker-fade-out');
                element.style.opacity = '';
            }

            // 풀 크기 제한 체크
            if (this.pool.length < this.MAX_POOL_SIZE) {
                this.pool.push(marker);
            } else {
                // 풀이 가득 차면 마커 완전 삭제(참조 제거)
            }

            this.stats.released++;
        }, 300);
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
            position?: unknown;
            icon?: MarkerIconLike;
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
    public get(id: string): PooledMarker | undefined {
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
