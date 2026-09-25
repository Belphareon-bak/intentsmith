'use strict';

// Renderer receives only one-use grants from preload. Keep the selected bytes
// in File objects; neither the M1 DTO nor persisted session state contains paths.
const TEXT = /\.(js|ts|jsx|tsx|mjs|cjs|py|json|md|txt|css|scss|html|htm|yaml|yml|xml|csv|tsv|sql|sh|bash|zsh|env|cfg|ini|log|toml|rs|go|java|c|cpp|h|hpp|cs|rb|php|swift|kt|r|lua|vue|svelte|dart|graphql|gql|proto|tf|dockerfile|makefile|cmake|properties|conf|lock|gitignore|gitattributes|dockerignore|npmrc|nvmrc|rst|adoc|tex|org|nix|diff|patch)$/i;
const MIME = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', heic: 'image/heic', heif: 'image/heif' });
const TEXT_MAX = 1024 * 1024;
const IMAGE_MAX = 5 * 1024 * 1024;
const DOCUMENT_MAX = 10 * 1024 * 1024;

function kind(name) {
  const extension = String(name || '').split('.').pop().toLowerCase();
  const mime = MIME[extension];
  if (mime) return { kind: ['pdf', 'heic', 'heif'].includes(extension) ? 'document' : 'image', mime,
    max: ['pdf', 'heic', 'heif'].includes(extension) ? DOCUMENT_MAX : IMAGE_MAX };
  if (TEXT.test(name)) return { kind: 'text', mime: 'text/plain', max: TEXT_MAX };
  return null;
}
function refusal(name, code) { return `${name || 'Soubor'}: ${code}`; }
function selectFiles(session, bridge, isCurrent) {
  if (!bridge || typeof bridge.pickAttachmentFiles !== 'function' || typeof bridge.readAttachmentBytes !== 'function') {
    return Promise.resolve({ added: [], refused: ['Výběr příloh není dostupný.'] });
  }
  return bridge.pickAttachmentFiles({ title: 'Připojit soubory', selectMany: true, defaultPath: session._lastAttachDir || '' })
    .then(picked => {
      const added = []; const refused = [];
      if (!isCurrent()) return { added, refused: ['Relace se během výběru změnila.'] };
      const files = Array.isArray(picked?.files) ? picked.files : [];
      if (typeof picked?.directory === 'string' && picked.directory) session._lastAttachDir = picked.directory;
      for (const descriptor of files) {
        if (!descriptor || typeof descriptor.name !== 'string' || typeof descriptor.token !== 'string') continue;
        const spec = kind(descriptor.name);
        if (!spec) { refused.push(refusal(descriptor.name, 'Nepodporovaný typ')); continue; }
        if (session.chat.attachments.length + added.length >= 5) {
          refused.push(refusal(descriptor.name, 'Nejvýše 5 příloh')); continue;
        }
        if (typeof descriptor.size === 'number' && descriptor.size > spec.max) {
          refused.push(refusal(descriptor.name, 'Soubor překračuje limit')); continue;
        }
        // The bridge rechecks the size against an opened descriptor. A refused
        // token cannot turn into a path-based or contentless attachment.
        const result = bridge.readAttachmentBytes(descriptor.token, spec.max);
        if (!result?.ok || !result.bytes) {
          refused.push(refusal(descriptor.name, result?.code || 'Čtení selhalo')); continue;
        }
        try {
          const file = new File([result.bytes], descriptor.name, { type: spec.mime });
          if (file.size > spec.max) throw new Error('Soubor překračuje limit');
          added.push({ name: descriptor.name, size: file.size, file });
        } catch (error) { refused.push(refusal(descriptor.name, error.message || 'Čtení selhalo')); }
      }
      if (!isCurrent()) return { added: [], refused: ['Relace se během výběru změnila.'] };
      session.chat.attachments.push(...added);
      return { added, refused };
    })
    .catch(error => ({ added: [], refused: [error?.message || 'Výběr příloh selhal.'] }));
}
function encodeBase64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 16384) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
  }
  return btoa(binary);
}
async function prepare(items) {
  if (!Array.isArray(items) || items.length > 5) throw new Error('Lze připojit nejvýše 5 souborů.');
  const prepared = [];
  let bytes = 0;
  const hasDocument = items.some(item => kind(item?.name)?.kind === 'document');
  const maxAggregate = hasDocument ? 20 * 1024 * 1024 : 8 * 1024 * 1024;
  for (const item of items) {
    const spec = kind(item?.name);
    if (!spec || !item.file || !Number.isFinite(item.file.size) || item.file.size > spec.max)
      throw new Error(refusal(item?.name, !spec ? 'Nepodporovaný typ' : 'Soubor překračuje limit'));
    bytes += item.file.size;
    if (bytes > maxAggregate) throw new Error('Přílohy dohromady překračují limit.');
    const content = spec.kind === 'text' ? await item.file.text()
      : `data:${spec.mime};base64,${encodeBase64(new Uint8Array(await item.file.arrayBuffer()))}`;
    prepared.push({ name: item.name, size: item.file.size, type: spec.kind, content });
  }
  return prepared;
}
module.exports = { kind, selectFiles, prepare };
