import { createLedger } from './storage.js';
import { total as sumRows, categories as catRows } from './totals.js';

export function createService() {
  const ledger = createLedger();

  return {
    add(amount, category) {
      ledger.add(amount, category);
    },
    list() {
      return ledger.list();
    },
    total() {
      return sumRows(ledger.list());
    },
    categories() {
      return catRows(ledger.list());
    }
  };
}
