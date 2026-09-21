import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const hookSource = readFileSync(join(import.meta.dir, '../hooks/use-restaurants.tsx'), 'utf8');

describe('관련 리뷰 카운트 청크 조회', () => {
    test('청크 결과 순서를 유지하는 공용 헬퍼를 사용한다', () => {
        expect(hookSource).toContain('async function fetchChunkedInOrder');
        expect(hookSource).toContain('rowsByChunk[chunkIndex] = await fetchChunk(');
        expect(hookSource).toContain('return rowsByChunk.flat();');
    });

    test('동시 요청 수를 상수로 제한한다', () => {
        expect(hookSource).toContain('const SUPABASE_IN_CHUNK_CONCURRENCY =');
        expect(hookSource).toContain('Math.min(SUPABASE_IN_CHUNK_CONCURRENCY, chunks.length)');
    });

    test('순차 for 루프로 청크를 조회하던 코드는 남아 있지 않다', () => {
        expect(hookSource).not.toContain('for (let index = 0; index < names.length; index += SUPABASE_IN_CHUNK_SIZE)');
        expect(hookSource).not.toContain('for (let index = 0; index < restaurantIds.length; index += SUPABASE_IN_CHUNK_SIZE)');
        expect(hookSource).toContain('fetchChunkedInOrder(names,');
        expect(hookSource).toContain('fetchChunkedInOrder(restaurantIds,');
    });
});
