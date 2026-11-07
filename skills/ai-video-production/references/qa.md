# QA reference

## Method

- Extract **16–20 frames evenly** (including first and last) per clip and look at them as a sequence; add a 4-frame contact sheet for the user. For fast actions (blink, tap, buzz) extract 48 frames from the relevant second. Four frames per clip miss most defects.
- Compare regions numerically when judging "did X change": crop a region (window, sign, background wall, a person) in the first and later frames and compute mean absolute difference or SSIM; for sharpness use variance of the Laplacian. State the numbers.
- Check the **start/end relation**: does the clip begin and end where the cut sheet's continuity line says?
- Check identity against a *known-good* frame (a base image or an approved clip), not against memory.
- Verify files with `ffprobe` (codec, size, fps, duration) and compare a mid frame of the upscaled file, downscaled, with the preview (SSIM ≳ 0.8 means the same clip; different clips are far lower).

## Checklist per clip

1. **Direction**: motion goes the intended way; no reversal, no turning back, no walking in place; gaze and head point where the sheet says.
2. **Identity**: face, hair, accessories, outfit unchanged from first to last frame.
3. **Scale and perspective**: people keep relative height; feet planted; a person moving away shrinks smoothly; no sinking, no overlap with props.
4. **Anatomy**: two arms/shoulders, hands with right finger count, sleeves put on correctly (jackets, doors).
5. **Background integrity**: nothing appears or vanishes (signs, windows, objects, people, text); neighbouring elements of the moving object stay closed/unchanged.
6. **Camera**: locked or ≤5 % drift; no shake, no zoom into faces.
7. **Required action** happens, at the right time (inside the part the edit will use), once.
8. **Style**: line quality and palette preserved; no 3D/gloss, no drawn effect marks, no text, no subtitles.
9. **Content**: nothing explicit; no brand marks.
10. **Edit usability**: note the clean window (e.g. "usable 0–2.5 s") and flaws the editor should avoid.

## Reporting format

A table per clip with one short observation per checklist item, attempts used, credits, and an honest verdict. Write "could not verify" where you could not (e.g. feet out of frame). Never write PASS if any hard-fail item (identity drift, wrong direction, new object/text, garbled text) is unresolved. When delegating QA to an operator, ask for exactly this table and spot-check one or two of its PASS claims yourself from the frames.

## Why the checks are strict

In the source project an operator marked several clips PASS that the user then rejected within seconds of playing them (walking in place, wrong door direction, a window opening with the door, a reflection that sharpened). Frame sequences and numbers prevent most of these.
