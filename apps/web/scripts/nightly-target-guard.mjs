const knownProductionProjectRefs = new Set(['aqlcofblfxdrjhhdmarw']);

// This denial is an additional safety boundary, not proof that another target
// is nonproduction. Operators must still independently establish its identity.
export function assertHostedNightlyTargetAllowed(projectRef, parsedUrl) {
  if (
    knownProductionProjectRefs.has(projectRef)
    || [...knownProductionProjectRefs].some((ref) => parsedUrl.hostname === `${ref}.supabase.co`)
  ) {
    throw new Error('Hosted nightly mode forbids known production Supabase targets.');
  }
}
