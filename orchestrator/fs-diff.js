import { createTwoFilesPatch } from "diff";

export function computeUnifiedDiff(path, oldContent, newContent) {
  return createTwoFilesPatch(
    path,
    path,
    oldContent ?? "",
    newContent ?? "",
    "",
    ""
  );
}
