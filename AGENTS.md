# AGENTS.md

Working rules for this repo — humans and AI agents alike. `CLAUDE.md` is a symlink to this
file, so there is one source of truth and nothing to keep in sync. Edit this file, never the
symlink.

## What we're building

**Allowance** — a control plane that gives AI agents a capped, network-enforced spending
budget instead of a private key.

**The product spec is `plans/product-spec/latest.md`** — one file, five sections. It is still
being written and changes daily. Read it before proposing anything about the product; don't
re-derive the product from this file, and don't trust a version you read in an earlier
session. Anything under `drafts/` is a proposal, not the spec.

The differentiator: *"Others give the agent a funded wallet and enforce the limit in their own
service. We give the agent zero funds and let consensus enforce the cap."*

## Context

- **Team:** Ido (backend, chain, agents — Claude Code) · Yuval (frontend, UX, docs — Codex).
  One repo, working in parallel, each with their own agents.
- **Timeline:** short — days, not weeks. That's why review is fast, and why nothing blocks on
  approval except the one case called out below.
- **Building blocks:** Hedera (allowances, HTS, HCS, HSS) · World (identity, step-up
  verification) · ENS (agent identity). The Graph is under consideration. Each earns its place
  by doing real work in the product — one we only name in the README isn't a building block.
- **Stage right now: writing the product spec. There is no code, and we are not writing any
  yet.** Everything that lands today is a document. When implementation starts, this file gets
  a code section — added deliberately in its own PR, not improvised mid-task.

## Why the process rules exist

Two people and their agents are changing one repo in parallel, at speed. A readable history is
what makes that survivable: it's how you find the change that broke something, how you recover
from a bad merge, and how a decision made in a hurry can still be explained a week later.

The reverse is what costs you. A day of work landing as one commit is unreviewable,
unbisectable, and impossible to revert in part. Small, well-described changes cost a few
minutes each and save hours exactly once.

## The five rules

1. **One idea per PR.** A PR should be reviewable in under five minutes. Over ~400 changed
   lines, or covering two unrelated things → split it. This applies to documents too: a PR
   that rewrites four docs is four PRs.
2. **Every change goes through a PR.** No direct commits to `main`. Including typo fixes.
3. **Every PR answers why / what / how — at product level and system level.** Not a
   narration of the implementation; the diff already covers that.
4. **Commit continuously** — roughly every 30 minutes of work, and always before switching
   tasks.
5. **Nothing is deleted or renumbered.** Superseded work gets a status header and stays where
   it is. The trail is the evidence.

## Layout

```
plans/
  product-spec/
    latest.md       the agreed spec — "the spec" always means this
    drafts/vN.md    a proposed next version, in progress, safe to churn
    archive/vN.md   superseded versions, frozen
  NNN-slug.md       one work item — a unit of work, owned by one person
docs/               decisions, SDK feedback logs, AI usage — created when first needed
README.md           what it is, how to run it, where each integration lives
```

Create directories when something goes in them. An empty `apps/` sitting in the history is
noise.

## Naming: two kinds of file, two schemes

`plans/` holds two artifacts with different lifecycles. Nearly every naming question is
answered by first deciding which one you're touching.

| | **Product spec** | **Work item** |
|---|---|---|
| Path | `plans/product-spec/latest.md` | `plans/NNN-slug.md` |
| Identity | version `vN`, recorded in its header | number `NNN` |
| Ownership | shared — both of us edit it | one person, by number |
| Ends when | a later version supersedes it | the work is done; the file stays as record |

**Odd/even numbering applies to work items only.** The product spec is co-owned and never
gets an `NNN`.

### Work items — numbered, collision-free by construction

`NNN-slug.md`, zero-padded to three digits.

- **Ido takes odd** — 001, 003, 005…
- **Yuval takes even** — 002, 004, 006…

Two people can create a file in the same second with zero coordination and zero conflicts.
Numbers are never reused and never renumbered.

### Product spec — one file, five sections

A spec version is a single file. Keep it sharp: if a section can't be read in a minute, it's
carrying weight that belongs in a work item.

```
1. Idea                 what it is, in a few sentences
2. Problem ↔ Solution   what's broken today against what changes, plus what it doesn't solve
3. Use cases            the concrete jobs it gets hired for
4. PMF                  who it's for, the differentiation, the competition, what's unvalidated
5. Architecture         flow, layers, policy model, known traps, stack
```

Five sections is the whole spec. Resist adding a sixth — new material almost always belongs
inside one of these, or in a work item if it's execution planning rather than product
thinking.

We both edit this file, so it's where conflicts are likeliest. **Take whole sections**, and
name the ones you touched in the PR.

### Drafts and latest

`latest.md` is the agreed spec. It is what "the spec" means everywhere else in this file, and
what any work item is built against.

**Right now there is no `latest.md`** — the only spec is `drafts/v0.md`, and nothing is agreed
until it's promoted. Until that first promotion, treat the draft as the best current thinking
rather than as settled, and don't build against it.

- A change that **sharpens** it — a typo, a clearer sentence, a resolved open question, a
  corrected claim — goes **straight into `latest.md`**. Don't open a draft for those.
- A change that **redirects** it — the product becomes a different thing, or something already
  built against stops being true — goes into **`drafts/vN.md`**: copy `latest.md`, change it
  there, iterate in as many small PRs as it takes.

Editing a draft never changes what the other person is building against. That is the entire
point of the split — churn freely in a draft, and `latest.md` stays trustworthy.

### Promoting a draft

One PR does the whole swap, so the repo is never in a half-promoted state:

1. `latest.md` → `archive/v<N-1>.md`, with `> Status: superseded by vN` added to its header.
2. `drafts/vN.md` → `latest.md`, with the version and date recorded in its header.

Move the file rather than copy-and-delete it — git records a rename and the diff stays
readable.

**This is the one PR type that blocks on the other person's approval.** Everything else merges
when you're confident; this one changes what we're both building against, so it needs two
people. Expect one or two promotions in total, not five — versions mark changes of direction,
not edits.

Archived versions are never touched again.

### The thread that makes work trackable

Whichever kind of file you're changing, its identity carries through the whole chain:

| | Work item | Product spec |
|---|---|---|
| File | `plans/007-escrow-release.md` | `plans/product-spec/drafts/v1.md` |
| Branch | `007-escrow-release` | `spec/v1-per-service-caps` |
| Commit | `docs(007): name the two failure modes` | `spec(v1): cap spend per service, not per call` |
| PR title | `[007] Escrow release` | `[spec v1] Per-service caps` |

The spec's scope is the version you're editing: the draft's number, or the version `latest.md`
currently holds. A promotion PR is `[spec v1] Promote v1 to latest`.

## Branches and commits

- Branch off `main`, named per the table above. Work with no work item and no spec version —
  repo chores, this file — uses `chore/short-slug` and an empty scope: `chore: ...`.
- Commit format: `type(scope): imperative summary`, where scope is the work-item number
  (`007`) or the spec version (`v1`). Types now: `docs`, `spec`, `chore`. Later: `feat`,
  `fix`, `refactor`, `test`.
- Commit messages explain **why**. The diff explains what.
- **Merge with a merge commit — never squash.** Squashing collapses exactly the small-commit
  history the rules above exist to preserve.
- Never force-push `main`, or any branch someone is reviewing.

## PR description

Write it at two altitudes: **what this means for the product**, and **what it means for the
system**. Line-by-line detail is the diff's job — a description that only narrates the
implementation is missing the half that's actually worth reading.

```markdown
## Spec
Which spec sections this serves — "v0 §2 Problem ↔ Solution", "v0 §5 Architecture". Say
"none" and why if the change isn't spec-driven. If it changes the spec rather than following
it, say that here too, and whether it belongs in `latest.md` or a draft.

## Why
The user need, product decision, or gap that made this necessary — in product terms first.
Then the technical trigger, if there was one. Link the doc or conversation it came from.

## What
Product level: what an operator can now do, or what we now believe about the product.
System level: which parts moved. A bullet each. Not a file list — the diff is the file list.

## How
The shape of the approach: the architecture or model chosen, what it implies for the pieces
around it, and what you considered and rejected. For a spec change, what shifted in our
thinking and why.

## Open questions
What you're unsure about, what you deliberately left out, and what this constrains for
whoever picks up the next piece.
```

Altitude check: *"renamed `getBudget` to `getRemaining`"* is diff noise. *"Budgets are now
expressed as remaining rather than total spent, because the console reads remaining
everywhere and the two were drifting"* is a PR description.

The other person reviews and comments — visible review comments are themselves evidence of
real collaboration. But **don't block a merge waiting for approval**: with two people and a
short timeline that's a bottleneck. Merge when you're confident; a comment can land after.
The single exception is promoting a spec draft to `latest.md`, which needs both of us.

## Working in parallel

Ownership follows the number: if you need to change a work item the other person owns, say so
in the PR description instead of silently rewriting it. A merge conflict late in the build
costs real time. The product spec is the deliberate exception — shared, and a single file.
Take whole sections and name them in the PR.

Anything that crosses the two lanes — a shared contract, an API shape, a data model — gets
agreed in the spec *before* either side builds against it.

## Repo hygiene

This repo is public. Write everything in it — specs, commit messages, PR descriptions, code —
as though a stranger will read it, because one will.

- **No secrets, ever.** `.gitignore` covers the usual suspects. On a public repo a leaked key
  is exploited within minutes, and deleting it in a later commit does not remove it from
  history.
- **No unverified claims about third parties.** Funding figures, compliance certifications,
  and characterisations of a competitor's internals are liabilities if they're wrong, and the
  argument rarely needs them. Cite a source and date it, or leave it out — see the sourcing
  sourcing note in the spec's PMF section.
- **The README points at the exact lines** where each integration lives. A reader shouldn't
  have to grep.
- **Disclose AI use.** Keep `docs/AI-USAGE.md` current from the first code PR: which tools,
  which parts, what was generated versus hand-corrected. Own the architecture — if you can't
  explain a file, it isn't ready to merge.
- **Log SDK friction while it's fresh.** When one of these SDKs fights you, write it up in
  `docs/feedback/<name>.md` the same hour. Written a day later it's vague and useless.

## For agents

- **Read `plans/product-spec/latest.md` before proposing product changes** — not a draft, and
  not a version you remember from an earlier session. It's the output of a long deliberate
  process and it moves daily. A suggestion that contradicts it is welcome, but must say so
  explicitly and argue the case.
- **Git autonomy is scoped by the implementation plan** *(amended by Ido, 2026-07-25, for
  the implementation phase)*. Work that is part of the agreed plan under
  `plans/implementation/` flows without per-step approval: commit and push continuously to
  your own task branch, open the PR, merge it. Small continuous commits are event
  compliance — large single commits risk disqualification. **The plan is the approval
  boundary:** anything outside it still requires explicit human approval, as does any
  change to `plans/product-spec/latest.md`, to the implementation plan itself, or to this
  file. Direct commits to `main` remain forbidden for agents.
- **Don't pad a document to make it look finished.** An honest gap beats confident filler —
  every claim in these docs has to survive someone asking where it came from.
- **Say "I don't know."** Several SDKs here — World AgentKit, Selfie Check, x402 V2,
  `@hiero-ledger/sdk` v4 — are newer than any model's training data. Read the real docs. An
  invented API surface costs more time than a question.
- **Flag slippage early.** If something is taking materially longer than expected, say so
  instead of pushing on quietly. On this timeline a surfaced blocker is worth more than a
  heroic fix.
