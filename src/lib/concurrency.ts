/**
 * Like Promise.all over items.map(fn), but with at most `limit` running at once, results in the same order.
 * Pages that check hundreds of rows use it: the database pool has very few connections (one on Vercel),
 * and starting every check together made the queued ones time out.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
