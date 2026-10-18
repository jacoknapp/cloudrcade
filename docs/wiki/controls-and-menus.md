# Controls and game menus

[Wiki home](README.md) · [Library](library-and-devices.md) · [Saves](saves-and-storage.md)

## Find the right menu

There are three places with different jobs:

| Place | How to open it | Use it for |
| --- | --- | --- |
| Library Settings | **Settings** while browsing | Cloud connection, browser preferences and available diagnostic settings |
| Game pause menu | Touch **Menu**, or that emulator's keyboard/gamepad pause shortcut | View Controls, game settings, supported save-state slots, resume and exit |
| Blue/aqua touch drawer | Tap/pull the **‹** edge tab while a game runs | Show/hide buttons, mute, translucence, edit layout and supported screen views |

Start with **View Controls** for a game's actual keyboard/gamepad mappings. A NES game and a 3DS game have different buttons and options.

## Keyboard and physical controllers

Keyboard and gamepad input remain available alongside touch controls. Use the emulator's **View Controls** guide to check the mapping for that system; bindings and available game settings vary by app. Connect or pair a controller through your operating system/browser before launching. A browser may need a controller button press before it exposes the gamepad.

Use the native pause menu to change game settings, consult controls, manage available state slots, resume, or exit. On touch devices, use the controller's **Menu** button. Tapping an empty part of the game is not the pause shortcut. Menus use compact black/red panels on mobile; portrait actions stack and landscape uses two columns. Settings keep their page arrows and OK/Cancel buttons in the same place as you switch pages; longer content scrolls inside the panel. The touch controller's drawer retains its blue/aqua styling.

The startup **Updated** popup shows current cloudЯcade changes and streaming/shader notes. On mobile, its notes scroll above a fixed footer; **Don't show again** and **OK** stay separate and tappable in portrait or landscape. Choosing Don't show again and then OK remembers your preference in this browser. The optional update popup waits for the library and does not open over another active dialog or a running game.

## Open the touch drawer

While a game is running, tap the **‹** edge tab or pull it inward. The tab is hidden in the library, during loading and in the native pause menu. Opening the drawer hides game buttons so you can use the panel without accidental input.

**Controls on/off** enables/disables the touch game buttons; the edge tab remains available. This choice is remembered in the browser. Turning touch controls off leaves keyboard/gamepad input available.

**Translucence** fades the game controls by up to 80%. The open drawer stays readable. **Mute audio** silences Web Audio output, including achievement sounds, while the emulator's audio clock continues. The app requests mixable ambient audio where supported; your phone may still require you to resume music or a podcast manually. Mute is remembered locally and can sync through the connected save provider.

## Edit a layout

1. Launch a game, tap/pull the **‹** edge tab to open the touch drawer, then choose **Edit layout**.
2. Drag the individual buttons, directional pad or sticks to your preferred positions. Drag the edge tab vertically or to the opposite edge if needed.
3. Choose **Save** to keep the layout and resume play. **Cancel** restores the prior layout. **Reset** restores defaults for the current orientation; choose Save afterward to keep that reset.
4. Rotate the device and repeat if you want a different landscape/portrait layout.

The game pauses during editing. Layouts save per platform and orientation in the browser, including separate GB/GBC/GBA layouts. Positions are screen-relative and clamped to the viewport. Editing works with controls switched off and preserves that visibility choice afterward. You cannot edit before a game is running.

Buttons can overlap the game or sit below it; place them wherever you find comfortable. Moving buttons does not move the picture to follow them. Some systems, including PlayStation and the PS2 beta, use a default portrait picture area above the controls; PS2 uses the available safe viewport in landscape or with controls off. Saved button positions are restored without restricting them to the default bottom pad.

With Nextcloud or Dropbox connected as the save provider, saved layouts, tab positions, translucence, visibility, mute and DS/3DS view choices sync through the controller profile. Unsaved drags and Cancel do not publish a layout. Offline edits queue for the connected account and retry after reconnection. See [cloud preferences](saves-and-storage.md#history-and-controller-preferences).

## Platform-specific input

Digital consoles use an eight-way D-pad. Multiple direction/action touches, sliding between action buttons and diagonals are supported. Directions release when the finger returns to a straight direction or neutral center. Held inputs also release on pause, focus loss, cancellation, hiding or rotation.

N64 has independent analog, D-pad and C buttons. PlayStation shows both DualShock analog sticks from startup, alongside its D-pad. The emulator's per-game controller-mode setting determines whether a game uses analog input. Stick and D-pad input remain independent. 3DS uses a Circle Pad, independent C-stick, D-pad and ZL/ZR. Nintendo face buttons put B below and A to the right.

DS retains native stylus touch on the game screen. Its drawer has **DS screens**: **View** cycles the six layouts, **Single screen** switches top/touchscreen, and **Dual screens** cycles two-screen views. Vertical layouts fit both screens within the safe area; other layouts retain normal centering. Choosing a view exits rotated book mode. The native microphone control remains available.

3DS has its own **3DS screens → View** button in the drawer to cycle that app's available screen arrangements. Its saved choice is separate from the DS view.

3DS text entry uses a browser prompt and the phone keyboard, limited to the game's allowed length. Cancel cancels the game's text request. Browser dialogs and OS input can look different across devices.

## Experimental settings and defaults

The inherited **Experimental apps** preference is enabled once when the fork's migration first runs so experimental systems such as N64 can be used. After that migration, a player's saved choice is respected. It is a browser preference, not a guarantee of compatibility or speed.

PSP is available by default without an Experimental Settings toggle or Docker enable setting. PSP uses an independent analog stick and D-pad, cross/circle/square/triangle, L/R, Select and Start. HTTPS, cross-origin isolation and WebGL2 are required. Compatibility and speed vary by browser and device.

The root deployment enables 3DS with `WEBRCADE_ENABLE_3DS=true`. This operator setting registers its app and permits scanner entries. There is no separate “Link 3DS” operation. **Settings → Core Settings** contains **3DS performance readout** and **3DS lighting on CPU (slower)**; both are off by default and read when a game launches. Leave them off for normal play unless diagnosing performance. PSP remains available by default.

GameCube is available when its core is packaged, without a player enable switch. Its **GameCube performance readout** is in **Core Settings**. Keyboard, gamepad and touch input include separate sticks and its own button layout. It requires device WebGPU; see [device requirements](streaming-offline-and-3ds.md#gamecube-and-the-ps2-beta).

On the **PS2 beta**, open **Settings → Experimental Settings**, turn on **Enable PlayStation 2 (experimental)** and press **OK**. This and the separate **PS2 performance readout** start off; Cancel discards changes. Disabling PS2 hides its games and blocks direct launches while preserving saves and layouts. There is no Docker enable flag. PS2 controls include both analog sticks, D-pad, Sony face buttons, L1/R1/L2/R2/L3/R3, Select, Start and Menu; Escape also opens its pause menu. Compatibility, rendering and speed remain experimental.

3DS uses native 1x resolution and the original console model by default. See [3DS performance](streaming-offline-and-3ds.md#3ds-shaders-and-performance) before changing settings expecting full-speed playback.

## Exit carefully

Save using the game's own save function when available, then use the native exit flow. Let save work finish and check any error message before closing the tab. Save states and in-game saves are different; read [saves and storage](saves-and-storage.md) before moving between devices or upgrading a core.
