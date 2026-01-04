export const FLOWS = {
  "single-pass": {
    steps: [
      { name: "analyze", executor: "analyze-generic" },
      { name: "design", executor: "design-generic" },
      { name: "decision", executor: "decision-simple", waitForApproval: true }
    ]
  },

  "dual-deliberation": {
    steps: [
      { name: "prepare", executor: "prepare-dual" },
      { name: "review", executor: "review-cross" },
      { name: "decision", executor: "decision-maker", waitForApproval: true }
    ]
  }
};
