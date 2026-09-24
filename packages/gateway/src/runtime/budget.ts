/**
 * Hierarchical byte budget: subscription → connection → gateway. A reservation
 * succeeds only if every level has room, and is applied to every level.
 */
export class ByteBudget {
  readonly limit: number;
  readonly parent: ByteBudget | null;
  #used = 0;

  constructor(limit: number, parent: ByteBudget | null = null) {
    this.limit = limit;
    this.parent = parent;
  }

  get used(): number {
    return this.#used;
  }

  tryReserve(bytes: number): boolean {
    for (let node: ByteBudget | null = this; node !== null; node = node.parent) {
      if (node.#used + bytes > node.limit) return false;
    }
    for (let node: ByteBudget | null = this; node !== null; node = node.parent) node.#used += bytes;
    return true;
  }

  release(bytes: number): void {
    for (let node: ByteBudget | null = this; node !== null; node = node.parent) {
      node.#used = Math.max(0, node.#used - bytes);
    }
  }
}

/** Per-subscription budget: a frame count plus a byte budget chained to its connection. */
export class SubscriptionBudget {
  readonly bytes: ByteBudget;
  readonly maxFrames: number;
  #frames = 0;

  constructor(maxFrames: number, maxBytes: number, parent: ByteBudget) {
    this.maxFrames = maxFrames;
    this.bytes = new ByteBudget(maxBytes, parent);
  }

  get frames(): number {
    return this.#frames;
  }

  tryReserve(bytes: number): boolean {
    if (this.#frames + 1 > this.maxFrames) return false;
    if (!this.bytes.tryReserve(bytes)) return false;
    this.#frames++;
    return true;
  }

  release(bytes: number): void {
    this.#frames = Math.max(0, this.#frames - 1);
    this.bytes.release(bytes);
  }
}
