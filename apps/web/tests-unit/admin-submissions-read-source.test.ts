import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

describe('admin submission read', () => {
  test('loads pending submissions through the admin route', () => {
    const page = readFileSync(resolve(root, 'app/admin/evaluations/page.tsx'), 'utf8');
    const route = readFileSync(resolve(root, 'app/api/admin/submissions/route.ts'), 'utf8');

    expect(page).toContain("fetch('/api/admin/submissions'");
    expect(page).not.toContain(".from('restaurant_submissions')");
    expect(page).not.toContain(".from('restaurant_submission_items')");
    expect(route).toContain('requireAdmin()');
    expect(route).toContain('from("restaurant_submissions")');
    expect(route).toContain('from("restaurant_submission_items")');
    expect(route).toContain('private, no-store, max-age=0');
    expect(route).toContain('["pending", "partially_approved"]');
  });
});
