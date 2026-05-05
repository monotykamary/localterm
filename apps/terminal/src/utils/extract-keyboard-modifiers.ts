import {
  KEYBOARD_MODIFIER_ALT_BIT,
  KEYBOARD_MODIFIER_CTRL_BIT,
  KEYBOARD_MODIFIER_META_BIT,
  KEYBOARD_MODIFIER_SHIFT_BIT,
} from "@/lib/constants";

export const extractKeyboardModifiers = (event: KeyboardEvent): number =>
  (event.shiftKey ? KEYBOARD_MODIFIER_SHIFT_BIT : 0) |
  (event.altKey ? KEYBOARD_MODIFIER_ALT_BIT : 0) |
  (event.ctrlKey ? KEYBOARD_MODIFIER_CTRL_BIT : 0) |
  (event.metaKey ? KEYBOARD_MODIFIER_META_BIT : 0);
