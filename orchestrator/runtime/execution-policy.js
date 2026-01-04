export const executionPolicy = {
  forbiddenPaths: [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/var"
  ],
  forbiddenCommands: [
    "sudo",
    "systemctl",
    "service",
    "reboot",
    "shutdown"
  ],
  requireExplicitApproval: {
    outsideSandbox: true,
    privileged: true
  }
};
