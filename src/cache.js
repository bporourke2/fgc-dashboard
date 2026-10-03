// Tiny TTL cache that keeps the last good value so a transient failure (DB busy, Docker hiccup)
// degrades to slightly stale data instead of an error.

export class Cached {
  constructor(ttlMs, loader) {
    this.ttlMs = ttlMs;
    this.loader = loader;
    this.value = undefined;
    this.at = 0;
    this.error = null;
    this.pending = null;
  }

  async get() {
    if (this.value !== undefined && Date.now() - this.at < this.ttlMs) return this.value;
    if (!this.pending) {
      this.pending = (async () => {
        try {
          this.value = await this.loader();
          this.at = Date.now();
          this.error = null;
        } catch (err) {
          this.error = err;
          if (this.value === undefined) throw err;
        } finally {
          this.pending = null;
        }
        return this.value;
      })();
    }
    return this.pending;
  }

  get stale() {
    return Boolean(this.error) && this.value !== undefined;
  }
}
