# YouGame Beta Review

A small review board for [yougame.co](https://yougame.co): bugs found in beta testing and design suggestions, each with a plain-language write-up for people and a copy-ready prompt for coding agents.

## View it

- **Live board (saves statuses and notes):** https://claude.ai/artifact/BcwTUsHBG3joki2KkLrWxr
- **Locally:** run `python3 -m http.server` in this folder and open http://localhost:8000. The local copy is read-only, because saving statuses and notes only works on the live board.

## What's in here

| Path | What it is |
| --- | --- |
| `index.html` | The whole site: one page, no build step, no dependencies. |
| `data/bugs.json` | Bugs. Fields: `id`, `title`, `severity` (critical/high/medium/low), `area`, `url`, `status` (needs_screenshot/verified/fixed), `summary`, `steps`, `expected`, `actual`, `evidence` (`screenshots`, `notes`, `console`), `agent_prompt`. |
| `data/ux.json` | Design ideas. Fields: `id`, `title`, `area`, `priority`, `page_url`, `problem`, `why_it_matters`, `recommendation`, `before_screenshot`, `after_image`, `figma_url`, `agent_prompt`. |
| `screenshots/` | Evidence screenshots and redesign mock images, referenced from the JSON by relative path. |
| `sync.py` | Used by Claude to copy fresh findings from the project into `data/` and `screenshots/`. |

## Editing

Edit the JSON files to add, reword or remove items; the page picks up any field it knows and ignores the rest. Image paths are relative to the repo root. In `index.html`, human-facing content and agent prompts are styled differently on purpose: agent prompts always sit in the dark "for agents" panels.
