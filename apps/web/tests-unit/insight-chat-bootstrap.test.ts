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

    test('includes reusable Tzuyang follow-up prompts', async () => {
        const payload = await getAdminInsightChatBootstrap();

        expect(Array.isArray(payload.message.followUpPrompts)).toBe(true);
        expect(payload.message.followUpPrompts?.length).toBeGreaterThanOrEqual(3);

        const prompts = (payload.message.followUpPrompts ?? []).map((item) => item.prompt);
        expect(prompts).toEqual(expect.arrayContaining([
            '/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘',
            '/tzuyang-restaurant 오늘 운영 영상용 상호 브리핑(메뉴·세팅·컷 추천)을 정리해줘',
            '/tzuyang-peak-frame 피크 프레임 구간에서 후킹/클로징 보강 컷을 제안해줘',
        ]));
    });
});
