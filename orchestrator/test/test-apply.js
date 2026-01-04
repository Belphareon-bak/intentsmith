import { applyEdit } from "../apply/apply.js";

const FILE = "/home/belphareon/Projects/copilot-orchestrator/sandbox/apply-demo.txt";

(async () => {
  const result1 = await applyEdit(FILE, "hello\n");
  console.log("FIRST APPLY DIFF:\n", result1.diff);

  const result2 = await applyEdit(FILE, "hello\nworld\n");
  console.log("SECOND APPLY DIFF:\n", result2.diff);

  console.log("APPLY DONE");
})();
