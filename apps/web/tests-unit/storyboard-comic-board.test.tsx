import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoryboardComicBoard } from '../components/admin/storyboard/StoryboardComicBoard';
import { StoryboardWorkspaceSkeleton } from '../components/admin/storyboard/StoryboardWorkspaceSkeleton';

const scenes = Array.from({ length: 6 }, (_, index) => ({ sceneNo: index + 1, title: `합성 장면 ${index + 1}`,
  description: '구조 검증용 장면 설명', caption: '', durationSec: 10 }));

describe('four-cut presentation of the unchanged production scene count', () => {
  test('shows exactly four selectable cuts on the first page and preserves the six-scene count', () => {
    const html = renderToStaticMarkup(<StoryboardComicBoard scenes={scenes} selectedScene={1} onSelect={() => undefined} />);
    expect(html.match(/aria-label="장면 \d 선택"/g)).toHaveLength(4);
    expect(html).toContain('6컷을 4컷씩 나눠');
    expect(html).toContain('aria-label="장면 4 선택"');
    expect(html).not.toContain('aria-label="장면 5 선택"');
    expect(html).toContain('aria-current="step"');
  });
  test('shows only the real remaining cuts; empty slots never become fabricated selectable scenes', () => {
    const html = renderToStaticMarkup(<StoryboardComicBoard scenes={scenes} selectedScene={5} onSelect={() => undefined} />);
    expect(html.match(/aria-label="장면 \d 선택"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="장면 5 선택"'); expect(html).toContain('aria-label="장면 6 선택"');
    expect(html).not.toContain('aria-label="장면 7 선택"');
    expect(html).toContain('이 페이지의 마지막 컷이에요');
  });
  test('loading reserves four panels, announces its state and does not invent image results', () => {
    const html = renderToStaticMarkup(<StoryboardWorkspaceSkeleton />);
    expect(html).toContain('aria-busy="true"'); expect(html).toContain('role="status"');
    expect(html).not.toContain('<img'); expect(html).not.toContain('animate-pulse');
    const empty = renderToStaticMarkup(<StoryboardComicBoard scenes={[]} selectedScene={1} onSelect={() => undefined} state="empty" />);
    expect(empty).not.toContain('aria-label="장면 1 선택"');
    expect(empty).toContain('아직 생성된 이미지가 없어요');
  });
});
