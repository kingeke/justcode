export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  return target.toLowerCase().includes(query.toLowerCase());
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string
): T[] {
  if (!query) return items;
  return items.filter((item) => fuzzyMatch(query, getText(item)));
}
