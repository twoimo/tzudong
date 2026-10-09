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

  test('preserves audit/readback metadata in scoped action messages', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');

    expect(panelSource).toContain('function getMutationAuditText(payload: AdminUserMutationResponse | null)');
    expect(panelSource).toContain('payload?.auditId ? `감사 ID: ${payload.auditId}`');
    expect(panelSource).toContain('payload?.preflightAuditId ? `사전 감사 ID: ${payload.preflightAuditId}`');
    expect(panelSource).toContain('payload?.step ? `단계: ${payload.step}`');
    expect(panelSource).toContain('const auditText = getMutationAuditText(payload);');
    expect(panelSource).toContain('const nextUsers = await loadUsers();');
    expect(panelSource).toContain('status: refreshed ? "success" : "warning"');
    expect(panelSource).toContain('? `적용 완료: ${message}${auditText} 상태를 다시 확인했습니다.`');
    expect(panelSource.indexOf('const nextUsers = await loadUsers();')).toBeLessThan(panelSource.indexOf('status: refreshed ? "success" : "warning"'));
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
const userReadbackLogic = userReadbackSource.slice(userReadbackSource.indexOf('function createPendingUserReadback('), userReadbackSource.indexOf('const DEFAULT_SUMMARY:'));
const userReadbackFunctions = new Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(`${userReadbackLogic}\nreturn { createPendingUserReadback, matchesPendingUserReadback };`))() as {
  createPendingUserReadback: (id: string, input: ReadbackInput, action: string, message: string) => Readback;
  matchesPendingUserReadback: (users: ReadbackUser[] | null, pending: Readback) => boolean;
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
    expect(userReadbackSource).toContain('pendingReadbackRef.current === pendingAtReadStart && matchesPendingUserReadback(readbackUsers, pendingAtReadStart)');
    expect(userReadbackSource).toContain('user_id: pendingAtReadStart.targetUserId');
    expect(userReadbackSource).toContain('if (searchQuery.trim()) params.set("search", searchQuery.trim());');
    expect(userReadbackSource).toContain('const refreshed = matchesPendingUserReadback(nextUsers, pending);');
    expect(userReadbackSource).toContain('if (pendingReadback && intent.type === "select") return;');
    expect(userReadbackSource).toContain('const uncertain = Boolean(pendingReadbackRef.current);');
    expect(userReadbackSource).toContain('if (response.status >= 400 && response.status < 500) updatePendingReadback(null);');
    expect(userReadbackSource.indexOf('updatePendingReadback(expectedReadback);')).toBeLessThan(userReadbackSource.indexOf('const response = await fetch(`/api/admin/users/${'));
  });
});

const loadStart=userReadbackSource.indexOf('  const loadUsers = useCallback(');
const loadEnd=userReadbackSource.indexOf('  useEffect(() => {\n    const controller = new AbortController();',loadStart);
const loadSource=userReadbackSource.slice(loadStart,loadEnd);
const userLoadHarness=new Function(new Bun.Transpiler({loader:'ts'}).transformSync(`
 return (pending,exactUser) => {
  const searchQuery='before-name'; const pendingReadbackRef={current:pending}; const usersReadGeneration={current:0};
  const matchesPendingUserReadback=${userReadbackFunctions.matchesPendingUserReadback.toString()};
  let users=[],result=null,error='',selectedUserId=pending.targetUserId,isLoading=false,wait=null;const urls=[];
  const DEFAULT_SUMMARY={};const useCallback=f=>f;const toast=()=>{};
  const setUsers=v=>{users=v;};const setSummary=()=>{};const setIsLoading=v=>{isLoading=v;};const setErrorMessage=v=>{error=v;};
  const setMutationResult=v=>{result=v;};const updatePendingReadback=v=>{pendingReadbackRef.current=v;};const setSelectedUserId=f=>{selectedUserId=f(selectedUserId);};
  const fetch=async(url,init)=>{urls.push({url,cache:init.cache});const exact=new URL(url,'http://fixture.test').searchParams.has('user_id');const value=exact?exactUser:[];const pause=exact?wait:null;if(exact)wait=null;if(pause)await pause;return {ok:true,json:async()=>({users:value,summary:{}})};};
  ${loadSource}
  return {loadUsers,setExactUser:v=>{exactUser=v;},deferNextExact:()=>{let release;wait=new Promise(resolve=>{release=resolve;});return release;},state:()=>({users,result,error,pending:pendingReadbackRef.current,urls,isLoading,selectedUserId})};
 };`))() as (pending: Readback, user: ReadbackUser[])=>{loadUsers:(signal?:AbortSignal)=>Promise<ReadbackUser[]|null>;setExactUser:(user:ReadbackUser[])=>void;deferNextExact:()=>()=>void;state:()=>{users:ReadbackUser[];result:{status:string}|null;pending:Readback|null;isLoading:boolean;urls:Array<{url:string;cache:string}>}};

test('profile renamed outside active search confirms only the authenticated exact target and preserves filtered list',async()=>{
 const before={id:'00000000-0000-4000-9000-000000000101',nickname:'before-name',username:'before-user',avatarUrl:null,isAdmin:false,isDisabled:false};
 const pending=userReadbackFunctions.createPendingUserReadback(before.id,{profile:{nickname:'after-name',username:'after-user',avatarUrl:''}},'profile','synthetic');
 const after={...before,nickname:'after-name',username:'after-user'};const h=userLoadHarness(pending,[after]);
 expect(await h.loadUsers()).toEqual([after]);expect(h.state().pending).toBeNull();expect(h.state().result?.status).toBe('success');expect(h.state().users).toEqual([]);
 expect(h.state().urls).toEqual([{url:'/api/admin/users?user_id='+before.id,cache:'no-store'},{url:'/api/admin/users?perPage=120&search=before-name',cache:'no-store'}]);
});
test('missing, wrong, and newer nonmatching exact results never release the pending readback lock',async()=>{
 const before={id:'00000000-0000-4000-9000-000000000101',nickname:'before-name',username:'before-user',avatarUrl:null,isAdmin:false,isDisabled:false};
 const pending=userReadbackFunctions.createPendingUserReadback(before.id,{role:'admin'},'role','synthetic');
 for(const rows of [[],[{...before,id:'wrong'}],[before]]){const h=userLoadHarness(pending,rows);await h.loadUsers();expect(h.state().pending).not.toBeNull();expect(h.state().result).toBeNull();}
 const h=userLoadHarness(pending,[{...before,isAdmin:true}]);const release=h.deferNextExact();const stale=h.loadUsers();h.setExactUser([before]);await h.loadUsers();release();await stale;
 expect(h.state().pending).not.toBeNull();expect(h.state().result).toBeNull();
});

test('aborted earlier exact read cannot confirm mutation or clear a newer request loading state',async()=>{
 const user={id:'00000000-0000-4000-9000-000000000101',nickname:'before-name',username:'before-user',avatarUrl:null,isAdmin:true,isDisabled:false};
 const pending=userReadbackFunctions.createPendingUserReadback(user.id,{role:'admin'},'role','synthetic');
 const h=userLoadHarness(pending,[user]);const controller=new AbortController();const releaseOld=h.deferNextExact();const old=h.loadUsers(controller.signal);
 const releaseNew=h.deferNextExact();h.setExactUser([{...user,isAdmin:false}]);const fresh=h.loadUsers();controller.abort();releaseOld();await old;
 expect(h.state().pending).not.toBeNull();expect(h.state().result).toBeNull();expect(h.state().isLoading).toBe(true);
 releaseNew();await fresh;expect(h.state().pending).not.toBeNull();expect(h.state().isLoading).toBe(false);
});
