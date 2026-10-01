import assert from 'node:assert/strict';

// Tracks only requests created by this probe. A broken stream in either
// direction closes its exact upstream and downstream; cleanup waits for both.
export class OwnedRelayRequests {
  constructor() { this.pending = new Set(); this.closed = false; }

  track(incoming, outgoing, request, onFailure = () => {}) {
    assert.equal(this.closed, false, 'relay is draining');
    assert.equal(typeof onFailure, 'function');
    let resolve;
    const settled = new Promise(done => { resolve = done; });
    const ticket = { request, response: null, requestClosed: false,
      responseClosed: true, settled, cancel: null };
    let failed = false;
    const finish = () => {
      if (!ticket.requestClosed || !ticket.responseClosed) return;
      incoming.off('aborted', abort);
      outgoing.off('close', close);
      this.pending.delete(ticket);
      resolve();
    };
    const abort = () => ticket.cancel(new Error('relay downstream request aborted'));
    const close = () => {
      if (!outgoing.writableFinished) ticket.cancel(new Error('relay downstream response closed'));
    };
    ticket.cancel = (reason = new Error('owned provider relay cleanup')) => {
      if (failed) return;
      failed = true;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      onFailure(error);
      if (!ticket.requestClosed) request.destroy(error);
      if (ticket.response && !ticket.responseClosed) ticket.response.destroy();
      if (!outgoing.destroyed) outgoing.destroy();
    };
    request.once('close', () => { ticket.requestClosed = true; finish(); });
    incoming.once('aborted', abort);
    outgoing.once('close', close);
    this.pending.add(ticket);
    if (incoming.aborted || outgoing.destroyed) ticket.cancel();
    return {
      attachResponse: response => {
        ticket.response = response; ticket.responseClosed = false;
        response.once('error', error => ticket.cancel(error));
        response.once('aborted', () => ticket.cancel(new Error('upstream provider response aborted')));
        response.once('close', () => {
          if (response.complete === false)
            ticket.cancel(new Error('upstream provider response closed incomplete'));
          ticket.responseClosed = true; finish();
        });
        if (failed || this.closed || incoming.aborted || outgoing.destroyed) {
          response.destroy(); ticket.cancel();
        }
      },
      settled,
    };
  }

  async cancelAndSettle(timeoutMs = 10000) {
    this.closed = true;
    const tickets = [...this.pending];
    for (const ticket of tickets) ticket.cancel();
    if (!tickets.length) return Object.freeze({ settled: true, cancelled: 0, pending: 0 });
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const settled = await Promise.race([Promise.all(tickets.map(ticket => ticket.settled)).then(() => true),timeout]);
    clearTimeout(timer);
    return Object.freeze({ settled, cancelled: tickets.length, pending: this.pending.size });
  }
}
