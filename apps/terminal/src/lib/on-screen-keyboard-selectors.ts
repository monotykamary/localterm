export const ON_SCREEN_KEYBOARD_TOGGLE_SELECTOR = [
  "[data-on-screen-keyboard-toggle]",
  "[data-on-screen-keyboard-actions-toggle]",
].join(", ");

export const ON_SCREEN_KEYBOARD_CONTROL_SELECTOR = [
  "[data-on-screen-keyboard]",
  "[data-on-screen-keyboard-settings]",
  ON_SCREEN_KEYBOARD_TOGGLE_SELECTOR,
  "[data-terminal-actions-toolbar]",
].join(", ");
