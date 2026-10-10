# Controls and game menus

[Wiki home](README.md) · [Library](library-and-devices.md) · [Saves](saves-and-storage.md)

## Keyboard and physical controllers

Keyboard and gamepad input remain available alongside touch controls. Use the emulator's **View Controls** guide to check the mapping for that system; bindings and available game settings vary by app. Connect or pair a controller through your operating system/browser before launching. A browser may need a controller button press before it exposes the gamepad.

Use the native pause menu to change game settings, consult controls, manage available state slots, resume, or exit. On touch devices, use the controller's **Menu** button. Tapping an empty part of the game is not the pause shortcut. Menus use compact black/red panels on mobile; portrait actions stack and landscape uses two columns. Settings keep their page arrows and OK/Cancel buttons in the same place as you switch pages; longer content scrolls inside the panel. The touch controller's drawer retains its blue/aqua styling.

The startup **Updated** popup shows current cloudЯcade changes and streaming/shader notes. On mobile, its notes scroll above a fixed footer; **Don't show again** and **OK** stay separate and tappable in portrait or landscape. Choosing Don't show again and then OK remembers your preference in this browser. The optional update popup waits for the library and does not open over another active dialog or a running game.

## Open the touch drawer

While a game is running, tap the **‹** edge tab or pull it inward. The tab is hidden in the library, during loading and in the native pause menu. Opening the drawer hides game buttons so you can use the panel without accidental input.

**Controls on/off** enables/disables the touch game buttons; the edge tab remains available. This choice is remembered in the browser. Turning touch controls off leaves keyboard/gamepad input available.

**Translucence** fades the game controls by up to 80%. The open drawer stays readable. **Mute audio** silences Web Audio output, including achievement sounds, while the emulator's audio clock continues. The app requests mixable ambient audio where supported; your phone may still require you to resume music or a podcast manually. Mute is remembered locally and can sync through Nextcloud.

## Edit a layout

1. Launch a game and open **Controls → Edit layout**.
2. Drag the individual buttons, directional pad or sticks to your preferred positions. Drag the edge tab vertically or to the opposite edge if needed.
3. Choose **Save** to keep the layout and resume play. **Cancel** restores the prior layout. **Reset** restores defaults for the current orientation; choose Save afterward to keep that reset.
4. Rotate the device and repeat if you want a different landscape/portrait layout.

The game pauses during editing. Layouts save per platform and orientation in the browser, including separate GB/GBC/GBA layouts. Positions are screen-relative and clamped to the viewport. Editing works with controls switched off and preserves that visibility choice afterward. You cannot edit before a game is running.

With Nextcloud connected, saved layouts, tab positions, translucence, visibility, mute and DS view choices sync through the controller profile. Unsaved drags and Cancel do not publish a layout. Offline edits queue for the connected account and retry after reconnection. See [cloud preferences](saves-and-storage.md#history-and-controller-preferences).

## Platform-specific input

Digital consoles use an eight-way D-pad. Multiple direction/action touches, sliding between action buttons and diagonals are supported. Directions release when the finger returns to a straight direction or neutral center. Held inputs also release on pause, focus loss, cancellation, hiding or rotation.

N64 has independent analog, D-pad and C buttons. PlayStation adds left/right analog sticks when its emulator analog mode is enabled; change that in the game's settings. Stick and D-pad input remain independent. 3DS uses a Circle Pad, independent C-stick, D-pad and ZL/ZR. Nintendo face buttons put B below and A to the right.

DS retains native stylus touch on the game screen. Its drawer has **DS screens**: **View** cycles the six layouts, **Single screen** switches top/touchscreen, and **Dual screens** cycles two-screen views. Vertical layouts fit both screens within the safe area; other layouts retain normal centering. Choosing a view exits rotated book mode. The native microphone control remains available.

3DS text entry uses a browser prompt and the phone keyboard, limited to the game's allowed length. Cancel cancels the game's text request. Browser dialogs and OS input can look different across devices.

## Exit carefully

Save using the game's own save function when available, then use the native exit flow. Let save work finish and check any error message before closing the tab. Save states and in-game saves are different; read [saves and storage](saves-and-storage.md) before moving between devices or upgrading a core.
