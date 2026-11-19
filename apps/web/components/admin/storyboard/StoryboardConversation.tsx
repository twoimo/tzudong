"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, MessageCircle } from 'lucide-react';
import { STORYBOARD_ASSISTANT_ERRORS, storyboardAssistantCapabilitySchema, storyboardAssistantRequestSchema,
  storyboardAssistantResultSchema, type StoryboardAssistantMessage, type StoryboardAssistantRequest,
  type StoryboardAssistantResult } from '@/lib/admin/storyboard/assistant-contract';
import type { StoryboardProvider } from '@/lib/admin/storyboard/production-contract';

const ENDPOINT = '/api/admin/storyboard/production/assistant';
const buttonClass = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50';
const examples = ['맛집 방문기를 자연스럽게 이어 가고 싶어요', '첫 컷에서 눈길을 끌 방법을 제안해 주세요'];
type Turn = StoryboardAssistantMessage & { proposal?: string; provenance?: StoryboardAssistantResult['provenance'] };

export function StoryboardConversation({ context, sceneCount, onUsePrompt, onWriteRequest, canWriteRequest = false, disabled = false }: {
  context: StoryboardAssistantRequest['context']; sceneCount: number;
  onUsePrompt: (prompt: string) => boolean | void; onWriteRequest?: () => void; canWriteRequest?: boolean; disabled?: boolean;
}) {
  const [provider, setProvider] = useState<StoryboardProvider | null>(null);
  const [checking, setChecking] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [capabilityTick, setCapabilityTick] = useState(0);
  const requestActionsDisabled = !canWriteRequest || disabled || !!pending;
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const load = new AbortController();
    setChecking(true);
    void fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.any([load.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => {
        if (!response.ok) throw new Error('unavailable');
        const parsed = storyboardAssistantCapabilitySchema.safeParse(await response.json());
        if (!parsed.success || (parsed.data.configured && !parsed.data.provider)) throw new Error('unavailable');
        if (!load.signal.aborted) setProvider(parsed.data.configured ? parsed.data.provider : null);
      }).catch(() => { if (!load.signal.aborted) setProvider(null); })
      .finally(() => { if (!load.signal.aborted) setChecking(false); });
    return () => load.abort();
  }, [capabilityTick]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [turns, pending]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!provider || controller.current || disabled || !draft.trim()) return;
    const content = draft.trim();
    const messages = [...turns.slice(-6).map(({ role, content: text }) => ({ role, content: text })), { role: 'user' as const, content }];
    const parsed = storyboardAssistantRequestSchema.safeParse({ provider, messages, sceneCount, context });
    if (!parsed.success) { setError(STORYBOARD_ASSISTANT_ERRORS.invalid_request); return; }
    const current = new AbortController(); controller.current = current;
    setPending(content); setError(null); setApplied(null);
    try {
      const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data),
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(35_000)]) });
      const value: unknown = await response.json();
      if (!response.ok) {
        const code = value && typeof value === 'object' && 'error' in value ? String(value.error) : 'assistant_failed';
        throw new Error(Object.hasOwn(STORYBOARD_ASSISTANT_ERRORS, code) ? code : 'assistant_failed');
      }
      const result = storyboardAssistantResultSchema.safeParse(value);
      if (!result.success || result.data.provenance.model !== provider.model || result.data.provenance.providerId !== provider.id) throw new Error('invalid_response');
      if (!current.signal.aborted) {
        setTurns(previous => [...previous, { role: 'user' as const, content }, { role: 'assistant' as const,
          content: result.data.answer.reply, proposal: result.data.answer.suggestedPrompt ?? undefined, provenance: result.data.provenance }].slice(-16));
        setDraft('');
      }
    } catch (failure) {
      if (!current.signal.aborted) setError(STORYBOARD_ASSISTANT_ERRORS[failure instanceof Error ? failure.message : ''] ?? STORYBOARD_ASSISTANT_ERRORS.assistant_failed);
    } finally { if (!current.signal.aborted) { controller.current = null; setPending(''); } }
  }

  return <section aria-labelledby="storyboard-conversation-title" data-layout-primitives="scroll-body-shell stack" className="flex h-full min-h-[360px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
    <header className="border-b border-border px-4 py-3">
      <h3 id="storyboard-conversation-title" className="flex items-center gap-2 text-base font-semibold"><MessageCircle size={18} aria-hidden="true" />AI와 이야기 만들기</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">아이디어를 함께 정리해요. 제안은 확인한 뒤 요청에 옮겨요.</p>
    </header>
    <div ref={transcript} data-scroll-owner="storyboard-conversation" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain scroll-pb-4 p-4" aria-label="기획 대화" role="log" aria-live="polite" aria-relevant="additions">
      {turns.length === 0 && <div className="space-y-3">
        <p className="text-sm leading-6">어떤 이야기를 그리고 싶으세요? 장소, 음식, 분위기부터 적어도 좋아요.</p>
        <div className="grid gap-2">{examples.map(example => <button key={example} type="button" className={`${buttonClass} text-left font-normal`} disabled={!!pending || disabled}
          onClick={() => { setDraft(example); input.current?.focus(); }}>{example}</button>)}</div>
      </div>}
      {turns.map((turn, index) => <article key={index} className={`rounded-lg p-3 ${turn.role === 'user' ? 'ml-6 bg-muted' : 'mr-2 border border-border bg-background'}`}>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{turn.role === 'user' ? '내 요청' : 'AI 기획 답변'}</p>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{turn.content}</p>
        {turn.proposal && <details className="mt-3 rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">제작 요청 제안 보기</summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{turn.proposal}</p>
          <button type="button" className={`${buttonClass} mt-3 w-full`} disabled={requestActionsDisabled} onClick={() => { if (requestActionsDisabled) return; if (onUsePrompt(turn.proposal!) !== false) setApplied('제작 요청에 옮겼어요. 내용을 확인한 뒤 프로젝트를 만들어 주세요.'); }}>요청에 옮겨 검토하기</button>
        </details>}
        {turn.provenance && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">답변 정보</summary><p className="mt-1 break-all">{turn.provenance.model} · 응답 모델 {turn.provenance.responseModel}</p></details>}
      </article>)}
      {pending && <div role="status" className="rounded-lg bg-muted/50 p-3 text-sm">답변을 기다리고 있어요. 자동으로 다시 보내지 않아요.</div>}
    </div>
    <div className="border-t border-border p-3">
      {checking ? <p role="status" className="mb-3 text-sm text-muted-foreground">AI 대화 설정을 확인하고 있어요.</p> : !provider && <div className="mb-3 space-y-2 text-sm">
        <p role="status" className="leading-6 text-muted-foreground">{STORYBOARD_ASSISTANT_ERRORS.assistant_unavailable}</p>
        {canWriteRequest && onWriteRequest && <p className="leading-6 text-muted-foreground">제작 요청을 직접 작성할 수 있어요.</p>}
        <button type="button" className={buttonClass} onClick={() => setCapabilityTick(value => value + 1)}>연결 상태 다시 확인</button>
      </div>}
      {error && <p role="alert" className="mb-3 text-sm leading-6 text-destructive">{error}</p>}
      {!canWriteRequest && <p className="mb-3 text-sm leading-6 text-muted-foreground">제작 준비가 확인되면 요청을 작성할 수 있어요.</p>}
      {applied && canWriteRequest && <p role="status" className="mb-3 text-sm text-muted-foreground">{applied}</p>}
      <form onSubmit={send} className="space-y-2">
        <label htmlFor="storyboard-conversation-input" className="sr-only">AI에게 보낼 메시지</label>
        <textarea ref={input} id="storyboard-conversation-input" rows={3} maxLength={2000} value={draft}
          disabled={disabled || !!pending} onChange={event => setDraft(event.target.value)}
          placeholder="예: 시장에서 발견한 국수집을 따뜻한 분위기로 소개하고 싶어요."
          className="block min-h-24 w-full resize-none rounded-lg border border-border bg-background p-3 text-base leading-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 sm:text-sm" />
        <div className="flex items-center justify-between gap-2">
          {onWriteRequest ? <button type="button" className={`${buttonClass} border-transparent text-muted-foreground`} disabled={requestActionsDisabled} onClick={() => { if (!requestActionsDisabled) onWriteRequest(); }}>요청 직접 쓰기</button> : <span className="text-xs text-muted-foreground">대화는 이 화면에서만 유지돼요.</span>}
          <button type="submit" className={`${buttonClass} flex items-center gap-1 border-primary bg-primary text-primary-foreground hover:bg-primary/90`}
            disabled={!provider || checking || !!pending || disabled || !draft.trim()}><ArrowUp size={16} aria-hidden="true" />{pending ? '답변 대기' : '보내기'}</button>
        </div>
      </form>
    </div>
  </section>;
}
