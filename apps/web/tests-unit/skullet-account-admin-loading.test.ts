import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Element = { type: string; props: Record<string, unknown> };
const read = (path: string) => readFileSync(join(import.meta.dir, '..', path), 'utf8');

// Evaluate only a presentation function: module imports, providers, query hooks
// and admin handlers never execute in this harness.
function presentation(path: string, name: string, props: Record<string, unknown> = {}) {
  const source = read(path);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error('Missing presentation function');
  const constants = tree.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item =>
    ['STORYBOARD_MODULE_LOADING_CUT_NOS', 'THUMBNAIL_MODULE_LOADING_TOOL_IDS'].includes(item.name.getText(tree))))
    .map(node => node.getText(tree)).join('\n');
  const code = ts.transpileModule(`${constants}\n${declaration.getText(tree)}\nexports.render = ${name};`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { render?: (props: Record<string, unknown>) => Element } = {};
  const jsx = (type: string, value: Record<string, unknown>): Element => ({ type, props: value });
  runInNewContext(code, {
    exports,
    require(name: string) {
      if (name !== 'react/jsx-runtime') throw new Error('Presentation imported a dependency');
      return { jsx, jsxs: jsx, Fragment: 'fragment' };
    },
    LoadingSurface: 'LoadingSurface', LoadingPreview: 'LoadingPreview',
    Button: 'Button', X: 'X', UserProfileTabSkeleton: 'UserProfileTabSkeleton',
    AdminPageHeader: 'AdminPageHeader', Clapperboard: 'Clapperboard', ImageIcon: 'ImageIcon',
    getAdminModuleTitle: (moduleId: string) => moduleId,
    cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
    useFilledSkeletonCount: () => ({ ref: null, count: 3 }),
  });
  if (!exports.render) throw new Error('Missing render');
  return exports.render(props);
}

function visit(value: unknown, inspect: (node: Element) => void) {
  if (Array.isArray(value)) { value.forEach(item => visit(item, inspect)); return; }
  if (!value || typeof value !== 'object' || !('type' in value) || !('props' in value)) return;
  const node = value as Element;
  inspect(node);
  visit(node.props.children, inspect);
}

function assertPassiveSamples(tree: Element) {
  let surfaces = 0;
  visit(tree, node => {
    if (node.type === 'LoadingPreview') {
      surfaces++;
      expect(Object.keys(node.props).every(key => ['kind', 'rows', 'showHeader', 'compact', 'className', 'style', 'label'].includes(key))).toBe(true);
    }
    if (node.type !== 'LoadingSurface') return;
    surfaces++;
    visit(node.props.children, sample => {
      expect(sample.type).toMatch(/^[a-z][a-z0-9-]*$/);
      for (const [key, value] of Object.entries(sample.props)) {
        expect(key).not.toMatch(/^on[A-Z]/);
        expect(typeof value).not.toBe('function');
        expect(['src', 'href', 'dangerouslySetInnerHTML'].includes(key)).toBe(false);
      }
    });
  });
  expect(surfaces).toBeGreaterThan(0);
}

describe('account and admin measured loading samples', () => {
  for (const [path, name, props] of [
    ['components/auth/ResetPasswordProgressiveSkeleton.tsx', 'ResetPasswordProgressiveSkeleton', {}],
    ['components/mypage/MyPageSectionSkeleton.tsx', 'MyPageSectionSkeleton', {}],
    ['app/mypage/mypage-layout-content.tsx', 'MyPageContentLoadingState', {}],
    ['components/profile/UserProfileProgressiveSkeleton.tsx', 'UserProfileTabSkeleton', { label: '활동 로딩 중' }],
    ['app/admin/banners/page.tsx', 'BannerListItemSkeleton', { index: 0 }],
    ['components/admin/AdminUsersPanel.tsx', 'UserTableSkeleton', {}],
    ['components/admin/AdminRestaurantRefreshHistoryPanel.tsx', 'RefreshCandidateListSkeleton', {}],
    ['components/admin/AdminConsoleOverview.tsx', 'AdminDashboardKpiValueSkeleton', {}],
    ['components/admin/AdminConsoleOverview.tsx', 'AdminStoryboardModuleLoadingSkeleton', {}],
    ['components/admin/AdminConsoleOverview.tsx', 'AdminYoutubeThumbnailModuleLoadingSkeleton', {}],
    ...['chart', 'table', 'ops', 'bubble', 'line', 'stacked', 'diagnosis'].map(variant =>
      ['components/admin/AdminConsoleOverview.tsx', 'AdminDashboardPanelBodySkeleton', { variant }]),
  ] as [string, string, Record<string, unknown>][]) {
    test(`${name} ${String(props.variant ?? '')} runs without records or service dependencies`, () => {
      assertPassiveSamples(presentation(path, name, props));
    });
  }

  test('profile header and close action stay outside measured samples', () => {
    const header: Element = { type: 'private-header', props: { children: 'PRIVATE_HEADER_SENTINEL' } };
    let calls = 0;
    const onBack = () => { calls++; };
    const path = 'components/profile/UserProfileProgressiveSkeleton.tsx';
    const withHeader = presentation(path, 'UserProfileProgressiveSkeleton', { header, showCloseButton: true, onBack });
    assertPassiveSamples(withHeader);
    let headerCount = 0;
    let buttonCount = 0;
    visit(withHeader, node => { if (node === header) headerCount++; if (node.type === 'Button') buttonCount++; });
    expect(headerCount).toBe(1);
    expect(buttonCount).toBe(0);
    const withoutHeader = presentation(path, 'UserProfileProgressiveSkeleton', { showCloseButton: true, onBack });
    assertPassiveSamples(withoutHeader);
    visit(withoutHeader, node => { if (node.type === 'Button') { buttonCount++; expect(node.props.onClick).toBe(onBack); } });
    expect(buttonCount).toBe(1);
    expect(calls).toBe(0);
  });

  test('generation retains progress status instead of measuring the editor', () => {
    const source = read('components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx');
    const tree = ts.createSourceFile('generation.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const generation: ts.ConditionalExpression[] = [];
    const walk = (node: ts.Node) => {
      if (ts.isConditionalExpression(node) && node.condition.getText(tree) === 'isGenerating' && node.whenTrue.getText(tree).includes('data-thumbnail-generation-skeleton')) generation.push(node);
      ts.forEachChild(node, walk);
    };
    walk(tree);
    expect(generation).toHaveLength(1);
    const branch = generation[0].whenTrue.getText(tree);
    expect(branch).toContain('role="status"');
    expect(branch).toContain('aria-busy="true"');
    expect(branch).toContain('Loader2');
    expect(branch).not.toMatch(/LoadingSurface|LoadingPreview/);
  });
});

// Composite children are deliberately rejected here, including a local count
// helper that would otherwise hide a second Skullet boundary from a text scan.
function measuredSampleViolations(source: string) {
  const tree = ts.createSourceFile('sample.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const surfaceNames = new Set(['LoadingSurface']);
  const previewNames = new Set(['LoadingPreview']);
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)
        || node.moduleSpecifier.text !== '@/components/ui/loading-surface') continue;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      const imported = (item.propertyName ?? item.name).text;
      if (imported === 'LoadingSurface') surfaceNames.add(item.name.text);
      if (imported === 'LoadingPreview') previewNames.add(item.name.text);
    }
  }
  function inspectSample(node: ts.Node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(tree);
      if (!/^[a-z][a-z0-9-]*$/.test(tag)) violations.push('non-dom-child:' + tag);
    }
    if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(tree))) violations.push('event-handler');
    if (ts.isJsxSpreadAttribute(node)) violations.push('spread-props');
    if (ts.isCallExpression(node)) {
      const call = node.expression;
      const fromArray = ts.isPropertyAccessExpression(call) && call.name.text === 'from'
        && ts.isIdentifier(call.expression) && call.expression.text === 'Array';
      const staticMap = ts.isPropertyAccessExpression(call) && call.name.text === 'map'
        && (ts.isArrayLiteralExpression(call.expression)
          || (ts.isCallExpression(call.expression) && call.expression.expression.getText(tree) === 'Array.from'));
      const classNames = ts.isIdentifier(call) && call.text === 'cn';
      if (!fromArray && !staticMap && !classNames) violations.push('sample-call:' + call.getText(tree));
    }
    ts.forEachChild(node, inspectSample);
  }
  function walk(node: ts.Node) {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(tree);
      if (surfaceNames.has(tag)) node.children.forEach(inspectSample);
      if (previewNames.has(tag) && node.children.some(child => !ts.isJsxText(child) || child.text.trim())) violations.push('preview-children');
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return violations;
}

const ownedLoadingPaths = [
  'app/auth/reset-password/page.tsx', 'app/mypage/bookmarks/page.tsx',
  'app/mypage/mypage-layout-content.tsx', 'app/mypage/reviews/page.tsx',
  'app/mypage/submissions/edit/page.tsx', 'app/mypage/submissions/new/page.tsx',
  'app/mypage/submissions/recommend/page.tsx',
  'components/auth/ResetPasswordProgressiveSkeleton.tsx',
  'components/mypage/MyPageSectionSkeleton.tsx', 'components/profile/UserProfilePanel.tsx',
  'components/profile/UserProfileProgressiveSkeleton.tsx', 'app/insights/insights-client.tsx',
  'components/admin/AdminConsoleOverview.tsx', 'components/admin/AdminOverviewDashboard.tsx',
  'app/admin/banners/page.tsx', 'app/admin/evaluations/page.tsx',
  'components/admin/AdminRestaurantRefreshHistoryPanel.tsx', 'components/admin/AdminReviewPanel.tsx',
  'components/admin/AdminSentryPanel.tsx', 'components/admin/AdminUsersPanel.tsx',
  'components/admin/EvaluationTableNew.tsx', 'components/admin/SubmissionListView.tsx',
  'components/admin/system-status/AdminSystemStatusCenter.tsx',
  'components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx',
];

describe('owned measured boundaries never contain another loader or action', () => {
  for (const path of ownedLoadingPaths) {
    test(path, () => expect(measuredSampleViolations(read(path))).toEqual([]));
  }

  test('rejects direct, aliased, helper-hidden and callback-hidden nesting', () => {
    for (const source of [
      '<LoadingSurface label="outer"><LoadingSurface label="inner"><span>00</span></LoadingSurface></LoadingSurface>',
      '<LoadingSurface label="outer"><LoadingPreview /></LoadingSurface>',
      'import { LoadingSurface as Measure } from "@/components/ui/loading-surface"; <Measure label="outer"><LoadingPreview /></Measure>',
      'function Count() { return <LoadingSurface label="count"><span>00</span></LoadingSurface>; } <LoadingSurface label="outer"><Count /></LoadingSurface>',
      '<LoadingSurface label="outer">{Array.from({ length: 2 }, () => <LoadingPreview />)}</LoadingSurface>',
      '<LoadingSurface label="outer">{renderCount()}</LoadingSurface>',
      '<LoadingSurface label="outer"><button onClick={submit}>확인</button></LoadingSurface>',
    ]) expect(measuredSampleViolations(source).length).toBeGreaterThan(0);
  });

  test('accepts independent count boundaries and plain sample counts', () => {
    expect(measuredSampleViolations('<><LoadingSurface label="count"><span>00</span></LoadingSurface><LoadingSurface label="list"><div><span>00</span>{[1, 2].map(index => <p key={index}>목록</p>)}</div></LoadingSurface></>')).toEqual([]);
  });
});
