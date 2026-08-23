# RAPOMAN cloud publisher bootstrap

Purpose: move RAPOMAN publishing off Vivid so ChatGPT mobile can queue an article and GitHub Actions publishes it to Hatena Blog.

Target private repo: `rapoman-cloud-publisher`.

Required repository secrets:
- `HATENA_ID`
- `HATENA_API_KEY`

Runtime flow:
1. ChatGPT creates `queue/<slug>.json` containing title, body HTML, categories, ISBN and official domain.
2. Push triggers GitHub Actions.
3. Worker validates body, affiliate ID, first-volume link, PR labels, bottom banner and official link.
4. Worker creates a Hatena draft through AtomPub.
5. Worker GETs the draft back and requires exact title/body match.
6. Worker publishes only after the match passes.
7. Worker fetches the public URL and performs the final audit.
8. On public-audit failure, worker rolls the entry back to draft.
9. Result is written to `results/<slug>.json` and committed using `GITHUB_TOKEN`.

Security:
- Never commit the Hatena API key.
- Secrets are read only from GitHub Actions repository secrets.
- The result commit uses `GITHUB_TOKEN`; GitHub documents that ordinary events caused by this token do not recursively trigger new workflow runs.

Files in this template are deliberately not placed under `.github/workflows/` here, so this public bootstrap branch cannot execute with credentials.