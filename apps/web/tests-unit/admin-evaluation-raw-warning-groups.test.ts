import { expect, test } from 'bun:test';
import { EvaluationRawWarningGroups } from '../lib/admin/evaluation-warning-raw-groups';
import { normalizeEvaluationRecord, withAdminEvaluationDisplayName } from '../lib/admin/normalize-evaluation-record';
import { EvaluationWarningStream } from '../lib/admin/evaluation-warning-stream';

const id = (n: number) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`;
const attrs = (extra: Record<string, unknown> = {}) => ({ approved_name: 'fixture', origin_name: 'fixture', naver_name: null, google_name: null,
  phone: null, status: 'pending', road_address: null, jibun_address: null, youtube_link: 'https://youtu.be/ABCDEFGHIJK',
  updated_by_admin_id: null, lat: null, lng: null, evaluation_results: { location_match_TF: { eval_value: null, match_status: null, naver_name: null, matched_provider: null, matched_name: null } }, name: 'fixture', ...extra });
const normalize = (raw: unknown) => withAdminEvaluationDisplayName(normalizeEvaluationRecord(raw)!);
function fixture() {
  const rows = Array.from({ length: 16 }, (_, i) => ({ ...attrs({ phone: i % 2 ? 'odd' : 'even' }), id: id(i) }));
  const targets = [rows[0], rows[9]].map(normalize);
  const pageIds = targets.map(row => row.id).sort();
  const groups = [0, 1].map(parity => ({ attrs: attrs({ phone: parity ? 'odd' : 'even' }), count: 8, firstOrder: parity + 1,
    selfIds: [targets[parity].id], samples: [0, 1, 2, 3].map(i => ({ id: id(i * 2 + parity), sourceOrder: i * 2 + parity + 1 })) }));
  const batch = { revision: '42', pageIds, totalRows: 16, totalGroups: 2, groupOffset: 0, rowOffset: 0, groups, hasMore: false, nextAfterOrder: 2 };
  return { rows, targets, batch };
}

test('four samples preserve top three with self both inside and outside samples', () => {
  const { rows, targets, batch } = fixture();
  const reader = new EvaluationRawWarningGroups(targets, '42'); reader.add(batch);
  const expected = Object.fromEntries(targets.map(target => { const stream = new EvaluationWarningStream(target); stream.add(rows.map(normalize)); return [target.id, stream.result()]; }));
  expect(reader.result()).toEqual(expected);
  expect(reader.result()[id(0)].sameVideo.candidates.map(row => row.id)).toEqual([id(1), id(2), id(3)]);
});

test('cursor offsets cover exactly the same groups and rows across batches', () => {
  const { targets, batch } = fixture(); const reader = new EvaluationRawWarningGroups(targets, '42');
  expect(reader.add({ ...batch, groups: [batch.groups[0]], hasMore: true, nextAfterOrder: 1 })).toEqual({ hasMore: true, afterOrder: 1 });
  expect(() => reader.result()).toThrow('EVALUATION_RECORDS_UNAVAILABLE');
  reader.add({ ...batch, groups: [batch.groups[1]], groupOffset: 1, rowOffset: 8 });
  expect(reader.result()[id(0)].sameVideo.count).toBe(15);
  expect(() => reader.add(batch)).toThrow('EVALUATION_RECORDS_UNAVAILABLE');
});

test('rejects wrong revision, totals, cursor, membership, duplicate samples and extra raw attrs', () => {
  const { targets, batch } = fixture();
  const corruptions = [
    { ...batch, revision: '43' }, { ...batch, totalRows: 15 }, { ...batch, totalGroups: 3 }, { ...batch, groupOffset: 1 },
    { ...batch, rowOffset: 1 }, { ...batch, pageIds: [id(100)] }, { ...batch, nextAfterOrder: 1 },
    { ...batch, groups: [] }, { ...batch, hasMore: true },
    ...[
      { selfIds: [] }, { selfIds: [id(100)] }, { selfIds: [id(0), id(0)] }, { count: 0 },
      { samples: batch.groups[0].samples.slice(0, 3) },
      { samples: [batch.groups[0].samples[0], batch.groups[0].samples[0], ...batch.groups[0].samples.slice(2)] },
      { attrs: { ...batch.groups[0].attrs, unrelated: true } },
      { attrs: { ...batch.groups[0].attrs, phone: 'wrong-self' } },
    ].map(change => ({ ...batch, groups: [{ ...batch.groups[0], ...change }, batch.groups[1]] })),
  ];
  for (const value of corruptions) {
    const reader = new EvaluationRawWarningGroups(targets, '42');
    expect(() => reader.add(value)).toThrow(value.revision === '43' ? 'EVALUATION_CURSOR_STALE' : 'EVALUATION_RECORDS_UNAVAILABLE');
  }
});

test('rejects a missing last self even when fabricated row and group totals agree', () => {
  const { targets, batch } = fixture();
  const reader = new EvaluationRawWarningGroups(targets, '42');
  expect(() => reader.add({ ...batch, groups: [batch.groups[0], { ...batch.groups[1], selfIds: [] }] })).toThrow('EVALUATION_RECORDS_UNAVAILABLE');
});

test('UTF16 similarity and locale-equivalent display ties retain exact stream order', () => {
  const rows = Array.from({ length: 32 }, (_, i) => ({ id: id(i), ...attrs({ approved_name: i % 2 ? 'é' : 'e\u0301', name: i % 2 ? 'é' : 'e\u0301' }) }));
  const targets = [normalize(rows[0])];
  const groups = [0, 1].map(p => ({ attrs: attrs({ approved_name: p ? 'é' : 'e\u0301', name: p ? 'é' : 'e\u0301' }), count: 16, firstOrder: p + 1,
    selfIds: p ? [] : [id(0)], samples: [0, 1, 2, 3].map(i => ({ id: id(i * 2 + p), sourceOrder: i * 2 + p + 1 })) }));
  const reader = new EvaluationRawWarningGroups(targets, '42'); reader.add({ revision: '42', pageIds: [id(0)], totalRows: 32, totalGroups: 2, groupOffset: 0, rowOffset: 0, groups, hasMore: false, nextAfterOrder: 2 });
  const reference = new EvaluationWarningStream(targets[0]); reference.add(rows.map(normalize));
  expect(reader.result()[id(0)]).toEqual(reference.result());
});

test('a self-containing first group cannot displace the next three groups on a display tie', () => {
  const rows = Array.from({ length: 20 }, (_, n) => ({ id: id(n), ...attrs({ phone: String(n % 10) }) }));
  const target = normalize(rows[0]);
  const groups = Array.from({ length: 10 }, (_, n) => ({ attrs: attrs({ phone: String(n) }), count: 2, firstOrder: n + 1,
    selfIds: n ? [] : [id(0)], samples: [n, n + 10].map(i => ({ id: id(i), sourceOrder: i + 1 })) }));
  const reader = new EvaluationRawWarningGroups([target], '42'); reader.add({ revision: '42', pageIds: [id(0)], totalRows: 20, totalGroups: 10, groupOffset: 0, rowOffset: 0, groups, hasMore: false, nextAfterOrder: 10 });
  const reference = new EvaluationWarningStream(target); reference.add(rows.map(normalize));
  expect(reader.result()[id(0)]).toEqual(reference.result());
  expect(reader.result()[id(0)].sameVideo.candidates.map(row => row.id)).toEqual([id(1), id(2), id(3)]);
});

test('adaptive flat decoder rejects incomplete, switched and malformed continuations', async () => {
  const { EvaluationWarningAdaptiveCodec, WARNING_TUPLE_FIELDS } = await import('../lib/admin/evaluation-warning-adaptive-codec');
  const rows = Array.from({length:201},(_,n)=>({...attrs(),id:id(n),created_at:n%2?'2026-01-01T00:00:00.000002+00:00':null,video_id:'ABCDEFGHIJK'}));
  const target=normalize(rows[0]);
  const cursor=(offset:number)=>({revision:'42',mode:'flat',pageIds:[id(0)],totalRows:201,offset,afterId:id(offset-1),afterCreated:rows[offset-1].created_at});
  const tuples=rows.map(row=>WARNING_TUPLE_FIELDS.map(key=>row[key]));
  const first={codecVersion:1,mode:'flat',revision:'42',pageIds:[id(0)],totalRows:201,rowOffset:0,tuples:tuples.slice(0,100),hasMore:true,cursor:cursor(100)};
  const second={...first,rowOffset:100,tuples:tuples.slice(100),hasMore:false,cursor:cursor(201)};
  const reference=new EvaluationWarningStream(target);reference.add(rows.map(normalize));
  const good=new EvaluationWarningAdaptiveCodec([target],'42');good.add(first);good.add(second);expect(good.result()[id(0)]).toEqual(reference.result());
  for(const corrupt of [{...second,mode:'grouped'},{...second,rowOffset:101},{...second,tuples:tuples.slice(99)},
    {...second,cursor:{...cursor(201),mode:'grouped'}},{...second,cursor:{...cursor(201),afterCreated:'wrong'}},
    {...second,tuples:[tuples[0],...tuples.slice(101)]},{...second,tuples:tuples.slice(100,-1)},
    {...second,tuples:tuples.slice(100).map((tuple,n)=>n?tuple:tuple.slice(1))}]){
    const reader=new EvaluationWarningAdaptiveCodec([target],'42');reader.add(first);expect(()=>reader.add(corrupt)).toThrow('EVALUATION_RECORDS_UNAVAILABLE');
  }
});
