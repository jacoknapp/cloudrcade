/* Device-clock and RTC-save adapter for the pinned emulator interfaces. */
(() => {
  'use strict';
  const SAVE_DIR = '/home/web_user/retroarch/userdata/saves/';
  const RTC_NAME = 'clock.rtc';
  const installed = new WeakMap();
  const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
  const coreName = wrapper => wrapper?.getScriptUrl?.() || '';
  const isRetro = wrapper => /(?:sameboy|mgba|melonds|clock-core)/.test(coreName(wrapper));
  const toBytes = async value => value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : new Uint8Array(value);

  function install(wrapper) {
    if (!wrapper || installed.has(wrapper) || !isRetro(wrapper)) return installed.get(wrapper);
    const state = {lastSync: 0, clock: false, pokemon: null};
    installed.set(wrapper, state);
    const sameboy = /sameboy|clock-core/.test(coreName(wrapper));
    if (sameboy) {
      // Read only the cartridge header. Games without an RTC are untouched.
      try {
        const stream = FS.open(wrapper.game, 'r');
        const header = new Uint8Array(0x150);
        try { FS.read(stream, header, 0, header.length, 0); } finally { FS.close(stream); }
        state.clock = [0x0f, 0x10].includes(header[0x147]);
        const title = new TextDecoder().decode(header.slice(0x134, 0x143)).replace(/\0/g, '');
        // English retail Gen 2 uses a software offset on top of the MBC3 RTC.
        // Read the live offset, never rewrite SRAM/checksums or player data.
        if (title === 'PM_CRYSTALBYTE') state.pokemon = 0x14b6;
        else if (title === 'POKEMON_GLDAAUE' || title === 'POKEMON_SLVAAXE') state.pokemon = 0x11dc;
      } catch (_) { /* No recognizable RTC cartridge. */ }
      const config = wrapper.getRaConfigContents;
      wrapper.getRaConfigContents = function(...args) {
        const file = '/home/web_user/retroarch/userdata/wrcad-clock-options.cfg';
        FS.writeFile(file, 'sameboy_rtc = "sync to system clock"\n');
        return (config?.apply(this, args) || '') + `\ncore_options_path = "${file}"\n`;
      };
      const frame = wrapper.onFrame;
      wrapper.onFrame = function(...args) {
        sync(wrapper);
        return frame?.apply(this, args);
      };
    }
    return state;
  }

  function sync(wrapper, force = false) {
    const state = installed.get(wrapper);
    const now = Date.now();
    if (!state?.clock || !wrapper.mainStarted || (!force && Math.abs(now - state.lastSync) < 1000)) return;
    const api = window.Module?.asm;
    if (typeof api?.wrcad_memory_data !== 'function' || api.wrcad_memory_size(1) !== 32) return;
    const ptr = api.wrcad_memory_data(1);
    const heap = Module.HEAPU8;
    if (!ptr || ptr + 32 > heap.length) return;
    const rtc = heap.subarray(ptr, ptr + 32);
    // Respect a game's brief halt while it is programming its clock.
    if (rtc[4] & 0x40) return;
    const local = new Date(now);
    let offset = 0, offsetDay = 0;
    if (state.pokemon) {
      const ramPtr = api.wrcad_memory_data(2), ramSize = api.wrcad_memory_size(2);
      if (!ramPtr || ramSize < state.pokemon + 4 || ramPtr + state.pokemon + 4 > heap.length) return;
      const start = heap.subarray(ramPtr + state.pokemon, ramPtr + state.pokemon + 4);
      if (start[0] > 139 || start[1] >= 24 || start[2] >= 60 || start[3] >= 60) return;
      offsetDay = start[0]; offset = start[1] * 3600 + start[2] * 60 + start[3];
    }
    const seconds = mod(local.getHours() * 3600 + local.getMinutes() * 60 + local.getSeconds() - offset, 86400);
    const carry = Math.floor((seconds + offset) / 86400);
    const currentDay = rtc[3] + ((rtc[4] & 1) << 8);
    // Keep the running day count, aligning weekday without resetting progress.
    const weekday = mod(local.getDay() - offsetDay - carry, 7);
    let day = currentDay + mod(weekday - currentDay, 7);
    // The hardware wraps at 512 days, which is not a whole number of weeks.
    if (day >= 512) day = weekday;
    rtc[0] = seconds % 60;
    rtc[1] = Math.floor(seconds / 60) % 60;
    rtc[2] = Math.floor(seconds / 3600);
    rtc[3] = day & 255;
    rtc[4] = (rtc[4] & 0xfe) | (day >> 8);
    const view = new DataView(heap.buffer, ptr, 32);
    view.setBigUint64(16, BigInt(Math.floor(now / 1000)), true);
    view.setUint32(24, 0, true);
    state.lastSync = now;
  }

  async function restore(manager, files) {
    const wrapper = manager.appWrapper;
    if (!install(wrapper)) return;
    const file = files?.find(file => file.name === RTC_NAME);
    if (file) {
      const bytes = await toBytes(file.content);
      const validSize = /sameboy|clock-core/.test(coreName(wrapper)) ? bytes.length === 32 : bytes.length > 0 && bytes.length <= 4096;
      if (validSize) FS.writeFile(SAVE_DIR + 'game.rtc', bytes);
    }
  }

  function capture(manager, files) {
    const wrapper = manager.appWrapper;
    if (!isRetro(wrapper) || !Array.isArray(files) || !files.some(file => file.name === wrapper.SAVE_NAME)) return;
    try {
      const bytes = FS.readFile(SAVE_DIR + 'game.rtc');
      if (!bytes.length || bytes.length > 4096) return;
      const file = {name: RTC_NAME, content: bytes};
      const index = files.findIndex(file => file.name === RTC_NAME);
      if (index < 0) files.push(file); else files[index] = file;
    } catch (_) { /* This game/core does not have a separate RTC file. */ }
  }
  window.WrcadClock = {restore, capture, sync};
})();
