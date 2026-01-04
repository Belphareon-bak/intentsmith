import { broadcast } from "./events.js";

const pending = new Map();

export function requestApproval(step) {
  if (process.env.C3_AUTO_APPROVE === "1") {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    pending.set(step.id, resolve);

    broadcast({
      type: "approval_request",
      id: step.id,
      preview: step
    });
  });
}

export function approve(id, approved) {
  const resolve = pending.get(id);
  if (resolve) {
    resolve(approved);
    pending.delete(id);
  }
}
