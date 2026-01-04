import { runC3 } from "../runtime/main.js";

(async () => {
  await runC3("Create folder audit-demo and file a.txt with 'ok'");
  console.log("AUDIT TEST DONE");
})();
