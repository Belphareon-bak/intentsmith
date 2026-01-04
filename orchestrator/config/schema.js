export function validateConfig(cfg) {
  if (!cfg.sandbox?.path) throw new Error("sandbox.path missing");
  if (!cfg.features) throw new Error("features missing");
  return true;
}
