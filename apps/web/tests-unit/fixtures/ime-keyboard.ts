import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const appRoot = join(import.meta.dir, '../..');
const parse = (path: string) => ts.createSourceFile(path, readFileSync(join(appRoot, path), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const admin = parse('components/admin/AdminRestaurantModal.tsx');
const submission = parse('components/modals/RestaurantSubmissionModal.tsx');
const thumbnail = parse('components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx');

function find(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error(`Missing production IME test boundary in ${source.fileName}`);
  return found;
}

function field(source: ts.SourceFile, name: string, value: string) {
  return find(source, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
      && attribute.name.getText(source) === name && attribute.initializer
      && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === value)) as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
}

function keyboardHandler(source: ts.SourceFile, node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
  const attribute = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute)
    && attribute.name.getText(source) === 'onKeyDown') as ts.JsxAttribute | undefined;
  if (!attribute?.initializer || !ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
    throw new Error('Missing production onKeyDown binding');
  }
  return attribute.initializer.expression.getText(source);
}

export function thumbnailFunction(name: string) {
  return find(thumbnail, node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(thumbnail);
}

// Mount the real category JSX and the actual thumbnail closures through React's
// SyntheticEvent layer. Only their surrounding state/services are synthetic.
const entry = `
  import React, {useRef, useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {Input} from './components/ui/input';
  function AdminCategory() {
    const [customCategory, setCustomCategory] = useState('');
    const [formData, setFormData] = useState({categories: []});
    const [submits, setSubmits] = useState(0);
    return <section data-fixture="admin"><form onSubmit={event => {event.preventDefault(); setSubmits(value => value + 1);}}>
      ${field(admin, 'placeholder', '새 카테고리 입력').getText(admin)}
      <button type="submit">Save form</button>
    </form><output data-categories>{JSON.stringify(formData.categories)}</output><output data-submits>{submits}</output></section>;
  }
  function SubmissionCategory() {
    const [categoryInput, setCategoryInput] = useState('');
    const [formData, setFormData] = useState({categories: []});
    const [submits, setSubmits] = useState(0);
    return <section data-fixture="submission"><form onSubmit={event => {event.preventDefault(); setSubmits(value => value + 1);}}>
      ${field(submission, 'id', 'submission-custom-category').getText(submission)}
      <button type="submit">Save form</button>
    </form><output data-categories>{JSON.stringify(formData.categories)}</output><output data-submits>{submits}</output></section>;
  }
  function InlineEditor() {
    const [editingLayerId, setEditingLayerId] = useState('synthetic-layer');
    const [commits, setCommits] = useState(0);
    const [undos, setUndos] = useState(0);
    const [bubbled, setBubbled] = useState(0);
    const canvasRef = useRef(null);
    const commitPendingTextLayerUndoSnapshot = () => setCommits(value => value + 1);
    const undoInlineTextEditorChange = () => setUndos(value => value + 1);
    ${thumbnailFunction('isUndoKeyboardShortcut')}
    return <section data-fixture="inline" onKeyDown={() => setBubbled(value => value + 1)}>
      <button type="button" onClick={() => setEditingLayerId('synthetic-layer')}>Edit again</button>
      <canvas ref={canvasRef} tabIndex={0} aria-label="Canvas" />
      {editingLayerId && <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Inline text"
        onKeyDown={${keyboardHandler(thumbnail, field(thumbnail, 'data-thumbnail-canvas-inline-text-editor', 'true'))}}>한상</div>}
      <output data-commits>{commits}</output><output data-undos>{undos}</output><output data-bubbled>{bubbled}</output>
    </section>;
  }
  function ChatComposer() {
    const chatComposerImeRef = useRef(false);
    const [sends, setSends] = useState(0);
    const handleThumbnailChatSubmit = () => setSends(value => value + 1);
    ${thumbnailFunction('handleThumbnailChatCompositionStart')}
    ${thumbnailFunction('handleThumbnailChatCompositionEnd')}
    ${thumbnailFunction('isThumbnailChatImeComposing')}
    ${thumbnailFunction('handleThumbnailChatKeyDown')}
    return <section data-fixture="chat"><textarea aria-label="Chat message"
      onCompositionStart={handleThumbnailChatCompositionStart} onCompositionEnd={handleThumbnailChatCompositionEnd}
      onKeyDown={handleThumbnailChatKeyDown} /><output data-sends>{sends}</output></section>;
  }
  createRoot(document.getElementById('root')).render(<><AdminCategory /><SubmissionCategory /><InlineEditor /><ChatComposer /></>);
`;


export function categoryKeydownSource(kind: 'admin' | 'submission') {
  return kind === 'admin'
    ? keyboardHandler(admin, field(admin, 'placeholder', '새 카테고리 입력'))
    : keyboardHandler(submission, field(submission, 'id', 'submission-custom-category'));
}

export const inlineKeydownSource = keyboardHandler(thumbnail,
  field(thumbnail, 'data-thumbnail-canvas-inline-text-editor', 'true'));

export async function buildImeBrowserFixture() {
  const built = await Bun.build({
    entrypoints: ['ime-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'ime-fixture', setup(builder) {
      builder.onResolve({ filter: /^ime-fixture$/ }, () => ({ path: 'entry', namespace: 'ime-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'ime-fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    } }],
  });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}
