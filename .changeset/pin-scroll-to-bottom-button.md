---
"@monotykamary/localterm": patch
---

Pin the run-log scroll-to-bottom button and animate its reveal.

The button was positioned inside the scroll container, so it scrolled away with the log and vanished as soon as you scrolled down. It's now a sibling of the scroll container, pinned to the bottom-right of the log view until the reader reaches the bottom. The reveal/exit switched from a mount/unmount fade to an always-mounted, interruptible opacity + translate transition driven by `data-visible`/`data-hidden`, so toggling near the bottom threshold no longer flickers, and the button is dropped from the a11y tree, tab order, and pointer hit-testing when dismissed.
