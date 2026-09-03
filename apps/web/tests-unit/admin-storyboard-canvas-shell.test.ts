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
  test('releases the embedded storyboard shell at stacked responsive widths only', () => {
    const appGlobalsSource = source('app/app-globals.css');
    const adminOverviewSource = source('components/admin/console/module-panel-registry.tsx');
    const responsiveStoryboardShellRules = /@media \(max-width: 1099px\) \{[\s\S]*?\[data-admin-console-content="true"\]\[data-admin-console-active-module="storyboard"\]\s*\{[^}]*overflow-y:\s*auto\s*!important;[^}]*\}[\s\S]*?\[data-admin-console-content="true"\]\[data-admin-console-active-module="storyboard"\][\s\S]*?\[data-admin-console-inline-module-frame="true"\]\[data-admin-console-inline-module-id="storyboard"\]\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*100%;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*\}[\s\S]*?\[data-admin-console-content="true"\]\[data-admin-console-active-module="storyboard"\][\s\S]*?\[data-admin-console-inline-module-frame="true"\]\[data-admin-console-inline-module-id="storyboard"\][\s\S]*?>\s*\[data-admin-console-inline-module-panel="true"\]\s*\{[^}]*flex:\s*none;[^}]*height:\s*auto;[^}]*min-height:\s*auto;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*\}[\s\S]*?\[data-admin-embedded-module-id="storyboard"\]\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*\}[\s\S]*?\[data-admin-embedded-module-id="storyboard"\]\s*>\s*\[data-admin-module-content="bounded"\]\s*\{[^}]*flex:\s*none;[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*\}[\s\S]*?\}/;

    expect(adminOverviewSource).toContain('data-admin-console-inline-module-frame="true"');
    expect(adminOverviewSource).toContain('data-admin-console-inline-module-id={menuId}');
    expect(appGlobalsSource).toMatch(responsiveStoryboardShellRules);
    expect(appGlobalsSource.match(/data-admin-embedded-module-id="storyboard"/g)).toHaveLength(2);
  });
});
