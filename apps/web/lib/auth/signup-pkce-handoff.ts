export type SignupPkceCookie = Readonly<{ name: string; value: string; remove: boolean }>;

export function parseSignupPkceCookies(input: unknown, key: string): SignupPkceCookie[] | null {
  const verifier = `${key}-code-verifier`;
  const names = new Set<string>();
  if (!Array.isArray(input) || input.length === 0 || input.length > 16) return null;
  const mutations: SignupPkceCookie[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Object.keys(item).sort().join(',') !== 'name,remove,value'
      || typeof item.name !== 'string' || names.has(item.name)
      || !(item.name === verifier || (item.name.startsWith(`${verifier}.`)
        && /^(?:[0-9]|1[0-5])$/.test(item.name.slice(verifier.length + 1))))
      || typeof item.value !== 'string' || item.value.length > 4096 || /[\u0000-\u0020\u007f;]/.test(item.value)
      || typeof item.remove !== 'boolean' || item.remove !== (item.value === '')) return null;
    names.add(item.name);
    mutations.push({ name: item.name, value: item.value, remove: item.remove });
  }
  const writes = mutations.filter(item => !item.remove).sort((a, b) => Number(a.name.slice(verifier.length + 1)) - Number(b.name.slice(verifier.length + 1)));
  if (!writes.length || (writes.some(item => item.name === verifier)
    ? writes.length !== 1 : writes.some((item, index) => item.name !== `${verifier}.${index}`))) return null;
  return mutations;
}
