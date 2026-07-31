import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logCliError, redactCliText } from "./privacy-safe-cli-log.mjs";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const childOutputLimit = 4_096;

const forwardChildOutput = (stream, target) => {
  if (!stream?.on) return;

  stream.on("data", (chunk) => {
    const text = typeof chunk === "string"
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : "";
    if (text) {
      target.write(redactCliText(text, childOutputLimit));
    }
  });
};


const tools = {
  eslint: {
    entrypoint: new URL("../node_modules/eslint/bin/eslint.js", import.meta.url),
    env: {
      BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
      BROWSERSLIST_IGNORE_OLD_DATA: "true",
    },
  },
  "next-analyze": {
    entrypoint: new URL("../node_modules/next/dist/bin/next", import.meta.url),
    env: {
      ANALYZE: "true",
    },
  },
};

export function getWebToolInvocation(tool, forwardedArgs) {
  const selectedTool = Object.hasOwn(tools, tool) ? tools[tool] : null;
  if (!selectedTool) return null;

  return {
    entrypoint: fileURLToPath(selectedTool.entrypoint),
    args: tool === "next-analyze" ? ["build", "--webpack", ...forwardedArgs] : forwardedArgs,
    env: selectedTool.env,
  };
}

export function runWebTool(tool, forwardedArgs, spawnChild = spawn) {
  const invocation = getWebToolInvocation(tool, forwardedArgs);
  if (!invocation) {
    process.stderr.write("[run-web-tool] error=UnknownTool\n");
    process.exitCode = 1;
    return;
  }

  const child = spawnChild(
    process.execPath,
    [invocation.entrypoint, ...invocation.args],
    {
      cwd: scriptDirectory + "..",
      env: { ...process.env, ...invocation.env },
      shell: false,
      stdio: ["inherit", "pipe", "pipe"],
    },
  );
  forwardChildOutput(child.stdout, process.stdout);
  forwardChildOutput(child.stderr, process.stderr);


  child.once("error", (error) => {
    logCliError(error, (line) => process.stderr.write(`[run-web-tool] child-process ${line}`));
    process.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });

  return child;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tool, ...forwardedArgs] = process.argv.slice(2);
  runWebTool(tool, forwardedArgs);
}