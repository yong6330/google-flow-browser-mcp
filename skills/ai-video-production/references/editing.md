# Editing reference (Python + FFmpeg, no Adobe)

Rules marked ✔ were confirmed by the user during a real project; ✘ were rejected.

## 1. Pipeline structure

- **One script, one cut table.** A single `edit.py OUT [T0 T1]` reads a cut table (clip, source start, start beat, end beat) as the only timeline source. Rendering is a frame loop (numpy compositing) piped into FFmpeg. Benefits: beat math, subtitles, typography, composites and grading reproduce from one place; partial renders (`T0 T1`) make quick tests; one option generates a derivative (`--vertical` 9:16, `--short` under 60 s). Cost: slow (≈6–7 min for 81 s FHD) and ordering bugs become on-screen bugs.
- Before rendering any derivative **assert**: frames used = frames expected, subtitle windows do not overlap, and a changed start point also moves the previous cut's end (overlapping cuts put the previous cut in the first frame and shift audio sync).
- **Beat snapping.** Keep BPM, first-beat time and the downbeat rule as constants; write cut boundaries as beat numbers: `t(n) = first_beat + n × period`. Cuts land on a bar's first beat; a lyric pick-up (half a beat early) pulls the cut half a beat earlier. Verify word timings in the lyric file against the vocal energy envelope. A first word was found attached to beat 0 incorrectly.
- Keep the clips' **native frame rate** (24 fps) in the output; converting to 30 fps duplicates frames and judders. Keep playback speed 1.0.
- Make cuts and effects by **frame index**, not rounded seconds, so an effect never lands a frame late.

## 2. Subtitles and typography

✔ Bottom subtitles: small italic serif line number in the accent colour + light sans text; each word brightens as it is sung; clear drop shadow on all text; a soft shadow band behind subtitles on bright frames; the subtitle appears with the first word and **stays until the next line starts** (never disappears before the singer finishes).
✔ On-screen typography: at most one per cut; a meaningful word or phrase; placed in empty space away from faces and the main action. If on-screen type carries a lyric line it must carry the **whole line**, and that line gets **no** bottom subtitle.
✔ Chorus keywords land on the beat word by word; a verdict device ties subtitle and motion together (e.g. one word gets a white underline, its opposite a red strike-through).
✔ Strong effects (glass crack, flash) only where the meaning fits, slightly larger than the word and **behind** it, in natural colours. Big and flashy was rejected.
✘ Syllable-split type, the same sentence as subtitle and type, small corner tags, fake-perspective 3D lettering, tearing transitions, excessive whip effects.
- 9:16: subtitles sit above the bottom ~20 % (platform description/buttons) with wide side margins; avoid the top menu band.
- When trying a new type style, render a **short style test first** and show it before any full render. Study references before inventing.
- Subtitle wording comes from the source lyrics/script **verbatim**. Check the lyric file's tokenisation: a word split into two tokens (e.g. a particle separated from its stem) shows up as a wrong space on screen.

## 3. Compositing and transitions

- **Green-screen phone screens:** per-frame rectangle estimation jumps when a thumb crosses; track the **bezel rim** instead (e.g. ICP on the rim), or lock a single quad if the phone is static. Render the screen graphics yourself (real Korean/English glyphs, crisp); never use AI-rendered text. The thumb stays in front (mask by the key). Remove green fringes (feather only the key edge, despill the thumb and bezel). Screen timing (on/off, lock → call → missed call) is authored in the composite.
- **Two-clip shots (head turn A→B):** hard cut plus a 1–2 frame smear. Cross-blending shows two faces. Stop clip B before any unwanted motion appears.
- **Camera shake:** measure sub-pixel frame-to-frame shake per clip and remove only the high-frequency part (keep slow camera moves).
- Bloom/flare or other flaws noted by generation: pick the clean window or trim.
- A clip that walks in place: use it short, on the beat; do not slow it down.

## 4. Grade and encode

- Output fps = source fps; BT.709 conversion with colour tags (h264_metadata), `+faststart`.
- Light, consistent grade: per-clip levels, split-tone, subtle red halation, light sharpen. Show a before/after still of a few cuts before applying it to the whole piece.
- **Never cover or remove** the AI-provenance sparkle. Credit AI use on the end card (e.g. "AI FILM").
- Keep intentional tight crops in derivatives; unzoom only awkward ones.

## 5. Delivery order

1. FHD render → check the finished file frame by frame (cut points, subtitle starts/ends, effects, composites, the first and last second, audio sync).
2. Report with a contact sheet; wait for approval.
3. Only then 4K (Lanczos upscale was accepted for platform quality assignment; AI upscalers were not available). **Never chained to the FHD render**.
4. Derivatives (vertical/short) follow the same FHD → check → approve → 4K order. Run heavy renders one at a time; parallel FHD only with permission.
5. Thumbnails, if requested, are separate deliverables.
6. Before saying "fixed", look at that exact segment in the **finished** file. Claims made without that check were corrected twice.

## 6. When editing needs a new shot

Ask generation for it with: the cut number, the slot and the **used window** (e.g. first 2.3 s), the continuity in/out, what must not happen, and the approval rule (the user confirms before the old cut is replaced). Prevent most of these at the cut-sheet stage by writing one line per cut: previous cut's end state → this cut → next cut's start state, and keep the needed action inside the window the edit will use. Typical reasons: a cut that does not connect to its neighbours (design the reverse angle of the next shot in advance), one lyric line spread over two disconnected shots, motion that reverses inside a clip, drawn effect marks or text baked into a clip.
