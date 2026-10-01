import { validate } from './validate.js';

export function createLedger() {
  const rows = [];

  return {
    add(amount, category) {
      validate(amount, category);
      rows.push({ amount, category });
    },
    list() {
      return rows.map((row) => ({ ...row }));
    }
  };
}
