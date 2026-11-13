import { expect, test } from 'bun:test';
import ts from 'typescript';
import { buildImeBrowserFixture, categoryKeydownSource, inlineKeydownSource, thumbnailFunction } from './fixtures/ime-keyboard';

type Key = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  nativeEvent: { isComposing: boolean; keyCode: number };
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
};

function key(keyName: string, keyCode = 13, isComposing = false): Key {
  const event: Key = {
    key: keyName, shiftKey: false, ctrlKey: false, metaKey: false,
    nativeEvent: { isComposing, keyCode }, defaultPrevented: false, propagationStopped: false,
    preventDefault() { event.defaultPrevented = true; },
    stopPropagation() { event.propagationStopped = true; },
  };
  return event;
}

function execute<T>(source: string, bindings: Record<string, unknown>): T {
  const compiled = ts.transpileModule(`return (${source});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as T;
}

function category(kind: 'admin' | 'submission', text = '한식', categories: string[] = []) {
  const state = { text, categories, changes: 0 };
  const run = execute<(event: Key) => void>(categoryKeydownSource(kind), {
    customCategory: text, categoryInput: text, formData: { categories },
    setFormData: (next: { categories: string[] }) => { state.categories = next.categories; state.changes++; },
    setCustomCategory: (next: string) => { state.text = next; },
    setCategoryInput: (next: string) => { state.text = next; },
  });
  return { run, state };
}

for (const kind of ['admin', 'submission'] as const) {
  test(`${kind} production category handler keeps native and Safari IME confirmation out of application state`, () => {
    for (const event of [key('Enter', 13, true), key('Enter', 229, false)]) {
      const fixture = category(kind);
      fixture.run(event);
      expect(fixture.state).toEqual({ text: '한식', categories: [], changes: 0 });
      expect(event.defaultPrevented).toBe(true);
    }
    for (const event of [key('Escape', 27), key('a', 229)]) {
      const fixture = category(kind);
      fixture.run(event);
      expect(fixture.state).toEqual({ text: '한식', categories: [], changes: 0 });
      expect(event.defaultPrevented).toBe(false);
    }
  });

  test(`${kind} production category handler preserves normal additions, duplicates and empty Enter safety`, () => {
    const normal = category(kind, ' 한식 ');
    const enter = key('Enter');
    normal.run(enter);
    expect(normal.state).toEqual({ text: '', categories: ['한식'], changes: 1 });
    expect(enter.defaultPrevented).toBe(true);

    const duplicate = category(kind, '한식', ['한식']);
    duplicate.run(key('Enter'));
    expect(duplicate.state).toEqual({ text: kind === 'admin' ? '' : '한식', categories: ['한식'], changes: 0 });

    const empty = category(kind, ' ');
    const emptyEnter = key('Enter');
    empty.run(emptyEnter);
    expect(empty.state).toEqual({ text: ' ', categories: [], changes: 0 });
    expect(emptyEnter.defaultPrevented).toBe(true);
  });
}

function inlineEditor() {
  const state = { commits: 0, closes: [] as (string | null)[], focuses: 0, undos: 0 };
  const run = execute<(event: Key) => void>(inlineKeydownSource, {
    isUndoKeyboardShortcut: execute(thumbnailFunction('isUndoKeyboardShortcut'), {}),
    commitPendingTextLayerUndoSnapshot: () => { state.commits++; },
    setEditingLayerId: (id: string | null) => { state.closes.push(id); },
    canvasRef: { current: { focus: () => { state.focuses++; } } },
    undoInlineTextEditorChange: () => { state.undos++; },
  });
  return { run, state };
}

test('production inline editor leaves composing Enter/Escape in place, including Safari 229', () => {
  for (const keyName of ['Enter', 'Escape']) {
    for (const event of [key(keyName, keyName === 'Enter' ? 13 : 27, true), key(keyName, 229)]) {
      const fixture = inlineEditor();
      fixture.run(event);
      expect(fixture.state).toEqual({ commits: 0, closes: [], focuses: 0, undos: 0 });
      expect(event.defaultPrevented).toBe(keyName === 'Enter');
      expect(event.propagationStopped).toBe(true);
    }
  }
});

test('production inline editor commits and returns focus once for normal Enter and Escape', () => {
  for (const keyName of ['Enter', 'Escape']) {
    const fixture = inlineEditor();
    const event = key(keyName, keyName === 'Enter' ? 13 : 27);
    fixture.run(event);
    expect(fixture.state).toEqual({ commits: 1, closes: [null], focuses: 1, undos: 0 });
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
  }
});

test('production inline editor retains Ctrl/Cmd+Z without committing or moving focus', () => {
  for (const modifier of ['ctrlKey', 'metaKey'] as const) {
    const fixture = inlineEditor();
    const event = key('z', 90);
    event[modifier] = true;
    fixture.run(event);
    expect(fixture.state).toEqual({ commits: 0, closes: [], focuses: 0, undos: 1 });
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
  }
});

test('production chat retains composition state and catches Safari 229 after compositionend', () => {
  let sends = 0;
  const fixture = execute<{ start(): void; end(): void; keydown(event: Key): void }>(`(() => {
    ${thumbnailFunction('handleThumbnailChatCompositionStart')}
    ${thumbnailFunction('handleThumbnailChatCompositionEnd')}
    ${thumbnailFunction('isThumbnailChatImeComposing')}
    ${thumbnailFunction('handleThumbnailChatKeyDown')}
    return {start: handleThumbnailChatCompositionStart, end: handleThumbnailChatCompositionEnd, keydown: handleThumbnailChatKeyDown};
  })()`, { chatComposerImeRef: { current: false }, handleThumbnailChatSubmit: () => { sends++; } });

  fixture.start();
  fixture.keydown(key('Enter'));
  fixture.end();
  fixture.keydown(key('Enter', 229));
  fixture.keydown(key('Enter', 13, true));
  expect(sends).toBe(0);

  const shiftEnter = key('Enter');
  shiftEnter.shiftKey = true;
  fixture.keydown(shiftEnter);
  expect(shiftEnter.defaultPrevented).toBe(false);
  expect(sends).toBe(0);

  const enter = key('Enter');
  fixture.keydown(enter);
  expect(enter.defaultPrevented).toBe(true);
  expect(sends).toBe(1);
  fixture.keydown(key('Escape', 27));
  expect(sends).toBe(1);
});

test('the production inputs and handlers compile into the React browser fixture', async () => {
  expect((await buildImeBrowserFixture()).length).toBeGreaterThan(0);
}, 30_000);
