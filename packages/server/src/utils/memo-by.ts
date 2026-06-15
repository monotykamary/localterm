export const memoBy = <T, K>(items: readonly T[], keyFn: (item: T) => K): T[] => {
  const memo = new Set<K>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (memo.has(key)) continue;
    memo.add(key);
    result.push(item);
  }
  return result;
};
