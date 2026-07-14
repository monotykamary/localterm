# syntax=docker/dockerfile:1
# Minimal image for the foreground-hook e2e (harness/fish-hook/run.mjs). Only
# fish is needed: the test feeds the real hook script (extracted from
# session.ts) to an interactive fish over a pty and asserts the OSC 7777
# fg/fg-idle sequences appear in the raw output.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fish \
    && rm -rf /var/lib/apt/lists/*
