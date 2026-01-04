// STUB planner – později nahradíš LLM voláním
export async function plan(prompt, context) {
  return {
    steps: [
      { type: "shell", command: "mkdir -p planner-demo", cwd: context.sandbox },
      { type: "fs", path: context.sandbox + "/planner-demo/a.txt", content: "hello\n" },
      { type: "fs", path: context.sandbox + "/planner-demo/b.txt", content: "world\n" }
    ]
  };
}
