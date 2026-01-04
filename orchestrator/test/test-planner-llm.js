import { runC3 } from "../runtime/main.js";

(async () => {
  await runC3("Create folder llm-demo and files a.txt with 'hello' and b.txt with 'world'");
  console.log("LLM PLANNER DONE");
})();
