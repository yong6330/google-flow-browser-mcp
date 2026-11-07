# Orchestration reference

How to keep a long AI-video project moving without burning your own context.

## Roles

- **You (supervisor):** cut sheet, prompts and specs, decisions, review of contact sheets and written reports, local clean-up, hand-offs, honest reporting.
- **Operator(s):** a CLI agent (e.g. Codex CLI) for image generation and for clicking through the generation tool; scripts (Playwright over CDP) for downloads, renaming, trashing, upscaling.
- **Editor:** a separate session/script with its own context; requests for new shots come back to you with cut number, window and continuity.

## Delegating to Codex CLI

```bash
codex exec -m <model> -c 'model_reasoning_effort="low|medium|high"' -s workspace-write \
  -c 'sandbox_workspace_write.network_access=true' --skip-git-repo-check -C <project-dir> \
  [-i reference.png ...] - < task.txt > run.log 2>&1 &
```
- Models and tiers vary per account: list them in `~/.codex/models_cache.json`; an unsupported model returns an explicit error. Start cheap (low tier for inserts and image jobs), raise the tier **only after asking the user** and only for cuts that failed at the cheaper tier. Update the CLI if a new model is refused.
- Give an operator a **self-contained task file**: absolute project path and "never write outside it", exact settings, the current state (what exists, what is already approved/rejected), numbered tasks, QC format, cleanup rules, and a required final report written to a file *and* printed. Add "stop and write the partial status first if anything fails".
- Image jobs: up to 3 in parallel (a Python helper with a thread pool); each job saves to a named path; check the file exists rather than trusting the message.
- Operators work best with a **resumable state file** and a **ledger**; tell them never to submit a paid job twice and to check the tool's UI for in-flight jobs before retrying.
- Inside a sandbox, Chrome may crash at launch (Crashpad permission): start Chrome yourself from a normal shell with a CDP port and a dedicated profile, then let the operator attach.
- If a delegated run is interrupted, read its ledger and the tool UI before restarting, and tell the new run what was already submitted.
- When an operator's "pass" disagrees with the user's eyes, treat the QC criteria as wrong and rewrite them (more frames, numeric checks), then re-run — do not argue the verdict.
- If the same step fails three times in a row, take over, find the root cause yourself, fix the script, then hand the job back.

## Parallelism and cost

- Generation: 3 jobs at a time. Upscale: start with 3 concurrent tabs; fall back to 2 on errors. Heavy local renders: one at a time (laptop heat).
- Read the cost line before every paid step; keep a credit floor; do one clip end-to-end to learn the real price before a batch. Daily free credits are spent first.
- Do not generate speculative extra variants beyond what the plan needs (2–3 per shot per round, at most 2 rounds).

## Clean-up routine (run after every phase)

1. Delete rejected clips, candidates, contact sheets, QC images, logs, extracted zips, helper scripts that were one-offs.
2. Keep: final clips, base/end frames, reusable scripts, the cut sheet, the ledger until the project ends.
3. Check: the project folder contains only what you made; the user's Downloads folder has no strays; nothing outside the project folder was created.
4. Browser tool: confirm the generation project contains only valid cards; rejected ones are in its trash (not emptied).
5. Move approved-but-low-res previews to the system trash after the final files are verified.

## Cross-session hand-offs

- A request from another session ("regenerate cut N") may reflect the user's wish; confirm the scope from the message, do the work, keep the old file until the user approves the replacement, then replace and notify the sender with path, spec, what was verified and what was not.
- Send concise messages: first line states the point; give paths and numbers; do not paste long logs.
- Never use another session to bypass something your own session cannot do.

## Memory

Record durable decisions (approved looks, quirks of cuts, the edit pipeline, the user's style rules, tool setup) in project memory so a new session can resume without re-asking.
