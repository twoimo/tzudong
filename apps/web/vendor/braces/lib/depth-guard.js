'use strict';

// Local mitigation for GHSA-vfj7-8cjw-p6xm; the package is explicitly a private fork.
const MAX_DEPTH = 128;
const nestingError = () => Object.assign(new RangeError('BRACES_NESTING_LIMIT'), { code: 'BRACES_NESTING_LIMIT' });
const assertAstDepth = root => {
  if (!root || typeof root !== 'object') return;
  const pending = [[root, 0]];
  const seen = new Set();
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (depth > MAX_DEPTH || seen.has(node) || seen.size >= 50000) throw nestingError();
    seen.add(node);
    if (Array.isArray(node.nodes)) {
      if (node.nodes.length > 50000 - seen.size - pending.length) throw nestingError();
      for (const child of node.nodes) pending.push([child, depth + 1]);
    }
  }
};
module.exports = { MAX_DEPTH, nestingError, assertAstDepth };
