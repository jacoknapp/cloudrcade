import React from 'react';

import { ControlsTab } from '@webrcade/app-common';

export class GamepadControlsTab extends ControlsTab {
  render() {
    return (
      <>
        {this.renderControl('start', 'Start')}
        {this.renderControl('select', 'Select')}
        {this.renderControl('dpad', 'D-Pad')}
        {this.renderControl('lanalog', 'Analog stick')}
        {this.renderControl('b', 'Circle')}
        {this.renderControl('a', 'Cross')}
        {this.renderControl('y', 'Triangle')}
        {this.renderControl('x', 'Square')}
        {this.renderControl('lbump', 'L')}
        {this.renderControl('rbump', 'R')}
      </>
    );
  }
}

export class KeyboardControlsTab extends ControlsTab {
  render() {
    return (
      <>
        {this.renderKey('Enter', 'Start')}
        {this.renderKey('ShiftRight', 'Select')}
        {this.renderKey('ArrowUp', 'Up')}
        {this.renderKey('ArrowDown', 'Down')}
        {this.renderKey('ArrowLeft', 'Left')}
        {this.renderKey('ArrowRight', 'Right')}
        {this.renderKey('KeyX', 'Circle')}
        {this.renderKey('KeyZ', 'Cross')}
        {this.renderKey('KeyS', 'Triangle')}
        {this.renderKey('KeyA', 'Square')}
        {this.renderKey('KeyQ', 'L')}
        {this.renderKey('KeyW', 'R')}
      </>
    );
  }
}
