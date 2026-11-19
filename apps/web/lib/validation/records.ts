export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Object.keys(descriptors).sort();
    const expectedKeys = [...keys].sort();
    return actualKeys.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index])
      && expectedKeys.every((key) => 'value' in descriptors[key]!);
  } catch {
    return false;
  }
}

export function parseValidatedRows<Row>(
  values: readonly unknown[],
  isRow: (value: unknown) => value is Row,
): Row[] {
  const rows: Row[] = [];

  for (const value of values) {
    if (isRow(value)) {
      rows.push(value);
    }
  }

  return rows;
}

export function getResponseErrorMessage(value: unknown): string | null {
  return isRecord(value) && typeof value.error === 'string' ? value.error : null;
}
