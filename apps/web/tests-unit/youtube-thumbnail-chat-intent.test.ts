import { describe, expect, test } from 'bun:test';
import {
  hasExplicitThumbnailGenerationCommand,
  isThumbnailChatGuidanceQuestion,
  normalizeThumbnailChatIntentText,
} from '@/lib/admin/youtube-thumbnail-generator/chat-intent';

describe('thumbnail chat intent', () => {
  test('collapses whitespace and trims empty input', () => {
    expect(normalizeThumbnailChatIntentText('  썸네일   만들어   줘  ')).toBe('썸네일 만들어 줘');
    expect(normalizeThumbnailChatIntentText('   ')).toBe('');
    expect(normalizeThumbnailChatIntentText('')).toBe('');
  });

  test('accepts an explicit generation command', () => {
    for (const value of [
      '썸네일 생성해줘',
      '이미지 만들어 주세요',
      '그 방향으로 진행해줘',
      '좋아, 그걸로 생성해주세요',
      '렌더해줘',
      '이미지 뽑아줘',
      '그걸로 만들어',
    ]) {
      expect(hasExplicitThumbnailGenerationCommand(value)).toBe(true);
    }
  });

  test('never treats a question as a generation command', () => {
    for (const value of [
      '',
      '   ',
      '얼마나 걸려?',
      '썸네일 생성하려면 얼마나 걸려?',
      '어떻게 만들 수 있어?',
      '이거 왜 이래',
      'generate please',
      '만들어줘',
      '진행해줘',
    ]) {
      expect(hasExplicitThumbnailGenerationCommand(value)).toBe(false);
    }
  });

  test('treats a bare Korean command without an object as guidance only', () => {
    expect(hasExplicitThumbnailGenerationCommand('만들어줘')).toBe(false);
    expect(hasExplicitThumbnailGenerationCommand('그걸로 만들어')).toBe(true);
  });

  test('reports an explicit command that also reads as a question on both checks', () => {
    expect(hasExplicitThumbnailGenerationCommand('생성해줘?')).toBe(true);
    expect(isThumbnailChatGuidanceQuestion('생성해줘?')).toBe(true);
  });

  test('recognizes guidance questions by punctuation or keywords', () => {
    expect(isThumbnailChatGuidanceQuestion('이거 뭐야?')).toBe(true);
    expect(isThumbnailChatGuidanceQuestion('어떻게 하나요')).toBe(true);
    expect(isThumbnailChatGuidanceQuestion('비용이 드나요')).toBe(true);
    expect(isThumbnailChatGuidanceQuestion('참고 이미지 넣을 수 있나')).toBe(true);
    expect(isThumbnailChatGuidanceQuestion('이거 왜 이래')).toBe(true);
    expect(isThumbnailChatGuidanceQuestion('썸네일 생성해줘')).toBe(false);
    expect(isThumbnailChatGuidanceQuestion('')).toBe(false);
    expect(isThumbnailChatGuidanceQuestion('   ')).toBe(false);
  });
});
