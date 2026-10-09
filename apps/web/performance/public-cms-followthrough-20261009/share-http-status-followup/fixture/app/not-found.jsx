export default function Missing() {
  return <main><h1>Owned legacy not-found</h1>
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- native legacy baseline must not introduce a client navigation boundary */}
    <a href="/">Home</a>
  </main>;
}
