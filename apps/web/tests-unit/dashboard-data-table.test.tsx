import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardDataTable } from '../components/admin/DashboardDataTable';

for (const count of [0, 50, 51, 490]) {
  test(`dashboard table bounds initial DOM for ${count} records without hiding total`, () => {
    const rows = Array.from({ length: count }, (_, id) => ({ id }));
    const html = renderToStaticMarkup(<DashboardDataTable rows={rows} columns={[{ key: 'id', header: 'ID', cell: row => row.id }]} getRowKey={row => String(row.id)} emptyText="자료 없음" />);
    expect((html.match(/aria-rowindex=/g) ?? []).length).toBe(Math.min(count, 50));
    if (!count) {
      expect(html).toContain('자료 없음');
      expect(html).not.toContain('<table');
    } else {
      expect(html).toContain(`aria-rowcount="${count + 1}"`);
      expect(html.includes('aria-label="표 다음 페이지"')).toBe(count > 50);
    }
  });
}
