import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { StoryboardConversation } from '../components/admin/storyboard/StoryboardConversation';
import { STORYBOARD_ASSISTANT_ERRORS } from '../lib/admin/storyboard/assistant-contract';

const heldMessage = '제작 준비가 확인되면 요청을 작성할 수 있어요.';

function renderConversation(canWriteRequest?: boolean, disabled = false) {
  return renderToStaticMarkup(<StoryboardConversation context={{ prompt: '', scene: null }} sceneCount={6}
    canWriteRequest={canWriteRequest} disabled={disabled} onUsePrompt={() => true} onWriteRequest={() => undefined} />);
}

describe('storyboard request readiness stays separate from the planning conversation', () => {
  test('held and unknown request readiness disable direct writing without locking the planner draft', () => {
    for (const readiness of [false, undefined]) {
      const html = renderConversation(readiness);
      expect(html).toContain(heldMessage);
      expect(html).not.toContain('제작 요청을 직접 작성할 수 있어요.');
      expect(html.match(/<button[^>]*>요청 직접 쓰기<\/button>/)?.[0]).toContain('disabled=""');
      const input = html.match(/<textarea[^>]*id="storyboard-conversation-input"[^>]*>/)?.[0];
      expect(input).toBeDefined();
      expect(input).not.toContain(' disabled=""');
    }
    expect(STORYBOARD_ASSISTANT_ERRORS.assistant_unavailable).toBe('AI 대화 연결이 아직 준비되지 않았습니다.');
  });

  test('ready request writing is available independently of the initial AI capability check', () => {
    const html = renderConversation(true);
    expect(html).toContain('AI 대화 설정을 확인하고 있어요.');
    expect(html).not.toContain(heldMessage);
    const button = html.match(/<button[^>]*>요청 직접 쓰기<\/button>/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain(' disabled=""');
  });

  test('an existing busy lock still disables request writing even when readiness is ready', () => {
    const html = renderConversation(true, true);
    expect(html.match(/<button[^>]*>요청 직접 쓰기<\/button>/)?.[0]).toContain('disabled=""');
  });
});

// Execute the actual local proposal-transfer callback without importing the
// workspace, mounting React effects, or contacting an application/provider.
const workspace = readFileSync(join(import.meta.dir, '../components/admin/storyboard/LocalStoryboardWorkspace.tsx'), 'utf8');
const tree = ts.createSourceFile('workspace.tsx', workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reviewSource = '';
function findReview(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'reviewProposal') reviewSource = node.getText(tree);
  ts.forEachChild(node, findReview);
}
findReview(tree);
if (!reviewSource) throw new Error('Missing proposal review callback');
const reviewCode = ts.transpileModule(reviewSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function reviewProposal(state: { actionsHeld: boolean; creating: boolean; inFlight: boolean; allowDeparture?: boolean }) {
  const changes: string[] = [];
  const callback = runInNewContext(`${reviewCode}\nreviewProposal`, {
    actionsHeld: state.actionsHeld, creating: state.creating, createController: { current: state.inFlight ? {} : null },
    selectProject: () => { changes.push('select'); return state.allowDeparture !== false; },
    setPrompt: (value: string) => changes.push(`prompt:${value}`),
    setNewPanel: (value: string) => changes.push(`panel:${value}`),
    setMobileView: (value: string) => changes.push(`mobile:${value}`),
    requestAnimationFrame: () => changes.push('focus-scheduled'),
  }) as (value: string) => boolean;
  return { accepted: callback('확인할 제작 요청'), changes };
}

test('proposal review cannot switch projects or replace the request while held or creating', () => {
  for (const state of [
    { actionsHeld: true, creating: false, inFlight: false },
    { actionsHeld: false, creating: true, inFlight: false },
    { actionsHeld: false, creating: false, inFlight: true },
  ]) expect(reviewProposal(state)).toEqual({ accepted: false, changes: [] });
});

test('ready proposal review preserves departure consent and only prepares the request for review', () => {
  expect(reviewProposal({ actionsHeld: false, creating: false, inFlight: false, allowDeparture: false }))
    .toEqual({ accepted: false, changes: ['select'] });
  expect(reviewProposal({ actionsHeld: false, creating: false, inFlight: false }))
    .toEqual({ accepted: true, changes: ['select', 'prompt:확인할 제작 요청', 'panel:request', 'mobile:conversation', 'focus-scheduled'] });
});
