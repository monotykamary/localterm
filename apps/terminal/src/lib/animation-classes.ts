/**
 * Shared Tailwind class strings for UI overlays so every floating panel and
 * modal in the app animates and styles identically.
 *
 * Easing follows the animation-best-practices skill:
 *   - Use a snappy custom curve (--ease-snappy) instead of generic ease-out for
 *     prominent transitions; built-in curves lack energy.
 *   - Never use `ease-in` on UI animations — same easing on close as on open
 *     so the exit doesn't feel back-loaded.
 */

// Popover-style panels (settings menu, select dropdowns). No backdrop;
// origin comes from Base UI's auto --transform-origin.
export const TRANSLUCENT_PANEL_CLASSES =
  "border border-border/60 bg-background/70 text-muted-foreground shadow-xs ring-0 backdrop-blur-md";

export const PANEL_ANIMATION_CLASSES =
  "duration-150 ease-snappy data-closed:duration-100 data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:blur-out-[5px] data-closed:slide-out-to-top-2 data-open:fade-in-0 data-open:zoom-in-95 data-open:blur-in-[5px] data-open:slide-in-from-top-2";

// Modal-level overlays (alert dialog, command palette). Full-screen backdrop
// with blur; centered panel with fade + scale.
//
// Alert dialog uses keyframe animations (animate-in/animate-out) because
// Base UI primitives manage the full lifecycle — they never toggle rapidly.
export const MODAL_BACKDROP_CLASSES =
  "fixed inset-0 isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs";

export const MODAL_BACKDROP_ANIMATION_CLASSES =
  "duration-150 ease-snappy data-closed:duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0";

export const MODAL_PANEL_CLASSES =
  "border border-border/60 bg-background/90 text-foreground shadow-lg ring-0";

export const MODAL_PANEL_ANIMATION_CLASSES =
  "duration-150 ease-snappy data-closed:duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

// Command-palette-specific animation using CSS transitions instead of
// keyframes. Transitions interpolate from the current visual state so there's
// no snap/flicker when interrupting a mid-flight enter animation with a close.
export const COMMAND_PALETTE_BACKDROP_CLASSES =
  "absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs transition-[opacity,backdrop-filter] duration-150 ease-snappy data-[closed]:opacity-0 data-[open]:opacity-100";

export const COMMAND_PALETTE_PANEL_CLASSES =
  "transition-[opacity,transform] duration-150 ease-snappy data-[closed]:opacity-0 data-[closed]:scale-95 data-[open]:opacity-100 data-[open]:scale-100";
