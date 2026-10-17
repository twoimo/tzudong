/** Synthetic loopback session and two read RPCs; no mutation is forwarded. */
export async function installSyntheticSession(page) {
  const origin = 'http://127.0.0.1:18822';
  const readPaths = new Set(['/rest/v1/rpc/get_current_privacy_eligibility', '/rest/v1/rpc/read_public_profile_summaries']);
  const counts = { sessionGets: 0, localReadRpcResponses: {}, localPreflightResponses: 0 };
  const profiles = Array.from({ length: 3 }, (_, index) => ({ user_id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`, nickname: `검증 사용자 ${index + 1}`, avatar_url: null }));
  await page.route('http://127.0.0.1:18821/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'accept-profile, apikey, authorization, content-profile, content-type, prefer, range, x-client-info, x-supabase-api-version',
      'access-control-allow-methods': readPaths.has(url.pathname) ? 'GET, HEAD, POST' : 'GET, HEAD',
      'cache-control': 'no-store',
      vary: 'Origin',
    };
    if (method === 'OPTIONS') {
      counts.localPreflightResponses += 1;
      return route.fulfill({ status: 204, headers, body: '' });
    }
    if (method !== 'POST' || !readPaths.has(url.pathname)) return route.fallback();
    const raw = request.postData() ?? '{}';
    let body;
    try {
      if (raw.length > 65536) throw new Error('LIMIT');
      body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INPUT');
    } catch { return route.fulfill({ status: 400, headers, contentType: 'application/json', body: '{"error":"FIXTURE_READ_INPUT_INVALID"}' }); }
    let value;
    if (url.pathname.endsWith('/get_current_privacy_eligibility')) {
      value = { schemaVersion: 1, eligible: true, reasonCode: 'PRIVACY_ELIGIBLE', policyVersionId: '00000000-0000-4000-8000-000000000001', policyVersion: '2026-08-04.1', contentSha256: '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' };
    } else {
      if (!Array.isArray(body.p_user_ids) || body.p_user_ids.length > 100 || body.p_user_ids.some(id => typeof id !== 'string')) return route.fulfill({ status: 400, headers, contentType: 'application/json', body: '{"error":"FIXTURE_READ_INPUT_INVALID"}' });
      value = profiles.filter(profile => body.p_user_ids.includes(profile.user_id));
    }
    counts.localReadRpcResponses[url.pathname] = (counts.localReadRpcResponses[url.pathname] ?? 0) + 1;
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(value) });
  });
  const response = await page.context().request.get(`${origin}/__fixture/session`, { maxRedirects: 0, failOnStatusCode: false });
  const status = response.status();
  await response.dispose();
  if (status !== 303) throw new Error('SYNTHETIC_SESSION_FAILED');
  counts.sessionGets += 1;
  return counts;
}
