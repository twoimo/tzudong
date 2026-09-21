import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function source(relativePath: string) {
    return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const BOUNDED_CLIENT_PATH = 'lib/admin/storyboard/rag-service-role-client.ts';
const RAG_ROUTE_PATHS = [
    'app/api/admin/storyboard/rag/documents/route.ts',
    'app/api/admin/storyboard/rag/search/route.ts',
];

describe('storyboard RAG service-role narrowing', () => {
    test('bounded client module stays type-only and never imports the privileged client', () => {
        const bounded = source(BOUNDED_CLIENT_PATH);

        expect(bounded).not.toMatch(/from\s+['"]@\/lib\/supabase\/service-role['"]/);
        expect(bounded).not.toMatch(/require\(\s*['"]@\/lib\/supabase\/service-role['"]/);
        expect(bounded).not.toMatch(/^import\s+(?!type\b)/m);
        expect(bounded).toContain('StoryboardRagDocumentsClient');
        expect(bounded).toContain('StoryboardRagRpcClient');
    });

    test('RAG routes narrow the privileged client instead of widening it to any', () => {
        for (const routePath of RAG_ROUTE_PATHS) {
            const route = source(routePath);

            expect(route, `${routePath} must not cast the service-role client to any`).not.toMatch(
                /createSupabaseServiceRoleClient\(\)\s*as\s+any\b/,
            );
            expect(route, `${routePath} must narrow through the bounded client module`).toContain(
                'rag-service-role-client',
            );
            expect(route, `${routePath} must keep the privileged client call itself`).toContain(
                'createSupabaseServiceRoleClient()',
            );
        }
    });
});
