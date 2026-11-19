export type LoopbackHostCase = {
  host: string | null
  isLoopback: boolean
}

export const LOOPBACK_HOST_CASES: readonly LoopbackHostCase[] = [
  { host: 'localhost', isLoopback: true },
  { host: 'localhost:3000', isLoopback: true },
  { host: 'LOCALHOST:3000', isLoopback: true },
  { host: '127.0.0.1:3000', isLoopback: true },
  { host: '[::1]', isLoopback: true },
  { host: '[::1]:3000', isLoopback: true },
  { host: '::1', isLoopback: true },
  { host: 'localhost, example.com', isLoopback: true },
  { host: 'localhost.', isLoopback: false },
  { host: 'localhost.:3000', isLoopback: false },
  { host: '', isLoopback: false },
  { host: null, isLoopback: false },
  { host: 'example.com', isLoopback: false },
  { host: 'localhost.example.com', isLoopback: false },
  { host: 'localhost@example.com', isLoopback: false },
  { host: 'example.com, localhost', isLoopback: false },
  { host: '0.0.0.0:3000', isLoopback: false },
  { host: '127.0.0.2:3000', isLoopback: false },
  { host: '::ffff:127.0.0.1', isLoopback: false },
  { host: '[::1', isLoopback: false },
  { host: '[localhost:3000]', isLoopback: false },
  { host: '[ localhost]', isLoopback: false },
]
