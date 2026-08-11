// Generated local-only edge function entrypoint.
Deno.serve((_request) => new Response("local edge function", {
  headers: { "content-type": "text/plain; charset=utf-8" },
}));
