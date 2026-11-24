# Coordination for parallel work

Use one owner for integration and bounded tasks with an owner, scope, dependency, touched files, checks and handoff. Check the existing worktree and agree on disjoint files or isolated worktrees before parallel edits. Shared UI, running desktop apps, persistent data, audio devices, credentials and provider quotas are shared resources even across worktrees; coordinate them explicitly. Do not assume that uncommitted work is present in a new worktree.

Record active work and blockers in [current dispatch](../../coordination/current-dispatch.md) and the [task board](../../coordination/tasks.tsv). Each contributor reports the change, validation, limitations, remaining work and exact revision or files. Integrate and review results before marking them complete. Keep this light for sequential work; do not manufacture tasks or agents. Respect the user's instructions and the capabilities and permissions of the actual agent environment.
