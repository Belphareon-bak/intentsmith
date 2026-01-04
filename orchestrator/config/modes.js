export const MODE = process.env.C3_MODE || "dev";

export function assertDev() {
  if (MODE !== "dev") {
    throw new Error("C.3 is not in dev mode");
  }
}
