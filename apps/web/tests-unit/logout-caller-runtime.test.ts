import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { AuthLogoutSupersededError, isSupersededLogout } from '../lib/auth/logout-result';

const ts = createRequire(import.meta.url)('typescript');
const callers = [
  ['components/home/HomeMapUserMenu.tsx', 'handleLogout'],
  ['components/home/MobileControlOverlay.tsx', 'handleLogoutClick'],
  ['components/mypage/MyPageTopActions.tsx', 'handleLogout'],
  ['components/mypage/MyPageSidebar.tsx', 'handleLogout'],
  ['app/mypage/mypage-layout-content.tsx', 'handleLogout'],
];

for (const [file, name] of callers) for (const outcome of ['superseded', 'success', 'failure']) {
  test(`${file} ${outcome} preserves the logout action boundary`, async () => {
    const source = ts.createSourceFile(file, readFileSync(path.join(import.meta.dir, '..', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer;
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(Boolean(initializer)).toBe(true);
    const calls = { navigate: 0, clear: 0, success: 0, failure: 0, close: 0 };
    const context = vm.createContext({
      useCallback: fn => fn, isSupersededLogout,
      signOut: async () => {
        if (outcome === 'superseded') throw new AuthLogoutSupersededError();
        if (outcome === 'failure') throw new Error('SYNTHETIC_LOGOUT_FAILURE');
      },
      queryClient: { clear: () => calls.clear++ },
      router: { push: () => calls.navigate++ },
      toast: { success: () => calls.success++, error: () => calls.failure++ },
      closeUserMenu: () => calls.close++, console: { error() {} },
    });
    // Execute the actual handler AST, with only UI/IO side effects substituted.
    const compiled = ts.transpileModule(`globalThis.handler = ${initializer.getText(source)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInContext(compiled, context);
    await context.handler();
    if (outcome === 'superseded') expect(calls).toEqual({ navigate: 0, clear: 0, success: 0, failure: 0, close: 0 });
    else if (outcome === 'failure') {
      expect(calls.navigate + calls.clear + calls.success).toBe(0);
      expect(calls.failure).toBe(1);
    } else {
      expect(calls.navigate).toBe(1);
      expect(calls.success).toBe(1);
      expect(calls.failure).toBe(0);
    }
  });
}
