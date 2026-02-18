'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { memo, useCallback, useMemo, useState, type ElementType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Menu, AlertTriangle, MapPinned, Users, Sparkles, BarChart3, CalendarClock, Video, Activity, Cloud, Play } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import type {
    DashboardFailuresResponse,
    DashboardFunnelResponse,
    DashboardQualityResponse,
    DashboardSummaryResponse,
} from '@/types/dashboard';

import styles from './insight-overhaul.module.css';

const HeatmapSection = dynamic(() => import('@/components/insight/HeatmapSection'), {
    ssr: false,
    loading: () => <SectionSkeleton title="유튜브 히트맵" />,
});

const MapSection = dynamic(() => import('@/components/insight/MapSection'), {
    ssr: false,
    loading: () => <SectionSkeleton title="지도 인사이트" />,
});

const WordCloudSection = dynamic(() => import('@/components/insight/WordCloudSection'), {
    ssr: false,
    loading: () => <SectionSkeleton title="키워드 인사이트" />,
});

const SeasonCalendarSection = dynamic(() => import('@/components/insight/SeasonCalendarSection'), {
    ssr: false,
    loading: () => <SectionSkeleton title="시즌 인사이트" />,
});

const InsightChatSection = dynamic(() => import('@/components/insight/InsightChatSection'), {
    ssr: false,
    loading: () => <SectionSkeleton title="AI 인사이트" />,
});

type AdminInsightTab = 'chat' | 'operations' | 'map';
type InsightMapTab = 'heatmap' | 'map' | 'wordcloud' | 'season';
type StatTone = 'neutral' | 'danger' | 'success';

type StatItem = {
    icon: ElementType;
    label: string;
    value: string;
    helper: string;
    tone: StatTone;
};

type QuickLink = {
    href: string;
    label: string;
    icon: ElementType;
};

type Tab = {
    value: AdminInsightTab;
    label: string;
    icon: ElementType;
    desc: string;
};

type MapTab = {
    value: InsightMapTab;
    label: string;
    icon: ElementType;
    desc: string;
};

async function fetchDashboardJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`요청에 실패했습니다: ${url}`);
    }
    return response.json() as Promise<T>;
}

async function fetchYouTubeCount(type: 'subscriberCount' | 'videoCount'): Promise<number> {
    const apiKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY_BYEON || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
    if (!apiKey) {
        return 0;
    }

    const response = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=@tzuyang6145&key=${apiKey}`,
    );
    if (!response.ok) {
        throw new Error('YouTube API 응답 실패');
    }

    const payload = await response.json();
    const target = type === 'subscriberCount' ? 'subscriberCount' : 'videoCount';
    const value = payload?.items?.[0]?.statistics?.[target] as string | undefined;
    const parsed = Number.parseInt(value ?? '0', 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '-';
    return value.toLocaleString('ko-KR');
}

function formatPercent(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '-';
    return `${value.toFixed(2)}%`;
}

function formatAsOf(isoDate: string | null | undefined): string {
    if (!isoDate) return '동기화 정보 없음';
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime())) return '동기화 정보 없음';
    return parsed.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function safeSum(items: { count: number }[] | undefined): number {
    if (!items) return 0;
    return items.reduce((acc, item) => acc + (item?.count ?? 0), 0);
}

const tabs: Tab[] = [
    {
        value: 'chat',
        label: 'AI 인사이트',
        icon: Sparkles,
        desc: '채팅 분석 / 요약',
    },
    {
        value: 'operations',
        label: '운영 분석',
        icon: AlertTriangle,
        desc: '퍼널 · 실패 원인',
    },
    {
        value: 'map',
        label: '지도 인사이트',
        icon: MapPinned,
        desc: '히트맵 / 지도',
    },
];

const mapTabs: MapTab[] = [
    {
        value: 'heatmap',
        label: '유튜브 히트맵',
        icon: Play,
        desc: '반응 구간 분석',
    },
    {
        value: 'map',
        label: '맛집 지도',
        icon: MapPinned,
        desc: '좌표 보유 분포',
    },
    {
        value: 'wordcloud',
        label: '키워드',
        icon: Cloud,
        desc: '실시간 트렌드',
    },
    {
        value: 'season',
        label: '시즌',
        icon: CalendarClock,
        desc: '월별 업로드 타이밍',
    },
];

const quickLinks: QuickLink[] = [
    {
        href: '/admin/evaluations',
        label: '제보 검수',
        icon: MapPinned,
    },
    {
        href: '/admin/restaurants',
        label: '식당 목록',
        icon: Users,
    },
    {
        href: '/admin/insight',
        label: '인사이트(현재)',
        icon: BarChart3,
    },
    {
        href: '/admin/settings',
        label: '설정',
        icon: Activity,
    },
];

const SectionSkeleton = memo(({ title }: { title: string }) => (
    <section className={styles.panelShell}>
        <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>{title}</h3>
        </div>
        <div className={styles.panelBody}>
            <RefreshCw className={styles.spin} />
            <p className={styles.panelHint}>로딩 중</p>
        </div>
    </section>
));
SectionSkeleton.displayName = 'SectionSkeleton';

const StatTile = memo(
    ({
        icon: Icon,
        label,
        value,
        helper,
        tone,
    }: {
        icon: ElementType;
        label: string;
        value: string;
        helper: string;
        tone: StatTone;
    }) => {
        const toneClass =
            tone === 'danger'
                ? styles.statDanger
                : tone === 'success'
                    ? styles.statSuccess
                    : styles.statNeutral;

        return (
            <article className={cn(styles.statTile, toneClass)}>
                <div className={styles.statTileHeader}>
                    <span className={styles.statIconWrap}>
                        <Icon className={styles.statIcon} />
                    </span>
                    <span className={styles.statLabel}>{label}</span>
                </div>
                <p className={styles.statValue}>{value}</p>
                <p className={styles.statHelper}>{helper}</p>
            </article>
        );
    },
);
StatTile.displayName = 'StatTile';

const YouTubeTile = memo(
    ({
        icon: Icon,
        label,
        type,
        suffix,
        enabled,
    }: {
        icon: ElementType;
        label: string;
        type: 'subscriberCount' | 'videoCount';
        suffix: string;
        enabled: boolean;
    }) => {
        const { data, isLoading, error } = useQuery({
            queryKey: ['admin-insight-youtube', type],
            queryFn: () => fetchYouTubeCount(type),
            staleTime: 1000 * 60 * 5,
            enabled,
        });
        const display = isLoading ? '로딩 중' : error ? '-' : `${formatNumber(data)}${suffix}`;

        return (
            <article className={cn(styles.statTile, styles.youtubeTile)}>
                <div className={styles.statTileHeader}>
                    <span className={styles.statIconWrap}>
                        <Icon className={styles.statIcon} />
                    </span>
                    <span className={styles.statLabel}>{label}</span>
                </div>
                <p className={styles.statValue}>{display}</p>
                <p className={styles.statHelper}>YouTube 실시간 동기화</p>
            </article>
        );
    },
);
YouTubeTile.displayName = 'YouTubeTile';

const FailureLinkItem = memo(({ href, label, value }: { href: string; label: string; value: string }) => (
    <Link href={href} className={styles.failureItem}>
        <span className={styles.failureLabel}>{label}</span>
        <span className={styles.failureValue}>{value}</span>
    </Link>
));
FailureLinkItem.displayName = 'FailureLinkItem';

const AdminOpsSection = memo(
    ({
        funnel,
        failures,
        quality,
        isLoading,
    }: {
        funnel?: DashboardFunnelResponse;
        failures?: DashboardFailuresResponse;
        quality?: DashboardQualityResponse;
        isLoading: boolean;
    }) => {
        if (isLoading) {
            return <SectionSkeleton title="운영 분석" />;
        }

        if (!funnel || !failures || !quality) {
            return (
                <section className={styles.panelShell}>
                    <div className={styles.panelHeader}>
                        <h3 className={styles.panelTitle}>운영 분석</h3>
                    </div>
                    <div className={styles.panelBody}>
                        <p className={styles.panelHint}>운영 지표를 불러오지 못했습니다.</p>
                    </div>
                </section>
            );
        }

        return (
            <div className={styles.opsGrid}>
                <article className={styles.opsPanel}>
                    <h4 className={styles.opsPanelTitle}>파이프라인 퍼널</h4>
                    <div className={styles.metricList}>
                        <div className={styles.metricRow}>
                            <span>수집 건수</span>
                            <span className={styles.metricValue}>{formatNumber(funnel.counts.crawling)}</span>
                        </div>
                        <div className={styles.metricRow}>
                            <span>선정·비선정</span>
                            <span className={styles.metricValue}>{formatNumber(funnel.counts.selectionUnion)}</span>
                        </div>
                        <div className={styles.metricRow}>
                            <span>규칙 통과</span>
                            <span className={styles.metricValue}>{formatNumber(funnel.counts.rule)}</span>
                        </div>
                        <div className={styles.metricRow}>
                            <span>LAAJ 통과</span>
                            <span className={styles.metricValue}>{formatNumber(funnel.counts.laaj)}</span>
                        </div>
                    </div>
                    <div className={styles.metricList}>
                        <div className={styles.metricRow}>
                            <span>선정율</span>
                            <span className={styles.metricValue}>{formatPercent(funnel.conversion.selectionRate)}</span>
                        </div>
                        <div className={styles.metricRow}>
                            <span>규칙 통과율</span>
                            <span className={styles.metricValue}>{formatPercent(funnel.conversion.ruleRate)}</span>
                        </div>
                        <div className={styles.metricRow}>
                            <span>LAAJ 통과율</span>
                            <span className={styles.metricValue}>{formatPercent(funnel.conversion.laajRate)}</span>
                        </div>
                    </div>
                </article>

                <article className={styles.opsPanel}>
                    <h4 className={styles.opsPanelTitle}>비선정 사유 상위</h4>
                    <div className={styles.failureList}>
                        {(failures.notSelectionReasons ?? []).slice(0, 6).map((item) => (
                            <FailureLinkItem
                                key={`not-${item.label}`}
                                href={`/admin/evaluations?issue=notSelection&reason=${encodeURIComponent(item.label)}`}
                                label={item.label}
                                value={formatNumber(item.count)}
                            />
                        ))}
                    </div>
                </article>

                <article className={styles.opsPanel}>
                    <h4 className={styles.opsPanelTitle}>규칙 실패 / LAAJ 누락</h4>
                    <div className={styles.failureList}>
                        {(failures.ruleFalseMessages ?? []).slice(0, 6).map((item) => (
                            <FailureLinkItem
                                key={`rule-${item.label}`}
                                href={`/admin/evaluations?issue=ruleFalse&reason=${encodeURIComponent(item.label)}`}
                                label={item.label}
                                value={formatNumber(item.count)}
                            />
                        ))}
                    </div>
                    <div className={styles.opsFooter}>
                        <span className={styles.opsFooterLabel}>LAAJ 누락 건수</span>
                        <FailureLinkItem
                            href="/admin/evaluations?issue=laajGap"
                            label="상세보기"
                            value={formatNumber(failures.laajGaps.count)}
                        />
                    </div>
                </article>

                <article className={styles.opsPanel}>
                    <h4 className={styles.opsPanelTitle}>품질 지표</h4>
                    <div className={styles.metricList}>
                        <div className={styles.metricRow}>
                            <span>위치 일치</span>
                            <span className={styles.metricValue}>
                                T {formatNumber(quality.locationMatch.trueCount)} / F {formatNumber(quality.locationMatch.falseCount)}
                            </span>
                        </div>
                        <div className={styles.metricRow}>
                            <span>카테고리 유효성</span>
                            <span className={styles.metricValue}>
                                T {formatNumber(quality.categoryValidity.trueCount)} / F {formatNumber(quality.categoryValidity.falseCount)}
                            </span>
                        </div>
                        <div className={styles.metricRow}>
                            <span>카테고리 판별</span>
                            <span className={styles.metricValue}>
                                T {formatNumber(quality.categoryTF.trueCount)} / F {formatNumber(quality.categoryTF.falseCount)}
                            </span>
                        </div>
                    </div>
                </article>
            </div>
        );
    },
);
AdminOpsSection.displayName = 'AdminOpsSection';

const InsightClientComponent = () => {
    const { isAdmin, isLoading: isAuthLoading } = useAuth();
    const [isNavCollapsed, setIsNavCollapsed] = useState(false);
    const [activeTab, setActiveTab] = useState<AdminInsightTab>('chat');
    const [activeMapTab, setActiveMapTab] = useState<InsightMapTab>('heatmap');

    const summaryQuery = useQuery<DashboardSummaryResponse, Error>({
        queryKey: ['admin-dashboard-summary'],
        queryFn: () => fetchDashboardJson<DashboardSummaryResponse>('/api/dashboard/summary'),
        enabled: isAdmin,
        staleTime: 1000 * 60 * 5,
    });

    const funnelQuery = useQuery<DashboardFunnelResponse, Error>({
        queryKey: ['admin-dashboard-funnel'],
        queryFn: () => fetchDashboardJson<DashboardFunnelResponse>('/api/dashboard/funnel'),
        enabled: isAdmin,
        staleTime: 1000 * 60 * 5,
    });

    const failuresQuery = useQuery<DashboardFailuresResponse, Error>({
        queryKey: ['admin-dashboard-failures'],
        queryFn: () => fetchDashboardJson<DashboardFailuresResponse>('/api/dashboard/failures'),
        enabled: isAdmin,
        staleTime: 1000 * 60 * 5,
    });

    const qualityQuery = useQuery<DashboardQualityResponse, Error>({
        queryKey: ['admin-dashboard-quality'],
        queryFn: () => fetchDashboardJson<DashboardQualityResponse>('/api/dashboard/quality'),
        enabled: isAdmin,
        staleTime: 1000 * 60 * 5,
    });

    const summary = summaryQuery.data;
    const funnel = funnelQuery.data;
    const failures = failuresQuery.data;
    const quality = qualityQuery.data;

    const syncLabel = useMemo(() => {
        const allAsOf = [summary?.asOf, funnel?.asOf, failures?.asOf, quality?.asOf].filter(Boolean) as string[];
        return formatAsOf(allAsOf[0]);
    }, [summary?.asOf, funnel?.asOf, failures?.asOf, quality?.asOf]);

    const isDataLoading =
        summaryQuery.isLoading || funnelQuery.isLoading || failuresQuery.isLoading || qualityQuery.isLoading;

    const isOperationsLoading = funnelQuery.isLoading || failuresQuery.isLoading || qualityQuery.isLoading;

    const stats: StatItem[] = useMemo(() => {
        const ruleFailureTotal = safeSum(failures?.ruleFalseMessages);
        const laajGapTotal = failures?.laajGaps.count ?? 0;

        return [
            {
                icon: MapPinned,
                label: '좌표 보유 맛집',
                value: formatNumber(summary?.totals.withCoordinates),
                helper: '지도 노출 가능',
                tone: 'success',
            },
            {
                icon: Users,
                label: '총 맛집',
                value: formatNumber(summary?.totals.restaurants),
                helper: '운영 대상 전체',
                tone: 'neutral',
            },
            {
                icon: Video,
                label: '총 영상',
                value: formatNumber(summary?.totals.videos),
                helper: '크롤링 누적',
                tone: 'neutral',
            },
            {
                icon: Activity,
                label: '선정·비선정',
                value: formatNumber(funnel?.counts.selectionUnion),
                helper: '파이프라인 합계',
                tone: 'neutral',
            },
            {
                icon: AlertTriangle,
                label: '규칙 실패',
                value: formatNumber(ruleFailureTotal),
                helper: '운영 알람',
                tone: ruleFailureTotal > 0 ? 'danger' : 'success',
            },
            {
                icon: CalendarClock,
                label: 'LAAJ 누락',
                value: formatNumber(laajGapTotal),
                helper: '추가 처리 필요',
                tone: laajGapTotal > 0 ? 'danger' : 'success',
            },
        ];
    }, [summary, funnel, failures]);

    const handleTabChange = useCallback((next: AdminInsightTab) => {
        setActiveTab(next);
    }, []);

    const handleMapTabChange = useCallback((next: InsightMapTab) => {
        setActiveMapTab(next);
    }, []);

    const handleNavToggle = useCallback(() => {
        setIsNavCollapsed((prev) => !prev);
    }, []);

    if (isAuthLoading) {
        return (
            <div className={styles.centerShell}>
                <div className={styles.centerPanel}>
                    <RefreshCw className={styles.spin} />
                    <p>권한 확인 중입니다.</p>
                </div>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className={styles.centerShell}>
                <section className={styles.centerPanel}>
                    <div className={styles.deniedSign}>!</div>
                    <h3 className={styles.centerPanelTitle}>관리자 전용 페이지입니다</h3>
                    <p className={styles.panelHint}>현재 계정은 관리자 권한이 없습니다.</p>
                    <Link href="/" className={styles.deniedAction}>
                        홈으로 이동
                    </Link>
                </section>
            </div>
        );
    }

    return (
        <section className={cn(styles.shellRoot, isNavCollapsed && styles.shellRootNavCollapsed)}>
            <div className={styles.shell}>
                <aside className={styles.nav}>
                    <div className={styles.navHeader}>
                        <div className={styles.brandWrap}>
                            <span className={styles.brandLogo}>ID</span>
                            <div className={styles.brandTextWrap}>
                                <div className={styles.brandTitle}>쯔동여지도 인사이트</div>
                                <div className={styles.brandSub}>OpenClaw-inspired Analytics</div>
                            </div>
                        </div>
                        <button
                            type="button"
                            className={styles.navToggle}
                            onClick={handleNavToggle}
                            aria-label={isNavCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
                        >
                            <Menu className={styles.navToggleIcon} />
                        </button>
                    </div>

                    <section className={styles.navSection}>
                        <h2 className={styles.navSectionTitle}>분석 패널</h2>
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.value}
                                    type="button"
                                    className={cn(styles.navItem, activeTab === tab.value && styles.navItemActive)}
                                    onClick={() => handleTabChange(tab.value)}
                                >
                                    <Icon className={styles.navItemIcon} />
                                    <span className={styles.navItemTextWrap}>
                                        <span className={styles.navItemLabel}>{tab.label}</span>
                                        <span className={styles.navItemBlurb}>{tab.desc}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </section>

                    <section className={styles.navSection}>
                        <h2 className={styles.navSectionTitle}>관리 메뉴</h2>
                        {quickLinks.map((link) => {
                            const Icon = link.icon;
                            return (
                                <Link key={link.label} href={link.href} className={styles.navItem}>
                                    <Icon className={styles.navItemIcon} />
                                    <span className={styles.navItemTextWrap}>
                                        <span className={styles.navItemLabel}>{link.label}</span>
                                        <span className={styles.navItemBlurb}>바로가기</span>
                                    </span>
                                </Link>
                            );
                        })}
                    </section>
                </aside>

                <main className={styles.content}>
                    <header className={styles.contentHeader}>
                        <div>
                            <h1 className={styles.pageTitle}>관리 운영 대시보드</h1>
                            <p className={styles.pageSub}>운영 지표, 규칙 실패, 지도 인사이트를 한 화면에서 확인합니다.</p>
                        </div>
                        <div className={styles.pageMeta}>
                            <span className={styles.pill}>SYNC: {syncLabel}</span>
                            <span className={styles.pill}>ENDPOINT: /api/dashboard</span>
                        </div>
                    </header>

                    {isDataLoading && !summary && !funnel && !failures && !quality ? (
                        <SectionSkeleton title="인사이트 데이터 로딩 중" />
                    ) : (
                        <>
                            <section className={styles.statGrid}>
                                {stats.map((item) => (
                                    <StatTile
                                        key={item.label}
                                        icon={item.icon}
                                        label={item.label}
                                        value={item.value}
                                        helper={item.helper}
                                        tone={item.tone}
                                    />
                                ))}
                            </section>

                            <section className={styles.statStrip}>
                                <YouTubeTile
                                    icon={BarChart3}
                                    label="쯔양 구독자"
                                    type="subscriberCount"
                                    suffix="명"
                                    enabled={isAdmin}
                                />
                                <YouTubeTile
                                    icon={Video}
                                    label="총 영상 수"
                                    type="videoCount"
                                    suffix="개"
                                    enabled={isAdmin}
                                />
                            </section>

                            <section className={styles.mainPanel}>
                                <div className={styles.mainTabBar}>
                                    {tabs.map((tab) => {
                                        const Icon = tab.icon;
                                        return (
                                            <button
                                                key={tab.value}
                                                type="button"
                                                className={cn(styles.mainTab, activeTab === tab.value && styles.mainTabActive)}
                                                onClick={() => handleTabChange(tab.value)}
                                            >
                                                <Icon className={styles.mainTabIcon} />
                                                <span>{tab.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className={styles.mainTabContent}>
                                    {activeTab === 'chat' && (
                                        <div className={styles.innerPanel}>
                                            <InsightChatSection />
                                        </div>
                                    )}

                                    {activeTab === 'operations' && (
                                        <AdminOpsSection
                                            funnel={funnel}
                                            failures={failures}
                                            quality={quality}
                                            isLoading={isOperationsLoading}
                                        />
                                    )}

                                    {activeTab === 'map' && (
                                        <div className={styles.innerPanel}>
                                            <div className={styles.subTabBar}>
                                                {mapTabs.map((item) => {
                                                    const Icon = item.icon;
                                                    return (
                                                        <button
                                                            key={item.value}
                                                            type="button"
                                                            className={cn(styles.subTab, activeMapTab === item.value && styles.subTabActive)}
                                                            onClick={() => handleMapTabChange(item.value)}
                                                        >
                                                            <Icon className={styles.subTabIcon} />
                                                            <span className={styles.subTabText}>
                                                                <span className={styles.subTabLabel}>{item.label}</span>
                                                                <span className={styles.subTabDesc}>{item.desc}</span>
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            <div className={styles.subTabContent}>
                                                {activeMapTab === 'heatmap' && <HeatmapSection />}
                                                {activeMapTab === 'map' && <MapSection />}
                                                {activeMapTab === 'wordcloud' && <WordCloudSection />}
                                                {activeMapTab === 'season' && <SeasonCalendarSection />}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>
                        </>
                    )}
                </main>
            </div>
        </section>
    );
};

const InsightClient = memo(InsightClientComponent);
InsightClient.displayName = 'InsightClient';

export default InsightClient;
