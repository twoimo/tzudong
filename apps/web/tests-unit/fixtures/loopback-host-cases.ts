export type LoopbackHostCase = {
  host: string | null
  proxy: boolean
  requireAdmin: boolean
  devCookie: boolean
}

const loopback = (host: string | null, isLoopback: boolean): LoopbackHostCase => ({
  host,
  proxy: isLoopback,
  requireAdmin: isLoopback,
  devCookie: isLoopback,
})

export const LOOPBACK_HOST_CASES: readonly LoopbackHostCase[] = [
  loopback('localhost', true),
  loopback('localhost:3000', true),
  loopback('LOCALHOST:3000', true),
  loopback('127.0.0.1:3000', true),
  loopback('[::1]', true),
  loopback('[::1]:3000', true),
  loopback('::1', true),
  loopback('localhost, example.com', true),
  loopback('localhost.', false),
  loopback('localhost.:3000', false),
  loopback('', false),
  loopback(null, false),
  loopback('example.com', false),
  loopback('localhost.example.com', false),
  loopback('localhost@example.com', false),
  loopback('example.com, localhost', false),
  loopback('0.0.0.0:3000', false),
  loopback('127.0.0.2:3000', false),
  loopback('::ffff:127.0.0.1', false),
  loopback('[::1', false),
  { host: '[localhost:3000]', proxy: true, requireAdmin: false, devCookie: false },
  { host: '[ localhost]', proxy: true, requireAdmin: false, devCookie: false },
]
