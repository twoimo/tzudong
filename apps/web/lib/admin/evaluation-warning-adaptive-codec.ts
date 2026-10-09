import { Buffer } from 'node:buffer';
import { EvaluationRawWarningGroups } from './evaluation-warning-raw-groups';
import { EvaluationWarningStream } from './evaluation-warning-stream';
import { isRecord, normalizeEvaluationRecord, withAdminEvaluationDisplayName } from './normalize-evaluation-record';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';

type Row = ReturnType<typeof withAdminEvaluationDisplayName>;
// codecVersion 1 contains EVERY column of admin_evaluation_related_rows.
export const WARNING_TUPLE_FIELDS = ['id','created_at','video_id','approved_name','origin_name','naver_name','google_name','phone','status','road_address','jibun_address','youtube_link','updated_by_admin_id','lat','lng','evaluation_results','name'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function invalid(): never { throw new Error('EVALUATION_RECORDS_UNAVAILABLE'); }
const integer = (v: unknown, max = 50000): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;

/** Transport selection only. Flat tuples use the unchanged stream classifier.
 * Cursors are internal service-role continuations, never client admission tokens.
 * Timestamps remain opaque lossless PG strings; SQL, not JS Date, orders them.
 */
export class EvaluationWarningAdaptiveCodec {
  private readonly ids: string[];
  private readonly streams: EvaluationWarningStream[];
  private readonly groups: EvaluationRawWarningGroups;
  private readonly videos: Set<string>;
  private readonly targetById: Map<string, Row>;
  private readonly seen = new Set<string>();
  private total: number | null = null;
  private offset = 0;
  private complete = false;
  private selected: 'flat' | 'grouped' | null = null;
  constructor(private readonly targets: Row[], private readonly revision: string, private readonly catalogCount = 50000) {
    this.groups = new EvaluationRawWarningGroups(targets, revision, catalogCount);
    this.ids = targets.map(row => row.id).sort();
    this.targetById = new Map(targets.map(row => [row.id, row]));
    this.streams = targets.map(row => new EvaluationWarningStream(row));
    this.videos = new Set(targets.map(row => extractVideoIdFromYoutubeLink(row.youtube_link)).filter((id): id is string => Boolean(id)));
  }
  get mode() { return this.selected; }
  add(value: unknown): { hasMore: boolean; cursor: Record<string, unknown> | null } {
    if (this.complete || !isRecord(value) || Buffer.byteLength(JSON.stringify(value)) > 2097152) invalid();
    if (value.revision !== this.revision) throw new Error('EVALUATION_CURSOR_STALE');
    if (value.codecVersion !== 1 || (value.mode !== 'flat' && value.mode !== 'grouped')
      || (this.selected !== null && value.mode !== this.selected) || JSON.stringify(value.pageIds) !== JSON.stringify(this.ids)
      || !integer(value.totalRows, this.catalogCount) || (this.total !== null && this.total !== value.totalRows)
      || typeof value.hasMore !== 'boolean') invalid();
    this.selected = value.mode; this.total = value.totalRows;
    let offset: number;
    let last: unknown[] | undefined;
    if (value.mode === 'grouped') {
      if (value.totalRows <= 200 || !integer(value.totalGroups, 200) || value.totalGroups * 100 > value.totalRows) invalid();
      offset = this.groups.add(value).afterOrder;
    } else {
      if (value.rowOffset !== this.offset || !Array.isArray(value.tuples) || value.tuples.length > 1000
        || (value.hasMore && !value.tuples.length) || this.offset + value.tuples.length > value.totalRows
        || (value.totalRows <= 200 && (this.offset !== 0 || value.hasMore))) invalid();
      const rows: Row[] = value.tuples.map(tuple => {
        if (!Array.isArray(tuple) || tuple.length !== WARNING_TUPLE_FIELDS.length || typeof tuple[0] !== 'string'
          || !UUID.test(tuple[0]) || this.seen.has(tuple[0]) || !(tuple[1] === null || typeof tuple[1] === 'string')
          || typeof tuple[2] !== 'string' || !this.videos.has(tuple[2])) invalid();
        this.seen.add(tuple[0]); last = tuple;
        const raw = { id:tuple[0],created_at:tuple[1],video_id:tuple[2],approved_name:tuple[3],origin_name:tuple[4],
          naver_name:tuple[5],google_name:tuple[6],phone:tuple[7],status:tuple[8],road_address:tuple[9],jibun_address:tuple[10],
          youtube_link:tuple[11],updated_by_admin_id:tuple[12],lat:tuple[13],lng:tuple[14],evaluation_results:tuple[15],name:tuple[16] };
        const normalized = normalizeEvaluationRecord(raw); if (!normalized) invalid();
        const row = withAdminEvaluationDisplayName(normalized);
        if (extractVideoIdFromYoutubeLink(row.youtube_link) !== tuple[2]) invalid();
        const target = this.targetById.get(row.id);
        if (target && WARNING_TUPLE_FIELDS.slice(3).some(key => key !== 'evaluation_results' && target[key as keyof Row] !== row[key as keyof Row])) invalid();
        return row;
      });
      // Match the original 200-row classifier batching even when SQL delivers
      // 1000 tuples. This also bounds transient candidate sorting allocations.
      for (let start = 0; start < rows.length; start += 200) { const batch = rows.slice(start, start + 200); for (const stream of this.streams) stream.add(batch); }
      this.offset += rows.length; offset = this.offset;
      if (value.hasMore !== (offset < value.totalRows)) invalid();
      if (!value.hasMore) for (const target of this.targets) {
        if (Boolean(extractVideoIdFromYoutubeLink(target.youtube_link)) !== this.seen.has(target.id)) invalid();
      }
    }
    const cursor = value.cursor;
    if (value.totalRows === 0) { if (cursor !== null) invalid(); }
    else if (!isRecord(cursor) || cursor.revision !== this.revision || cursor.mode !== value.mode
      || cursor.totalRows !== value.totalRows || cursor.offset !== offset
      || JSON.stringify(cursor.pageIds) !== JSON.stringify(this.ids) || typeof cursor.afterId !== 'string' || !UUID.test(cursor.afterId)
      || !(cursor.afterCreated === null || typeof cursor.afterCreated === 'string')
      || (last && (cursor.afterId !== last[0] || cursor.afterCreated !== last[1]))) invalid();
    this.complete = !value.hasMore;
    return { hasMore: value.hasMore, cursor: isRecord(cursor) ? cursor : null };
  }
  result() {
    if (!this.complete) invalid();
    return this.selected === 'grouped' ? this.groups.result() : Object.fromEntries(this.streams.map((stream, i) => [this.targets[i].id, stream.result()]));
  }
}
