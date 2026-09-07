# Research

Background surveys produced while designing the CLI rewrite. These are
**evidence, not decisions**: each one gathers facts about prior art or about the
current codebase so that a decision could be made from something better than
intuition.

The decisions themselves live in Linear, and the ones that are hard to reverse
are recorded as ADRs under `docs/architecture/adr/`. Where a survey recommends
something, that recommendation may since have been overridden — read the ADR for
what was actually chosen, and this directory only for why the options looked the
way they did.

| Document | Question it answers |
| --- | --- |
| [`cli-prior-art-trigger-dev.md`](./cli-prior-art-trigger-dev.md) | How a mature CLI with the same `init` / `dev` / `deploy` shape is actually built, read from source rather than docs |
| [`cli-framework-survey.md`](./cli-framework-survey.md) | Which argument-parsing and terminal-UI libraries fit this codebase's constraints, and what each would cost |
| [`acp-harness-classification.md`](./acp-harness-classification.md) | What the Agent Client Protocol actually specifies, and which agent harnesses can be attached to over it |
| [`dev-mode-rendezvous-patterns.md`](./dev-mode-rendezvous-patterns.md) | How other tools let a CLI and a separate long-running application find each other on a developer's machine |

## Caveats

Each document is a point-in-time snapshot with dated version numbers, and the
ecosystems described here move quickly. Verify anything load-bearing before
relying on it.

Several contain corrections to their own earlier passes, kept in place rather
than edited out, because the corrected claim is often the more interesting one.
Where a document contradicts itself, the later section wins.
