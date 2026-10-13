// LoadStateFile queues work on the native CPU thread. A request acknowledgement
// is not completion, and its input file must remain alive until the callback.
export async function waitForStateLoad(readGeneration, before, {
  timeoutMs = 30000, now = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const deadline = now() + timeoutMs;
  while (readGeneration() === before) {
    if (now() >= deadline) throw new Error('GameCube state restore timed out. Restart the game before retrying.');
    await sleep(50);
  }
}
