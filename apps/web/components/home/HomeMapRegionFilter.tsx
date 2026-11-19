'use client';

import { useId, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Globe, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { MapFilterTriggerLabel } from '@/components/filters/MapFilterTriggerLabel';
import { homeMapResultStatusText, type HomeMapResultSummary } from '@/lib/home-map-result-summary';
import { cn } from '@/lib/utils';

export interface HomeMapRegionFilterProps {
    mapMode: 'domestic' | 'overseas';
    value: string | undefined;
    options: readonly { value: string; label: string; count?: number }[];
    resultSummary: HomeMapResultSummary;
    onValueChange: (value: string) => void;
}

/** Mode changes remount the local popover/search state without changing the parent's selection. */
export function HomeMapRegionFilter(props: HomeMapRegionFilterProps) {
    return <RegionFilter key={props.mapMode} {...props} />;
}

function RegionFilter({ mapMode, value, options, resultSummary, onValueChange }: HomeMapRegionFilterProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const statusId = useId();
    const noun = mapMode === 'domestic' ? '지역' : '국가';
    const selected = options.find((option) => option.value === value);
    const label = selected?.label ?? noun;
    const ready = resultSummary.status === 'ready';
    const statusText = homeMapResultStatusText(resultSummary);

    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        if (!open) setSearch('');
    };

    return (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-label={`${noun} 선택: ${label}`}
                    aria-describedby={statusId}
                    title={`${noun} 필터: ${label}`}
                    className="h-11 w-full min-w-0 justify-between gap-2 rounded-full border-border bg-background/95 px-3 text-xs font-medium shadow-sm"
                >
                    <MapFilterTriggerLabel
                        icon={mapMode === 'domestic' ? MapPin : Globe}
                        label={label}
                        count={ready ? selected?.count : undefined}
                    />
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <span id={statusId} role="status" className="sr-only">{statusText}</span>
            <PopoverContent
                side="top"
                align="start"
                sideOffset={8}
                aria-label={`${noun} 필터`}
                className="t-dropdown z-[180] w-[min(21rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-hidden rounded-2xl border-border bg-card p-0 shadow-2xl"
            >
                <Command
                    label={`${noun} 검색`}
                    defaultValue={selected?.value}
                    className="max-h-[var(--radix-popover-content-available-height)] rounded-2xl bg-card"
                    filter={(optionValue, query) => {
                        const optionLabel = options.find((option) => option.value === optionValue)?.label;
                        return optionLabel?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ? 1 : 0;
                    }}
                >
                    <div className="shrink-0 border-b border-border/70 px-3 py-3">
                        <p className="text-sm font-semibold text-foreground">{noun} 필터</p>
                        <p className="mt-1 text-xs text-muted-foreground">{statusText}</p>
                    </div>
                    <CommandInput
                        ref={searchInputRef}
                        value={search}
                        onValueChange={setSearch}
                        aria-label={`${noun} 검색`}
                        placeholder={`${noun} 검색…`}
                        className="h-11 text-sm"
                    />
                    <CommandList className="min-h-0 max-h-[min(21rem,calc(100dvh-9rem))] overscroll-contain p-2">
                        <CommandEmpty className="px-3 py-6 text-center text-sm text-muted-foreground">
                            <p>일치하는 {noun}이 없습니다.</p>
                            <Button
                                type="button"
                                variant="outline"
                                className="mt-3 min-h-11"
                                onClick={() => {
                                    setSearch('');
                                    searchInputRef.current?.focus();
                                }}
                            >
                                전체 {noun} 보기
                            </Button>
                        </CommandEmpty>
                        <CommandGroup className="p-0">
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    value={option.value}
                                    aria-label={option.label}
                                    onSelect={() => {
                                        handleOpenChange(false);
                                        if (option.value !== value) onValueChange(option.value);
                                    }}
                                    className="min-h-11 rounded-xl px-3 py-2 data-[selected='true']:bg-accent"
                                >
                                    <Check
                                        className={cn('mr-2 h-4 w-4 shrink-0 text-primary', value === option.value ? 'opacity-100' : 'opacity-0')}
                                        aria-hidden="true"
                                    />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={option.label}>{option.label}</span>
                                    {value === option.value && <span className="sr-only">선택됨</span>}
                                    {ready && option.count !== undefined && (
                                        <span className="ml-3 shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs tabular-nums text-muted-foreground">
                                            {option.count}개
                                        </span>
                                    )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

export default HomeMapRegionFilter;
