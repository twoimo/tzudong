/**
 * 펼친 클러스터 맛집이 목록에서 빠져도 마커를 다시 그릴 수 있게 보관하는 스냅샷.
 *
 * 이전 경로는 클러스터가 하나라도 펼쳐지면 지금까지 본 맛집 전부를 렌더용 Map 두 개로
 * 복사했습니다. 실제 조회는 현재 목록, 펼친 id, 선택된 id만 쓰므로 그 복사 없이 같은
 * 우선순위로 해석합니다. 그 외 id는 더 이상 보관하지 않습니다.
 */

export type ExpandedClusterSnapshotStats = {
    retained: number;
    pruned: number;
};

const isSnapshotId = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;

const readMapEntries = <T>(source: ReadonlyMap<string, T> | null | undefined): Array<[string, T]> => {
    if (!source || typeof source.keys !== 'function' || typeof source.get !== 'function') return [];

    const entries: Array<[string, T]> = [];
    try {
        for (const id of source.keys()) {
            if (!isSnapshotId(id) || !source.has(id)) continue;
            entries.push([id, source.get(id) as T]);
        }
    } catch (error) {
        console.warn(
            `[expanded-cluster-snapshot] lookup read failed (${error instanceof Error ? error.name : 'unknown'})`,
        );
        return entries;
    }

    return entries;
};

export function retainExpandedClusterRestaurantSnapshot<T>(
    snapshot: Map<string, T> | null | undefined,
    currentById: ReadonlyMap<string, T> | null | undefined,
    currentMergedById: ReadonlyMap<string, T> | null | undefined,
    retainIds: readonly unknown[] | null | undefined,
): ExpandedClusterSnapshotStats {
    if (!snapshot || typeof snapshot.keys !== 'function' || typeof snapshot.delete !== 'function' || typeof snapshot.set !== 'function') {
        return { retained: 0, pruned: 0 };
    }

    const retain = new Set<string>();
    const currentEntries = readMapEntries(currentById);
    const mergedEntries = readMapEntries(currentMergedById);

    for (const [id] of currentEntries) retain.add(id);
    for (const [id] of mergedEntries) retain.add(id);
    if (Array.isArray(retainIds)) {
        for (const id of retainIds) {
            if (isSnapshotId(id)) retain.add(id);
        }
    }

    let pruned = 0;
    let snapshotIds: string[] = [];
    try {
        snapshotIds = [...snapshot.keys()].filter(isSnapshotId);
    } catch (error) {
        console.warn(
            `[expanded-cluster-snapshot] snapshot read failed (${error instanceof Error ? error.name : 'unknown'})`,
        );
        return { retained: 0, pruned: 0 };
    }

    for (const id of snapshotIds) {
        if (retain.has(id)) continue;
        snapshot.delete(id);
        pruned += 1;
    }

    for (const [id, restaurant] of currentEntries) {
        snapshot.set(id, restaurant);
    }
    for (const [id, restaurant] of mergedEntries) {
        if (!snapshot.has(id)) snapshot.set(id, restaurant);
    }

    return { retained: snapshot.size, pruned };
}

export function resolveExpandedClusterRestaurant<T>(
    restaurantId: unknown,
    byId: ReadonlyMap<string, T> | null | undefined,
    mergedById: ReadonlyMap<string, T> | null | undefined,
    snapshot: ReadonlyMap<string, T> | null | undefined,
    expansionActive: boolean,
): T | undefined {
    if (!isSnapshotId(restaurantId)) return undefined;

    try {
        if (byId?.has(restaurantId)) return byId.get(restaurantId);
        if (expansionActive && snapshot?.has(restaurantId)) return snapshot.get(restaurantId);
        if (mergedById?.has(restaurantId)) return mergedById.get(restaurantId);
    } catch (error) {
        console.warn(
            `[expanded-cluster-snapshot] resolve failed (${error instanceof Error ? error.name : 'unknown'})`,
        );
        return undefined;
    }

    return undefined;
}
