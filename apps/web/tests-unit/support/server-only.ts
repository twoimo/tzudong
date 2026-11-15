import { mock } from 'bun:test';

// Next.js and the OCR workflow load server code with the react-server condition, where server-only is empty.
mock.module('server-only', () => ({}));
