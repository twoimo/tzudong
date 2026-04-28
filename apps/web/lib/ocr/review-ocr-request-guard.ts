export type OcrRequestToken = {
  requestId: number;
  receiptKey: string | null;
};

export function getReceiptFileKey(file: File | null): string | null {
  if (!file) return null;
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function createOcrRequestToken(file: File | null, nextId: number): OcrRequestToken {
  return {
    requestId: Number.isFinite(nextId) ? nextId : 0,
    receiptKey: getReceiptFileKey(file),
  };
}

export function isCurrentOcrRequest(token: OcrRequestToken, current: OcrRequestToken): boolean {
  return token.requestId === current.requestId && token.receiptKey === current.receiptKey && token.receiptKey !== null;
}

export function shouldApplyOcrPatch(
  token: OcrRequestToken,
  current: OcrRequestToken,
  file: File | null
): boolean {
  const currentFileKey = getReceiptFileKey(file);
  return Boolean(currentFileKey) && isCurrentOcrRequest(token, current) && token.receiptKey === currentFileKey;
}
