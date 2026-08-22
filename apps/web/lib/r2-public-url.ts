const R2_DEV_ORIGIN_PATTERN =
  /^https:\/\/pub-[a-z0-9]{8,64}\.r2\.dev$/;

export function resolveR2PublicBase(
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const value = environment.NEXT_PUBLIC_R2_PUBLIC_BASE?.trim() ?? '';
  if (!value) return null;
  if (!R2_DEV_ORIGIN_PATTERN.test(value)) return null;
  return value;
}

export function resolveR2PublicObjectUrl(
  key: string,
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const base = resolveR2PublicBase(environment);
  if (!base) return null;
  if (!key || key.startsWith('/') || key.includes('..')) return null;
  return `${base}/${key}`;
}
