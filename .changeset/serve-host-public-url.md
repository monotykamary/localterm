---
"@monotykamary/localterm-server": patch
---

Accept the `tailscale serve` Host on a loopback bind by trusting the surface origin the CLI resolved via `setPublicUrl`. The network-policy host check previously only allowed loopback names / private IP literals / `.localhost`, so a request fronted by `tailscale serve` — which preserves the MagicDNS `Host` header — was rejected with `forbidden: host not allowed`. Under userspace-networking tailscaled there is no host `100.x` interface to bind, so `serve → localhost:<port>` is the only ingress; this makes that surface reachable by its DNS name (no IP-literal + cert-name-mismatch workaround needed). The check also extends to the `Origin` header for same-origin browser/WS requests, and still rejects unrelated DNS names and cross-origin requests from public sites.
