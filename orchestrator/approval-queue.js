export class ApprovalQueue {
  constructor() {
    this.queue = [];
    this.active = null;
  }

  enqueue(item) {
    this.queue.push(item);
    this._drain();
  }

  resolve(id, approved) {
    if (!this.active || this.active.id !== id) {
      throw new Error("Unknown or inactive approval id");
    }

    const current = this.active;
    this.active = null;
    current.resolve(approved);
    this._drain();
  }

  _drain() {
    if (this.active) return;
    if (this.queue.length === 0) return;

    this.active = this.queue.shift();
    this.active.onActivate(this.active);
  }
}
