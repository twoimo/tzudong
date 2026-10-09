import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  STORYBOARD_GUIDED_EXAMPLE_STARTER_PRESETS,
} from '../lib/admin/storyboard/guided-example-presets';
import { generateLocalStoryboard } from '../lib/admin/storyboard/generator';
import { generateStoryboardSceneImages } from '../lib/admin/storyboard/image-provider';
import {
  isTrustedStoryboardGeneratedImage,
} from '../lib/admin/storyboard/image-trust';
import type { StoryboardGenerateRequest } from '../lib/admin/storyboard/types';

const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l9ggGQAAAABJRU5ErkJggg==';

const expectedStarterIds = [
  'seafood-feast',
  'night-market-spicy',
  'dessert-cafe-course',
  'pork-grill-table',
  'soup-noodle-comfort',
  'convenience-ramen-mix',
  'market-fried-chicken',
  'late-night-store-snack',
  'cheese-budae-ramen',
  'sushi-omakase-closeup',
];

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function writeExactProof(dir: string) {
  const imagePath = join(dir, 'proof.png');
  const proofPath = join(dir, 'proof.json');
  const image = Buffer.from(tinyPngBase64, 'base64');

  mkdirSync(dir, { recursive: true });
  writeFileSync(imagePath, image);
  writeFileSync(
    proofPath,
    `${JSON.stringify({
      ok: true,
      providerId: 'local-codex',
      authMode: 'codex_oauth',
      endpoint: 'https://chatgpt.com/backend-api/codex/responses',
      agentModel: 'gpt-5.5',
      requestToolType: 'image_generation',
      requestToolModel: 'gpt-image-2',
      model: 'gpt-image-2',
      modelProvenance: 'exact',
      responseId: 'resp_storyboard_ten_committed_ultraqa',
      imageCallId: 'ig_storyboard_ten_committed_ultraqa',
      imageItemCount: 1,
      generatedImageItemTypes: ['image_generation_call'],
      rawImageItemTypes: ['image_generation_call'],
      mime: 'image/png',
      bytes: image.length,
      outputPath: imagePath,
      requestHash: sha256('storyboard-ten-committed-ultraqa-proof-request'),
      responseHash: sha256(image),
      hasOpenAIAPIKey: false,
      generatedAt: new Date().toISOString(),
    })}\n`,
  );

  return { proofPath };
}

function buildFakeLocalProviderScript(markerPath: string) {
  return `
    const fs = require('node:fs');
    const path = require('node:path');
    const crypto = require('node:crypto');
    const sharp = require('sharp');
    let body = '';
    process.stdin.on('data', (chunk) => { body += chunk; });
    process.stdin.on('end', () => {
      void (async () => {
        try {
          const payload = JSON.parse(body);
          const image = await sharp({
            create: {
              width: 1536,
              height: 864,
              channels: 3,
              background: { r: 24, g: 48, b: 72 },
            },
          }).png().toBuffer();
          fs.mkdirSync(path.dirname(payload.outputPath), { recursive: true });
          fs.writeFileSync(payload.outputPath, image);
          fs.appendFileSync(${JSON.stringify(markerPath)}, JSON.stringify({
            outputPath: payload.outputPath,
            hasOpenAIAPIKey: Boolean(process.env.OPENAI_API_KEY),
            promptPreview: String(payload.prompt).slice(0, 120),
          }) + '\\n');
          console.log(JSON.stringify({
            ok: true,
            providerId: 'local-codex',
            authMode: 'codex_oauth',
            endpoint: 'https://chatgpt.com/backend-api/codex/responses',
            agentModel: payload.agentModel,
            requestToolType: 'image_generation',
            requestToolModel: 'gpt-image-2',
            model: 'gpt-image-2',
            modelProvenance: 'exact',
            responseId: 'resp_' + crypto.createHash('sha256').update(payload.prompt).digest('hex').slice(0, 16),
            imageCallId: 'ig_' + crypto.createHash('sha256').update(payload.outputPath).digest('hex').slice(0, 16),
            imageItemCount: 1,
            generatedImageItemTypes: ['image_generation_call'],
            rawImageItemTypes: ['image_generation_call'],
            requestHash: crypto.createHash('sha256').update(payload.prompt).digest('hex'),
            responseHash: crypto.createHash('sha256').update(image).digest('hex'),
            mime: 'image/png',
            bytes: image.length,
            outputPath: payload.outputPath,
            hasOpenAIAPIKey: Boolean(process.env.OPENAI_API_KEY),
            generatedAt: new Date().toISOString(),
          }));
        } catch (error) {
          console.error(error);
          process.exitCode = 1;
        }
      })();
    });
  `;
}

describe('storyboard ten guided preset UltraQA coverage', () => {
  test('preserves ten starter presets while retired image execution rejects each preset', async () => { expect(STORYBOARD_GUIDED_EXAMPLE_STARTER_PRESETS).toHaveLength(10); expect(STORYBOARD_GUIDED_EXAMPLE_STARTER_PRESETS.map(p=>p.id)).toEqual(expectedStarterIds); for(const preset of STORYBOARD_GUIDED_EXAMPLE_STARTER_PRESETS){await expect(generateStoryboardSceneImages([{} as never],{title:preset.title,logline:preset.prompt,request:{} as never})).rejects.toThrow('STORYBOARD_WORKFLOW_RETIRED');} }, 30_000);
});
