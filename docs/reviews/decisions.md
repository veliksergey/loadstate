# Review decisions

One row per Codex finding that was **rejected**, so the next review does not
re-litigate it. Accepted findings need no row — the fix and its regression test
are the record.

Add a row only with concrete evidence: a code path, test output, or primary
documentation. "We meant it that way" is not evidence.

| Date | Finding | Severity claimed | Decision | Evidence |
|---|---|---|---|---|

If the same finding is raised a third time, that is a signal the repository's
`AGENTS.md` is missing a fact, not that the reviewer is wrong. Fix the
instructions instead of adding another row.
