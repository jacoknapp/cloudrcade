// Keep Dolphin's normal CPU/GPU idle rendezvous for this browser core. The
// upstream wasm host disables it; Double Dash can then stop submitting draws
// while its VI counter continues. Local game settings override that base value.
export function configureGameCube(fs, gameId) {
  // Disc metadata supplies the filename, so never allow it to escape this
  // worker's ephemeral GameSettings directory. Inspection/homebrew may lack ID.
  if (typeof gameId !== 'string' || !/^[A-Za-z0-9]{6}$/.test(gameId)) return false;
  const directory = '/dolphin-user/GameSettings';
  fs.mkdirTree(directory);
  fs.writeFile(`${directory}/${gameId}.ini`, '[Core]\nSyncOnSkipIdle = True\n');
  return true;
}
