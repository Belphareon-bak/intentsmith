import { runC3 } from "../runtime/run-c3.js";

const cfg = {
  sandbox: "/home/belphareon/Projects/copilot-orchestrator/sandbox",
  workspaceRoot: "/home/belphareon/Projects/copilot-orchestrator"
};

(async () => {
  await runC3(
    "Create folder multi-demo and file a.txt with 'hello'",
    cfg
  );
  console.log("MULTI-AGENT DONE");
})();
