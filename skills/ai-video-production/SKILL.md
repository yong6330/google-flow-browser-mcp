---
name: ai-video-production
description: End-to-end workflow for producing a video from AI-generated clips (Google Flow / Veo / Omni style tools) plus local editing with Python and FFmpeg. Covers the cut sheet, reference and base images, start/end-frame video generation, frame-by-frame QA, upscaling, file naming, delegating work to Codex CLI, and the hand-off to editing (beat-synced cuts, subtitles, typography, grading, delivery). Use when the user wants to make a music video, short film, ad or any clip-based video with AI-generated footage, asks to generate or regenerate a shot, review AI clips, upscale or organize them, or edit them together without Adobe tools.
---

# AI video production

A pipeline that turns a concept into a finished video from AI-generated clips. It was distilled from a 30-cut music video made with Google Flow (via the `google-flow-browser-mcp` server) and edited with Python + FFmpeg. Everything here is generalised; adapt names and numbers to the project.

Read the reference files only when you reach that stage:
- `references/generation.md`: cut sheet, base images, video generation, Flow specifics, delegating to Codex CLI, failure catalogue
- `references/qa.md`: frame-by-frame review checklist and how to report
- `references/editing.md`: beat-synced edit, subtitles/typography, grading, delivery, 9:16
- `references/orchestration.md`: how to supervise operators, parallel jobs, credits, cleanup, cross-session hand-offs

## Non-negotiables

1. **Intent before pixels.** Write the cut sheet first and get it confirmed. For every cut note the *intent* (what the viewer should feel/understand). The user judges OK/not-OK by intent, so you must be able to state it when asked.
2. **Continuity is designed, not hoped for.** For each cut write one line each: previous cut's end state → this cut → next cut's start state (viewpoint, who is visible, direction of movement, which side things are on). Most "regenerate this" requests during editing are continuity gaps that were visible in the sheet.
3. **Look-development one cut at a time, production in parallel.** Until the style, characters and scale are accepted, show each base image and get approval. After that run up to 3 jobs in parallel.
4. **Verify before spending, verify before claiming.** Paid steps (generation, upscale) start only after the settings and cost are known. Never report a clip, image or fix as good without looking at frames from the final file. "Passed" from an operator is a claim, not evidence.
5. **FHD before 4K.** Render and approve the 1080p/FHD version first; only then upscale to 4K. Never chain the two in one job.
6. **Delete rejected material immediately.** No `old/` folders. Keep one clearly named final file per shot plus the inputs needed to regenerate it.
7. **Stay inside the project folder.** Temp files, downloads and caches go inside it; check the user's Downloads folder for strays after browser work.
8. **Do not remove or cover AI-provenance watermarks.** Plan the framing around them or leave them.
9. **Say what you changed and what you did not check.** Be plain about failures, partial results and unverified parts.

## Pipeline

| Stage | Output | Gate |
|---|---|---|
| 0. Brief | concept, audience, length, aspect, deliverables, protagonist, what must never happen | user confirms |
| 1. Cut sheet | table: cut no., time slot, line/beat, intent, camera, action, continuity in/out, reference images | user confirms |
| 2. References | uploaded to the generation tool with descriptive names | all attached in the tool |
| 3. Characters | identity sheet(s) and character entries incl. full-body | face/outfit/scale consistent |
| 4. Base images | one start frame per cut (end frame where the motion needs it) | user approves look first, then batch |
| 5. Video | one 4-second-class clip per cut, preview resolution | frame-sequence QA passed |
| 6. Finalise | rename, upscale approved clips to 1080p, place finals, trash the rest | files verified by probe + similarity to the preview |
| 7. Edit | beat-synced cut, subtitles, typography, composite inserts, grade | frame-by-frame check of the render |
| 8. Deliver | FHD master → user OK → 4K/derivatives | user approval at each step |

## How to work with the user

- Show the cut sheet and the first few base images before bulk work; show contact sheets, not 30 separate images.
- When the user flags a problem, restate the cause in one sentence, say what you will change, then change it. When you find your own mistake say so directly.
- When asked "what was the intent of cut N?" answer from the sheet; if the intent was unclear, say that and propose it.
- Keep your own context small during long runs: delegate repetitive operation (image generation, Flow clicking, downloading) to an operator and supervise with contact sheets and written reports.

## Tools this skill assumes (substitute equivalents)

- A generation tool: Google Flow through the `google-flow-browser-mcp` MCP server, or its scripts, or manual use.
- An image generator for base images (Codex CLI image tool, Nano Banana, etc.).
- Python (with numpy, Pillow, OpenCV) and FFmpeg/ffprobe for edit and QA.
- Optional: another CLI agent (Codex) as an operator: see `references/orchestration.md`.
