import { share } from '@/db/useQuery';

it('reuses unchanged rows and returns the previous array when nothing changed', () => {
  const prev = [
    { id: 1, title: 'a', is_read: 0 },
    { id: 2, title: 'b', is_read: 0 },
  ];
  const same = share(prev, [
    { id: 1, title: 'a', is_read: 0 },
    { id: 2, title: 'b', is_read: 0 },
  ]);
  expect(same).toBe(prev);

  const next = share(prev, [
    { id: 1, title: 'a', is_read: 1 },
    { id: 2, title: 'b', is_read: 0 },
  ]);
  expect(next).not.toBe(prev);
  expect(next[0]).not.toBe(prev[0]);
  expect(next[1]).toBe(prev[1]);

  expect(share({ total: 3 }, { total: 3 })).toEqual({ total: 3 });
  const counts = { total: 3 };
  expect(share(counts, { total: 3 })).toBe(counts);
});
