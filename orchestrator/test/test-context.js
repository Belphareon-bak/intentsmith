import { collectContext } from "../runtime/context.js";

const WORKSPACE = "/home/belphareon/Projects/copilot-orchestrator";
const SANDBOX = "/home/belphareon/Projects/copilot-orchestrator/sandbox";

const ctx = collectContext({
  workspaceRoot: WORKSPACE,
  sandbox: SANDBOX,
  activeFile: WORKSPACE + "/orchestrator/runtime/context.js",
  selection: "export function collectContext"
});

console.log(JSON.stringify(ctx, null, 2));
