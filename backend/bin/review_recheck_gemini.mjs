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
  const model = process.env.PRIMARY_MODEL || 'gemini-3.7-flash';
  const thinkingLevel = process.env.LAAJ_THINKING_LEVEL || 'MEDIUM';
  const isGemini38 = model.replace(/^models\//, '') === 'gemini-3.8-flash';
  if (isGemini38 && thinkingLevel.trim().toUpperCase() === 'MINIMAL') throw new Error('GEMINI_THINKING_LEVEL_UNSUPPORTED');
  const response = await generateWithProjectBudget(createGeminiClient(key), {
    model, contents: prompt,
    config: { ...(isGemini38 ? {} : { temperature: 0.1 }), maxOutputTokens: 4096, thinkingConfig: { thinkingLevel } },
  }, 300000);
  const text = requireGeminiText(response);
  fs.writeFileSync(output, text, { mode: 0o600 });
  logGeminiUsage(response);
} catch {
  console.error('REVIEW_RECHECK_PROVIDER_FAILED');
  process.exitCode = 1;
}
