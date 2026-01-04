export function normalizeContext(ctx = {}) {
  return {
    filePath: ctx.filePath || null,
    languageId: ctx.languageId || null,
    selection: ctx.selection || "",
    prefix: ctx.prefix || "",
    suffix: ctx.suffix || ""
  };
}
