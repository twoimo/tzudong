#!/usr/bin/env node
// Node 24 runs this local CLI through native type stripping and can load the .mts runtime module.
import { startStoryboardLocalBridgeServer } from '../lib/admin/storyboard/local-bridge-server.mts';

await startStoryboardLocalBridgeServer();
