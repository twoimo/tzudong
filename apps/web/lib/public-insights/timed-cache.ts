/**
 * TTL 캐시는 읽기에서 만료를 무시할 뿐 항목을 지우지 않아, 요청이 쌓이는 동안
 * 키마다 항목이 그대로 남습니다. 쓰기 시점에 만료 항목을 정리하고 상한을 넘으면
 * 가장 먼저 들어온 항목부터 버려 서버 프로세스의 메모리 증가를 막습니다.
 *
 * 만료된 값은 어차피 읽기에서 반환되지 않으므로 정리해도 응답은 달라지지 않고,
 * 상한을 넘겨 버린 항목은 다음 읽기에서 같은 값으로 다시 채워집니다.
 */
export type ExpiringCacheEntry = { expiresAt: number; value: unknown } | null;

export function pruneTimedCache(
    cache: Map<string, ExpiringCacheEntry>,
    now: number,
    maxEntries: number,
): void {
    for (const [key, entry] of cache) {
        if (!entry || entry.expiresAt <= now) cache.delete(key);
    }

    const overflow = cache.size - maxEntries;
    if (overflow <= 0) return;

    let removed = 0;
    for (const key of cache.keys()) {
        cache.delete(key);
        removed += 1;
        if (removed >= overflow) break;
    }
}

