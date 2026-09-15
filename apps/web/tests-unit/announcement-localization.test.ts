import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { localizeAnnouncementContent } from '../lib/announcement-localization';

const seed = readFileSync(new URL('../../../backend/supabase/baselines/pre-20260214-announcements.seed.sql', import.meta.url), 'utf8');
const original = { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', title: 'Tzudong Map v1.1.1 Release Notes', content: seed.split('$a1$')[1], priority: 100 };
test('historical English announcement is fully rendered in Korean without modifying source', () => {
    const result = localizeAnnouncementContent(original);
    expect(result.title).toBe('쯔동여지도 버전 1.1.1 업데이트 안내');
    expect(result.content).toContain('관리자 검수 화면');
    expect(result.content).not.toMatch(/[A-Za-z]/);
    expect(result.priority).toBe(100);
    expect(original.title).toContain('Release Notes');
});
test('operator edits and unrelated announcements are preserved exactly', () => {
    const edited = { ...original, content: '운영자가 수정한 내용' };
    expect(localizeAnnouncementContent(edited)).toBe(edited);
    const other = { ...original, id: 'another' };
    expect(localizeAnnouncementContent(other)).toBe(other);
});
