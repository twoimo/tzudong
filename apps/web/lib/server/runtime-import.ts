export function runtimeImport<TModule>(specifier: string): Promise<TModule> {
  return Function('s', 'return import(s)')(specifier) as Promise<TModule>;
}
