import { describe, expect, test } from 'bun:test';
import {
    type AdminInsightSystemStatusChecklistItem,
    type AdminInsightSystemStatusResponse,
    type AdminInsightSystemReadinessCard,
    getSystemStatusChecklistCategoryLabel,
    getSystemStatusChecklistSourceLabel,
    summarizeRunDailyReadiness,
    summarizeFrameCaptionReadiness,
    summarizeGDriveCaptionReadiness,
    groupChecklistItemsBySeverityAndCategory,
    normalizeSystemStatusHints,
    summarizeSystemReadiness,
} from '@/components/insight/InsightChatSection';

describe('insight system status checklist normalization', () => {
    test('normalizes malformed checklist items without throwing', () => {
        const checklist: unknown[] = [
            {
                id: 'check-1',
                title: '정상 항목',
                severity: 'critical',
                category: 'environment',
                action: '점검 요청',
                source: 'storyboard-agent',
            },
            {
                id: 'check-2',
                title: '통합 경고',
                severity: 'high',
                category: 'integration',
                action: '재시도',
                source: 'unknown-source',
            },
            {
                id: '',
                severity: 'weird-severity',
                category: 'mystery',
                title: '알 수 없음',
                action: '',
                source: null,
            },
            null,
            undefined,
            {
                id: 'check-4',
                title: '',
                severity: 'low',
                category: undefined,
                action: undefined,
                source: undefined,
            },
        ];

        const groups = groupChecklistItemsBySeverityAndCategory(checklist as unknown as AdminInsightSystemStatusChecklistItem[]);

        expect(groups).toHaveLength(3);

        const criticalEnvironmentGroup = groups.find((item) => item.severity === 'critical' && item.category === 'environment');
        expect(criticalEnvironmentGroup).toBeDefined();
        expect(criticalEnvironmentGroup?.items).toHaveLength(1);
        expect(criticalEnvironmentGroup?.items[0].id).toBe('check-1');
        expect(criticalEnvironmentGroup?.items[0].source).toBe('storyboard-agent');

        const highIntegrationGroup = groups.find((item) => item.severity === 'high' && item.category === 'integration');
        expect(highIntegrationGroup).toBeDefined();
        expect(highIntegrationGroup?.items).toHaveLength(1);
        expect(highIntegrationGroup?.items[0].source).toBe('provider-key');

        const lowGeneralGroup = groups.find((item) => item.severity === 'low' && item.category === 'general');
        expect(lowGeneralGroup).toBeDefined();
        expect(lowGeneralGroup?.items).toHaveLength(2);

        const fallbackChecklistTitles = lowGeneralGroup?.items.map((item) => item.title);
        expect(fallbackChecklistTitles).toContain('알 수 없음');
        expect(fallbackChecklistTitles).toContain('제목 없음');
        const checklistWithCommand = lowGeneralGroup?.items.find((item) => item.id === 'check-4');
        expect(checklistWithCommand?.commandSnippet).toBeUndefined();
    });

    test('normalizes checklist command snippets as strings only', () => {
        const checklist: unknown[] = [
            {
                id: 'check-1',
                title: '명령어 포함',
                severity: 'high',
                category: 'integration',
                action: '명령어 실행 필요',
                source: 'storyboard-agent',
                commandSnippet: '  curl -fsS "$URL/health"  ',
            },
            {
                id: 'check-2',
                title: '무시 대상',
                severity: 'medium',
                category: 'provider-key',
                action: '비정상 데이터',
                source: 'provider-key',
                commandSnippet: 123,
            },
        ];

        const groups = groupChecklistItemsBySeverityAndCategory(checklist as unknown as AdminInsightSystemStatusChecklistItem[]);
        const highIntegrationGroup = groups.find((item) => item.severity === 'high' && item.category === 'integration');
        expect(highIntegrationGroup).toBeDefined();
        expect(highIntegrationGroup?.items[0]?.commandSnippet).toBe('curl -fsS "$URL/health"');

        const mediumProviderGroup = groups.find((item) => item.severity === 'medium' && item.category === 'provider-key');
        expect(mediumProviderGroup).toBeDefined();
        expect(mediumProviderGroup?.items[0]?.commandSnippet).toBeUndefined();
    });

    test('maps checklist source/category labels with safe fallbacks', () => {
        expect(getSystemStatusChecklistSourceLabel('storyboard-agent')).toBe('스토리보드 에이전트');
        expect(getSystemStatusChecklistSourceLabel('unknown-source')).toBe('기타');
        expect(getSystemStatusChecklistSourceLabel(123)).toBe('기타');

        expect(getSystemStatusChecklistCategoryLabel('environment')).toBe('환경');
        expect(getSystemStatusChecklistCategoryLabel('unmapped-category')).toBe('기타');
    });

    test('summarizes frame-caption readiness from payload or checklist hints', () => {
        const directPayloadStatus: AdminInsightSystemStatusResponse = {
            asOf: '2026-02-28T10:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://storyboard.internal/api',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            bgeEmbedding: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://bge.internal/v1/embeddings',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            checklist: [],
        } as AdminInsightSystemStatusResponse & Record<string, unknown>;

        (directPayloadStatus as Record<string, unknown>).frameCaptionData = {
            configured: true,
            ready: true,
            path: '/tmp/frame-captions',
        };

        const directSummary = summarizeFrameCaptionReadiness(directPayloadStatus);
        expect(directSummary).not.toBeNull();
        expect(directSummary).toMatchObject({
            title: '피크 프레임 데이터',
            statusText: '정상',
            statusTone: 'good',
            path: '/tmp/frame-captions',
        } as Partial<AdminInsightSystemReadinessCard>);

        const checklistOnlyStatus: AdminInsightSystemStatusResponse = {
            asOf: '2026-02-28T10:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://storyboard.internal/api',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            bgeEmbedding: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://bge.internal/v1/embeddings',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            checklist: [
                {
                    id: 'frame-caption-path-missing',
                    title: '피크 프레임 데이터 경로 미설정',
                    severity: 'high',
                    category: 'general',
                    action: 'FRAME_CAPTION_PATH를 확인해 주세요.',
                    source: 'provider-key',
                },
            ] as AdminInsightSystemStatusChecklistItem[],
        };

        const checklistSummary = summarizeFrameCaptionReadiness(checklistOnlyStatus);
        expect(checklistSummary).not.toBeNull();
        expect(checklistSummary?.title).toBe('피크 프레임 데이터');
        expect(checklistSummary?.statusTone).toBe('warning');
    });

    test('summarizes run_daily readiness from direct payload and stale log state', () => {
        const status: AdminInsightSystemStatusResponse = {
            asOf: '2026-02-28T10:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://storyboard.internal/api',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            bgeEmbedding: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://bge.internal/v1/embeddings',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            runDaily: {
                scriptPath: '/opt/app/backend/run_daily.sh',
                executable: true,
                latestLogPath: '/opt/app/backend/log/cron/daily_2026-03-01.log',
                latestLogUpdatedAt: '2026-03-01T00:00:00.000Z',
                stale: false,
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            checklist: [],
        };

        const summary = summarizeRunDailyReadiness(status);
        expect(summary).not.toBeNull();
        expect(summary).toMatchObject({
            title: 'run_daily 수집',
            path: '/opt/app/backend/run_daily.sh',
            statusText: '정상',
            statusTone: 'good',
        });

        const staleStatus: AdminInsightSystemStatusResponse = {
            ...status,
            runDaily: {
                ...status.runDaily,
                executable: false,
                stale: true,
            },
        };

        const staleSummary = summarizeRunDailyReadiness(staleStatus);
        expect(staleSummary).not.toBeNull();
        expect(staleSummary?.statusText).toBe('실행 권한 필요');
        expect(staleSummary?.statusTone).toBe('warning');
    });

    test('summarizes run_daily readiness from checklist-only signal', () => {
        const status: AdminInsightSystemStatusResponse = {
            asOf: '2026-02-28T10:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://storyboard.internal/api',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            bgeEmbedding: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://bge.internal/v1/embeddings',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            checklist: [
                {
                    id: 'run-daily-log-stale',
                    title: 'run_daily 로그 점검 실패',
                    severity: 'medium',
                    category: 'environment',
                    action: '로그를 확인해 주세요.',
                    source: 'run_daily',
                },
            ],
        } as AdminInsightSystemStatusResponse;

        const summary = summarizeRunDailyReadiness(status);
        expect(summary).not.toBeNull();
        expect(summary?.statusText).toBe('로그 점검 필요');
        expect(summary?.statusTone).toBe('warning');
    });

    test('summarizes gdrive caption readiness from payload', () => {
        const status: AdminInsightSystemStatusResponse = {
            asOf: '2026-02-28T10:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://storyboard.internal/api',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            bgeEmbedding: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://bge.internal/v1/embeddings',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            checklist: [],
        } as AdminInsightSystemStatusResponse & Record<string, unknown>;

        (status as Record<string, unknown>).gdriveFrameCaptionReadiness = {
            configured: true,
            ready: false,
            path: 'gs://tzuyang-frames/peak',
            detail: '테스트 경로 미연결',
        };

        const gdriveSummary = summarizeGDriveCaptionReadiness(status);
        expect(gdriveSummary).not.toBeNull();
        expect(gdriveSummary).toMatchObject({
            title: 'GDrive 증거 경로',
            path: 'gs://tzuyang-frames/peak',
            statusTone: 'warning',
            detail: '테스트 경로 미연결',
        } as Partial<AdminInsightSystemReadinessCard>);
    });

    test('summarizes system readiness score for full readiness', () => {
        const status: AdminInsightSystemStatusResponse = {
            asOf: '2026-02-28T10:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://storyboard.internal/api',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            bgeEmbedding: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://bge.internal/v1/embeddings',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            runDaily: {
                scriptPath: '/opt/app/backend/run_daily.sh',
                executable: true,
                latestLogPath: '/opt/app/backend/log/cron/daily_2026-03-01.log',
                latestLogUpdatedAt: '2026-02-28T09:58:00.000Z',
                stale: false,
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            checklist: [],
        };

        const summary = summarizeSystemReadiness(status);
        expect(summary.status).toBe('good');
        expect(summary.readinessPercent).toBe(100);
        expect(summary.blockers).toHaveLength(0);
        expect(summary.reason).toContain('준비되어');
    });

    test('marks readiness as critical when checklist has critical item', () => {
        const status: AdminInsightSystemStatusResponse = {
            asOf: '2026-02-28T10:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: false,
                nanoBanana2Key: true,
            },
            storyboardAgent: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://storyboard.internal/api',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            bgeEmbedding: {
                enabled: true,
                configured: true,
                reachable: true,
                endpoint: 'https://bge.internal/v1/embeddings',
                checkedAt: '2026-02-28T10:00:00.000Z',
            },
            checklist: [
                {
                    id: 'storyboard-health-failed',
                    title: '스토리보드 헬스체크 실패',
                    severity: 'critical',
                    category: 'integration',
                    action: '재시도',
                    source: 'storyboard-agent',
                },
            ] as AdminInsightSystemStatusChecklistItem[],
        };

        const summary = summarizeSystemReadiness(status);
        expect(summary.status).toBe('critical');
        expect(summary.readinessPercent).toBeLessThan(100);
        expect(summary.blockers).toContain('Anthropic 서버 키');
        expect(summary.reason).toContain('즉시 점검');
    });

    test('returns warning state for partial readiness', () => {
        expect(summarizeSystemReadiness(null).status).toBe('warning');
        expect(summarizeSystemReadiness(null).readinessPercent).toBe(0);
    });

    test('normalizes system status hints with dedupe and invalid filtering', () => {
        const hints = normalizeSystemStatusHints([
            '  LLM 키 없음: gemini ',
            'LLM 키 없음: GEMINI',
            '',
            null,
            '스토리보드 에이전트 연결 확인 필요',
        ] as unknown);

        expect(hints).toEqual([
            'LLM 키 없음: gemini',
            '스토리보드 에이전트 연결 확인 필요',
        ]);
    });
});
