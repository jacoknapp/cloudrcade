// Stable library stays dormant when the experimental core is not packaged.
(() => {
  if (window === window.top && window.WrcadCloudConfig?.gamecubePrototypeUrl === '/experimental/gamecube/') {
    import('/experimental/gamecube/recovery.js').catch(() => {});
  }
})();
