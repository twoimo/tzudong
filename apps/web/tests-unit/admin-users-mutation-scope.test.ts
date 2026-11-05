import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin users mutation result scope contract', () => {
  test('scopes mutation results by action and selected target', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');

    expect(panelSource).toContain('type AdminUserMutationAction = "profile" | "role" | "accountStatus";');
    expect(panelSource).toContain('type AdminUserMutationResult = {');
    expect(panelSource).toContain('targetUserId: string | null;');
    expect(panelSource).toContain('const [mutationResult, setMutationResult]');
    expect(panelSource).not.toContain('lastActionMessage');

    expect(panelSource).not.toContain('clearCreateErrorResult');
    expect(panelSource).toContain('current.targetUserId === selectedUser?.id ? current : null');
    expect(panelSource).toContain('const visibleMutationResult =');
    expect(panelSource).toContain('!mutationResult?.targetUserId || mutationResult.targetUserId === selectedUser?.id');
    expect(panelSource).toContain('data-admin-user-mutation-action={visibleMutationResult?.action ?? undefined}');
    expect(panelSource).toContain('data-admin-user-mutation-target={visibleMutationResult?.targetUserId ?? undefined}');
  });

  test('renders the nested audit receipt returned by the mutation route', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');
    const start = panelSource.indexOf('function getMutationAuditText(');
    const end = panelSource.indexOf('function SummaryMetric(', start);
    const getMutationAuditText = new Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(`${panelSource.slice(start, end)}\nreturn getMutationAuditText;`))() as (payload: unknown) => string;

    expect(getMutationAuditText({ audit: { readbackId: 'readback-1', correlationId: 'intent-1', auditIds: ['intent-1', 'readback-1'] } }))
      .toBe(' 감사 ID: readback-1 · 사전 감사 ID: intent-1');
  });

  test('preserves audit/readback metadata in scoped action messages', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');

    expect(panelSource).toContain('function getMutationAuditText(payload: AdminUserMutationResponse | null)');
    expect(panelSource).toContain('payload?.audit?.readbackId ?? payload?.auditId');
    expect(panelSource).toContain('payload?.audit?.correlationId ?? payload?.preflightAuditId');
    expect(panelSource).toContain('readbackId ? `감사 ID: ${readbackId}`');
    expect(panelSource).toContain('correlationId ? `사전 감사 ID: ${correlationId}`');
    expect(panelSource).toContain('payload?.step ? `단계: ${payload.step}`');
    expect(panelSource).toContain('const auditText = getMutationAuditText(payload);');
    expect(panelSource).toContain('const nextUsers = await loadUsers();');
    expect(panelSource).toContain('message: `적용 완료: ${pendingAtReadStart.message}${pendingAtReadStart.auditText} 상태를 다시 확인했습니다.`');
    expect(panelSource).toContain('if (nextUsers?.some((candidate) => candidate.id === pending.targetUserId)) return;');
    expect(panelSource.indexOf('const nextUsers = await loadUsers();')).toBeLessThan(panelSource.indexOf('message: `변경 결과 재확인 필요: ${message}${auditText}'));
    expect(panelSource).not.toContain('목록을 다시 확인했습니다.');
    expect(panelSource).toContain(': `적용 실패: ${message}`');
  });

  test('binds each admin user mutation callsite to its isolated action', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');

    expect(panelSource).toContain('patchSelectedUser({ profile: profileForm }, "프로필 정보를 저장했습니다.", "profile")');
    expect(panelSource).toContain('patchSelectedUser({ role: "admin" }, "관리자 권한을 부여했습니다.", "role")');
    expect(panelSource).toContain('patchSelectedUser({ role: "user" }, "관리자 권한을 회수했습니다.", "role")');
    expect(panelSource).toContain('patchSelectedUser({ accountStatus: "disabled" }, "계정을 비활성화했습니다.", "accountStatus")');
    expect(panelSource).toContain('patchSelectedUser({ accountStatus: "active" }, "계정을 재활성화했습니다.", "accountStatus")');
    expect(panelSource).not.toContain('action: "create"');
    expect(panelSource).toContain('새 계정은 개인정보 온보딩 가입 절차를 통해서만 만들 수 있습니다.');
  });
});

type ReadbackUser = { id: string; nickname: string; username: string; avatarUrl: string | null; isAdmin: boolean; isDisabled: boolean };
type ReadbackInput = { profile?: { nickname: string; username: string; avatarUrl: string }; role?: 'admin' | 'user'; accountStatus?: 'active' | 'disabled' };
type Readback = { targetUserId: string; expected: Partial<ReadbackUser> };
const userReadbackSource = source('components/admin/AdminUsersPanel.tsx');
const intentStart = userReadbackSource.indexOf('  const cancelPendingIntent =');
const intentEnd = userReadbackSource.indexOf('  const patchSelectedUser =', intentStart);
const intentSource = userReadbackSource.slice(intentStart, intentEnd);
const createIntentHarness = new Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(`
 return ({ isMutating = false, pendingReadback = null, isProfileDirty = true } = {}) => {
  let pendingIntent = null, searchInput = 'typed-query', searchQuery = 'applied-query', userFilter = 'all', sortOrder = 'newest', page = 3, selectedUserId = 'selected-user', loads = 0;
  const setPendingIntent = value => { pendingIntent = value; };
  const setSearchInput = value => { searchInput = value; };
  const setSearchQuery = value => { searchQuery = value; };
  const setUserFilter = value => { userFilter = value; };
  const setSortOrder = value => { sortOrder = value; };
  const setPage = value => { page = value; };
  const setSelectedUserId = value => { selectedUserId = value; };
  const setDetailTab = () => {};
  const detailRef = { current: { focus() {} } };
  const requestAnimationFrame = callback => callback();
  const loadUsers = async () => { loads++; };
  ${intentSource}
  return { requestIntent, applyIntent, cancelPendingIntent, state: () => ({ pendingIntent, searchInput, searchQuery, userFilter, sortOrder, page, selectedUserId, loads }) };
 };`))() as (options?: { isMutating?: boolean; pendingReadback?: object | null; isProfileDirty?: boolean }) => {
  requestIntent: (intent: Record<string, unknown>) => void;
  applyIntent: (intent: Record<string, unknown>) => void;
  cancelPendingIntent: () => void;
  state: () => { pendingIntent: Record<string, unknown> | null; searchInput: string; searchQuery: string; userFilter: string; sortOrder: string; page: number; selectedUserId: string | null; loads: number };
};

test('dirty filter, sort, search, reset and page intents do not change query state before confirmation', () => {
  for (const intent of [
    { type: 'filter', filter: 'admin' },
    { type: 'sort', sort: 'name' },
    { type: 'search', query: 'next-query' },
    { type: 'reset' },
    { type: 'page', page: 4 },
  ]) {
    const harness = createIntentHarness();
    const before = harness.state();
    harness.requestIntent(intent);
    expect(harness.state()).toEqual({ ...before, pendingIntent: intent });
    harness.cancelPendingIntent();
    expect(harness.state()).toEqual({ ...before, pendingIntent: null, searchInput: before.searchQuery });
  }
});

test('mutation and pending readback block query controls while explicit readback refresh remains available', () => {
  const mutating = createIntentHarness({ isMutating: true });
  mutating.requestIntent({ type: 'filter', filter: 'admin' });
  expect(mutating.state().pendingIntent).toBeNull();

  const pending = createIntentHarness({ pendingReadback: {} });
  pending.requestIntent({ type: 'sort', sort: 'name' });
  expect(pending.state().pendingIntent).toBeNull();
  pending.requestIntent({ type: 'refresh' });
  expect(pending.state().loads).toBe(1);
});

const userReadbackLogic = userReadbackSource.slice(userReadbackSource.indexOf('function createPendingUserReadback('), userReadbackSource.indexOf('const DEFAULT_SUMMARY:'));
const userReadbackFunctions = new Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(`${userReadbackLogic}\nreturn { createPendingUserReadback, matchesPendingUserReadback, mergeExactUserReadback, isExactAdminUserId };`))() as {
  createPendingUserReadback: (id: string, input: ReadbackInput, action: string, message: string) => Readback;
  matchesPendingUserReadback: (users: ReadbackUser[] | null, pending: Readback) => boolean;
  mergeExactUserReadback: (users: ReadbackUser[], exact: ReadbackUser) => ReadbackUser[];
  isExactAdminUserId: (value: string) => boolean;
};

describe('admin users expected mutation readback', () => {
  const initial: ReadbackUser = { id: 'synthetic-user', nickname: 'before', username: 'before-user', avatarUrl: null, isAdmin: false, isDisabled: false };
  test('does not confirm a present user whose profile remains old or only partly changed', () => {
    const input = { profile: { nickname: ' after ', username: ' after-user ', avatarUrl: '' } };
    const pending = userReadbackFunctions.createPendingUserReadback(initial.id, input, 'profile', 'synthetic');
    input.profile.nickname = 'later-editor-change';
    expect(userReadbackFunctions.matchesPendingUserReadback([initial], pending)).toBe(false);
    expect(userReadbackFunctions.matchesPendingUserReadback([{ ...initial, nickname: 'after' }], pending)).toBe(false);
    expect(userReadbackFunctions.matchesPendingUserReadback([{ ...initial, nickname: 'after', username: 'after-user' }], pending)).toBe(true);
    expect(userReadbackFunctions.matchesPendingUserReadback([{ ...initial, nickname: 'after', username: 'after-user', avatarUrl: 'unexpected' }], pending)).toBe(false);
  });
  test('requires the requested role and account status, including reversed changes', () => {
    for (const [input, action, after] of [
      [{ role: 'admin' }, 'role', { ...initial, isAdmin: true }],
      [{ accountStatus: 'disabled' }, 'accountStatus', { ...initial, isDisabled: true }],
    ] as const) {
      const pending = userReadbackFunctions.createPendingUserReadback(initial.id, input, action, 'synthetic');
      expect(userReadbackFunctions.matchesPendingUserReadback(null, pending)).toBe(false);
      expect(userReadbackFunctions.matchesPendingUserReadback([], pending)).toBe(false);
      expect(userReadbackFunctions.matchesPendingUserReadback([{ ...after, id: 'other-user' }], pending)).toBe(false);
      expect(userReadbackFunctions.matchesPendingUserReadback([initial], pending)).toBe(false);
      expect(userReadbackFunctions.matchesPendingUserReadback([after], pending)).toBe(true);
      expect(userReadbackFunctions.matchesPendingUserReadback([initial], pending)).toBe(false);
    }
  });
  test('keeps uncertain results locked independently of selection and checks immediate and later readbacks', () => {
    expect(userReadbackSource).toContain('if (pendingReadbackRef.current) return current;');
    expect(userReadbackSource).toContain('if (pendingReadbackRef.current === pendingAtReadStart)');
    expect(userReadbackSource).toContain('if (matchesPendingUserReadback(readbackUsers, pendingAtReadStart))');
    expect(userReadbackSource).toContain('setReadbackConflict({ pending: pendingAtReadStart, latest });');
    expect(userReadbackSource).toContain('user_id: pendingAtReadStart.targetUserId');
    expect(userReadbackSource).toContain('params.set(isExactAdminUserId(normalizedSearch) ? "user_id" : "search", normalizedSearch);');
    expect(userReadbackSource).toContain('setUsers((current) => mergeExactUserReadback(current, latest));');
    expect(userReadbackSource).toContain('if (nextUsers?.some((candidate) => candidate.id === pending.targetUserId)) return;');
    expect(userReadbackSource).toContain('if (isMutating || (pendingReadback && intent.type !== "refresh")) return;');
    expect(userReadbackSource).toContain('const uncertain = Boolean(pendingReadbackRef.current);');
    expect(userReadbackSource).toContain('if (response.status >= 400 && response.status < 500) {');
    expect(userReadbackSource).toContain('onClick={acceptLatestUserReadback}>최신 상태 수용</Button>');
    expect(userReadbackSource.indexOf('updatePendingReadback(expectedReadback);')).toBeLessThan(userReadbackSource.indexOf('const response = await fetch(`/api/admin/users/${'));
  });
});

const loadStart=userReadbackSource.indexOf('  const loadUsers = useCallback(');
const loadEnd=userReadbackSource.indexOf('  useEffect(() => {\n    const controller = new AbortController();',loadStart);
const loadSource=userReadbackSource.slice(loadStart,loadEnd);
const acceptStart=userReadbackSource.indexOf('  const acceptLatestUserReadback =');
const acceptEnd=userReadbackSource.indexOf('  const visibleMutationResult =',acceptStart);
const acceptSource=userReadbackSource.slice(acceptStart,acceptEnd);
type UserLoadHarness = {loadUsers:(signal?:AbortSignal)=>Promise<ReadbackUser[]|null>;acceptLatestUserReadback:()=>void;setExactUser:(user:ReadbackUser[])=>void;setListFailure:(value:boolean)=>void;deferNextExact:()=>()=>void;state:()=>{users:ReadbackUser[];result:{status:string}|null;error:string;pending:Readback|null;conflict:{pending:Readback;latest:ReadbackUser}|null;isLoading:boolean;urls:Array<{url:string;cache:string}>}};
const userLoadHarness=new Function(new Bun.Transpiler({loader:'ts'}).transformSync(`
 return (pending,exactUser,initialUsers=[]) => {
  const searchQuery='before-name',page=1,userFilter='all',sortOrder='newest',ADMIN_USERS_PER_PAGE=120; const pendingReadbackRef={current:pending}; const usersReadGeneration={current:0};
  const matchesPendingUserReadback=${userReadbackFunctions.matchesPendingUserReadback.toString()};
  const mergeExactUserReadback=${userReadbackFunctions.mergeExactUserReadback.toString()};
  const isExactAdminUserId=${userReadbackFunctions.isExactAdminUserId.toString()};
  let users=initialUsers,result=null,error='',selectedUserId=pending.targetUserId,isLoading=false,isMutating=false,wait=null,failList=false,readbackConflict=null;const urls=[];
  const DEFAULT_SUMMARY={};const useCallback=f=>f;const toast=()=>{};
  const setUsers=v=>{users=typeof v==='function'?v(users):v;};const setSummary=()=>{};const setPagination=()=>{};const setIsLoading=v=>{isLoading=v;};const setErrorMessage=v=>{error=v;};
  const setMutationResult=v=>{result=v;};const updatePendingReadback=v=>{pendingReadbackRef.current=v;};const setReadbackConflict=v=>{readbackConflict=v;};const setSelectedUserId=f=>{selectedUserId=f(selectedUserId);};
  const fetch=async(url,init)=>{urls.push({url,cache:init.cache});const exact=new URL(url,'http://fixture.test').searchParams.has('user_id');const value=exact?exactUser:[];const pause=exact?wait:null;if(exact)wait=null;if(pause)await pause;if(!exact&&failList)return {ok:false,json:async()=>({error:'synthetic-list-failure'})};return {ok:true,json:async()=>({users:value,summary:{},page:1,perPage:120,total:value.length,sourceTotal:value.length,isPartial:false,hasPreviousPage:false,hasNextPage:false})};};
  ${loadSource}
  ${acceptSource}
  return {loadUsers,acceptLatestUserReadback,setExactUser:v=>{exactUser=v;},setListFailure:v=>{failList=v;},deferNextExact:()=>{let release;wait=new Promise(resolve=>{release=resolve;});return release;},state:()=>({users,result,error,pending:pendingReadbackRef.current,conflict:readbackConflict,urls,isLoading,selectedUserId})};
 };`))() as (pending: Readback, user: ReadbackUser[], initialUsers?: ReadbackUser[])=>UserLoadHarness;

test('profile renamed outside active search confirms only the authenticated exact target and preserves filtered list',async()=>{
 const before={id:'00000000-0000-4000-9000-000000000101',nickname:'before-name',username:'before-user',avatarUrl:null,isAdmin:false,isDisabled:false};
 const pending=userReadbackFunctions.createPendingUserReadback(before.id,{profile:{nickname:'after-name',username:'after-user',avatarUrl:''}},'profile','synthetic');
 const after={...before,nickname:'after-name',username:'after-user'};const h=userLoadHarness(pending,[after]);
 expect(await h.loadUsers()).toEqual([after]);expect(h.state().pending).toBeNull();expect(h.state().result?.status).toBe('success');expect(h.state().users).toEqual([]);
 expect(h.state().urls).toEqual([{url:'/api/admin/users?user_id='+before.id,cache:'no-store'},{url:'/api/admin/users?page=1&perPage=120&filter=all&sort=newest&search=before-name',cache:'no-store'}]);
});
test('exact success updates the visible row even when the following list request fails',async()=>{
 const before={id:'00000000-0000-4000-9000-000000000101',nickname:'before-name',username:'before-user',avatarUrl:null,isAdmin:false,isDisabled:false};
 const after={...before,nickname:'after-name',username:'after-user'};
 const pending=userReadbackFunctions.createPendingUserReadback(before.id,{profile:{nickname:'after-name',username:'after-user',avatarUrl:''}},'profile','synthetic');
 const h=userLoadHarness(pending,[after],[before]);
 h.setListFailure(true);expect(await h.loadUsers()).toEqual([after]);
 expect(h.state().pending).toBeNull();expect(h.state().result?.status).toBe('success');expect(h.state().error).toContain('사용자 목록');expect(h.state().users).toEqual([after]);
});
test('missing and wrong exact results stay locked while a valid mismatch can accept latest without another mutation',async()=>{
 const before={id:'00000000-0000-4000-9000-000000000101',nickname:'before-name',username:'before-user',avatarUrl:null,isAdmin:false,isDisabled:false};
 const pending=userReadbackFunctions.createPendingUserReadback(before.id,{role:'admin'},'role','synthetic');
 for(const rows of [[],[{...before,id:'wrong'}]]){const h=userLoadHarness(pending,rows);await h.loadUsers();expect(h.state().pending).not.toBeNull();expect(h.state().result).toBeNull();expect(h.state().conflict).toBeNull();}
 const h=userLoadHarness(pending,[before],[before]);h.setListFailure(true);await h.loadUsers();
 expect(h.state().pending).not.toBeNull();expect(h.state().result?.status).toBe('warning');expect(h.state().conflict?.latest).toEqual(before);
 const requestsBeforeAccept=h.state().urls.length;h.acceptLatestUserReadback();
 expect(h.state().pending).toBeNull();expect(h.state().conflict).toBeNull();expect(h.state().users).toEqual([before]);expect(h.state().urls.length).toBe(requestsBeforeAccept);
});

test('aborted earlier exact read cannot confirm mutation or clear a newer request loading state',async()=>{
 const user={id:'00000000-0000-4000-9000-000000000101',nickname:'before-name',username:'before-user',avatarUrl:null,isAdmin:true,isDisabled:false};
 const pending=userReadbackFunctions.createPendingUserReadback(user.id,{role:'admin'},'role','synthetic');
 const h=userLoadHarness(pending,[user]);const controller=new AbortController();const releaseOld=h.deferNextExact();const old=h.loadUsers(controller.signal);
 const releaseNew=h.deferNextExact();h.setExactUser([{...user,isAdmin:false}]);const fresh=h.loadUsers();controller.abort();releaseOld();await old;
 expect(h.state().pending).not.toBeNull();expect(h.state().result).toBeNull();expect(h.state().isLoading).toBe(true);
 releaseNew();await fresh;expect(h.state().pending).not.toBeNull();expect(h.state().isLoading).toBe(false);
});
