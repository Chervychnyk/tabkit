type Seg = [number, number];

/** Gaps between two boxes along one axis: the space between them, or edge offsets when they overlap. */
export function axisGaps(a1: number, a2: number, b1: number, b2: number): Seg[] {
  if (b1 >= a2) return [[a2, b1]];
  if (a1 >= b2) return [[b2, a1]];
  return ([[Math.min(a1, b1), Math.max(a1, b1)], [Math.min(a2, b2), Math.max(a2, b2)]] as Seg[]).filter(([s, e]) => e - s >= 1);
}
