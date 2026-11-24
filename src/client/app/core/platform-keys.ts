/**
 * The keys of this platform, by name: macOS shows ⌘, ⌃ and ⇧ where others
 * write Ctrl and Shift. Plain, without Angular, for code outside the app's
 * components (CodeMirror's panels, the kit).
 */
export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";
export const CTRL_KEY = isMac ? "⌃" : "Ctrl";
export const SHIFT_KEY = isMac ? "⇧" : "Shift";
