import React, { Fragment } from 'react';
import { WebrcadeRetroApp } from '@webrcade/app-common';
import { Emulator } from './emulator';
import { EmulatorPauseScreen } from './pause';
import './App.scss';

class App extends WebrcadeRetroApp {
  createEmulator(app, debug) { return new Emulator(app, debug); }
  isRomProgressBased() { return true; }
  isHeapAllocEnabled() { return false; }
  isDiscBased() { return false; }
  getBiosMap() { return {}; }
  getBiosUrls() { return []; }

  async fetchResponseBuffer(response, heapAllocCallback = null) {
    const size = Number(response.headers.get('Content-Length'));
    if (!(size > 128 * 1024 * 1024)) {
      return super.fetchResponseBuffer(response, heapAllocCallback);
    }
    if ((response.headers.get('Accept-Ranges') || '').toLowerCase() !== 'bytes' || !response.url) {
      throw new Error('Large PSP games require a server with HTTP range support.');
    }
    const url = response.url;
    try { await response.body.cancel(); } catch (_) { /* already closed */ }
    const head = await fetch(url, { headers: {Range: 'bytes=0-65535'} });
    if (head.status !== 206) throw new Error('The server could not stream this PSP game.');
    const bytes = new Uint8Array(await head.arrayBuffer());
    if (bytes.length !== 65536 || head.headers.get('Content-Range') !== `bytes 0-65535/${size}`) {
      throw new Error('The server returned an invalid PSP game range.');
    }
    this.emulator.setLazyRom(url, size);
    return bytes;
  }

  async onPreExit() {
    try { await super.onPreExit(); }
    finally { await this.emulator.dispose(); }
  }

  renderPauseScreen() {
    return <EmulatorPauseScreen emulator={this.emulator} appProps={this.appProps}
      closeCallback={() => this.resume()} exitCallback={() => this.exitFromPause()}
      isEditor={this.isEditor} isStandalone={this.isStandalone} />;
  }

  render() { return <Fragment>{super.render()}<div id="background" /></Fragment>; }
}
export default App;
