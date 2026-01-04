import { requestApproval as requestFromUI } from "./approval/plugin.js";

export async function requestApproval(step) {
  console.log("REQUEST APPROVAL CALLED");
  console.log("STEP =", step);
  console.log("C3_AUTO_APPROVE =", process.env.C3_AUTO_APPROVE);

  if (process.env.C3_AUTO_APPROVE === "1") {
    console.log("AUTO APPROVE → TRUE");
    return true;
  }

  const r = await requestFromUI(step);
  console.log("APPROVAL RESULT FROM UI =", r);
  return r;
}
