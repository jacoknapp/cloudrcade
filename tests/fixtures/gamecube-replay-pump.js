// Pinned wasm-dolphin 7e38409 upstream pump; exercised through patch_replay_pump.
function startWgpuReplayPump() {
  if (!wgpuReplayPumpEnabled || wgpuReplayPumpTimer !== null) return;
  const pump = () => {
    wgpuReplayPumpTimer = null;
    if (!wgpuReplayPumpEnabled || !webGpuCmdRing) return;
    if (wgpuReplayPumpDueAt > 0) {
      const wokeAt = performance.now();
      const wakeDelayMs = Math.max(0, wokeAt - wgpuReplayPumpDueAt);
      webGpuCausalStats.replayPumpWakeCount += 1;
      webGpuCausalStats.replayPumpWakeDelayLastMs = wakeDelayMs;
      webGpuCausalStats.replayPumpWakeDelayTotalMs += wakeDelayMs;
      webGpuCausalStats.replayPumpWakeDelayMaxMs = Math.max(
        webGpuCausalStats.replayPumpWakeDelayMaxMs,
        wakeDelayMs
      );
    }
    wgpuReplayYieldPending = false;
    const write = Atomics.load(webGpuCmdRing.headerI32, 0) >>> 0;
    const read = currentWgpuReadIndex(webGpuCmdRing);
    if (write !== read) {
      webGpuCausalStats.replayPumpDrainCount += 1;
      drainWebGpuCmdRing("pump");
    } else {
      webGpuCausalStats.replayPumpEmptyPollCount += 1;
    }
    scheduleWgpuReplayPump(
      pump,
      write === read || wgpuMappedCapacityBlocked ? 4 : 0
    );
  };
  scheduleWgpuReplayPump(pump, 0);
}

function scheduleWgpuReplayPump(callback, delayMs) {
  const delay = Math.max(0, Number(delayMs) || 0);
  const trackWakeDelay = causalMetricsEnabled || wgpuReplayBudgetMs > 0;
  wgpuReplayPumpScheduledAt = trackWakeDelay ? performance.now() : 0;
  wgpuReplayPumpDueAt = trackWakeDelay ? wgpuReplayPumpScheduledAt + delay : 0;
  webGpuCausalStats.replayPumpScheduleCount += 1;
  if (delay === 0) webGpuCausalStats.replayPumpBacklogScheduleCount += 1;
  else webGpuCausalStats.replayPumpIdleScheduleCount += 1;
  wgpuReplayPumpTimer = setTimeout(callback, delay);
}

function cancelWgpuReplayPump() {
  if (wgpuReplayPumpTimer !== null) clearTimeout(wgpuReplayPumpTimer);
  wgpuReplayPumpTimer = null;
  wgpuReplayYieldPending = false;
  wgpuReplayPumpScheduledAt = 0;
  wgpuReplayPumpDueAt = 0;
}

