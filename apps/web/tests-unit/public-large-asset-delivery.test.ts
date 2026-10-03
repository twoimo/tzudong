import { expect, test } from 'bun:test';
import { GET, HEAD } from '@/app/fonts/ChosunCentennial_otf.otf/route';

test('legacy public font redirect preserves GET/HEAD and remains rollbackable', async () => {
    for (const handler of [GET, HEAD]) {
        const response = handler();
        expect(response.status).toBe(307);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('location')).toBe(
            'https://assets.tzudong.app/sha256-8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7--ChosunCentennial_otf.otf',
        );
        expect(await response.text()).toBe('');
    }
});
