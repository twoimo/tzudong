import fs from 'node:fs';
import { createGeminiClient, generateWithProjectBudget, logGeminiUsage, requireGeminiText } from '../utils/gemini-client.mjs';

// One call per leased item: no health probe, rotation, second model, or replay
// after an uncertain provider response. Uses the existing LAAJ model/settings.
const [input, output] = process.argv.slice(2);
try {
  const key = process.env.GEMINI_CREDITS_API_KEY || process.env.GEMINI_API_KEY;
  if (!key || !input || !output) throw new Error('configuration');
  const prompt = fs.readFileSync(input, 'utf8');
  if (Buffer.byteLength(prompt) > 2 * 1024 * 1024) throw new Error('capacity');
  const response = await generateWithProjectBudget(createGeminiClient(key), {
    model: process.env.PRIMARY_MODEL || 'gemini-3.7-flash', contents: prompt,
    config: { temperature: 0.1, maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: process.env.LAAJ_THINKING_LEVEL || 'MEDIUM' } },
  }, 300000);
  const text = requireGeminiText(response);
  fs.writeFileSync(output, text, { mode: 0o600 });
  logGeminiUsage(response);
} catch {
  console.error('REVIEW_RECHECK_PROVIDER_FAILED');
  process.exitCode = 1;
}
