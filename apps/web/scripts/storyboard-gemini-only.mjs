/** Refuse obsolete producers before model, network, listener or credential work. */
export function refuseRetiredStoryboardProducer() {
  console.log(JSON.stringify({ code: 'storyboard_gemini_only', command: 'storyboard:gemini-worker' }));
  process.exitCode = process.argv.includes('--help') || process.argv.includes('-h') ? 0 : 2;
  return true;
}
