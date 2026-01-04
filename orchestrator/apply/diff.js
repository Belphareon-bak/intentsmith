import { diffLines } from "diff";

export function createDiff(oldText, newText, filePath = "file") {
  const changes = diffLines(oldText, newText);
  let diff = `--- ${filePath}\n+++ ${filePath}\n`;

  for (const part of changes) {
    const prefix = part.added ? "+" : part.removed ? "-" : " ";
    const lines = part.value.split("\n");
    for (const line of lines) {
      if (line === "") continue;
      diff += prefix + line + "\n";
    }
  }
  return diff;
}
