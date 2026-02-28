import { expect, mock, test } from 'bun:test';

type OpenAiPayload = {
  messages: Array<{
    role: string;
    content: string;
  }>;
};

async function captureOpenAIPayload(fn: () => Promise<unknown>): Promise<OpenAiPayload> {
  mock.restore();
  const originalFetch = global.fetch;
  let captured: OpenAiPayload | undefined;

  global.fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const endpoint = String(_input);
    if (!endpoint.includes('api.openai.com')) {
      return new Response('', { status: 500 });
    }

    const body = init?.body;
    captured = JSON.parse(String(body || '{}')) as OpenAiPayload;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: 'mock reply',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }

  if (!captured) {
    throw new Error('Expected OpenAI fetch payload capture');
  }

  return captured;
}

async function callChatWithOpenAIPrompt(message: string, memoryMode: 'off' | 'session' | 'pinned', memoryProfileNote: string) {
  const cacheBust = `?cache=${Math.random()}`;
  const { answerAdminInsightChat } = await import(`../lib/insight/chat.ts${cacheBust}`);

  return captureOpenAIPayload(async () => {
    return answerAdminInsightChat(
      message,
      {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
      },
      undefined,
      'fast',
      memoryMode,
      undefined,
      undefined,
      undefined,
      memoryProfileNote,
    );
  });
}

test('session memory mode injects memory profile note into prompt', async () => {
  const payload = await callChatWithOpenAIPrompt('이번 달 성장률은?', 'session', '  핵심\n메모  ');

  const prompt = payload.messages.find((line) => line.role === 'user')?.content ?? '';
  expect(prompt).toContain('[대화 프로필 노트]');
  expect(prompt).toContain('핵심 메모');
});

test('pinned memory mode injects memory profile note into prompt', async () => {
  const payload = await callChatWithOpenAIPrompt('최근 트렌드는?', 'pinned', '우선순위:\t콘텐츠 기획');

  const prompt = payload.messages.find((line) => line.role === 'user')?.content ?? '';
  expect(prompt).toContain('[대화 프로필 노트]');
  expect(prompt).toContain('우선순위: 콘텐츠 기획');
});

test('off memory mode does not inject memory profile prompt block', async () => {
  const payload = await callChatWithOpenAIPrompt('일반 문의', 'off', '오프 모드에서는 제외됨');

  const prompt = payload.messages.find((line) => line.role === 'user')?.content ?? '';
  expect(prompt).not.toContain('[대화 프로필 노트]');
  expect(prompt).not.toContain('오프 모드에서는 제외됨');
});
