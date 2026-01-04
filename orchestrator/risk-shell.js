export function assessShellRisk(command) {
  const low = [/^mkdir\b/, /^ls\b/, /^cat\b/];
  const medium = [/^rm\b/, /^mv\b/, /^cp\b/];
  const high = [/>/, /\*/, /\$\(/];

  if (high.some(r => r.test(command))) return "HIGH";
  if (medium.some(r => r.test(command))) return "MEDIUM";
  if (low.some(r => r.test(command))) return "LOW";

  return "UNKNOWN";
}
