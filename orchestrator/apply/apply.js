import fs from "fs/promises";
import path from "path";
import { createDiff } from "./diff.js";

export async function applyEdit(filePath, newContent) {
  let oldContent = "";
  try {
    oldContent = await fs.readFile(filePath, "utf8");
  } catch {
    // soubor neexistuje – bereme jako prázdný
  }

  const diff = createDiff(oldContent, newContent, filePath);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, newContent);

  return {
    filePath,
    diff
  };
}
