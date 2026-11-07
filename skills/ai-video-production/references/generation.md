# Generation reference

## 1. Cut sheet

One row per cut:

| # | slot (s) | line / beat | intent | camera | action | in → out continuity | refs |
|---|---|---|---|---|---|---|---|

- Slots come from the audio: convert the beat grid to seconds; hook/chorus cuts are short (1.5–3 s), verse cuts 2–3 s, a final shot can be 4 s. A 4-second generated clip is trimmed in the edit, so slots shorter than 4 s are fine. But **the important action must happen in the first 2–2.5 s** (the part the edit will use).
- A shot that fits a lyric line should cover the whole line; plan its action to finish inside the used part.
- Use inserts (hands, screens, windows, objects) between character shots: they are cheap, easy to generate and give the editor rhythm. 25–35 cuts for ~75 s of music is a good density; 13 long cuts was too slow.
- Write the continuity line for every cut (see SKILL.md). Typical gaps: a close-up followed by a wide shot from a different place; a person leaving screen-left and the next shot showing them arriving from the left; a character facing the wrong way relative to the other person's position.
- Plan around what video models cannot do (section 6) before promising it in the sheet.

## 2. References and characters

- Upload every usable reference (identity sheet, gesture sheet, scenes, props, hands) to the tool's project with **descriptive file names**; the tool's asset picker matches by name.
- Create character entries (identity from the sheet) **and** generate a full-body view for each, with realistic proportions and relative height (one taller than the other). Do this before any scene work; do not skip the body step.
- Keep one identity sheet per cast as the primary reference for every image; add a close-up of the face as the second reference when a face matters (profile shots drift most).

## 3. Base images

- Generate with an image model that accepts references; always attach: identity sheet, the scene/background reference, a pose reference, and (for sequels) the previous base image of the same location so the room/street stays identical.
- Prompt skeleton: *shot type and camera height → who/where in frame (left/right third) → action frozen at the start pose → what is in the background with fixed layout → scale statement (door taller than head, feet planted, no prop overlap) → style line (ink-line illustration, palette, flat shading, no photoreal/3D/gloss) → "no text"*.
- State **geometry explicitly in screen terms**: "taxi on screen-right, she faces screen-right". Models mirror left/right and gaze unless told. Gaze and head direction are the most common errors. Check them first on every image.
- Review each image for: face/outfit identity, scale and perspective (a person must not look 150 cm tall next to a door or kerb), feet on the ground, anatomy (two shoulders, hands), prop overlaps, hallucinated text, and exposed/explicit content. Reject with a reason.
- Insert shots (phone, hands, windows) are cheap. Use the lowest reasoning tier; character shots deserve a higher one. Run up to 3 in parallel.
- **End frames.** For any motion whose *direction or end state* matters (a door opening outward, a person stepping to a mark, a phone screen changing) make an end frame as a *minimal edit* of the start frame (attach the start frame as the first reference and say "keep identical: …; change only: …"). Measure that the unchanged regions really did not change (crop and compare mean absolute difference). A "small" edit that also enlarges a doorway makes the video model open the neighbouring window too.

## 4. Video generation (Flow / Omni / Veo style)

- Mode **frames**: start frame (+ optional end frame). Mode ingredients: references only (less controllable). Use frames.
- Settings used in practice: Omni Flash class model, 4 s, 720p preview, 16:9, 1 output per attempt. Read the credit line from the settings popover before every paid action; a 4 s clip cost ~7 credits, 8 s ~12.
- Prompt skeleton: *camera (locked / ≤5 % drift) → the single action in order → what must stay identical (room, signs, the other person) → what must never happen (turning around, new objects, text) → style tail*. End every prompt with a fixed tail, e.g. "Keep the exact hand-drawn ink-line illustration look of the image, flat graphic shading, no morphing, no camera shake, no extra people, no text, no subtitles."
- Camera moves must be tiny: "static, or a push-in of at most 3–5 %". An unqualified "slow push-in" can double a person's size in 4 s.
- **Actions go one way, once.** Say "he turns his head to the right once and holds" or "walks steadily in one direction"; models happily turn and come back, walk in place, or reverse.
- Submit 2–3 prompt variants at once (different wording/seeds), judge them together, keep the best, delete the rest. If none passes, one more round with *changed approach* (e.g. add an end frame) rather than the same prompt again.
- Never click generate twice for the same job; keep a ledger (prompt, time, settings, cost) so a restarted operator can resume instead of re-submitting.

## 5. Flow specifics

See the MCP repo's `docs/FLOW_UI_NOTES.md` for UI mechanics. Operational points:
- Download and upscale: card → download menu → 270p GIF / 720p original / 1080p upscaled / 4K. Choosing 1080p starts a server render (~30 s for 4 s) and the file downloads automatically; 3 concurrent upscales worked, start with 3 and drop to 2 on errors.
- Rename the approved cards to the final names (`Cut01` …), trash everything else, **never empty the trash** (it is the recovery path: a rejected card was later restored because the user preferred it).
- Captions are auto-generated and duplicates are common. Identify a card by caption + prompt and confirm by hashing its 720p download against the file the user approved.
- Every output has a sparkle watermark: leave it.

## 6. Failure catalogue (what went wrong and the fix)

| Symptom | Cause | Fix |
|---|---|---|
| Figure looks tiny/huge next to props; door or kerb impossible | scale not stated, camera too far/low | state heights and camera height; regenerate; check with a person-height rule of thumb |
| Person walks away from the thing they should approach | direction described relative to the frame, but the scene is mirrored | give screen-left/right, add an end frame at the destination |
| Gaze points at camera/away from partner | head direction in start image wrong or unconstrained | fix in the base image first, then video; QC frame by frame |
| Walks in place, then turns and walks back | video model loops locomotion | add an end frame further along; "continuous, one direction, never turns"; accept a short use if only the tempo matters |
| Quick glance (head turn and back) comes out as a full body turn or a 1-second stare | models cannot do fast reversals | split into two clips (A: held look, B: head forward) and hard-cut them in the edit |
| Door/window/neighbouring object also opens or changes | start and end frames differ in the neighbour | make the end frame a pixel-faithful edit; measure unchanged regions |
| Garbled small text on phone screens/signs | video models cannot hold small glyphs while an object changes | shoot the screen as flat chroma green and composite real text locally; keep only large, static glyphs |
| Reflection that should stay faint sharpens mid-clip | model treats it as a subject | anchor both start and end frames with equally faint reflections; measure sharpness (variance of Laplacian) per frame |
| Face turns into another person | identity not pinned in the new base image | pass the identity sheet and a reference face explicitly; compare first/middle/last frames to a known-good frame; hard fail on drift |
| Visible vibration marks / sound effects drawn in the clip | illustration style carried into the video | reject. They cannot be removed in the edit |
| Smoke/steam from breath looks like a cigarette | "exhale" prompts | say "no visible breath, smoke or vapour" |
| Bloom/flare washes out a clip | model adds light leaks | state "no bloom"; otherwise choose the clean part in the edit |
| Another person appears / sign text appears | hallucination | add to the negative tail; QC the background regions against the start frame |

## 7. Green-screen inserts

- Make hand/phone shots with the phone screen as a flat pure green (#00FF00) rectangle, nothing else green in the frame; keep the real background. Then key and track in the edit (see `editing.md`) and render the screen content yourself.
- Verify the green stays uniform across frames (sample pixels); drift or flicker breaks the key.
- The double-tap or press timing in the raw clip may be weak. The screen's on/off timing is set in the composite.

## 8. Delivering to the edit

- Final names: `Cut01.mp4 … CutNN.mp4`; split shots as `Cut22a/Cut22b`. Same resolution/fps for all. Keep the base images (`cutNN_base.png`, `cutNN_end.png`) next to them.
- Tell the editor: which cuts are green-screen inserts, which are two-part shots, which cuts have unavoidable flaws (e.g. "walks in place: use short", "bloom 1.7–3 s"), and the usable window of each cut.
