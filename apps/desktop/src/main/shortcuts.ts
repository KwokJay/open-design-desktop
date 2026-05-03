import { type BrowserWindow, globalShortcut } from "electron";

export type DesktopShortcuts = {
  unregister(): void;
};

export function registerDesktopShortcuts(window: BrowserWindow): DesktopShortcuts {
  // Toggle window visibility with Cmd/Ctrl+Shift+D
  const accelerator = "CmdOrCtrl+Shift+D";

  const registered = globalShortcut.register(accelerator, () => {
    if (window.isDestroyed()) return;
    if (window.isVisible() && !window.isMinimized()) {
      window.hide();
    } else {
      window.show();
      window.focus();
    }
  });

  if (!registered) {
    console.warn(`desktop failed to register global shortcut: ${accelerator}`);
  }

  return {
    unregister() {
      globalShortcut.unregister(accelerator);
    },
  };
}
