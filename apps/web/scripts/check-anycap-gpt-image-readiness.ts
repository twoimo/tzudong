#!/usr/bin/env bun

import { probeAnyCapGptImageReadiness } from '../lib/admin/anycap-gpt-image-readiness';

const readiness = await probeAnyCapGptImageReadiness();
console.log(JSON.stringify(readiness, null, 2));
process.exit(readiness.status === 'ready' ? 0 : 1);
