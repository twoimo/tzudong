import { beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

// Execute the production component's handlers with deterministic hook scheduling.
// DOM geometry and reachability remain the existing pinned-browser suite's job.
const componentPath = join(import.meta.dir, '../app/insights/insights-treemap.tsx');
let compiled: string;

beforeAll(async () => {
  const mocks: Record<string, string> = {
    react: `const hooks=globalThis.__hooks;
      export const useState=(...args)=>hooks.useState(...args);
      export const useRef=(...args)=>hooks.useRef(...args);
      export const useCallback=(...args)=>hooks.useCallback(...args);
      export const useEffect=(...args)=>hooks.useEffect(...args);`,
    'react/jsx-runtime': `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment';`,
    'react/jsx-dev-runtime': `export const jsxDEV=(type,props)=>({type,props});export const Fragment='fragment';`,
    '@radix-ui/react-popover': `export const PopoverAnchor='anchor';`,
    'ztd-charts': `export const Treemap='treemap';`,
    'lucide-react': `export const X='icon';`,
    '@/components/ui/button': `export const Button='button';`,
    '@/components/ui/popover': `export const Popover='popover';export const PopoverContent='content';`,
  };
  const result = await Bun.build({
    entrypoints: [componentPath], target: 'browser', format: 'cjs', write: false,
    plugins: [{ name: 'insights-preview-handler-fixture', setup(builder) {
      builder.onResolve({ filter: /^(?:react(?:\/|$)|@radix-ui\/|ztd-charts$|lucide-react$|@\/)/ }, args => {
        if (!(args.path in mocks)) throw new Error('UNEXPECTED_INSIGHTS_PREVIEW_DEPENDENCY');
        return { path: args.path, namespace: 'insights-preview-mock' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'insights-preview-mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }],
  });
  if (!result.success) throw new Error(result.logs.map(String).join('\n'));
  compiled = await result.outputs[0].text();
});

type ElementNode = { type: string; props: Record<string, unknown> };
type Slot = { value?: unknown; deps?: unknown[]; effect?: () => void | (() => void); cleanup?: () => void };
type InputPoint = { type: string; pointerType: string; clientX: number; clientY: number };
type Listener = (event: unknown) => void;

function createFixture() {
  const slots: Slot[] = [];
  let cursor = 0;
  let changed = false;
  let pending: Slot[] = [];
  const equalDeps = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && b.every((v, i) => Object.is(v, a[i]));
  const hooks = {
    useState(initial: unknown) {
      const slot = slots[cursor++] ??= { value: initial };
      return [slot.value, (value: unknown) => {
        const next = typeof value === 'function' ? (value as (previous: unknown) => unknown)(slot.value) : value;
        if (!Object.is(slot.value, next)) { slot.value = next; changed = true; }
      }];
    },
    useRef(initial: unknown) { return (slots[cursor++] ??= { value: { current: initial } }).value; },
    useCallback(callback: unknown, deps: unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (!equalDeps(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
      return slot.value;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (!equalDeps(slot.deps, deps)) { slot.effect = effect; slot.deps = deps; pending.push(slot); }
    },
  };
  const listeners = new Map<string, Set<Listener>>();
  const registrations: Array<{ type: string; capture: boolean; passive: boolean }> = [];
  const capture = (options: boolean | { capture?: boolean } | undefined) => typeof options === 'boolean' ? options : options?.capture === true;
  const window = {
    addEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean; passive?: boolean }) {
      const key = `${type}:${capture(options)}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(listener);
      registrations.push({ type, capture: capture(options), passive: typeof options === 'object' && options.passive === true });
    },
    removeEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }) {
      listeners.get(`${type}:${capture(options)}`)?.delete(listener);
    },
  };
  class TestElement { isConnected = true; contains() { return false; } }
  const document = { activeElement: new TestElement(), body: new TestElement() };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const componentModule = { exports: {} as { InsightsTreemap?: (props: Record<string, unknown>) => ElementNode } };
  runInNewContext(compiled, {
    module: componentModule, exports: componentModule.exports, __hooks: hooks, window, document, HTMLElement: TestElement, Node: TestElement,
    setTimeout(callback: () => void) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const renderComponent = componentModule.exports.InsightsTreemap!;
  const data = [{ id: 'synthetic-leaf', value: 1 }];
  let props: Record<string, unknown> = { data, height: 300, previewContent: () => null, previewDisabled: false };
  let tree: ElementNode;
  function render(changes: Record<string, unknown> = {}) {
    props = { ...props, ...changes };
    for (let attempt = 0; attempt < 8; attempt++) {
      cursor = 0; changed = false; pending = [];
      tree = renderComponent(props);
      for (const slot of pending) { slot.cleanup?.(); slot.cleanup = slot.effect?.() || undefined; }
      if (!changed) return tree;
    }
    throw new Error('INSIGHTS_PREVIEW_HANDLER_RENDER_DID_NOT_SETTLE');
  }
  const nodes = (value: unknown): ElementNode[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object' || !('props' in value)) return [];
    const node = value as ElementNode;
    return [node, ...nodes(node.props.children)];
  };
  function invoke(kind: 'wrapper' | 'chart', name: string, value: unknown) {
    const node = nodes(tree).find(node => kind === 'wrapper' ? node.props['data-insights-chart'] === 'true' : node.type === 'treemap');
    const handler = node?.props[name];
    if (typeof handler !== 'function') throw new Error('INSIGHTS_PREVIEW_HANDLER_MISSING');
    (handler as (value: unknown) => void)(value);
  }
  render();
  return {
    render, invoke, registrations,
    open: () => tree.props.open,
    hover: () => invoke('chart', 'onHover', { datum: data[0] }),
    emitPointer: (event: InputPoint) => {
      for (const callback of listeners.get('pointermove:true') ?? []) callback(event);
    },
    unmount: () => { for (const slot of slots) slot.cleanup?.(); },
    remainingListeners: () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0),
    pendingTimers: () => timers.size,
  };
}

const point = (type: string, x: number, y: number, pointerType = 'mouse'): InputPoint => ({ type, clientX: x, clientY: y, pointerType });

for (const pointerType of ['mouse', 'pen']) {
  test(`detail-portal ${pointerType} movement suppresses stationary re-entry, then real movement resumes the cached tile`, () => {
    const fixture = createFixture();
    try {
      const initial = point('pointermove', 500, 250, pointerType);
      fixture.emitPointer(initial);
      fixture.invoke('wrapper', 'onPointerMoveCapture', initial);
      fixture.hover();
      fixture.render();
      expect(fixture.open()).toBe(true);

      fixture.render({ previewDisabled: true });
      // Real movement happens in the separate detail portal: no chart handler.
      fixture.emitPointer(point('pointermove', 651, 214, pointerType));
      fixture.render({ previewDisabled: false });
      // Removing that portal exposes the chart at the stationary pointer.
      fixture.invoke('wrapper', 'onPointerEnter', point('pointerenter', 651, 214, pointerType));
      fixture.hover();
      fixture.render();
      expect(fixture.open()).toBe(false);

      // ztd-charts need not emit another hover for this same active tile.
      fixture.emitPointer(point('pointermove', 654, 214, pointerType));
      fixture.invoke('wrapper', 'onPointerMoveCapture', point('pointermove', 654, 214, pointerType));
      fixture.render();
      expect(fixture.open()).toBe(true);
    } finally { fixture.unmount(); }
  });
}

test('touch movement cannot replace the last mouse position or arm a preview', () => {
  const fixture = createFixture();
  try {
    fixture.emitPointer(point('pointermove', 500, 250));
    fixture.invoke('wrapper', 'onPointerMoveCapture', point('pointermove', 500, 250));
    fixture.render({ previewDisabled: true });
    fixture.emitPointer(point('pointermove', 651, 214, 'touch'));
    fixture.render({ previewDisabled: false });
    fixture.invoke('wrapper', 'onPointerEnter', point('pointerenter', 500, 250));
    fixture.hover();
    fixture.render();
    expect(fixture.open()).toBe(false);
    fixture.invoke('wrapper', 'onPointerMoveCapture', point('pointermove', 651, 214, 'touch'));
    fixture.hover();
    fixture.render();
    expect(fixture.open()).toBe(false);
  } finally { fixture.unmount(); }
});

test('pointer observation is passive capture and every listener is removed on unmount', () => {
  const fixture = createFixture();
  expect(fixture.registrations.filter(value => value.type === 'pointermove')).toEqual([{ type: 'pointermove', capture: true, passive: true }]);
  expect(fixture.remainingListeners()).toBe(3);
  fixture.unmount();
  expect(fixture.remainingListeners()).toBe(0);
  expect(fixture.pendingTimers()).toBe(0);
});
