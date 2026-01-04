import path from "path";

export function assertSandboxPath(targetPath, sandboxRoot) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedSandbox = path.resolve(sandboxRoot);

  if (!resolvedTarget.startsWith(resolvedSandbox)) {
    throw new Error("FS guard: path escapes sandbox");
  }
}
