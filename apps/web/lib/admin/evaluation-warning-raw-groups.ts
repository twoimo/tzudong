import { Buffer } from 'node:buffer';
import { findSameVideoDuplicateWarningCandidates, formatSameVideoDuplicateWarning, type SameVideoDuplicateWarningCandidate } from '@/lib/admin-same-video-duplicate-warning';
import { findRestaurantIdentityWarnings, isSameVideoSameOriginDeleted, deletedRestaurantIdentityWarning } from '@/lib/admin-restaurant-identity-warning';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import { isRecord, normalizeEvaluationRecord, withAdminEvaluationDisplayName } from './normalize-evaluation-record';

type Row = ReturnType<typeof withAdminEvaluationDisplayName>;
type Sample = { id: string; sourceOrder: number };
type OrderedCandidate = { value: SameVideoDuplicateWarningCandidate; order: number };
type State = { target: Row; count: number; candidates: OrderedCandidate[]; deletedCount: number; deleted: { row: Row; order: number }[] };
type Group = { representative: Row; samples: Sample[]; selfIds: Set<string>; count: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ATTRIBUTES = ['approved_name','origin_name','naver_name','google_name','phone','status','road_address','jibun_address','youtube_link','updated_by_admin_id','lat','lng','evaluation_results','name'].sort();
const COMPARISON_FIELDS = [...ATTRIBUTES.filter(key => key !== 'evaluation_results'), 'restaurant_name'] as (keyof Row)[];
function invalid(): never { throw new Error('EVALUATION_RECORDS_UNAVAILABLE'); }
const integer = (value: unknown, min = 0, max = 50000): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

/** Lossless weighted stream. SQL only groups identical raw attributes.
 * A target excludes at most one row, hence the first four real samples contain
 * every possible top three. Explicit sourceOrder restores stable JS sort ties
 * when groups interleave. No SQL float, normalization or linguistic decision.
 */
export class EvaluationRawWarningGroups {
  private readonly states: State[];
  private readonly targets: Map<string, Row>;
  private readonly revision: string;
  private readonly ids: string[];
  private readonly catalogCount: number;
  private readonly samples = new Set<string>();
  private readonly orders = new Set<number>();
  private readonly selves = new Set<string>();
  private totalRows: number | null = null;
  private totalGroups: number | null = null;
  private rows = 0;
  private groups = 0;
  private after = 0;
  private complete = false;

  constructor(targets: Row[], revision: string, catalogCount = 50000) {
    if (!targets.length || targets.length > 200 || targets.some(row => !UUID.test(row.id)) || !/^\d{1,20}$/.test(revision)) invalid();
    this.targets = new Map(targets.map(row => [row.id, row]));
    if (this.targets.size !== targets.length) invalid();
    this.ids = [...this.targets.keys()].sort();
    if (!integer(catalogCount, targets.length)) invalid();
    this.catalogCount = catalogCount;
    this.revision = revision;
    this.states = targets.map(target => ({ target, count: 0, candidates: [], deletedCount: 0, deleted: [] }));
  }

  add(value: unknown): { hasMore: boolean; afterOrder: number } {
    if (this.complete || !isRecord(value) || Buffer.byteLength(JSON.stringify(value)) > 2097152) invalid();
    if (value.revision !== this.revision) throw new Error('EVALUATION_CURSOR_STALE');
    if (JSON.stringify(value.pageIds) !== JSON.stringify(this.ids)
      || !integer(value.totalRows, 0, this.catalogCount) || !integer(value.totalGroups, 0, value.totalRows)
      || value.groupOffset !== this.groups || value.rowOffset !== this.rows
      || !Array.isArray(value.groups) || value.groups.length > 1000 || typeof value.hasMore !== 'boolean'
      || !integer(value.nextAfterOrder) || (value.hasMore && !value.groups.length)) invalid();
    if (this.totalRows !== null && (this.totalRows !== value.totalRows || this.totalGroups !== value.totalGroups)) invalid();
    this.totalRows = value.totalRows;
    this.totalGroups = value.totalGroups;
    const groups = value.groups.map(group => this.addGroup(group, value.totalRows as number));
    this.addRows(groups);
    if (value.nextAfterOrder !== this.after || this.groups > value.totalGroups || this.rows > value.totalRows) invalid();
    if (!value.hasMore) {
      if (this.groups !== value.totalGroups || this.rows !== value.totalRows) invalid();
      for (const target of this.targets.values()) {
        if (Boolean(extractVideoIdFromYoutubeLink(target.youtube_link)) !== this.selves.has(target.id)) invalid();
      }
      this.complete = true;
    } else if (this.groups >= value.totalGroups || this.rows >= value.totalRows) invalid();
    return { hasMore: value.hasMore, afterOrder: this.after };
  }

  private addGroup(group: unknown, totalRows: number): Group {
    if (!isRecord(group) || !integer(group.count, 1, totalRows) || !integer(group.firstOrder, this.after + 1, totalRows)
      || !isRecord(group.attrs) || JSON.stringify(Object.keys(group.attrs).sort()) !== JSON.stringify(ATTRIBUTES)
      || !Array.isArray(group.samples) || group.samples.length !== Math.min(4, group.count)
      || !Array.isArray(group.selfIds) || group.selfIds.length > Math.min(200, group.count)) invalid();
    const selfIds = new Set<string>();
    for (const id of group.selfIds) {
      if (typeof id !== 'string' || !this.targets.has(id) || selfIds.has(id) || this.selves.has(id)) invalid();
      selfIds.add(id);
    }
    let lastOrder = group.firstOrder - 1;
    const samples: Sample[] = group.samples.map(sample => {
      if (!isRecord(sample) || typeof sample.id !== 'string' || !UUID.test(sample.id) || this.samples.has(sample.id)
        || !integer(sample.sourceOrder, lastOrder + 1, totalRows) || this.orders.has(sample.sourceOrder)
        || (this.targets.has(sample.id) && !selfIds.has(sample.id))) invalid();
      this.samples.add(sample.id); this.orders.add(sample.sourceOrder); lastOrder = sample.sourceOrder;
      return { id: sample.id, sourceOrder: sample.sourceOrder };
    });
    if (samples[0].sourceOrder !== group.firstOrder) invalid();
    if (group.count <= 4 && [...selfIds].some(id => !samples.some(sample => sample.id === id))) invalid();
    const normalized = normalizeEvaluationRecord({ ...group.attrs, id: samples[0].id });
    if (!normalized) invalid();
    const representative = withAdminEvaluationDisplayName(normalized);
    for (const id of selfIds) {
      const target = this.targets.get(id)!;
      if (COMPARISON_FIELDS.some(key => target[key] !== representative[key])) invalid();
      this.selves.add(id);
    }
    this.rows += group.count; this.groups++; this.after = group.firstOrder;
    return { representative, samples, selfIds, count: group.count };
  }

  private addRows(groups: Group[]) {
    // Call the existing classifier once per bounded batch/target. In the
    // all-unique case this avoids N singleton filters/maps and video parses.
    for (const state of this.states) {
      const related: Row[] = [];
      const memberships = new Map<string, Group>();
      for (const group of groups) {
        if (group.count === Number(group.selfIds.has(state.target.id))) continue;
        const sample = group.samples.find(item => item.id !== state.target.id);
        if (!sample) invalid();
        const row = group.representative.id === sample.id ? group.representative : { ...group.representative, id: sample.id };
        related.push(row); memberships.set(row.id, group);
      }
      const candidates = findSameVideoDuplicateWarningCandidates(state.target, related);
      for (const candidate of candidates) {
        const group = memberships.get(candidate.id)!;
        state.count += group.count - Number(group.selfIds.has(state.target.id));
      }
      // Candidate groups are sorted by confidence/name, stably by firstOrder.
      // Only the target's own group can lose its first row. After four groups,
      // at least three earlier groups therefore have a real row that outranks
      // every later group. Count every match; expand only this exact frontier.
      for (const candidate of candidates.slice(0, 4)) {
        const group = memberships.get(candidate.id)!;
        for (const item of group.samples) if (item.id !== state.target.id) {
          state.candidates.push({ value: { ...candidate, id: item.id }, order: item.sourceOrder });
        }
      }
      state.candidates.sort((a, b) => b.value.confidence - a.value.confidence || a.value.name.localeCompare(b.value.name) || a.order - b.order);
      state.candidates.length = Math.min(3, state.candidates.length);
      if (state.target.status !== 'deleted') for (const row of related) if (isSameVideoSameOriginDeleted(state.target, row)) {
        const group = memberships.get(row.id)!;
        state.deletedCount += group.count - Number(group.selfIds.has(state.target.id));
        for (const item of group.samples) if (item.id !== state.target.id) state.deleted.push({ row: { ...row, id: item.id }, order: item.sourceOrder });
        state.deleted.sort((a, b) => a.order - b.order);
        state.deleted.length = Math.min(3, state.deleted.length);
      }
    }
  }

  result() {
    if (!this.complete) invalid();
    return Object.fromEntries(this.states.map(state => {
      const candidates = state.candidates.map(item => item.value);
      const identity = findRestaurantIdentityWarnings(state.target, []);
      if (state.deletedCount) identity.push(deletedRestaurantIdentityWarning(state.deleted.map(item => item.row), state.deletedCount));
      identity.sort((a, b) => a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1);
      return [state.target.id, { sameVideo: { count: state.count, candidates, message: formatSameVideoDuplicateWarning(candidates, state.count) }, identity }];
    }));
  }
}
