import { afterEach, describe, expect, mock, test } from 'bun:test';
import { PerformanceMonitor } from '@/lib/performance-monitor';

const originalGroup = console.group;
const originalTable = console.table;
const originalGroupEnd = console.groupEnd;

afterEach(() => {
  console.group = originalGroup;
  console.table = originalTable;
  console.groupEnd = originalGroupEnd;
});

describe('performance monitor', () => {
  test('records nothing while disabled', () => {
    const monitor = new PerformanceMonitor(false);

    monitor.startMeasure('render');
    monitor.endMeasure('render');

    expect(monitor.getAverageDuration('render')).toBe(0);
    expect(monitor.getLastDuration('render')).toBe(0);
    expect(monitor.report()).toBeUndefined();
  });

  test('reports zero for labels that were never measured', () => {
    const monitor = new PerformanceMonitor(true);

    expect(monitor.getAverageDuration('render')).toBe(0);
    expect(monitor.getLastDuration('render')).toBe(0);
  });

  test('averages recorded measurements and keeps the last one', () => {
    const monitor = new PerformanceMonitor(true);

    monitor.startMeasure('render');
    monitor.endMeasure('render');
    const first = monitor.getLastDuration('render');

    monitor.startMeasure('render');
    monitor.endMeasure('render');
    const second = monitor.getLastDuration('render');

    expect(Number.isFinite(first)).toBe(true);
    expect(Number.isFinite(second)).toBe(true);
    expect(monitor.getAverageDuration('render')).toBeGreaterThanOrEqual(0);
    expect(monitor.getAverageDuration('render')).toBeLessThanOrEqual(Math.max(first, second));
  });

  test('resets a single label or every label', () => {
    const monitor = new PerformanceMonitor(true);

    for (const label of ['render', 'cluster']) {
      monitor.startMeasure(label);
      monitor.endMeasure(label);
    }
    expect(monitor.getLastDuration('render')).toBeGreaterThanOrEqual(0);

    monitor.reset('render');
    expect(monitor.getAverageDuration('render')).toBe(0);
    expect(monitor.getLastDuration('render')).toBe(0);

    monitor.reset();
    expect(monitor.getAverageDuration('cluster')).toBe(0);
    expect(monitor.getLastDuration('cluster')).toBe(0);
  });

  test('survives more measurements than the retained window', () => {
    const monitor = new PerformanceMonitor(true);

    for (let index = 0; index < 120; index += 1) {
      monitor.startMeasure('render');
      monitor.endMeasure('render');
    }

    expect(Number.isFinite(monitor.getAverageDuration('render'))).toBe(true);
    expect(Number.isFinite(monitor.getLastDuration('render'))).toBe(true);
  });

  test('prints a report table while enabled and stays silent while disabled', () => {
    const group = mock();
    const table = mock();
    const groupEnd = mock();
    console.group = group as unknown as typeof console.group;
    console.table = table as unknown as typeof console.table;
    console.groupEnd = groupEnd as unknown as typeof console.groupEnd;

    const enabled = new PerformanceMonitor(true);
    enabled.startMeasure('render');
    enabled.endMeasure('render');
    enabled.report();

    expect(group).toHaveBeenCalledTimes(1);
    expect(table).toHaveBeenCalledTimes(1);
    expect(groupEnd).toHaveBeenCalledTimes(1);

    const disabled = new PerformanceMonitor(false);
    disabled.report();

    expect(group).toHaveBeenCalledTimes(1);
  });

  test('returns a clearable interval from startAutoReport', () => {
    const monitor = new PerformanceMonitor(true);
    const timer = monitor.startAutoReport(50);

    expect(timer).toBeDefined();
    clearInterval(timer);
  });
});
