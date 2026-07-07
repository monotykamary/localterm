---
"@monotykamary/localterm": minor
---

Make the session picker browser-profile aware. Each row's attached clients now
group by profile and render as a dot cluster — one solid dot per peer, your
profile in the foreground color and each other profile in a stable hue, dots
within a profile touching with a wider gap between profiles — so a glance reads
"two of mine, one of another profile." A dormant shell (no viewers) shows a
single hollow dot, and beyond five peers the tail collapses to "+N". The shell
name and pid are dropped from each row to give the title the freed room, and
within each activity tier this profile's sessions float above other profiles'.
