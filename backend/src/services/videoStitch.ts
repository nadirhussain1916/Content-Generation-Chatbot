import { getSandbox } from '@cloudflare/sandbox';
import type { CloudflareBindings } from '../env';
import { getPublicUrl } from './r2';
import { Logger } from '../utils/Logger';

// ─── FFmpeg-in-a-container video stitching ────────────────────────────────────
//
// Native binaries can't run in a Worker, so all ffmpeg work happens inside a
// Cloudflare Sandbox container (see wrangler.jsonc `containers` + Dockerfile).
// The Worker drives the sandbox with `exec`/`writeFile` and persists results to R2.
// Two primitives back all three long-video flows:
//   • concatClips     — normalize N clips to a common format and concatenate
//   • extractLastFrame — pull the final frame of a clip (seeds chained i2v chunks)
//
// OUTPUT HANDLING — the ffmpeg artifact is written straight to R2 by mounting the
// ASSETS bucket into the container (credential-less R2 egress mount) and `cp`-ing
// the result onto the mount. This keeps the (potentially large) MP4 out of Worker
// memory entirely — nothing is read back through the isolate. If the mount is
// unavailable at runtime we fall back to reading the bytes back and PUT-ing them
// (the previous behaviour), so stitching still works, just less memory-efficiently.

/** R2 binding name (see wrangler.jsonc r2_buckets[].binding). The egress mount
 *  resolves `env[R2_BINDING]`, so this MUST match the binding name exactly. */
const R2_BINDING = 'ASSETS';
/** Mount point inside the container for the ASSETS bucket. */
const R2_MOUNT = '/r2';

type Dimensions = { w: number; h: number };

function dimsFor(aspectRatio: '16:9' | '9:16'): Dimensions {
  return aspectRatio === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
}

/**
 * Bash script that downloads each clip, normalizes it to a uniform
 * resolution / fps / SAR / pixel-format (padding to preserve aspect ratio) and a
 * guaranteed stereo audio track (silent when the source has none), then concatenates
 * the normalized clips with the concat demuxer. Normalizing first makes the inputs
 * uniform, so heterogeneous clips (different models / aspect ratios / audio) stitch
 * cleanly — this is what makes "combine my existing clips" (Flow B) robust.
 *
 * The final artifact is produced locally then `cp`-ed to `$1` (the output path,
 * which is a file on the R2 mount when mounted). A single sequential copy is the
 * friendliest write pattern for the s3fs-backed mount.
 */
function buildConcatScript(w: number, h: number): string {
  const vf =
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
  return `#!/usr/bin/env bash
set -euo pipefail
cd /work
OUT="$1"
i=0
: > concat.txt
while IFS= read -r url; do
  [ -z "$url" ] && continue
  raw="raw_\${i}.mp4"
  norm="norm_\${i}.mp4"
  curl -fsSL "$url" -o "$raw"
  if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$raw" | grep -q .; then
    ffmpeg -y -i "$raw" \
      -vf "${vf}" \
      -c:v libx264 -preset veryfast -crf 18 -c:a aac -ar 48000 -ac 2 "$norm"
  else
    ffmpeg -y -i "$raw" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
      -vf "${vf}" \
      -map 0:v:0 -map 1:a:0 -shortest \
      -c:v libx264 -preset veryfast -crf 18 -c:a aac -ar 48000 -ac 2 "$norm"
  fi
  echo "file '\${norm}'" >> concat.txt
  i=$((i+1))
done < urls.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy -movflags +faststart _out.mp4
cp _out.mp4 "$OUT"
`;
}

/** Extract the final frame of src.mp4 as a PNG, then `cp` it to `$1`. */
const FRAME_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
cd /work
OUT="$1"
curl -fsSL "$(cat src_url.txt)" -o src.mp4
ffmpeg -y -sseof -1 -i src.mp4 -update 1 -frames:v 1 -q:v 2 _last.png
cp _last.png "$OUT"
`;

/** Where the artifact ended up + how it got there. `mounted` is true when it was
 *  written straight to R2 via the egress mount, false when we fell back to reading
 *  the bytes back through the Worker. Surfaced so callers (e.g. the admin stitch
 *  test harness) can confirm the live mount path is actually being taken. */
export type StitchResult = { mounted: boolean; sizeBytes: number };

/**
 * Run one ffmpeg job in a short-lived sandbox and land the artifact in R2 at
 * `outKey`. Prefers a direct-to-R2 write via the credential-less egress mount;
 * falls back to reading the bytes back through the Worker if the mount fails.
 */
async function runJob(
  env: CloudflareBindings,
  opts: {
    sandboxId: string;
    files: Record<string, string>;
    scriptPath: string;
    outKey: string;
    contentType: string;
    label: string;
  },
): Promise<StitchResult> {
  // Pin the RPC transport: the fallback read-back uses `encoding: 'none'` streaming,
  // which is only supported on the rpc transport (HTTP/WS throw). RPC is also the
  // right choice for large binary I/O generally.
  const sandbox = getSandbox(env.Sandbox, opts.sandboxId, { transport: 'rpc' });
  // Split the key into its parent prefix + filename so we can mount the prefix and
  // write the bare filename at the mount root (avoids creating dir-marker objects).
  const slash = opts.outKey.lastIndexOf('/');
  const dir = slash >= 0 ? opts.outKey.slice(0, slash) : '';
  const base = slash >= 0 ? opts.outKey.slice(slash + 1) : opts.outKey;

  try {
    await sandbox.mkdir('/work', { recursive: true });
    for (const [path, content] of Object.entries(opts.files)) {
      await sandbox.writeFile(path, content);
    }

    // Preferred path: mount ASSETS (credential-less R2 egress) so ffmpeg's output is
    // streamed straight to R2 by s3fs — the file never enters Worker memory. s3fs sets
    // the object Content-Type from the file extension via /etc/mime.types (provided by
    // the `media-types` package in the Dockerfile), so .mp4/.png land with correct types.
    let mounted = false;
    try {
      await sandbox.mountBucket(R2_BINDING, R2_MOUNT, dir ? { prefix: `/${dir}` } : {});
      mounted = true;
    } catch (err) {
      Logger.log('VideoStitchMountUnavailable', { label: opts.label, sandboxId: opts.sandboxId, error: String(err) });
    }

    const outPath = mounted ? `${R2_MOUNT}/${base}` : '/work/out.bin';
    const res = await sandbox.exec(`bash ${opts.scriptPath} ${JSON.stringify(outPath)}`);
    if (!res.success) {
      Logger.log('VideoStitchFfmpegFailed', { label: opts.label, sandboxId: opts.sandboxId, exitCode: res.exitCode, stderr: res.stderr.slice(-2000) });
      throw new Error(`ffmpeg ${opts.label} failed (exit ${res.exitCode}): ${res.stderr.slice(-500)}`);
    }

    if (mounted) {
      // Unmount blocks until pending s3fs uploads flush; then confirm the object landed.
      try {
        await sandbox.unmountBucket(R2_MOUNT);
      } catch (err) {
        Logger.log('VideoStitchUnmountFailed', { label: opts.label, sandboxId: opts.sandboxId, error: String(err) });
      }
      const head = await env.ASSETS.head(opts.outKey);
      if (!head || head.size === 0) {
        throw new Error(`ffmpeg ${opts.label}: R2 object ${opts.outKey} missing/empty after mount write`);
      }
      return { mounted: true, sizeBytes: head.size };
    } else {
      // Fallback: STREAM the artifact back to R2. We must not use base64 here — a
      // base64 string is returned as a single RPC value capped at 32 MiB, which
      // blows up for real videos (a ~39 MB mp4 → ~52 MB base64). `encoding: 'none'`
      // returns a ReadableStream delivered directly over the capnp channel with no
      // 32 MiB cap and no full-file buffering; we pipe it straight into R2.
      const file = await sandbox.readFile(outPath, { encoding: 'none' });
      if (!file.success || !file.content) throw new Error(`ffmpeg ${opts.label}: output ${outPath} missing`);
      // R2 rejects a raw ReadableStream of unknown length ("Provided readable stream
      // must have a known length"). We know the byte count, so pump the stream through
      // a FixedLengthStream to give R2 the length without buffering the whole file.
      const fixed = new FixedLengthStream(file.size);
      // Pipe in the background; put() consumes the readable half as it fills.
      file.content.pipeTo(fixed.writable).catch((err) => {
        Logger.log('VideoStitchReadbackPipeError', { label: opts.label, sandboxId: opts.sandboxId, error: String(err) });
      });
      await env.ASSETS.put(opts.outKey, fixed.readable, { httpMetadata: { contentType: opts.contentType } });
      return { mounted: false, sizeBytes: file.size };
    }
  } finally {
    // Free the container promptly — each stitch job gets its own short-lived sandbox.
    try { await sandbox.destroy(); } catch { /* best-effort cleanup */ }
  }
}

/**
 * Download `clipUrls`, normalize + concatenate them, and store the result at
 * `outKey` in the ASSETS bucket. Used by all three flows' final stitch step.
 */
export async function concatClips(
  env: CloudflareBindings,
  opts: { assetId: string; clipUrls: string[]; outKey: string; aspectRatio: '16:9' | '9:16' },
): Promise<StitchResult> {
  if (opts.clipUrls.length === 0) throw new Error('concatClips: no clips to combine');
  const { w, h } = dimsFor(opts.aspectRatio);
  const result = await runJob(env, {
    sandboxId: `stitch-${opts.assetId}`,
    files: {
      '/work/urls.txt': opts.clipUrls.join('\n') + '\n',
      '/work/run.sh': buildConcatScript(w, h),
    },
    scriptPath: '/work/run.sh',
    outKey: opts.outKey,
    contentType: 'video/mp4',
    label: 'concat',
  });
  Logger.log('VideoStitchConcatDone', { assetId: opts.assetId, clips: opts.clipUrls.length, outKey: opts.outKey, ...result });
  return result;
}

/**
 * Extract the last frame of `clipUrl` as a PNG, store it at `outKey`, and return
 * its public URL so it can seed the next chunk's image-to-video generation.
 */
export async function extractLastFrame(
  env: CloudflareBindings,
  opts: { assetId: string; clipUrl: string; outKey: string },
): Promise<{ publicUrl: string } & StitchResult> {
  const result = await runJob(env, {
    sandboxId: `frame-${opts.assetId}`,
    files: {
      '/work/src_url.txt': opts.clipUrl,
      '/work/frame.sh': FRAME_SCRIPT,
    },
    scriptPath: '/work/frame.sh',
    outKey: opts.outKey,
    contentType: 'image/png',
    label: 'extract-frame',
  });
  const publicUrl = getPublicUrl(env.ASSETS_PUBLIC_URL, opts.outKey);
  Logger.log('VideoStitchFrameDone', { assetId: opts.assetId, outKey: opts.outKey, ...result });
  return { publicUrl, ...result };
}
