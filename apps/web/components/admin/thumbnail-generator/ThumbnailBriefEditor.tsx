"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  isThumbnailReferenceRole,
  THUMBNAIL_REFERENCE_ROLE_OPTIONS,
  type ThumbnailReferenceRole,
} from '@/lib/admin/youtube-thumbnail-generator/reference-selection';

type ThumbnailBriefEditorProps = {
  topic: string;
  headline: string;
  subHeadline: string;
  files: File[];
  roles: ThumbnailReferenceRole[];
  disabled: boolean;
  error: string | null;
  onTopicChange: (value: string) => void;
  onHeadlineChange: (value: string) => void;
  onSubHeadlineChange: (value: string) => void;
  onAddReferences: () => void;
  onRemoveReference: (index: number) => void;
  onReferenceRoleChange: (index: number, value: ThumbnailReferenceRole) => void;
  onPreview: () => void;
};

export function ThumbnailBriefEditor(props: ThumbnailBriefEditorProps) {
  const [previews, setPreviews] = useState<Array<{ file: File; url: string }>>([]);
  useEffect(() => {
    const next: Array<{ file: File; url: string }> = [];
    for (const file of props.files) {
      if (file.size < 16 || file.size > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) continue;
      try { next.push({ file, url: URL.createObjectURL(file) }); } catch { /* The attachment remains removable without a preview. */ }
    }
    setPreviews(next);
    return () => { for (const preview of next) URL.revokeObjectURL(preview.url); };
  }, [props.files]);

  return (
    <div className="space-y-4" data-thumbnail-brief-editor="true">
      <div className="space-y-2">
        <Label htmlFor="thumbnail-brief-topic" className="text-sm font-medium">영상 주제</Label>
        <Textarea id="thumbnail-brief-topic" value={props.topic} maxLength={400} rows={3}
          disabled={props.disabled} onChange={(event) => props.onTopicChange(event.target.value)}
          placeholder="음식, 장소, 장면을 적어 주세요" className="min-h-20 resize-y text-sm"
          aria-describedby="thumbnail-brief-topic-help" />
        <p id="thumbnail-brief-topic-help" className="text-xs leading-5 text-muted-foreground">화면에 담을 내용과 강조할 특징을 적어 주세요</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="thumbnail-brief-headline" className="text-sm font-medium">메인 문구</Label>
        <Input id="thumbnail-brief-headline" value={props.headline} maxLength={80} disabled={props.disabled}
          onChange={(event) => props.onHeadlineChange(event.target.value)} className="h-11 text-sm" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="thumbnail-brief-subheadline" className="text-sm font-medium">보조 문구 <span className="font-normal text-muted-foreground">선택</span></Label>
        <Input id="thumbnail-brief-subheadline" value={props.subHeadline} maxLength={120} disabled={props.disabled}
          onChange={(event) => props.onSubHeadlineChange(event.target.value)} className="h-11 text-sm" />
      </div>
      <Button type="button" variant="outline" className="min-h-11 w-full" disabled={props.disabled || !props.topic.trim()}
        onClick={props.onPreview} data-thumbnail-brief-preview="true">문구 배치 미리보기</Button>
      <section className="space-y-2 border-t border-border pt-4" aria-labelledby="thumbnail-reference-heading">
        <div className="flex items-center justify-between gap-2">
          <h3 id="thumbnail-reference-heading" className="text-sm font-medium">참고 이미지 <span className="tabular-nums text-muted-foreground">{props.files.length}/8</span></h3>
          <Button type="button" variant="ghost" className="min-h-11 gap-1 px-2" disabled={props.disabled || props.files.length >= 8}
            onClick={props.onAddReferences}><Plus className="h-4 w-4" aria-hidden="true" />추가</Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">각 이미지의 용도를 확인하세요 · PNG, JPEG, WebP · 장당 8MB, 합계 16MB</p>
        {props.error && <p role="alert" className="text-xs leading-5 text-destructive">{props.error}</p>}
        {props.files.length === 0 ? <p className="py-2 text-sm text-muted-foreground">추가한 참고 이미지가 없습니다</p> : (
          <ul className="max-h-56 space-y-2 overflow-y-auto overscroll-contain" data-thumbnail-reference-list="true">
            {props.files.map((file, index) => {
              const preview = previews.find((item) => item.file === file);
              return <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="flex min-w-0 items-center gap-2 rounded-md border border-border p-2">
                <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded bg-muted">
                  {preview && <Image src={preview.url} alt={`참고 이미지 ${index + 1}`} fill unoptimized sizes="64px" className="object-contain" />}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-xs" title={file.name}>{file.name}</p>
                  <select aria-label={`참고 이미지 ${index + 1} 용도`} value={props.roles[index] ?? 'other'} disabled={props.disabled}
                    onChange={(event) => { if (isThumbnailReferenceRole(event.target.value)) props.onReferenceRoleChange(index, event.target.value); }}
                    className="h-11 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {THUMBNAIL_REFERENCE_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={props.disabled}
                  aria-label={`참고 이미지 ${index + 1} 삭제`} onClick={() => props.onRemoveReference(index)}><X className="h-4 w-4" aria-hidden="true" /></Button>
              </li>;
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
