"""Apply the pinned upstream wasm recipe and native webRcade adapter changes."""
from pathlib import Path
import sys

work = Path(sys.argv[1])
def replace(path, old, new):
    text = path.read_text()
    if new in text: return
    assert text.count(old) == 1, (path, old)
    path.write_text(text.replace(old, new))

replace(work/'ppsspp/ext/cpu_features/src/hwcaps.c', 'return getauxval(hwcap_type);', 'return 1;')
replace(work/'ppsspp/ext/cpu_features/src/hwcaps.c', '#include <sys/auxv.h>', '// No Linux auxv in WebAssembly.')
socket = work/'ppsspp/ext/aemu_postoffice/client/sock_impl_linux.c'
socket.write_text(socket.read_text().replace('#ifndef __linux__', '#ifdef SO_NOSIGPIPE'))
replace(work/'ppsspp/libretro/libretro.cpp', '"elf|iso|cso|prx|pbp|chd"', '"elf|iso|cso|prx|pbp"')
replace(work/'ppsspp/Core/FileSystems/BlockDevices.cpp',
        '\t\tdevice = new CHDFileBlockDevice(fileLoader);',
        '#ifndef __EMSCRIPTEN__\n\t\tdevice = new CHDFileBlockDevice(fileLoader);\n#endif')
# Browser workers cannot be created synchronously while the renderer waits for
# video decoding. Keep FFmpeg decoding within the existing PSP worker instead
# of opening another pool at the first movie frame.
replace(work/'ppsspp/Core/HW/MediaEngine.cpp',
        '\t\tav_dict_set(&opt, "threads", "0", 0);',
        '\t\tav_dict_set(&opt, "threads", "1", 0);')
replace(work/'RetroArch/Makefile.emulatorjs', 'EXPORTS := Browser,', 'EXPORTS := PThread,RWA,Browser,')
replace(work/'RetroArch/Makefile.emulatorjs', '-s ERROR_ON_UNDEFINED_SYMBOLS=0', '-s ERROR_ON_UNDEFINED_SYMBOLS=1')
# Reuse gesture-created audio and handle a rejected resume on mobile browsers.
replace(work/'RetroArch/emscripten/library_rwebaudio.js', 'RWA.context = new ac();', 'RWA.context = window.readyAudioContext || new ac();')
replace(work/'RetroArch/emscripten/library_rwebaudio.js',
        'if (!RWA.contextRunning) RWA.context.resume();',
        'if (!RWA.contextRunning) RWA.context.resume().catch(function() {});')

common = work/'webrcade-app-common'
apps = common/'src/apps/applist.js'
# Include the line boundary: the uncommented text alone is also a substring
# of the commented declaration, which would incorrectly look already patched.
replace(apps, '\n  //RETRO_PPSSPP: "retro-ppsspp",', '\n  RETRO_PPSSPP: "retro-ppsspp",')
replace(apps, '  NDS: "nds",', '  NDS: "nds",\n  PSP: "psp",')
replace(apps, 'const types = [{', '''const types = [{
    key: APP_TYPE_KEYS.RETRO_PPSSPP, alias: APP_TYPE_KEYS.PSP,
    name: 'PlayStation Portable', coreName: 'PPSSPP', slowExit: true,
    location: 'app/retro-ppsspp/', background: 'images/app/nds-background.png',
    thumbnail: 'images/app/nds-thumb.png', description: 'PSP browser core.',
    validate: checkRom, extensions: ['iso', 'cso', 'pbp', 'elf'],
    multiThreaded: true, defaults: {rom: ''}
  }, {''')
replace(apps, 'addAlias(types, APP_TYPE_KEYS.NDS, APP_TYPE_KEYS.RETRO_MELONDS);',
        'addAlias(types, APP_TYPE_KEYS.NDS, APP_TYPE_KEYS.RETRO_MELONDS);\naddAlias(types, APP_TYPE_KEYS.PSP, APP_TYPE_KEYS.RETRO_PPSSPP);')
wrapper = common/'src/app/retrowrapper/index.js'
text = wrapper.read_text().replace('window.readyAudioContext.resume();', 'window.readyAudioContext.resume().catch(() => {});')
wrapper.write_text(text)
# Keep the already verified Safari byte-backed save codec used by the 3DS app.
storage = common/'src/storage/storage.js'
replace(storage, '    if (idxDb) {\n      return new Promise((resolve, reject) => {\n        const txn = idxDb.transaction([DB_STORE], "readwrite");\n        txn.oncomplete', '''    if (idxDb) {
      if (value instanceof Blob) {
        value = {__webrcadeBlobV1: true, type: value.type,
          bytes: new Uint8Array(await value.arrayBuffer())};
      }
      return new Promise((resolve, reject) => {
        const txn = idxDb.transaction([DB_STORE], "readwrite");
        txn.oncomplete''')
replace(storage, 'resolve(request.result ? request.result : null);', '''const value = request.result;
          resolve(value && value.__webrcadeBlobV1 === true && value.bytes instanceof Uint8Array ?
            new Blob([value.bytes], {type: value.type || ''}) : value || null);''')
