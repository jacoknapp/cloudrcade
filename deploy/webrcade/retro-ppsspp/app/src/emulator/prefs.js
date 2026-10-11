import {
  NewRetroPrefs
} from '@webrcade/app-common';

export class Prefs extends NewRetroPrefs {
  constructor(emu) {
    super(emu);
    this.emu = emu;
  }
}
