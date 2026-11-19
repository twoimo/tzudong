export function getTierDisplayName(name: string): string {
  return name.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}
