'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminInsightSeasonResponse, InsightMonthlySeasonData, InsightSeasonalKeyword } from '@/types/insight';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Clock, Flame, TrendingDown, TrendingUp, Video } from 'lucide-react';

type MonthlySeasonData = InsightMonthlySeasonData;
type SeasonalKeyword = InsightSeasonalKeyword;

const EMPTY_MONTHS: MonthlySeasonData[] = [];

async function fetchSeasonCalendar(): Promise<AdminInsightSeasonResponse> {
    const response = await fetch('/api/admin/insight/season');
    if (!response.ok) {
        throw new Error('시즌 인사이트 데이터를 가져오지 못했습니다');
    }
    return response.json() as Promise<AdminInsightSeasonResponse>;
}

function formatGrowth(value: number | null): string {
    if (value == null) return '-';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value}%`;
}

const GrowthPill = memo(({ label, value }: { label: string; value: number | null }) => {
    const isUp = typeof value === 'number' && value > 0;
    const isDown = typeof value === 'number' && value < 0;

    return (
        <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className={cn(
                "font-semibold",
                isUp ? 'text-green-600' : isDown ? 'text-red-600' : 'text-muted-foreground'
            )}>
                {formatGrowth(value)}
            </span>
            {isUp && <TrendingUp className="h-3 w-3 text-green-600" />}
            {isDown && <TrendingDown className="h-3 w-3 text-red-600" />}
        </div>
    );
});
GrowthPill.displayName = 'GrowthPill';

const KeywordCard = memo(({ keyword }: { keyword: SeasonalKeyword }) => (
    <div className="rounded-xl border border-border/60 p-3 bg-gradient-to-br from-card to-secondary/20 hover:to-secondary/30 transition-colors">
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">{keyword.icon}</span>
                    <p className="font-semibold truncate">{keyword.keyword}</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">{keyword.category}</Badge>
                    <Badge variant="outline" className="text-[10px]">{keyword.peakWeek}</Badge>
                </div>
            </div>
            <div className="shrink-0 flex items-center gap-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
        </div>

        <div className="mt-3 space-y-1.5">
            <GrowthPill label="작년 대비" value={keyword.lastYearGrowth} />
            <GrowthPill label="예상" value={keyword.predictedGrowth} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-secondary/40 p-2">
                <p className="text-muted-foreground">촬영</p>
                <p className="font-medium">{keyword.recommendedShootDate}</p>
            </div>
            <div className="rounded-lg bg-secondary/40 p-2">
                <p className="text-muted-foreground">업로드</p>
                <p className="font-medium">{keyword.recommendedUploadDate}</p>
            </div>
        </div>

        {keyword.relatedVideos?.length ? (
            <div className="mt-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                    <Video className="h-3.5 w-3.5" />
                    관련 영상
                </div>
                <ul className="text-xs space-y-1 text-muted-foreground">
                    {keyword.relatedVideos.slice(0, 3).map((title) => (
                        <li key={title} className="truncate">- {title}</li>
                    ))}
                </ul>
            </div>
        ) : null}
    </div>
));
KeywordCard.displayName = 'KeywordCard';

const MonthTabs = memo(({
    selectedMonth,
    onSelectMonth,
}: {
    selectedMonth: number;
    onSelectMonth: (month: number) => void;
}) => (
    <div className="flex flex-wrap gap-2">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <Button
                key={m}
                size="sm"
                variant={m === selectedMonth ? 'default' : 'outline'}
                className="h-8 px-3 text-xs"
                onClick={() => onSelectMonth(m)}
            >
                {m}월
            </Button>
        ))}
    </div>
));
MonthTabs.displayName = 'MonthTabs';

const MiniCalendar = memo(({
    currentMonth,
    currentYear,
    peakDays,
    onPrevMonth,
    onNextMonth,
}: {
    currentMonth: number;
    currentYear: number;
    peakDays: ReadonlySet<number>;
    onPrevMonth: () => void;
    onNextMonth: () => void;
}) => {
    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === currentYear && (today.getMonth() + 1) === currentMonth;
    const todayDate = today.getDate();

    const days = useMemo(() => {
        const cells: Array<number | null> = [];
        for (let i = 0; i < startDayOfWeek; i += 1) cells.push(null);
        for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
        return cells;
    }, [daysInMonth, startDayOfWeek]);

    const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

    return (
        <Card className="h-full">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <Button variant="ghost" size="icon" onClick={onPrevMonth} aria-label="이전 달">
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="text-center">
                        <CardTitle className="text-base">{currentYear}년 {currentMonth}월</CardTitle>
                        <CardDescription className="text-xs">피크 일자 하이라이트</CardDescription>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onNextMonth} aria-label="다음 달">
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-7 gap-1 text-[10px] text-muted-foreground mb-1">
                    {weekDays.map((w) => (
                        <div key={w} className="text-center">{w}</div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {days.map((d, idx) => {
                        if (d == null) {
                            return <div key={`empty-${idx}`} className="h-8" />;
                        }

                        const isPeak = peakDays.has(d);
                        const isToday = isCurrentMonth && d === todayDate;

                        return (
                            <div
                                key={d}
                                className={cn(
                                    "h-8 rounded-md flex items-center justify-center text-xs border",
                                    isPeak ? "bg-orange-500/10 border-orange-500/30 text-orange-700" : "border-border/50",
                                    isToday ? "ring-1 ring-primary" : ""
                                )}
                                title={isPeak ? '피크' : undefined}
                            >
                                {d}
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
});
MiniCalendar.displayName = 'MiniCalendar';

const SeasonCalendarSectionComponent = () => {
    const today = new Date();
    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();

    const [currentMonth, setCurrentMonth] = useState(todayMonth);
    const [currentYear, setCurrentYear] = useState(today.getFullYear());

    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-insight-season'],
        queryFn: fetchSeasonCalendar,
        staleTime: 1000 * 60 * 5,
    });

    const months: MonthlySeasonData[] = data?.months ?? EMPTY_MONTHS;

    const currentSeasonData = useMemo(
        () => months.find((m) => m.month === currentMonth),
        [months, currentMonth],
    );

    const peakDays = useMemo(() => {
        const set = new Set<number>();
        currentSeasonData?.keywords?.forEach((k) => {
            k.peakDays?.forEach((d) => set.add(d));
        });
        return set;
    }, [currentSeasonData]);

    const hotKeywords = useMemo(() => {
        const thisMonth = months.find((m) => m.month === todayMonth);
        const nextMonth = months.find((m) => m.month === ((todayMonth % 12) + 1));

        const all: SeasonalKeyword[] = [];
        if (thisMonth) all.push(...thisMonth.keywords);
        if (nextMonth && todayDay > 20) all.push(...nextMonth.keywords.slice(0, 2));

        return all
            .sort((a, b) => (b.predictedGrowth ?? -999) - (a.predictedGrowth ?? -999))
            .slice(0, 4);
    }, [months, todayDay, todayMonth]);

    const handlePrevMonth = useCallback(() => {
        if (currentMonth === 1) {
            setCurrentMonth(12);
            setCurrentYear((y) => y - 1);
        } else {
            setCurrentMonth((m) => m - 1);
        }
    }, [currentMonth]);

    const handleNextMonth = useCallback(() => {
        if (currentMonth === 12) {
            setCurrentMonth(1);
            setCurrentYear((y) => y + 1);
        } else {
            setCurrentMonth((m) => m + 1);
        }
    }, [currentMonth]);

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="h-10 w-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-red-500" />
                        시즌 캘린더
                    </CardTitle>
                    <CardDescription>시즌 데이터를 불러오지 못했습니다.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <div className="h-full overflow-auto">
            <div className="flex flex-col gap-4 p-1">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <MiniCalendar
                        currentMonth={currentMonth}
                        currentYear={currentYear}
                        peakDays={peakDays}
                        onPrevMonth={handlePrevMonth}
                        onNextMonth={handleNextMonth}
                    />

                    <Card className="lg:col-span-2">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Flame className="h-5 w-5 text-orange-500" />
                                이번 시즌 핫 키워드
                            </CardTitle>
                            <CardDescription>
                                최근 업로드된 영상의 자막 하이라이트 키워드를 월별로 집계한 결과입니다.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {hotKeywords.length === 0 ? (
                                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                                    표시할 키워드가 없습니다.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {hotKeywords.map((keyword) => (
                                        <KeywordCard key={keyword.keyword} keyword={keyword} />
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <CalendarDays className="h-5 w-5" />
                            월별 시즌 트렌드
                        </CardTitle>
                        <CardDescription>
                            월을 선택하면 해당 월의 TOP 키워드를 확인할 수 있습니다.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <MonthTabs selectedMonth={currentMonth} onSelectMonth={setCurrentMonth} />
                        <Separator className="my-3" />
                        {currentSeasonData ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {currentSeasonData.keywords.map((keyword) => (
                                    <KeywordCard key={keyword.keyword} keyword={keyword} />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                <AlertCircle className="h-12 w-12 mb-3" />
                                <p>{currentMonth}월 시즌 데이터가 없습니다</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

const SeasonCalendarSection = memo(SeasonCalendarSectionComponent);
SeasonCalendarSection.displayName = 'SeasonCalendarSection';

export default SeasonCalendarSection;
