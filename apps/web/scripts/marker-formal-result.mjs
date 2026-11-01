/** Harness failures are not evidence that an intentionally broken source was detected. */
export function isExpectedMutationFailure(result, expectedTest) {
  return result.exitCode === 1
    && result.output.includes(`(fail) ${expectedTest}`)
    && !/FORMAL_BROWSER_REQUIRED|Cannot find module|Could not resolve|Cannot resolve|Module not found|ResolveMessage|BuildMessage/i.test(result.output);
}
