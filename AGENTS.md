# Project guidelines

_Add your project-level guidelines here._

<!-- thrifty:skills:begin (managed by thrifty; do not edit inside markers) -->
## Agent Skills (Thrifty)

This repository may have been set up with **Thrifty**, a per-developer agent workflow harness. Thrifty installs its skills into your working copy and git-ignores them, so they are intentionally **not committed**.

- If `.agents/thrifty-skills.md` exists, read it and treat its contents as part of these instructions — it lists the skills installed in this working copy and when to use them.
- If `.agents/thrifty-skills.md` does **not** exist at exactly that path, Thrifty is not installed here (or only partially). Continue the task normally **without** any Thrifty skills: do not look for the file elsewhere, do not try to install anything, and do not treat its absence as an error or a blocker.
<!-- thrifty:skills:end -->

<!-- thrifty:operating-rules:begin (managed by thrifty; do not edit inside markers) -->
## Operating rules (Thrifty)

This repository may be set up with **Thrifty**, a per-developer agent workflow harness. Its operating rules (scope contract + security posture) are installed locally and git-ignored, so they are intentionally **not committed**.

- If `.agents/thrifty-operating-rules.md` exists, read it and treat its contents as part of these instructions.
- Anything written directly in this file ALWAYS overrides that doc wherever they conflict.
- If `.agents/thrifty-operating-rules.md` does **not** exist, Thrifty is not installed here. Continue normally without it: do not look for the file elsewhere, and do not treat its absence as an error or a blocker.
<!-- thrifty:operating-rules:end -->
