import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const appRoot = resolve(import.meta.dir, '..');
const repoRoot = resolve(appRoot, '../..');
const GENERATED_TYPES = 'integrations/supabase/database.types.ts';
const NON_APP_DIRS = new Set(['.next', 'node_modules', 'performance', 'public', 'tests', 'tests-formal', 'tests-unit', 'vendor']);
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const UNAPPLIED_RPCS: Record<string, string> = {
  apply_restaurant_refresh_candidate: 'backend/supabase/candidates/20260906064459_admin_restaurant_refresh_apply_boundary.sql',
  thumbnail_production_admin: 'backend/supabase/candidates/20261024071000_thumbnail_production_install.sql',
  thumbnail_production_auth_worker: 'backend/supabase/candidates/20261024071000_thumbnail_production_install.sql',
  thumbnail_production_worker: 'backend/supabase/candidates/20261024071000_thumbnail_production_install.sql',
};

type CallShape = { argsArg: number } & ({ nameArg: number } | { name: string });
type Wrapper = { file: string; call: string } & CallShape;
const WRAPPERS: readonly Wrapper[] = [
  { file: 'app/api/admin/evaluations/[id]/route.ts', call: 'rpc', nameArg: 0, argsArg: 1 },
  { file: 'app/api/admin/evaluations/automation/route.ts', call: 'rpc', nameArg: 0, argsArg: 1 },
  { file: 'app/api/admin/evaluations/recovery/route.ts', call: 'rpc', nameArg: 0, argsArg: 1 },
  { file: 'app/api/admin/record-actions/media-cleanup/route.ts', call: 'invoke', nameArg: 0, argsArg: 1 },
  { file: 'app/api/admin/record-actions/route.ts', call: 'invoke', nameArg: 0, argsArg: 1 },
  { file: 'lib/admin/evaluation-catalog-server.ts', call: 'rpc', nameArg: 0, argsArg: 1 },
  { file: 'lib/admin/record-action-service.ts', call: 'rpc', name: 'admin_record_action', argsArg: 1 },
  { file: 'lib/privacy/account-deletion-worker.ts', call: 'rpc', nameArg: 1, argsArg: 2 },
  { file: 'lib/privacy/marketing-campaigns.ts', call: 'rpc', nameArg: 1, argsArg: 2 },
  { file: 'lib/privacy/retention-runner.ts', call: 'callRpc', nameArg: 1, argsArg: 2 },
  { file: 'lib/profile-mutation.ts', call: 'invokeRpc', nameArg: 1, argsArg: 2 },
  { file: 'lib/public-profile-read.ts', call: 'invokeRpc', nameArg: 1, argsArg: 2 },
  { file: 'lib/reviews/admin-verification-cleanup.ts', call: 'deps.rpc', name: 'admin_review_verification_cleanup', argsArg: 0 },
  { file: 'lib/server/runtime-feature-readiness.ts', call: 'invoke', nameArg: 0, argsArg: 1 },
];

const BOUND_INTO_WRAPPER = 'bound into a local wrapper; WRAPPERS checks its calls';
const WRAPPER_BODY = 'wrapper body that forwards its name parameter; WRAPPERS checks its callers';
const SHAPE_GUARD = 'runtime check that the client exposes rpc; sends nothing';

type AppFile = string;
type UnresolvedSourceText = string;
type Reason = string;
const UNCHECKED: Record<AppFile, Record<UnresolvedSourceText, Reason>> = {
  'app/api/admin/evaluations/[id]/route.ts': { 'supabase.rpc': BOUND_INTO_WRAPPER },
  'app/api/admin/evaluations/automation/route.ts': { 'supabase.rpc': BOUND_INTO_WRAPPER },
  'app/api/admin/evaluations/recovery/route.ts': { 'client.rpc': BOUND_INTO_WRAPPER },
  'app/api/admin/record-actions/media-cleanup/route.ts': {
    'client.rpc': BOUND_INTO_WRAPPER,
    args: 'built by lib/admin/record-action-service.ts, whose rpc(runner, args) calls WRAPPERS checks',
  },
  'app/api/admin/record-actions/route.ts': {
    'client.rpc': BOUND_INTO_WRAPPER,
    args: 'built by lib/admin/record-action-service.ts, whose rpc(runner, args) calls WRAPPERS checks',
  },
  'app/api/internal/account-deletion/route.ts': {
    'request.args': 'dispatches args built by the rpc(client, name, args) calls in lib/privacy/account-deletion-worker.ts, which WRAPPERS checks',
  },
  'contexts/NotificationContext.tsx': {
    'request.fn': 'NotificationRpcRequest union; tsc checks its names and params against the curated types.ts only',
  },
  'lib/admin/evaluation-catalog-server.ts': { 'supabase.rpc': BOUND_INTO_WRAPPER },
  'lib/admin/storyboard/production-store.ts': {
    'name as never': 'service-role ProductionDatabase adapter; this.rpc(name, args) calls in the same file are checked',
    name: 'ProductionStore.rpc body; its this.rpc(name, args) callers are checked',
  },
  'lib/admin/youtube-thumbnail-generator/private-store.ts': {
    'name as never': 'service-role ThumbnailDatabase adapter; this.rpc(name, args) calls in the same file are checked',
    name: 'private rpc method body; its this.rpc(name, args) callers are checked',
    args: 'admin() spreads its caller-supplied args into thumbnail_production_admin',
  },
  'lib/privacy/account-deletion-worker.ts': {
    name: WRAPPER_BODY,
    'context.dependencies.rpc': 'injected client passed to the rpc wrapper; WRAPPERS checks its calls',
    'dependencies.rpc': 'injected client passed to the rpc wrapper; WRAPPERS checks its calls',
  },
  'lib/privacy/marketing-campaigns.ts': { fn: WRAPPER_BODY },
  'lib/privacy/retention-runner.ts': { functionName: WRAPPER_BODY },
  'lib/profile-mutation.ts': { '(client as { rpc?: unknown }).rpc': SHAPE_GUARD, functionName: WRAPPER_BODY },
  'lib/public-profile-read.ts': { '(client as { rpc?: unknown }).rpc': SHAPE_GUARD, functionName: WRAPPER_BODY },
  'lib/reviews/admin-verification-cleanup.ts': {
    'client.rpc': 'bound to admin_review_verification_cleanup; WRAPPERS checks its deps.rpc(args) calls',
  },
  'lib/reviews/review-media-mutation.ts': {
    'client.rpc': 'bound into ReviewMediaDependencies.rpc; its deps.rpc(name, args) calls are checked',
    'op.args': 'mutate_review_with_media args stored on the pending Operation when it is created',
  },
  'lib/server/runtime-feature-readiness.ts': { 'client!.rpc': BOUND_INTO_WRAPPER },
};

type Signature = { accepts: ReadonlySet<string>; requires: ReadonlySet<string> };
type Arg = { key: string; line: number };
type Site = { file: string; line: number; names: string[]; args: Arg[]; allKeysKnown: boolean };
type Gap = { file: string; line: number; subject: string };

const DIRECT_CALL: CallShape = { nameArg: 0, argsArg: 1 };
const MAX_RESOLVE_DEPTH = 8;

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return undefined;
}

function member(node: ts.TypeNode | undefined, name: string): ts.TypeNode | undefined {
  if (!node || !ts.isTypeLiteralNode(node)) return undefined;
  return node.members.find((entry): entry is ts.PropertySignature =>
    ts.isPropertySignature(entry) && propertyName(entry.name) === name)?.type;
}

// An overloaded function is a union of `{ Args; Returns }` entries.
function signatures(rpc: string, entry: ts.TypeNode | undefined): Signature[] {
  if (entry && ts.isUnionTypeNode(entry)) return entry.types.flatMap(type => signatures(rpc, type));
  const args = member(entry, 'Args');
  if (args && ts.isTypeLiteralNode(args)) {
    const params = args.members.filter(ts.isPropertySignature);
    const names = (list: ts.PropertySignature[]) => new Set(list.map(param => propertyName(param.name)!));
    return [{ accepts: names(params), requires: names(params.filter(param => !param.questionToken)) }];
  }
  if (args?.getText() === 'Record<PropertyKey, never>') return [{ accepts: new Set(), requires: new Set() }];
  throw new Error(`${GENERATED_TYPES}: unrecognized Args shape for ${rpc}`);
}

function readGeneratedFunctions(text: string): Map<string, Signature[]> {
  const source = ts.createSourceFile(GENERATED_TYPES, text, ts.ScriptTarget.Latest, true);
  const database = source.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === 'Database');
  const functions = member(member(database?.type, 'public'), 'Functions');
  if (!functions || !ts.isTypeLiteralNode(functions)) throw new Error(`${GENERATED_TYPES}: Database['public']['Functions'] not found`);
  return new Map(functions.members.filter(ts.isPropertySignature).map(fn => {
    const name = propertyName(fn.name)!;
    return [name, signatures(name, fn.type)];
  }));
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)
    || ts.isNonNullExpression(expression) || ts.isTypeAssertionExpression(expression)) expression = expression.expression;
  return expression;
}

function binds(name: ts.BindingName, text: string): boolean {
  if (ts.isIdentifier(name)) return name.text === text;
  return name.elements.some(element => !ts.isOmittedExpression(element) && binds(element.name, text));
}

function staticBinding(identifier: ts.Identifier): ts.Node | undefined {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(param => binds(param.name, identifier.text))) return undefined;
    if (!ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isModuleBlock(scope) && !ts.isCaseOrDefaultClause(scope)) continue;
    for (const statement of scope.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === identifier.text) return statement;
      if (!ts.isVariableStatement(statement)) continue;
      const declaration = statement.declarationList.declarations.find(entry => binds(entry.name, identifier.text));
      if (!declaration) continue;
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      return isConst && ts.isIdentifier(declaration.name) ? declaration.initializer : undefined;
    }
  }
  return undefined;
}

function soleReturnExpression(fn: ts.Node): ts.Expression | undefined {
  if (!ts.isFunctionDeclaration(fn) && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return undefined;
  if (fn.body && !ts.isBlock(fn.body)) return fn.body;
  const [only] = fn.body?.statements ?? [];
  return fn.body?.statements.length === 1 && only && ts.isReturnStatement(only) ? only.expression : undefined;
}

function resolveValue(expression: ts.Expression, depth = 0, aliased = false): { value: ts.Expression; aliased: boolean } {
  const value = unwrap(expression);
  if (depth >= MAX_RESOLVE_DEPTH) return { value, aliased };
  const bound = ts.isIdentifier(value) ? staticBinding(value) : undefined;
  if (bound && ts.isExpression(bound)) return resolveValue(bound, depth + 1, true);
  const helper = ts.isCallExpression(value) && ts.isIdentifier(value.expression) ? staticBinding(value.expression) : undefined;
  const body = helper && soleReturnExpression(helper);
  return body ? resolveValue(body, depth + 1, aliased) : { value, aliased };
}

function resolveNames(expression: ts.Expression): string[] | undefined {
  const { value } = resolveValue(expression);
  if (ts.isStringLiteralLike(value)) return [value.text];
  if (!ts.isConditionalExpression(value)) return undefined;
  const whenTrue = resolveNames(value.whenTrue);
  const whenFalse = resolveNames(value.whenFalse);
  return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
}

function unbind(callee: ts.Expression): ts.Expression {
  const isBind = ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'bind';
  return isBind ? unwrap(callee.expression.expression) : callee;
}

function extractRpcCalls(file: string, text: string, wrappers: readonly Wrapper[]) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const sites: Site[] = [];
  const gaps: Gap[] = [];
  const callees = new Set<ts.Node>();
  const used = new Set<Wrapper>();
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const gap = (node: ts.Node) => gaps.push({ file, line: lineOf(node), subject: node.getText(source) });

  const collectArgs = (expression: ts.Expression, site: Site): void => {
    const { value, aliased } = resolveValue(expression);
    if (aliased) site.allKeysKnown = false;
    if (ts.isConditionalExpression(value)) {
      collectArgs(value.whenTrue, site);
      collectArgs(value.whenFalse, site);
    } else if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        const key = ts.isSpreadAssignment(property) ? undefined : property.name && propertyName(property.name);
        if (ts.isSpreadAssignment(property)) collectArgs(property.expression, site);
        else if (key === undefined) { site.allKeysKnown = false; gap(property); }
        else site.args.push({ key, line: lineOf(property) });
      }
    } else {
      site.allKeysKnown = false;
      gap(expression);
    }
  };

  const record = (call: ts.CallExpression, shape: CallShape) => {
    const nameNode = 'nameArg' in shape ? call.arguments[shape.nameArg] : undefined;
    const names = 'name' in shape ? [shape.name] : nameNode && resolveNames(nameNode);
    if (!names) return gap(nameNode ?? call);
    const site: Site = { file, line: lineOf(nameNode ?? call), names, args: [], allKeysKnown: true };
    const args = call.arguments[shape.argsArg];
    if (args) collectArgs(args, site);
    sites.push(site);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const target = unbind(callee);
      const direct = ts.isPropertyAccessExpression(target) && target.name.text === 'rpc';
      if (direct) callees.add(target);
      const wrapper = wrappers.find(entry => entry.file === file && entry.call === callee.getText(source));
      if (wrapper) used.add(wrapper);
      if (wrapper || direct) record(node, wrapper ?? DIRECT_CALL);
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'rpc' && !callees.has(node)) gap(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { sites, gaps, used };
}

function* appSourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !NON_APP_DIRS.has(entry.name)) yield* appSourceFiles(path);
    else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) yield path;
  }
}

function contractViolations(sites: readonly Site[], functions: ReadonlyMap<string, Signature[]>, unapplied: Readonly<Record<string, string>>) {
  const violations: string[] = [];
  for (const site of sites) {
    const known = site.names.filter(name => functions.has(name));
    for (const name of site.names) {
      if (!functions.has(name) && !Object.hasOwn(unapplied, name)) {
        violations.push(`${site.file}:${site.line} ${name}: not in Database['public']['Functions']; regenerate ${GENERATED_TYPES} or list it in UNAPPLIED_RPCS`);
      }
    }
    if (known.length === 0) continue;
    const candidates = known.flatMap(name => functions.get(name)!);
    for (const arg of site.args) {
      if (candidates.some(signature => signature.accepts.has(arg.key))) continue;
      const accepted = [...new Set(candidates.flatMap(signature => [...signature.accepts]))].sort().join(', ') || 'no args';
      violations.push(`${site.file}:${arg.line} ${known.join('|')}: unknown arg ${arg.key}; accepts ${accepted}`);
    }
    if (!site.allKeysKnown) continue;
    const sent = new Set(site.args.map(arg => arg.key));
    for (const name of known) {
      const options = functions.get(name)!;
      if (options.some(signature => [...signature.requires].every(key => sent.has(key)))) continue;
      const missing = [...options[0]!.requires].filter(key => !sent.has(key)).join(', ');
      violations.push(`${site.file}:${site.line} ${name}: missing required arg ${missing}`);
    }
  }
  return violations;
}

const functions = readGeneratedFunctions(readFileSync(join(appRoot, GENERATED_TYPES), 'utf8'));
const scanned = [...appSourceFiles(appRoot)].flatMap(path => {
  const text = readFileSync(path, 'utf8');
  return text.includes('rpc') ? [extractRpcCalls(relative(appRoot, path), text, WRAPPERS)] : [];
});
const sites = scanned.flatMap(result => result.sites);
const gaps = scanned.flatMap(result => result.gaps);

describe('Supabase RPC argument contract', () => {
  test('every RPC call names a generated function and sends only its declared args', () => {
    expect(contractViolations(sites, functions, UNAPPLIED_RPCS)).toEqual([]);
  });

  test('every call the check cannot resolve is documented, and every allowlist entry is live', () => {
    const problems = gaps
      .filter(entry => !Object.hasOwn(UNCHECKED[entry.file] ?? {}, entry.subject))
      .map(entry => `${entry.file}:${entry.line} unresolved RPC \`${entry.subject}\`; pass literals, add a WRAPPERS entry, or document it in UNCHECKED`);
    for (const [file, subjects] of Object.entries(UNCHECKED)) {
      for (const subject of Object.keys(subjects)) {
        if (!gaps.some(entry => entry.file === file && entry.subject === subject)) problems.push(`UNCHECKED ${file} \`${subject}\` matches no call; delete it`);
      }
    }
    const usedWrappers = new Set(scanned.flatMap(result => [...result.used]));
    for (const wrapper of WRAPPERS) {
      if (!usedWrappers.has(wrapper)) problems.push(`WRAPPERS ${wrapper.file} \`${wrapper.call}\` matches no call; delete it`);
    }
    for (const [name, candidate] of Object.entries(UNAPPLIED_RPCS)) {
      if (functions.has(name)) problems.push(`UNAPPLIED_RPCS ${name} is now generated; delete the entry so its args are checked`);
      if (!sites.some(site => site.names.includes(name))) problems.push(`UNAPPLIED_RPCS ${name} is not called; delete it`);
      const path = join(repoRoot, candidate);
      if (!existsSync(path) || !readFileSync(path, 'utf8').includes(`FUNCTION public.${name}`)) problems.push(`UNAPPLIED_RPCS ${name}: ${candidate} does not define it`);
    }
    expect(problems).toEqual([]);
  });

  test('a drifted call is reported with its file, line and offending arg', () => {
    const generated = readGeneratedFunctions(`export type Database = { public: { Functions: {
      allocate_short_url: { Args: { p_target_url: string; p_review_id?: string }; Returns: string }
    } } }`);
    const fixture = [
      "const RPC = 'allocate_short_url';",
      'export async function save(client: Client, url: string, id: string) {',
      "  await client.rpc('allocate_short_url' as never, {",
      '    p_target_url: url,',
      '    p_reviewid: id,',
      '  } as never);',
      '  await send(client, RPC, { p_review_id: id });',
      "  await client.rpc('allocate_short_urls');",
      '  return client.rpc.bind(client);',
      '}',
    ].join('\n');
    const drifted = extractRpcCalls('fixture.ts', fixture, [{ file: 'fixture.ts', call: 'send', nameArg: 1, argsArg: 2 }]);
    expect(contractViolations(drifted.sites, generated, {})).toEqual([
      'fixture.ts:5 allocate_short_url: unknown arg p_reviewid; accepts p_review_id, p_target_url',
      'fixture.ts:7 allocate_short_url: missing required arg p_target_url',
      `fixture.ts:8 allocate_short_urls: not in Database['public']['Functions']; regenerate ${GENERATED_TYPES} or list it in UNAPPLIED_RPCS`,
    ]);
    expect(drifted.gaps.map(entry => `${entry.line} ${entry.subject}`)).toEqual(['9 client.rpc']);
  });
});
