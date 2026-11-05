import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin storyboard canvas shell extraction', () => {
  test('keeps current scene output inside the Gemini project workspace', () => {
    const workspaceSource = source('components/admin/storyboard/LocalStoryboardWorkspace.tsx');
    const aliasSource = source('components/admin/storyboard/LegacyStoryboardReference.tsx');

    expect(workspaceSource).toContain('aria-labelledby="local-scenes-title"');
    expect(workspaceSource).toContain('view.project.document.scenes.map');
    expect(workspaceSource).toContain('function AssetImage');
    expect(workspaceSource).toContain('function Provenance');
    expect(workspaceSource).toContain('privateAssetUrl');
    expect(workspaceSource).toContain('VersionHistory');
    expect(aliasSource).toContain('export { AdminStoryboardGenerator }');
    expect(aliasSource).not.toContain('StoryboardCanvasShell');
  });

  test('keeps historical image trust separate from current stored asset rendering', () => {
    const archiveSource = source('components/admin/storyboard/AdminStoryboardGenerator.tsx');
    const workspaceSource = source('components/admin/storyboard/LocalStoryboardWorkspace.tsx');

    expect(archiveSource).toContain('getTrustedStoryboardGeneratedImage');
    expect(archiveSource).toContain('data-storyboard-archive="read-only"');
    expect(workspaceSource).toContain('asset.provenance');
    expect(workspaceSource).toContain('modelEvidence === "unverified"');
    expect(workspaceSource).not.toContain('STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE');
  });
  test('releases the embedded storyboard shell at stacked responsive widths only', () => {
    const appGlobalsSource = source('app/app-globals.css');
    const adminOverviewSource = source('components/admin/AdminConsoleOverview.tsx');
    const responsiveStoryboardShellRules = /@media \(max-width: 1099px\) \{[\s\S]*?\[data-admin-console-content="true"\]\[data-admin-console-active-module="storyboard"\]\s*\{[^}]*overflow-y:\s*auto\s*!important;[^}]*\}[\s\S]*?\[data-admin-console-content="true"\]\[data-admin-console-active-module="storyboard"\][\s\S]*?\[data-admin-console-inline-module-frame="true"\]\[data-admin-console-inline-module-id="storyboard"\]\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*100%;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*\}[\s\S]*?\[data-admin-console-content="true"\]\[data-admin-console-active-module="storyboard"\][\s\S]*?\[data-admin-console-inline-module-frame="true"\]\[data-admin-console-inline-module-id="storyboard"\][\s\S]*?>\s*\[data-admin-console-inline-module-panel="true"\]\s*\{[^}]*flex:\s*none;[^}]*height:\s*auto;[^}]*min-height:\s*auto;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*\}[\s\S]*?\[data-admin-embedded-module-id="storyboard"\]\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*\}[\s\S]*?\[data-admin-embedded-module-id="storyboard"\]\s*>\s*\[data-admin-module-content="bounded"\]\s*\{[^}]*flex:\s*none;[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*\}[\s\S]*?\}/;

    expect(adminOverviewSource).toContain('data-admin-console-inline-module-frame="true"');
    expect(adminOverviewSource).toContain('data-admin-console-inline-module-id={module.id}');
    expect(appGlobalsSource).toMatch(responsiveStoryboardShellRules);
    expect(appGlobalsSource.match(/data-admin-embedded-module-id="storyboard"/g)).toHaveLength(2);
  });
});
