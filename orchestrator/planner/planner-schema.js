export const PlannerSchema = {
  steps: "Array<{ type: 'shell'|'fs', command?: string, cwd?: string, path?: string, content?: string }>"
};
