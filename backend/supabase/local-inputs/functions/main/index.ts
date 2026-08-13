// LOCAL_TEST_ONLY:NOT_PRODUCTION
//
// Minimal allowlisted dispatcher for the pinned self-hosted Edge Runtime. It
// replaces the upstream generic dispatcher so local development cannot load an
// arbitrary function directory or pass stack credentials into a child worker.

type LocalUserWorker = {
  fetch(request: Request): Promise<Response>;
};

declare const EdgeRuntime: {
  userWorkers: {
    create(options: {
      servicePath: string;
      memoryLimitMb: number;
      workerTimeoutMs: number;
      noModuleCache: boolean;
      importMapPath: null;
      envVars: readonly (readonly [string, string])[];
    }): Promise<LocalUserWorker>;
  };
};

const LOCAL_FUNCTIONS = new Map<string, string>([
  ["naver-geocode", "/home/deno/functions/naver-geocode"],
]);

const JSON_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

Deno.serve(async (request) => {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const functionName = segments[0];

  if (functionName === "main" && segments.length === 1 && request.method === "GET") {
    return jsonResponse({
      status: "ok",
      source: "LOCAL_TEST_ONLY:NOT_PRODUCTION:edge-dispatcher-v1",
    }, 200);
  }
  const servicePath = functionName && segments.length === 1
    ? LOCAL_FUNCTIONS.get(functionName)
    : undefined;
  if (!servicePath) {
    return jsonResponse({ error: "Local function not found" }, 404);
  }

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 64,
      workerTimeoutMs: 5_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: [],
    });
    return await worker.fetch(request);
  } catch {
    return jsonResponse({ error: "Local function unavailable" }, 503);
  }
});
