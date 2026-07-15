---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---
Add a reusable design-token toast and move the pasted-image notice to the top.

- New `components/ui/toast.tsx` wraps `@base-ui/react/toast` in the app's design tokens, with kind-tinted status icons (spinner / check / alert) and the popover/modal enter–exit animation (fade + zoom + slide).
- The pasted-image toast now appears at the top of the terminal instead of above the on-screen keyboard, upserts in place via a stable toast id, and lets the toast manager own its timers (the manual setTimeout / unmount cleanup is gone).
