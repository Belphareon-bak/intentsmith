import { execShell } from "../executors/shell.js";
import { execFs } from "../executors/fs.js";

export const workers = {
  shell: execShell,
  fs: execFs
};
