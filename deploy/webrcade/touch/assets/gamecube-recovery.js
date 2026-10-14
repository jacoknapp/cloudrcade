// Library recovery is available whenever the GameCube core is packaged.
(() => {
  if (window === window.top && window.WrcadCloudConfig?.gamecubeUrl === '/experimental/gamecube/') {
    import('/experimental/gamecube/recovery.js').catch(() => {});
  }
})();
