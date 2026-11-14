import { parseArgs } from 'node:util';
import { readSealed, analyzeVisits, writeOnce } from './evidence.mjs';

const { values: args } = parseArgs({ strict: true, options: Object.fromEntries(['root', 'repository', 'protocol-sha256', 'artifact-map-sha256'].map((key) => [key, { type: 'string' }])) });
try {
  const bundle = readSealed(args.root, args.repository, args['artifact-map-sha256'], args['protocol-sha256']);
  const analysis = analyzeVisits(bundle, args['artifact-map-sha256'], args['protocol-sha256']);
  console.log(JSON.stringify(writeOnce(args.root, 'analysis.json', analysis)));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Calibration analysis failed');
  process.exitCode = 1;
}
