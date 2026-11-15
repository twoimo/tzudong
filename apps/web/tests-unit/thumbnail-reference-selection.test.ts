import { describe, expect, test } from 'bun:test';
import { isThumbnailReferenceRole, reconcileThumbnailReferences } from '../lib/admin/youtube-thumbnail-generator/reference-selection';

describe('thumbnail reference editing', () => {
  test('removing the first attachment preserves the remaining file roles', () => {
    const files = [{ name: 'host.png' }, { name: 'food.png' }, { name: 'plate.png' }];
    expect(reconcileThumbnailReferences(files, ['host', 'food', 'object'], files.slice(1), 8)).toEqual({
      files: files.slice(1), roles: ['food', 'object'],
    });
  });
  test('reordering and appending keeps existing explicit roles and does not mutate the original selection', () => {
    const files = [{ name: 'a.png' }, { name: 'b.png' }]; const next = { name: 'c.png' };
    const roles = ['person', 'other'] as const;
    expect(reconcileThumbnailReferences(files, roles, [files[1], files[0], next], 8)).toEqual({
      files: [files[1], files[0], next], roles: ['other', 'person', 'other'],
    });
    expect(files.map((file) => file.name)).toEqual(['a.png', 'b.png']); expect(roles).toEqual(['person', 'other']);
  });
  test('duplicate file objects retain their separate assigned roles', () => {
    const file = { name: 'shared.png' };
    expect(reconcileThumbnailReferences([file, file], ['host', 'food'], [file, file], 8).roles).toEqual(['host', 'food']);
  });
  test('new selections remain bounded with the established initial defaults', () => {
    const files = Array.from({ length: 9 }, (_, index) => ({ index }));
    const selected = reconcileThumbnailReferences([], [], files, 8);
    expect(selected.files).toHaveLength(8); expect(selected.roles).toEqual(['host', 'food', 'other', 'other', 'other', 'other', 'other', 'other']);
    expect(isThumbnailReferenceRole('host')).toBe(true); expect(isThumbnailReferenceRole('style')).toBe(false);
    expect(isThumbnailReferenceRole('')).toBe(false);
  });
});
