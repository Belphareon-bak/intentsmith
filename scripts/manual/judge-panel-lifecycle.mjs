// Evidence lifecycle only; does not change prompts, grades or inference options.
export function assertResumableReceipt(receipt, post, { planSha256, key }) {
  if (receipt?.planSha256 !== planSha256) throw Error('JUDGE_RECEIPT_PLAN_MIX');
  if (!post) throw Error('JUDGE_RECEIPT_POSTCHECK_MISSING:' + key);
  if (post.planSha256 !== planSha256 || post.key !== key) throw Error('JUDGE_RECEIPT_POSTCHECK_MISMATCH:' + key);
  if (!Array.isArray(post.after?.placement) || !post.after.placement.some(p => p.digest?.replace(/^sha256:/, '') === receipt.judge?.digestSha256)
    || !Number.isFinite(post.afterPower?.limitWatts)) throw Error('JUDGE_RECEIPT_POSTCHECK_INCOMPLETE:' + key);
}

export async function finalizeJudgePanel({ status, failure, close, release, checkpoint }) {
  const failures = [];
  const record = (stage, error) => failures.push({ stage, code: error?.code || null, message: String(error?.message || error) });
  if (failure) record('collection', failure);
  try { await close(); } catch (error) { record('provider-close', error); }
  try { await release(); } catch (error) { record('lease-release', error); }
  const result = { status: failures.length ? 'BLOCKED' : status, failures };
  // Cleanup failure must not leave a stale RUNNING checkpoint or hide the first error.
  await checkpoint(result);
  return result;
}
