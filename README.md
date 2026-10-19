# YouGame Beta Review

A review site for [yougame.co](https://yougame.co): bugs found in beta testing, design ideas and product improvements, each with screenshots, a plain-language write-up for people, and a copy-ready prompt for coding agents. People mark items fixed, planned or dismissed, and leave notes. Those decisions are saved to [`feedback/decisions.json`](feedback/README.md) in this repository, where future scans read them.

## How it works

| Path | What it is |
| --- | --- |
| `src/` | The React app: Bugs, Design ideas, Improvements and Scan feedback pages, with details in a side drawer. |
| `api/` | Vercel functions: GitHub sign-in, the review data, screenshots, and saving decisions. |
| `server/` | Shared server code: session, GitHub reads and writes, findings on disk. |
| `data/bugs.json`, `data/ux.json` | The findings. Edit them to add, reword or remove items. |
| `data/proposals.json` | Redesigns: one mock that answers several design ideas, listed by id in `ideas`. Ideas in a redesign show inside it instead of on the board. |
| `data/bug-groups.json` | Bug groups: bugs similar enough to fix together, listed by id in `bugs`. They show as one card on the Bugs board, in the column of the most severe bug, and its bugs follow the group's decision unless decided on separately. |
| `data/improvements.json` | Improvements: feature, engagement and creator ideas beyond bugs and design fixes. Same fields as a design idea, plus `effort` (`small`, `medium`, `large`) and `related` (ids it builds on). The tab is hidden when the file is missing or empty. |
| `screenshots/` | Evidence screenshots and redesign mocks, referenced from the JSON. |
| `feedback/decisions.json` | Saved decisions. Written by the site, one commit per save. |
| `sync.py` | Copies fresh findings from the Claude project into `data/` and `screenshots/`. |
| `legacy-index.html` | The original single-page version, kept for reference. |

Only people who can read this repository can sign in, and only people who can push to it can save decisions. Saving a decision commits as that person using their own GitHub sign-in. Commits that only touch `feedback/` don't trigger a redeploy (`ignoreCommand` in `vercel.json`).

## Run it locally

```sh
npm install
npm test
npm run preview:local   # builds, then serves on http://localhost:4173 with an in-memory stand-in for GitHub
```

## Deploy

1. Create a GitHub App (Settings → Developer settings → GitHub Apps) with the callback URL `https://<your-domain>/api/auth/callback`, "Request user authorization (OAuth) during installation" off, and the repository permission **Contents: Read and write**. Install it on this repository only.
2. Import this repository into Vercel. Add the environment variables from `.env.example`: `BASE_URL` (the site's origin), `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (from the GitHub App), and `SESSION_SECRET` (at least 32 random characters, for example from `openssl rand -base64 32`).
