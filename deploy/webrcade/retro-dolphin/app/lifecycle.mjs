// Background pauses belong to the current session. A deliberate pause/menu
// must survive returning to the app. Serialize transitions: iOS can return
// before the worker acknowledges the pause requested when it went away.
export function createBackgroundPause({getSession, canPause, canResume, pause, resume, onError}) {
  let foreground = true, owner = null, running = false, again = false;
  async function reconcile() {
    again = true;
    if (running) return;
    running = true;
    try {
      while (again) {
        again = false;
        const session = getSession();
        if (owner && (owner !== session || owner.closed)) owner = null;
        if (!foreground && !owner && canPause(session)) {
          owner = session;
          await pause();
          again = true;
        } else if (foreground && owner && canResume(owner)) {
          const resumed = owner;
          await resume();
          if (owner === resumed) owner = null;
          again = true;
        }
      }
    } catch (error) { owner = null; onError(error); }
    finally { running = false; }
  }
  return {
    background() { foreground = false; void reconcile(); },
    foreground() { foreground = true; void reconcile(); },
    update() { void reconcile(); },
    reset() { owner = null; },
  };
}
