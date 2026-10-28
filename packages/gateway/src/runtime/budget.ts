/**
 * Hierarchical byte budget: subscription → connection → gateway. A reservation
 * succeeds only if every level has room, and is applied to every level.
 */
export class ByteBudget {
  /** Most bytes this level may hold at once. */
  readonly limit: number;
  /** The enclosing level whose room is also checked and charged, or null at the top. */
  readonly parent: ByteBudget | null;
  #used = 0;

  /** Creates an empty budget of `limit` bytes chained under `parent`. */
  constructor(limit: number, parent: ByteBudget | null = null) {
    this.limit = limit;
    this.parent = parent;
  }

  /** Bytes currently reserved at this level, including reservations made through its children. */
  get used(): number {
    return this.#used;
  }

  /** Reserves `bytes` at this level and every ancestor, or reserves nothing and returns false if any level lacks room. */
  tryReserve(bytes: number): boolean {
    for (let node: ByteBudget | null = this; node !== null; node = node.parent) {
      if (node.#used + bytes > node.limit) return false;
    }
    for (let node: ByteBudget | null = this; node !== null; node = node.parent) node.#used += bytes;
    return true;
  }

  /** Returns `bytes` to this level and every ancestor; never drops a level below zero. */
  release(bytes: number): void {
    for (let node: ByteBudget | null = this; node !== null; node = node.parent) {
      node.#used = Math.max(0, node.#used - bytes);
    }
  }
}

/** Per-subscription budget: a frame count plus a byte budget chained to its connection. */
export class SubscriptionBudget {
  /** This subscription's byte budget, chained to its connection's. */
  readonly bytes: ByteBudget;
  /** Most frames this subscription may hold reserved at once. */
  readonly maxFrames: number;
  #frames = 0;

  /** Creates an empty budget for `maxFrames` frames and `maxBytes` bytes under the connection budget `parent`. */
  constructor(maxFrames: number, maxBytes: number, parent: ByteBudget) {
    this.maxFrames = maxFrames;
    this.bytes = new ByteBudget(maxBytes, parent);
  }

  /** Frames currently reserved. */
  get frames(): number {
    return this.#frames;
  }

  /** Reserves one frame of `bytes`; false, with nothing reserved, if the frame count or any byte level is full. */
  tryReserve(bytes: number): boolean {
    if (this.#frames + 1 > this.maxFrames) return false;
    if (!this.bytes.tryReserve(bytes)) return false;
    this.#frames++;
    return true;
  }

  /** Releases one frame of `bytes` reserved by tryReserve. */
  release(bytes: number): void {
    this.#frames = Math.max(0, this.#frames - 1);
    this.bytes.release(bytes);
  }
}
