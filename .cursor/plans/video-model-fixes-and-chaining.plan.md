---
name: Video Model Fixes + Chaining
overview: Fix 3 existing model bugs and add wan-2.7 models. Chaining research complete — deferred pending consistency solution.
todos:
  - id: fix-seedance-duration
    content: "Fix Seedance 2.0: expose 5-15s picker in models.ts, remove hardcoded duration:5 in generate.ts, add 9/11/13/15 to VALID_DURATIONS"
    status: completed
  - id: add-seedance-fast
    content: Add bytedance/seedance-2.0-fast as a new model option (same schema as Seedance 2.0)
    status: completed
  - id: add-wan-27-models
    content: Add wan-video/wan-2.7-t2v and wan-video/wan-2.7-i2v to models.ts and generate.ts
    status: completed
  - id: chain-workflow
    content: "[DEFERRED] Add video_chain type to GenerationWorkflow: sequential t2v → extract last frame → i2v × N → FFmpeg concat"
    status: cancelled
  - id: chain-route
    content: "[DEFERRED] Add chain_count param to generate route, dispatch video_chain workflow when chain_count > 1"
    status: cancelled
  - id: chain-ui
    content: "[DEFERRED] Add clip chain picker to GenerateVideoButton (1×/2×/4×/6×) shown only for wan-2.7-t2v"
    status: cancelled
isProject: false
---

# Video Model Fixes + Wan 2.7 Chaining

## Status

**Fixes 1–3: shipped** (2026-07-28).
**Chaining: deferred** — research complete, approach documented below for future implementation.

## What shipped

3 bug fixes + 2 new models across 2 files:

- [`frontend/src/lib/models.ts`](../../../frontend/src/lib/models.ts)
- [`backend/src/routes/generate.ts`](../../../backend/src/routes/generate.ts)

---

## Fix 1 — Seedance 2.0 duration bug

**Problem:** Code hardcoded `duration: 5` and hid the picker entirely. Docs confirm 4–15s is supported.

**`frontend/src/lib/models.ts`** — replaced single fixed `5s` with full picker (5/8/10/12/15s) and moved Seedance into `DURATION_MODEL_IDS`.

**`backend/src/routes/generate.ts`** — removed hardcoded `duration: 5` from Seedance's `buildInput`, added 15 to `VALID_DURATIONS`.

---

## Fix 2 — Add `bytedance/seedance-2.0-fast`

Drop-in alongside Seedance 2.0. Same input/output schema, same duration range (5–15s), faster/cheaper.

---

## Fix 3 — Add `wan-video/wan-2.7-t2v` + `wan-video/wan-2.7-i2v`

Both confirmed working via live API test (2026-07-28). Duration 2–15s, 720p/1080p, auto-generates audio.

---

## Chaining — Research Findings (DEFERRED)

### Key findings from live API testing (2026-07-28)

- `wan-video/wan-2.7-t2v` ✓ confirmed working — ~93s generation, $0.50 per 5s clip at 720p
- `wan-video/wan-2.7-i2v` with `first_frame` ✓ confirmed working — ~31s, ~$0.15 per 5s clip
- `wan-video/wan-2.7-i2v` with `first_clip` ✗ consistently fails with E006 ("The input was invalid") on this Replicate-hosted version — the underlying Wan API task fails immediately regardless of URL format or parameter combinations tested
- Visual consistency issue: `first_frame` chaining causes character drift (e.g. brown dog → black & white dog) because each clip only sees one boundary frame, not the full clip context

### Better alternative for when chaining is implemented: LTX 2.3 Pro `extend`

Already integrated. Takes the full previous video as context (not just a frame), so character/style consistency is guaranteed. Adds up to 20s per extend call.

```
Generate 10s clip (LTX 2.3 Pro text_to_video)
  → extend +20s (sees full 10s context)
  → extend +20s
  → ...
```

Recommended over Wan 2.7 frame-extraction chaining when consistency matters.

### Wan 2.7 chaining approach (low-cost, accepts some drift)

New workflow type to add to `backend/src/workflows/generation.ts`:

```ts
{
  type: 'video_chain';
  assetId: string;
  workspaceId: string;
  r2KeyPrefix: string;
  prompts: string[];      // one prompt per clip
  clipDuration: number;   // seconds per clip (2-15)
  aspectRatio: string;
}
```

Steps:
```
step 1: generate clip 1  →  wan-2.7-t2v  →  store in R2 as clip_0.mp4
step 2: extract last frame from clip_0.mp4 via FFmpeg WASM  →  R2 as clip_0_lastframe.jpg
step 3: generate clip 2  →  wan-2.7-i2v (first_frame=clip_0_lastframe)  →  R2 as clip_1.mp4
step 4: extract last frame from clip_1.mp4  →  R2 as clip_1_lastframe.jpg
...repeat for N clips...
final step: concatenate all clip_N.mp4 via FFmpeg WASM  →  R2 as final.mp4
```

Frame extraction (`ffmpeg -sseof -0.1 -i input.mp4 -frames:v 1 frame.jpg`) is well under the 30s Workers CPU limit.

Route change: add `chain_count` (2–24) to the generate request body. When `chain_count > 1` and model is `wan-2.7-t2v`, dispatch `video_chain` workflow instead of single `video`.

UI: show a chain picker (1×/2×/4×/6× = 5s/10s/20s/30s) in `GenerateVideoButton` only when `wan-2.7-t2v` is selected.

### Estimated costs per chain length (at 720p)

| Clips | Duration | Est. cost |
|---|---|---|
| 1 | 5s | ~$0.50 |
| 4 | 20s | ~$0.95 |
| 6 | 30s | ~$1.25 |
| 24 | 2 min | ~$3.95 |
