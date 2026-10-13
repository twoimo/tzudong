const groups = ['app-chunk', 'naver-sdk', 'naver-other', 'other-script', 'native-or-unknown'];

function location(frame, inherited) {
  let group = inherited, asset = null;
  if (frame.url) {
    try {
      const url = new URL(frame.url);
      if (url.hostname === 'localhost' && /^\/_next\/static\/chunks\/[A-Za-z0-9_.\/-]+\.js$/.test(url.pathname)) {
        group = 'app-chunk'; asset = url.pathname;
      } else if (url.hostname === 'oapi.map.naver.com' && url.pathname === '/openapi/v3/maps.js') {
        group = 'naver-sdk'; asset = '/openapi/v3/maps.js';
      } else if (/(^|\.)(naver\.com|pstatic\.net|ntruss\.com)$/.test(url.hostname)) {
        group = 'naver-other';
      } else group = 'other-script';
    } catch { group = 'other-script'; }
  }
  const name = typeof frame.functionName === 'string' && /^[A-Za-z_$][A-Za-z0-9_$.]{0,63}$/.test(frame.functionName)
    ? frame.functionName : 'unnamed';
  return { group, asset, function: name, line: Number.isInteger(frame.lineNumber) ? frame.lineNumber : null,
    column: Number.isInteger(frame.columnNumber) ? frame.columnNumber : null };
}

export function summarizeAllocationProfile(profile) {
  if (!profile?.head || !Array.isArray(profile.samples) || profile.samples.length > 1_000_000) throw Error('PROFILE_SCHEMA');
  const seen = new Set(), totals = Object.fromEntries(groups.map(g => [g, 0])), stacks = [];
  const pending = [{ node: profile.head, parentGroup: 'native-or-unknown', stack: [] }];
  while (pending.length) {
    const { node, parentGroup, stack } = pending.pop();
    if (!Number.isInteger(node.id) || seen.has(node.id) || !Number.isFinite(node.selfSize) || node.selfSize < 0 || !Array.isArray(node.children)) throw Error('PROFILE_NODE');
    seen.add(node.id); if (seen.size > 100_000) throw Error('PROFILE_BOUNDS');
    const loc = location(node.callFrame ?? {}, parentGroup), path = [...stack, loc].slice(-12);
    totals[loc.group] += node.selfSize;
    if (node.selfSize > 0) stacks.push({ selfEstimatedLiveBytes: node.selfSize, stack: path });
    for (const child of node.children) pending.push({ node: child, parentGroup: loc.group, stack: path });
  }
  for (const sample of profile.samples) {
    if (!seen.has(sample.nodeId) || !Number.isFinite(sample.size) || sample.size < 0) throw Error('PROFILE_SAMPLE');
  }
  stacks.sort((a, b) => b.selfEstimatedLiveBytes - a.selfEstimatedLiveBytes);
  return { estimatedLiveBytes: Object.values(totals).reduce((sum, value) => sum + value, 0), allocationTreeNodes: seen.size,
    sampleCount: profile.samples.length, byNearestScriptAncestor: totals, topAllocationStacks: stacks.slice(0, 30),
    rawProfilePersisted: false, primaryGuardUse: false,
    semantics: 'Sampling estimates live allocations after profiling began. Script-ancestor attribution is not ownership or retained size; samples and profiler overhead prevent primary performance comparisons.' };
}
