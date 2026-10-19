# Feedback for future scans

`decisions.json` is written by the review site every time someone saves a decision on a bug or design idea. Each save is a commit by that person, so the history shows who decided what and when.

```json
{
  "schema": 1,
  "decisions": {
    "BUG-01": {
      "id": "BUG-01",
      "kind": "bug",
      "status": "dismissed",
      "reason": "edge_case",
      "note": "Only shows for signed-out visitors on old builds.",
      "by": "github-login",
      "at": "2026-10-18T17:30:00.000Z"
    }
  }
}
```

| Field | Values |
| --- | --- |
| `kind` | `bug`, `bug_group` (from `data/bug-groups.json`), `idea`, `proposal` (a redesign from `data/proposals.json`), or `improvement` (from `data/improvements.json`) |
| `status` | Bugs and bug groups: `open`, `fixing`, `fixed`, `dismissed`. Design ideas, redesigns and improvements: `open`, `planned` (Will do), `later`, `done`, `dismissed`. An idea with no decision of its own follows its redesign's decision. |
| `reason` | Only when dismissed: `edge_case` (too edge case), `dont_do`, `not_a_problem`, `duplicate`. |
| `note` | Free text from the person deciding. |

## For the YouGame beta-test and UX-critique scans

Read this file before a new scan, together with `data/bugs.json` and `data/ux.json`:

- Don't report a finding again if an earlier one like it was dismissed. Use the reason and note to judge "like it": `edge_case` means findings that only affect rare setups, `dont_do` means a direction the developer has rejected, `not_a_problem` means the behaviour is intended.
- Don't re-report items marked `fixed` or `done` unless you can show they regressed, with fresh evidence.
- Items marked `planned` or `fixing` are in progress; check on them instead of filing duplicates.
- Notes on kept items say what the developer found useful. Lean towards findings like those.
