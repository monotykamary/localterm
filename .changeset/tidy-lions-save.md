---
"@monotykamary/localterm-server": minor
---

Raise MAX_PROCESS_REQUESTED_SECRETS from 32 to MAX_SECRETS (64) so a process or automation can reference every configured secret — previously a process with 31 secrets wired (e.g. `pi`) failed to save with a 400 as soon as two more secrets were selected, and the UI collapsed every rejection into one misleading "check the binary name" message.

The terminal UI now surfaces the server's error code per failure mode (invalid_name / invalid_body / invalid_secret / capacity / unreachable), pre-validates the count before submitting, and the shared SecretSelector shows a selected/limit counter and blocks adds at the cap for both the processes and automations forms.
