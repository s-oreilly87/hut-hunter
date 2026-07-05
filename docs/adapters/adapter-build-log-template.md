# Adapter Build Log — template

This is the per-step logging template used for every step of a new-site adapter
build (HH-94). The canonical, running log lives as the **Adapter Build Log**
document in the Linear project; this file is the reusable template and the
in-repo copy of the conventions.

The build log is the **primary input to the Agentic Adapter Builder** project —
treat each entry as a deliverable, not overhead. The point is to capture, per
step, what generalizes to *any* Camis site (or any booking site) versus what was
site-specific, and which agent/approach actually got the step done. That is the
raw material the pipeline spec (HH-107) is distilled from.

## How to use

- Add one entry per meaningful step (recon, scrape, scaffold, flow impl, E2E, fix).
- Keep entries terse but concrete — real endpoints, selectors, timings, errors.
- Tag each step's **Generalizable?** honestly; it drives the pipeline design.
- When a step maps to a Linear issue, reference it as `HH-<n>`.

## Entry template

```
### <YYYY-MM-DD> — <step title>  (HH-<n>)

**Goal:** <what this step was trying to produce>

**What we did:** <concrete actions, endpoints hit, files written>

**Agent(s):**
- <agent/approach> — <succeeded | failed> — <why; what it was good/bad at>

**Blockers & workarounds:** <what broke, how it was gotten around; "none" if clean>

**Time spent:** <rough wall-clock>

**Outputs / artifacts:** <files, JSON catalogs, snapshots, PRs>

**Generalizable?** <site-specific | generalizable to any Camis site | generalizable to any booking site> — <one line why>

**Open items:** <anything deferred; link the issue that will resolve it>
```

## Fields at a glance

| Field | Why it's captured |
|---|---|
| Goal | Lets the pipeline spec define this stage's expected output |
| What we did | The reproducible action — becomes stage instructions |
| Agent(s) + success/failure | Which agent to assign this stage to in the automated pipeline |
| Blockers & workarounds | Human-in-the-loop points; failure modes to guard against |
| Time spent | Measures the payoff of config-driven reuse (BC vs Ontario delta is the headline metric) |
| Outputs / artifacts | Stage inputs/outputs for the pipeline DAG |
| Generalizable? | The core split: base adapter vs per-site config vs per-platform |
| Open items | Keeps deferred work from being lost between milestones |
