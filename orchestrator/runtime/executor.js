import { emit } from "./event-bus.js";
import { streamExplainCode } from "../llm/llm-stream.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export async function runPlan(steps, sandboxRoot) {
  for (const step of steps) {

    // --------------------
    // EXPLAIN (LLM STREAM)
    // --------------------
    if (step.type === "explain") {
      emit({ type: "step_start", step });

      await streamExplainCode(
        {
          languageId: step.languageId,
          selection: step.selection,
          prefix: step.prefix,
          suffix: step.suffix
        },
        (token) => {
          // 🔑 ABSOLUTNĚ KLÍČOVÉ
          emit({
            type: "step_output",
            output: token
          });
        }
      );

      emit({ type: "step_done", status: "ok" });
      continue;
    }

    // --------------------
    // SHELL
    // --------------------
    if (step.type === "shell") {
      emit({ type: "step_start", step });

      const cwd =
        step.cwd === "repo"
          ? process.cwd()
          : sandboxRoot;

      const cmd = `cd "${cwd}" && ${step.command}`;

      try {
        const out = execSync(cmd, {
          shell: true,
          encoding: "utf8"
        });

        if (out) {
          emit({ type: "step_output", output: out });
        }

        emit({ type: "step_done", status: "ok" });
      } catch (e) {
        emit({ type: "step_done", status: "fail" });
        throw e;
      }

      continue;
    }

    // --------------------
    // FILESYSTEM
    // --------------------
    if (step.type === "fs") {
      emit({ type: "step_start", step });

      const target = path.join(sandboxRoot, step.path);

      if (step.action === "mkdir") {
        fs.mkdirSync(target, { recursive: true });
      }

      if (step.action === "write_file") {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, step.content ?? "");
      }

      emit({ type: "step_done", status: "ok" });
      continue;
    }

    throw new Error(
      "Invalid canonical step: " + JSON.stringify(step)
    );
  }
}
