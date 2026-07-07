---
"@monotykamary/localterm": patch
---

Space the session picker's peer-dot colors so two browser profiles can't render
as the same hue. The per-id hue hash could map two profile uuids to ~12° apart
(both purple), making a third client invisible; the dots now take hues from a
golden-angle sequence ranked across every profile visible in the picker, which
spaces any N near-optimally around the wheel.
