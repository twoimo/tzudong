import { describe, expect, test } from 'bun:test';
import { getAdminInsightChatBootstrap } from '@/lib/insight/chat';

describe('admin insight chat bootstrap', () => {
    test('includes Tzuyang video/restaurant/peak-frame storyboard presets', async () => {
        const payload = await getAdminInsightChatBootstrap();

        expect(payload.message.content).toContain('쯔양 스토리보드 운영 프리셋');
        expect(payload.message.content).toContain('식당(레스토랑) 콘텐츠용 30초 숏폼 스토리보드 5컷 구조로 기획해줘');
        expect(payload.message.content).toContain('오늘 업로드용 푸드·브이로그 영상 아이디어 3개를 콘티 기준으로 비교해줘');
        expect(payload.message.content).toContain('피크 프레임 중심으로 후킹·클로징 연출 포인트를 정리해줘');
    });
});
