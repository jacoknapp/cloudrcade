import React, { Fragment } from "react";

import {
  WebrcadeRetroApp
} from '@webrcade/app-common';

import { Emulator } from './emulator';
import { EmulatorPauseScreen } from './pause';

import './App.scss';

const STREAMING_THRESHOLD = 512 * 1024 * 1024;
const STREAMING_ID_BYTES = 64 * 1024;

class App extends WebrcadeRetroApp {
  createEmulator(app, isDebug) {
    return new Emulator(app, isDebug);
  }

  isRomProgressBased() {
    return true;
  }

  // Games are several hundred MB or more; keep them out of the WASM heap.
  isHeapAllocEnabled() {
    return false;
  }

  // Games above the streaming threshold are not downloaded: the emulator reads them on
  // demand, and only the start of the file is returned here (it also identifies the game).
  async fetchResponseBuffer(response, heapAllocCallback = null) {
    const length = parseInt(response.headers.get('Content-Length'));
    const ranges = (response.headers.get('Accept-Ranges') || '').toLowerCase();
    if (!(length > STREAMING_THRESHOLD) || ranges !== 'bytes' || !response.url) {
      return super.fetchResponseBuffer(response, heapAllocCallback);
    }

    const url = response.url;
    try { await response.body.cancel(); } catch (e) { /* already closed */ }
    const head = await fetch(url, { headers: { Range: `bytes=0-${STREAMING_ID_BYTES - 1}` } });
    if (head.status !== 206) {
      throw new Error('The server does not support partial downloads of this game.');
    }
    this.emulator.setLazyRom(url, length);
    return new Uint8Array(await head.arrayBuffer());
  }

  async onPreExit() {
    try {
      // Persist saves before releasing the runtime and its workers.
      await super.onPreExit();
      // Reports are already stored locally before their optional cloud upload.
      // Do not hold exit open indefinitely for a diagnostic upload.
      await Promise.race([
        this.emulator.shaderFailures.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    } finally {
      const module = window.Module;
      if (module) {
        // A core that aborted while starting can throw here; the remaining
        // clean-up (ROM cache, listeners, audio) must still run.
        try {
          if (module._toggleMainLoop) module._toggleMainLoop(0);
          if (module.PThread) module.PThread.terminateAllThreads();
        } catch (e) { /* nothing left to stop */ }
      }
      if (this.emulator.lazyRom) this.emulator.lazyRom.chunks.clear();
      if (this.emulator.resumeAudio) {
        for (const event of ['pointerdown', 'touchend', 'keydown']) {
          document.removeEventListener(event, this.emulator.resumeAudio, true);
        }
      }
      if (this.emulator.timingAudioContext) {
        this.emulator.timingAudioContext.removeEventListener(
          'statechange', this.emulator.updateFrameTiming,
        );
        this.emulator.timingAudioContext = null;
      }
      const context = module && module.RWA && module.RWA.context;
      if (context && context.state !== 'closed') await context.close().catch(() => {});
    }
  }

  isDiscBased() {
    return false;
  }

  getBiosMap() {
    return {};
  }

  getBiosUrls(appProps) {
    return [];
  }

  renderPauseScreen() {
    const { appProps, emulator } = this;

    return (
      <EmulatorPauseScreen
        emulator={emulator}
        appProps={appProps}
        closeCallback={() => this.resume()}
        exitCallback={() => {
          this.exitFromPause();
        }}
        isEditor={this.isEditor}
        isStandalone={this.isStandalone}
      />
    );
  }

  render() {
    return (
      <Fragment>
        {super.render()}
        <div id="background"/>
      </Fragment>
    );
  }
}

export default App;
