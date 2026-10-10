// CloudRcade modification, 2026: use configured app branding.
import React, { Component } from "react";
require("./style.scss");
export default class Logo extends Component {
  render() {
    const logoName = this.props.size === 'large' ? 'logoLarge' : 'logo';
    const name = window.WrcadCloudConfig?.appName || 'cloudЯcade';
    return <div className={logoName}><div className={logoName + '-left-text'}>{name}</div></div>;
  }
}
