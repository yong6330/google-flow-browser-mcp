import { checkCreditFloor } from "./account.js";
// One serialized credit check + durable intent per paid click, shared by generation and upscale.
export async function executePaid({
  queue,
  job,
  signal,
  floor,
  metadata,
  readBalance,
  prepare,
}) {
  return queue.withCredits(async () => {
    signal.throwIfAborted();
    const balance = await readBalance();
    const { cost, submit } = await prepare();
    signal.throwIfAborted();
    checkCreditFloor(balance, cost, floor, queue.reserved(job.id));
    queue.update(job.id, { ...metadata, submissionIntent: true, cost });
    const result = await submit();
    queue.update(job.id, { submittedAt: Date.now() });
    return result;
  });
}
