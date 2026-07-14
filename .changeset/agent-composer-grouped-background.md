---
"@monotykamary/localterm": patch
---

Make the agent composer's background match the grouped form cards so the prompt
input and the model/effort/session pickers read as one cohesive ChatGPT-style
chat area instead of a separate raised white card.

The composer now uses the same `bg-foreground/[0.02]` tint as the surrounding
`FormSection` and Harness cards and drops its resting drop shadow (the grouped
cards are flat), keeping the focus-within border + shadow as the input's active
affordance.
