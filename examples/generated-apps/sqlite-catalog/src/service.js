import { openStore } from './store.js';
import {
  validateSku,
  validateName,
  validateQuantity,
  validatePriceCents,
  validateId,
  validateQuery,
  validatePatch
} from './validate.js';

export function createCatalog(dbPath) {
  const store = openStore(dbPath);

  return {
    add(sku, name, quantity, priceCents) {
      validateSku(sku);
      validateName(name);
      validateQuantity(quantity);
      validatePriceCents(priceCents);
      return store.add({ sku, name, quantity, priceCents });
    },

    get(id) {
      validateId(id);
      return store.get(id);
    },

    list() {
      return store.list();
    },

    search(query) {
      validateQuery(query);
      return store.search(query);
    },

    update(id, patch) {
      validateId(id);
      validatePatch(patch);
      return store.update(id, patch);
    },

    remove(id) {
      validateId(id);
      return store.remove(id);
    },

    transaction(fn) {
      if (typeof fn !== 'function') throw new TypeError('fn must be a function');
      return store.transaction(fn);
    },

    close() {
      store.close();
    }
  };
}
