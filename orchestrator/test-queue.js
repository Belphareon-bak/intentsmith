import { runShellCommand } from "./shell-executor.js";
import { approveFsWrite } from "./fs-approval.js";

const SANDBOX = "/home/belphareon/Projects/copilot-orchestrator/sandbox";

(async () => {
  console.log("STEP 1: mkdir");
  await runShellCommand({ command: "mkdir -p queue-test", cwd: SANDBOX });

  console.log("STEP 2: write one.txt");
  await approveFsWrite({
    filePath: SANDBOX + "/queue-test/one.txt",
    newContent: "one\n"
  });

  console.log("STEP 3: write two.txt");
  await approveFsWrite({
    filePath: SANDBOX + "/queue-test/two.txt",
    newContent: "two\n"
  });

  console.log("ALL DONE");
})();
