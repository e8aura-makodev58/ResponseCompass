/**
 * Deterministic, persistable pseudo-random stream.
 *
 * Reproducibility is an acceptance requirement (SOW s11): the same seed and
 * cursor must always produce the same draw, so the cursor is state we persist
 * rather than a hidden generator closure.
 */

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 over (hash(seed) + cursor). Pure: same inputs, same output. */
export function draw(seed: string, cursor: number): number {
  let t = (hashSeed(seed) + Math.imul(cursor + 1, 0x6d2b79f5)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export class RandomStream {
  constructor(
    readonly seed: string,
    private cursor: number = 0,
  ) {}

  next(): number {
    const value = draw(this.seed, this.cursor);
    this.cursor += 1;
    return value;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list');
    return items[this.int(0, items.length - 1)] as T;
  }

  get position(): number {
    return this.cursor;
  }
}
