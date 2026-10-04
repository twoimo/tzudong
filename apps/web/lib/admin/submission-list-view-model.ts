export type AdminModerationStatus = 'pending' | 'partially_approved' | 'approved' | 'rejected' | 'unknown';
export type AdminModerationFilter = 'all' | AdminModerationStatus | 'duplicate';
export type AdminModerationSort = 'priority' | 'newest' | 'oldest' | 'name';

type ModerationRow = { id: string; created_at: string };
type ModerationSearchFields = { name: string; status: string; search: readonly (string | null | undefined)[]; duplicate?: boolean };
const priority: Record<string, number> = { pending: 0, partially_approved: 1, approved: 2, rejected: 3 };
const normalized = (value: string) => value.trim().toLocaleLowerCase('ko-KR');

export function adminReviewModerationStatus(review: { is_verified: boolean; admin_note: string | null }): AdminModerationStatus {
  return review.is_verified ? 'approved' : review.admin_note?.includes('거부') ? 'rejected' : 'pending';
}

/** Select from the loaded rows only. Sorting and filtering never mutate caller snapshots. */
export function selectAdminModerationRows<T extends ModerationRow>(
  rows: readonly T[],
  options: { query: string; status: AdminModerationFilter; sort: AdminModerationSort },
  project: (row: T) => ModerationSearchFields,
): T[] {
  const query = normalized(options.query);
  return rows.map(row => ({ row, fields: project(row), time: Date.parse(row.created_at) }))
    .filter(({ fields }) => {
      const state = Object.hasOwn(priority, fields.status) ? fields.status : 'unknown';
      const matchesStatus = options.status === 'all' || (options.status === 'duplicate' ? fields.duplicate === true : options.status === 'pending' ? state === 'pending' || state === 'partially_approved' : state === options.status);
      return matchesStatus && (!query || fields.search.some(value => typeof value === 'string' && normalized(value).includes(query)));
    })
    .sort((a, b) => {
      if (options.sort === 'priority') {
        const delta = (Object.hasOwn(priority, a.fields.status) ? priority[a.fields.status] : 4) - (Object.hasOwn(priority, b.fields.status) ? priority[b.fields.status] : 4);
        if (delta) return delta;
      }
      if (options.sort === 'name') {
        const delta = a.fields.name.localeCompare(b.fields.name, 'ko-KR');
        if (delta) return delta;
      }
      const aValid = Number.isFinite(a.time), bValid = Number.isFinite(b.time);
      if (aValid !== bValid) return aValid ? -1 : 1;
      const dateDelta = aValid && bValid ? (options.sort === 'oldest' ? a.time - b.time : b.time - a.time) : 0;
      return dateDelta || a.row.id.localeCompare(b.row.id);
    })
    .map(({ row }) => row);
}
