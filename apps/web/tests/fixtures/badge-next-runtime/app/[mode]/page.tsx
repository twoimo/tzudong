import Harness from "../harness";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  return <main><h1>Badge server boundary</h1><Harness enabled={mode === "on"} /></main>;
}
