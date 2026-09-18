'use strict';

// Files enter this store only after the operator explicitly picks or shares them.
// Listing a file never adds its content to a model request.
function createSpecialistFileStore(indexedDB) {
  let opened;
  function open() {
    if (!opened) opened = new Promise((resolve, reject) => {
      const request = indexedDB.open('intentsmith-specialist-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { opened = null; reject(request.error); };
    });
    return opened;
  }
  async function transaction(mode, operation) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('files', mode);
      const request = operation(tx.objectStore('files'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Soubor nelze uložit.'));
    });
  }
  return {
    async put(owner, file) {
      if (typeof owner !== 'string' || !owner || !file || !Number.isFinite(file.size)) throw Error('Neplatný vlastník souboru.');
      if (file.size > 20 * 1024 * 1024) throw Error('Soubor překračuje limit 20 MiB.');
      const row = { id: crypto.randomUUID(), owner, name: file.name, size: file.size, type: file.type, blob: file, addedAt: Date.now() };
      await transaction('readwrite', store => store.put(row));
      return { id: row.id, name: row.name, size: row.size, type: row.type, addedAt: row.addedAt };
    },
    async get(owner, id) {
      const row = await transaction('readonly', store => store.get(id));
      if (!row || row.owner !== owner) throw Error('Soubor nepatří tomuto specialistovi.');
      return row;
    },
    async list(owner) {
      const rows = await transaction('readonly', store => store.getAll());
      return rows.filter(row => row.owner === owner).map(({ blob, ...row }) => row);
    },
    async share(source, target, id) {
      const row = await this.get(source, id);
      const file = new File([row.blob], row.name, { type: row.type });
      return this.put(target, file);
    },
    async remove(owner, id) {
      await this.get(owner, id);
      await transaction('readwrite', store => store.delete(id));
    },
  };
}

module.exports = { createSpecialistFileStore };
