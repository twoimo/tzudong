import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin storyboard canvas shell extraction', () => {
  test('keeps canvas shell attributes in the extracted presentational component', () => {
    const generatorSource = source('components/admin/storyboard/AdminStoryboardGenerator.tsx');
    const shellSource = source('components/admin/storyboard/StoryboardCanvasShell.tsx');

    expect(generatorSource).toContain('StoryboardCanvasShell');
    expect(generatorSource).toContain('StoryboardFrameGrid');
    expect(shellSource).toContain('data-storyboard-result-panel="image-frames-only"');
    expect(shellSource).toContain('aria-label="스토리보드 이미지 생성 결과"');
    expect(shellSource).toContain('role="region"');
    expect(shellSource).toContain('data-storyboard-image-board="true"');
    expect(shellSource).toContain('data-storyboard-frame-grid="true"');
  });

  test('leaves provider readiness and trusted-image decisions in the orchestrator', () => {
    const generatorSource = source('components/admin/storyboard/AdminStoryboardGenerator.tsx');
    const shellSource = source('components/admin/storyboard/StoryboardCanvasShell.tsx');

    expect(generatorSource).toContain('mapStoryboardImageProviderReadiness');
    expect(generatorSource).toContain('getTrustedStoryboardGeneratedImage');
    expect(generatorSource).toContain('stripUntrustedStoryboardGeneratedImages');
    expect(shellSource).not.toContain('getTrustedStoryboardGeneratedImage');
    expect(shellSource).not.toContain('STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE');
  });
});
