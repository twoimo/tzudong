import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import ts from 'typescript';

const source = readFileSync(join(import.meta.dir, '../app/api/privacy/onboarding/route.ts'), 'utf8');
const tree = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const node = tree.statements.find(statement => ts.isFunctionDeclaration(statement)
  && statement.name?.text === 'compensationIdempotencyKey');
if (!node) throw new Error('Missing compensation key function');
const compiled = ts.transpileModule(node.getText(tree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
// Run the route's actual private function without importing network/auth clients.
const key = new Function('createHmac', `${compiled}\nreturn compensationIdempotencyKey;`)(createHmac) as
  (challengeId: string, userId: string, reason: string) => string;

describe('durable privacy compensation key compatibility', () => {
  test('existing v1 hold keys remain identical after the token digest correction', () => {
    for (let i = 0; i < 12; i++) {
      const challenge = `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
      const owner = `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`;
      const reason = i % 2 ? 'PROFILE_READBACK_FAILED' : 'ONBOARDING_CONFIRM_FAILED';
      const input = `privacy-onboarding-compensation:v1:${challenge}:${owner}:${reason}`;
      const legacy = createHmac('sha256', 'tzudong:privacy-digest:v1').update(input).digest('hex');
      const changedTokenDigest = createHash('sha256').update(input).digest('hex');
      // Boolean assertions keep identifiers/digests out of failed test diagnostics.
      expect(key(challenge, owner, reason) === legacy).toBe(true);
      expect(key(challenge, owner, reason) === changedTokenDigest).toBe(false);
    }
  });

  test('the same operation is stable and distinct challenge, owner and reason stay separate', () => {
    const before = key('challenge-a', 'owner-a', 'reason-a');
    expect(key('challenge-a', 'owner-a', 'reason-a') === before).toBe(true);
    expect(key('challenge-b', 'owner-a', 'reason-a') === before).toBe(false);
    expect(key('challenge-a', 'owner-b', 'reason-a') === before).toBe(false);
    expect(key('challenge-a', 'owner-a', 'reason-b') === before).toBe(false);
  });
});
