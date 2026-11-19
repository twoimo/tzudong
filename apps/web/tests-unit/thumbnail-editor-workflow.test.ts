import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '../components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx'), 'utf8');
const transpiler = new Bun.Transpiler({ loader: 'tsx' });

// Exercise the component's actual local handlers with inert collaborators; no browser or provider.
function handler(name: string, nextName: string, dependencies: Record<string, unknown>): (...args: unknown[]) => void {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(`  function ${nextName}(`, start + 1);
  if (start < 0 || end < start) throw new Error('THUMBNAIL_HANDLER_NOT_FOUND');
  const keys = Object.keys(dependencies);
  const compiled = transpiler.transformSync(`function create(${keys.join(',')}) { ${source.slice(start, end)} return ${name}; }`);
  const factory = new Function(`${compiled}\nreturn create;`)() as (...values: unknown[]) => (...args: unknown[]) => void;
  return factory(...Object.values(dependencies));
}

describe('thumbnail editor explicit workflow', () => {
  test('selecting an example previews the draft and opens editing without submitting a generation', () => {
    const example = { topic: '합성 음식 영상', headline: '한 상', subHeadline: '구성 예시' };
    const previews: unknown[] = []; let editsOpened = false; let generationCalls = 0;
    const preview = handler('handleThumbnailGuidedExamplePresetClick', 'handleThumbnailGuidedExampleClick', {
      applyThumbnailGuidedExamplePreviewToCanvas: (value: unknown) => previews.push(value),
      appendThumbnailChatCommand: () => undefined,
      setIsChatSettingsOpen: (open: boolean) => { editsOpened = open; },
      runThumbnailGeneration: () => { generationCalls += 1; },
    });
    preview(example);
    expect(previews).toEqual([example]); expect(editsOpened).toBe(true); expect(generationCalls).toBe(0);
  });

  test('selecting more files appends to the draft; cancelling selection preserves existing attachments', () => {
    const current = [{ name: 'existing.png' }]; const incoming = { name: 'new.png' };
    const changes: unknown[][] = []; let opens = 0;
    const select = handler('handleReferenceFilesSelected', 'previewThumbnailBrief', {
      files: current,
      handleReferenceFilesChange: (files: unknown[]) => { changes.push(files); return { acceptedCount: files.length, validationMessage: null }; },
      appendThumbnailChatAssistantNotice: () => undefined,
      setIsChatSettingsOpen: (open: boolean) => { if (open) opens += 1; },
    });
    select([]);
    expect(changes).toEqual([]); expect(opens).toBe(0);
    select([incoming]);
    expect(changes).toEqual([[current[0], incoming]]); expect(opens).toBe(1); expect(current).toHaveLength(1);
  });
});
