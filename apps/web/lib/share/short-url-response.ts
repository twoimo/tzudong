import { isValidShortUrlCode, type ShortUrlReadResult } from './short-url-read';

const headers = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function createShortUrlResponse(result: ShortUrlReadResult, code?: string): Response {
  if (result.kind === 'redirect') {
    // Relative Location keeps the client's origin; do not derive it from a Host header.
    return new Response(null, { status: 307, headers: { ...headers, Location: result.target } });
  }
  const unavailable = result.kind === 'unavailable';
  const title = unavailable ? '공유 링크를 확인하지 못했습니다' : '공유 링크를 찾을 수 없습니다';
  const description = unavailable ? '잠시 후 다시 조회하거나 홈에서 맛집을 찾아주세요.' : '링크 주소를 확인하거나 홈에서 맛집을 찾아주세요.';
  const retry = unavailable && isValidShortUrlCode(code) ? `<a href="/s/${code}">다시 조회</a>` : '';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${title} - 쯔동여지도</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/styles/share-fallback.css"></head><body><main data-share-read-state="${result.kind}"><section aria-labelledby="share-read-title" aria-describedby="share-read-description"><img src="/logo.webp" alt="" width="44" height="44"><h1 id="share-read-title">${title}</h1><p id="share-read-description">${description}</p><nav aria-label="공유 링크 복구">${retry}<a href="/">홈으로 이동</a></nav></section></main></body></html>`;
  return new Response(html, { status: unavailable ? 503 : 404, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}
