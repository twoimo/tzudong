import { describe, expect, test } from 'bun:test';
import {
  getAuditComparison, getAuditResidual, getAuditValues, performanceAuditSnapshot as audit,
  summarizeAuditValues,
} from '../lib/admin/performance-audit';

describe('audited performance observations', () => {
  test('retains all ten admitted observations including the first large values', () => {
    expect(audit.analysisSha256).toBe('80795786da10461b2cf2c5694b4c94128ef117d48d35a3ded191487ca20e4abf');
    expect(audit.phases.map(phase => phase.mode)).toEqual(['legacy', 'rpc']);
    for (const phase of audit.phases) {
      for (const values of Object.values(phase.metricsMs)) {
        expect(values).toHaveLength(5);
        expect(summarizeAuditValues(values)).not.toBeNull();
      }
    }
    expect(audit.phases[0].metricsMs.externalTotal[0]).toBe(9971.786);
    expect(audit.phases[1].metricsMs.externalTotal[0]).toBe(8028.048);
  });

  test('adds each legacy request pair before computing its median', () => {
    const phase = audit.phases[0];
    expect(getAuditValues(phase, 'request')).toEqual([1995.078, 535.553, 672.844, 607.344, 357.908]);
    expect(getAuditComparison('request').before?.median).toBe(607.344);
    expect(getAuditComparison('request').before?.median).not.toBe(159.117 + 380.062);
  });

  test('subtracts paired observations, keeping the residual separate from pure network time', () => {
    const residual = getAuditResidual(audit.phases[1]);
    expect(residual).toEqual([921.9, 263.53, 256.674, 108.387, 263.688]);
    expect(summarizeAuditValues(residual!)?.median).toBe(263.53);
  });

  test('unknown measurements stay unavailable and never become zero', () => {
    expect(getAuditComparison('database').before).toBeNull();
    expect(getAuditComparison('database').percentLower).toBeNull();
    expect(audit.browser.state).toBe('unavailable');
    expect(summarizeAuditValues([])).toBeNull();
    expect(summarizeAuditValues([NaN])).toBeNull();
    expect(summarizeAuditValues([-1])).toBeNull();
    expect(getAuditValues({ ...audit.phases[0], metricsMs: { 'kpi-bucket-request': [1], 'kpi-rows-request': [1, 2] } }, 'request')).toBeNull();
  });
});
