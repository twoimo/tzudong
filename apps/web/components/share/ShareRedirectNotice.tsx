import { Link2 } from 'lucide-react';

export function ShareRedirectNotice({
  kind,
  code,
}: {
  kind: 'not-found' | 'unavailable';
  code?: string;
}) {
  const unavailable = kind === 'unavailable';
  return (
    <main data-centered-error-state="viewport" data-share-read-state={kind}>
      <section aria-labelledby="share-read-title" aria-describedby="share-read-description">
        <div data-centered-error-icon="true" aria-hidden="true"><Link2 className="h-5 w-5" /></div>
        <h1 id="share-read-title">{unavailable ? '공유 링크를 확인하지 못했습니다' : '공유 링크를 찾을 수 없습니다'}</h1>
        <p id="share-read-description">{unavailable ? '잠시 후 다시 조회하거나 홈에서 맛집을 찾아주세요.' : '링크 주소를 확인하거나 홈에서 맛집을 찾아주세요.'}</p>
        <div data-centered-error-actions="true" className="mt-4 flex flex-wrap justify-center gap-2">
          {unavailable && code ? <a href={`/s/${code}`}>다시 조회</a> : null}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- native recovery does not require the application session runtime */}
          <a href="/">홈으로 이동</a>
        </div>
      </section>
    </main>
  );
}
