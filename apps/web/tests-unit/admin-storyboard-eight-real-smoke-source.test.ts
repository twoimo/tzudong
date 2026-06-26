import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('storyboard eight real-provider smoke source contract', () => {
  test('keeps the real-provider smoke manual, fail-closed, and out of normal CI', () => {
    const packageSource = source('package.json');
    const smokeSource = source('scripts/storyboard-eight-real-provider-smoke.ts');
    const docsSource = source('../../docs/operations/storyboard-eight-real-provider-smoke.md');

    expect(packageSource).toContain('"storyboard:eight-real-smoke"');
    expect(packageSource).not.toContain('test:unit\": \"bun test tests-unit admin-storyboard-eight-real-provider-smoke');
    expect(smokeSource).toContain("const SMOKE_FLAG = 'STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_SMOKE'");
    expect(smokeSource).toContain("const CI_OVERRIDE_FLAG = 'STORYBOARD_ALLOW_CI_REAL_PROVIDER_SMOKE'");
    expect(smokeSource).toContain(
      "const ARGS_JSON_OVERRIDE_FLAG = 'STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_ALLOW_ARGS_JSON'",
    );
    expect(smokeSource).toContain('assertManualGuards(process.env)');
    expect(smokeSource).toContain('refusing before proof/provider execution');
    expect(smokeSource).toContain('CI=true detected');
    expect(smokeSource).toContain('STORYBOARD_LOCAL_CODEX_ARGS_JSON');
    expect(smokeSource).toContain('A fresh exact proof path');
    expect(smokeSource).toContain('use --all for all eight quota-consuming cases');
    expect(smokeSource).toContain('--output-dir must stay under ignored');
    expect(smokeSource).toContain('getStoryboardImageProviderAvailability(process.env)');
    expect(smokeSource).toContain("availability.providerId !== 'local-codex'");
    expect(smokeSource).toContain("availability.model !== 'gpt-image-2'");
    expect(smokeSource).toContain("availability.modelProvenance !== 'exact'");
    expect(smokeSource).toContain("STORYBOARD_GUIDED_EXAMPLE_STARTER_PRESETS");
    expect(smokeSource).toContain("DEFAULT_OUTPUT_DIR = '.omx/ultraqa/storyboard-eight-real-smoke'");
    expect(smokeSource).toContain('redact(process.env.STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE)');
    expect(smokeSource).not.toContain('process.env.OPENAI_API_KEY');

    expect(docsSource).toContain('This smoke is manual operator evidence');
    expect(docsSource).toContain('not part of normal CI');
    expect(docsSource).toContain('STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_SMOKE=1');
    expect(docsSource).toContain('Use `--case <id>` or `--limit <1-7>`');
    expect(docsSource).toContain('use `--all` only when all eight quota-consuming cases are intentional');
    expect(docsSource).toContain('Negative guard check');
  });
});
