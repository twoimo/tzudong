/**
 * Retired compatibility alias.
 *
 * The pre-Gemini storyboard workspace used to live in this module. Keeping an
 * executable copy here kept retired provider paths available to future
 * importers even though the admin console no longer rendered them. Any stale
 * import now resolves to the same Gemini-only entrypoint as the current admin
 * console.
 */
export { AdminStoryboardGenerator } from "./AdminStoryboardGenerator";
