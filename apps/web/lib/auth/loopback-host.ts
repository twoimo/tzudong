export function normalizeHostName(value: string) {
  const firstValue = value.split(',')[0]?.trim().toLowerCase() ?? ''

  if (firstValue.startsWith('[')) {
    const closingBracketIndex = firstValue.indexOf(']')
    return closingBracketIndex > 1 ? firstValue.slice(1, closingBracketIndex) : firstValue
  }

  if (firstValue === '::1') return firstValue
  if (firstValue.includes(':') && firstValue.split(':').length > 2) return firstValue

  return firstValue.split(':')[0] ?? ''
}

export function isLoopbackHost(value: string | null | undefined) {
  if (!value) return false
  const hostName = normalizeHostName(value)
  return hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '::1'
}
