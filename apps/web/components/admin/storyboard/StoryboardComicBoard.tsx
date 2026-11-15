"use client";

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react';

export type StoryboardComicScene = {
  sceneNo: number; title: string; description: string; caption: string; durationSec: number;
  image?: unknown; imageError?: string | null;
};

export function StoryboardComicBoard<T extends StoryboardComicScene>({
  scenes, selectedScene, onSelect, renderImage, disabled = false, state = 'ready', message,
}: {
  scenes: readonly T[]; selectedScene: number; onSelect: (sceneNo: number) => void;
  renderImage?: (scene: T) => ReactNode; disabled?: boolean;
  state?: 'empty' | 'loading' | 'waiting' | 'error' | 'ready'; message?: string;
}) {
  const page = Math.min(Math.floor((Math.max(1, selectedScene) - 1) / 4), Math.max(0, Math.ceil(scenes.length / 4) - 1));
  const pages = Math.max(1, Math.ceil(scenes.length / 4));
  const visible = scenes.slice(page * 4, page * 4 + 4);
  const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  return <section aria-label="네 컷 미리보기" className="min-w-0">
    <div className="mb-3 flex min-h-10 items-center justify-between gap-3">
      <div><h3 className="text-base font-semibold">이야기를 한눈에</h3>
        <p className="text-xs text-muted-foreground">{scenes.length ? `${scenes.length}컷을 4컷씩 나눠 보여 드려요.` : '이야기를 정하면 이곳에 장면이 채워져요.'}</p></div>
      <div className="flex shrink-0 items-center gap-1" aria-label="미리보기 페이지">
        <button type="button" aria-label="이전 네 컷" disabled={disabled || page === 0}
          onClick={() => onSelect((page - 1) * 4 + 1)} className={`flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-40 ${focusClass}`}><ChevronLeft size={18} aria-hidden="true" /></button>
        <span className="min-w-10 text-center text-sm tabular-nums" aria-live="polite">{page + 1} / {pages}</span>
        <button type="button" aria-label="다음 네 컷" disabled={disabled || page + 1 >= pages}
          onClick={() => onSelect((page + 1) * 4 + 1)} className={`flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-40 ${focusClass}`}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
    </div>
    {message && <p role={state === 'error' ? 'alert' : 'status'} className={`mb-3 text-sm ${state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>}
    <div className="grid aspect-square max-h-[min(60vh,600px)] min-h-[280px] w-full min-w-0 grid-cols-2 grid-rows-2 gap-3" aria-busy={state === 'loading' || undefined}>
      {[0, 1, 2, 3].map(slot => {
        const scene = visible[slot];
        return scene ? <button key={scene.sceneNo} type="button" aria-label={`장면 ${scene.sceneNo} 선택`}
          aria-current={selectedScene === scene.sceneNo ? 'step' : undefined} disabled={disabled}
          onClick={() => onSelect(scene.sceneNo)}
          className={`group flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-left transition-colors motion-reduce:transition-none ${focusClass} ${selectedScene === scene.sceneNo ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-foreground/40'} disabled:cursor-default`}>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/40">
            {scene.image && renderImage ? renderImage(scene) : <div className="flex flex-col items-center gap-2 p-3 text-center text-sm text-muted-foreground">
              <ImageIcon size={24} strokeWidth={1.5} aria-hidden="true" /><span>{scene.imageError ? '이미지를 확인해 주세요' : '이미지 대기 중'}</span>
            </div>}
            <span className="absolute left-2 top-2 rounded-md bg-background/95 px-2 py-1 text-xs font-semibold text-foreground">{scene.sceneNo}컷</span>
          </div>
          <div className="min-w-0 border-t border-border px-3 py-2">
            <p className="truncate text-sm font-semibold">{scene.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{scene.caption || scene.description}</p>
          </div>
        </button> : <div key={`empty-${slot}`} className="flex min-h-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-3 text-center">
          <span className="text-sm font-medium text-muted-foreground">{scenes.length ? '이 페이지의 마지막 컷이에요' : `${slot + 1}컷 미리보기`}</span>
          {!scenes.length && <span className="max-w-40 text-xs leading-5 text-muted-foreground">{state === 'loading' ? '저장된 장면을 확인 중이에요.' : state === 'waiting' ? '완료된 장면부터 표시돼요.' : state === 'error' ? '결과를 확인하면 다시 표시돼요.' : '아직 생성된 이미지가 없어요.'}</span>}
        </div>;
      })}
    </div>
  </section>;
}
