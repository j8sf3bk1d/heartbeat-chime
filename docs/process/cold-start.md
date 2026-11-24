# Cold start for people and agents

To start a new session, open this repository in your preferred agentic development tool and say:

> Existing repo: read the cold-start guidance, then help me start working on Heartbeat.

This workflow is provider-neutral. An agent should:

1. Read [README](../../README.md), [AGENTS.md](../../AGENTS.md), [roadmap](../ROADMAP.md), [current dispatch](../../coordination/current-dispatch.md), [task board](../../coordination/tasks.tsv), and [sync policy](../upstream-sync.md). Use the relevant links there for the task; don't ingest the whole repo by default.
2. Inspect `git status --short`, branch and recent commits. Identify existing work and preserve it. Don't assume a clean tree, a configured remote, a running app, tool availability, or a user's permissions.
3. Summarize the purpose, current state, relevant risks, and an appropriate next step, then follow the user's actual request. If a request is actionable, proceed within that scope; ask only when a missing decision matters. Do not claim tests or reviews you did not perform.
4. For changes, identify the affected storage, audio, desktop, or security boundaries; start with focused checks, then broaden for persistence, native packaging or trust-boundary changes. See [testing](testing.md). Preserve the operator's running app and data; use disposable profiles for destructive tests.
5. Keep the roadmap and dispatch current when decisions or validation change. For simultaneous work, use [coordination](coordination.md); a single contributor can work directly. Record unresolved issues and the next concrete step.
6. Never copy credentials, backups, personal files or third-party assets into the repository. Review source, Git history, rights, dependency notices and release-readiness before configuring a public remote or publishing.

Character creation uses the [creator kit](../character-creator/README.md). If the current agent is Codex and its image-generation capability or skill is available, it can generate and review character assets under the applicable tool instructions. Other agents should inspect their own available image-generation and visual-review capabilities; do not assume a particular provider, product or tool exists. If needed capabilities are absent, explain the gap and proceed with user-provided art or a manifest/checklist instead of claiming generated assets or visual review.

The optional repo-native practices are informed by [Embedded Delivery OS](https://github.com/j8sf3bk1d/embedded-delivery-os). No particular agent platform is required.
