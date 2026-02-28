import { describe, expect, test } from 'bun:test';

import { resolvePromptInput, resolvePromptInputWithGovernance } from '@/components/insight/InsightChatSection';

describe('insight prompt library resolution', () => {
    test('converts slash command to the mapped prompt template', () => {
        const result = resolvePromptInput('/trend');
        expect(result).toBe(
            '최근 30일 영상 지표(조회수·좋아요·댓글) 추세를 비교하고 상승/하락 요인을 정리해줘.',
        );
    });

    test('keeps optional trailing user text after command template', () => {
        expect(
            resolvePromptInput('/trend 지난달 대비 이번달 1:1 방문 유입 추세 분석'),
        ).toBe('최근 30일 영상 지표(조회수·좋아요·댓글) 추세를 비교하고 상승/하락 요인을 정리해줘. 지난달 대비 이번달 1:1 방문 유입 추세 분석');
    });

    test('falls back to raw input when no known command', () => {
        expect(resolvePromptInput('/custom 쿼리 요청')).toBe('/custom 쿼리 요청');
        expect(resolvePromptInput('일반 문의: 광고 성과를 알려줘')).toBe('일반 문의: 광고 성과를 알려줘');
    });

    test('supports Tzuyang storyboard presets', () => {
        expect(resolvePromptInput('/tzuyang-restaurant')).toBe(
            '레스토랑 촬영 기획을 위해 메뉴 하이라이트, 셋업, 촬영 포인트, 편집 타이밍을 8개 항목으로 정리해줘.',
        );
    });

    test('deprecated command returns migration hint while preserving prompt output', () => {
        const result = resolvePromptInputWithGovernance('/kpi 이번달 댓글과 전환율 연관성까지 같이 봐줘');

        expect(result.content).toBe(
            '조회수·좋아요·댓글·전환율 지표를 교차해서 핵심 상관 신호를 찾아줘. 이번달 댓글과 전환율 연관성까지 같이 봐줘',
        );
        expect(result.migrationHint).toBe(
            '기존 /kpi 명령어는 유지되지만 곧 제거될 예정입니다. 앞으로는 /segment를 사용해 주세요.',
        );
    });
});
