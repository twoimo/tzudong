import type { ThumbnailInput } from './queue-contract';

export type ThumbnailReferenceRole = ThumbnailInput['references'][number]['role'];

export const THUMBNAIL_REFERENCE_ROLE_OPTIONS = [
  { value: 'host', label: '진행자' },
  { value: 'food', label: '음식' },
  { value: 'object', label: '물건' },
  { value: 'person', label: '인물' },
  { value: 'other', label: '분위기·구도' },
] as const satisfies ReadonlyArray<{ value: ThumbnailReferenceRole; label: string }>;

export function isThumbnailReferenceRole(value: string): value is ThumbnailReferenceRole {
  return THUMBNAIL_REFERENCE_ROLE_OPTIONS.some((option) => option.value === value);
}

/** Keep each retained file's role when another attachment is removed or reordered. */
export function reconcileThumbnailReferences<T>(
  previousFiles: readonly T[],
  previousRoles: readonly ThumbnailReferenceRole[],
  nextFiles: readonly T[],
  maxFiles: number,
): { files: T[]; roles: ThumbnailReferenceRole[] } {
  const files = nextFiles.slice(0, maxFiles);
  const retained = new Set<number>();
  const roles = files.map((file, index) => {
    const previousIndex = previousFiles.findIndex((previous, oldIndex) => previous === file && !retained.has(oldIndex));
    if (previousIndex >= 0) {
      retained.add(previousIndex);
      return previousRoles[previousIndex] ?? 'other';
    }
    // Preserve the existing first/second-upload defaults; the editor exposes each role.
    return index === 0 ? 'host' : index === 1 ? 'food' : 'other';
  });
  return { files, roles };
}
