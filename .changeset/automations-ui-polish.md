---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Polish the automations UI with a ChatGPT-style prompt composer.

**Composer.** The agent runner's prompt, model, effort, and session now live in a single rounded composer card — the prompt auto-grows and the model/effort/session selectors sit as docked pills along the bottom, a mobile-first layout that scales to desktop.

**Form.** Settings are grouped into cards (Where & when, Limits, Secrets), the Harness config is its own nested card, the Name field is a prominent title input, and the footer is a clear action bar.

**Schedule.** The month picker renders as a mini calendar card with uniform day tiles; weekday/day chips are rounded tiles; the time picker gains a clock glyph.

**Detail.** The action buttons cluster into a pill toolbar and the info grid sits in a card.

**Selectors.** Closed the stray gap between the search input and the option list in the searchable single- and multi-select popovers (model, secrets, events) by overriding the popover's default gap.
