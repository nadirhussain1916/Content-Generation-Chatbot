import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock the Cloudflare Sandbox SDK ──────────────────────────────────────────
// videoStitch.ts drives a container via `getSandbox(...)`. We replace the whole
// SDK with an in-memory fake so these tests exercise the real orchestration logic
// (mount → exec → verify, plus the read-back fallback) WITHOUT spinning up a
// container or making any network / API call.

const { sandboxMock, getSandboxMock } = vi.hoisted(() => {
  const sandboxMock = {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    mountBucket: vi.fn(),
    unmountBucket: vi.fn(),
    exec: vi.fn(),
    readFile: vi.fn(),
    destroy: vi.fn(),
  };
  return { sandboxMock, getSandboxMock: vi.fn(() => sandboxMock) };
});

vi.mock('@cloudflare/sandbox', () => ({ getSandbox: getSandboxMock }));

import { concatClips, extractLastFrame } from '../../backend/src/services/videoStitch';

// ─── Fake env (R2 binding + public URL) ───────────────────────────────────────

const putMock = vi.fn();
const headMock = vi.fn();

function makeEnv() {
  return {
    Sandbox: {} as never, // getSandbox is mocked, so the namespace is unused
    ASSETS: { put: putMock, head: headMock },
    ASSETS_PUBLIC_URL: 'https://cdn.example.com',
  } as never;
}

/** Grab the content written to a given path via sandbox.writeFile. */
function writtenTo(path: string): string | undefined {
  const call = sandboxMock.writeFile.mock.calls.find((c) => c[0] === path);
  return call?.[1] as string | undefined;
}

/** The single command passed to sandbox.exec. */
function execCommand(): string {
  return sandboxMock.exec.mock.calls[0]?.[0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible happy-path defaults; individual tests override as needed.
  sandboxMock.mkdir.mockResolvedValue(undefined);
  sandboxMock.writeFile.mockResolvedValue(undefined);
  sandboxMock.mountBucket.mockResolvedValue(undefined);
  sandboxMock.unmountBucket.mockResolvedValue(undefined);
  sandboxMock.exec.mockResolvedValue({ success: true, exitCode: 0, stderr: '' });
  sandboxMock.readFile.mockResolvedValue({ success: true, content: btoa('hello') });
  sandboxMock.destroy.mockResolvedValue(undefined);
  headMock.mockResolvedValue({ size: 12_345 });
  putMock.mockResolvedValue(undefined);
});

// ─── concatClips: mount happy path (direct-to-R2, no read-back) ───────────────

describe('concatClips — mounted (direct-to-R2)', () => {
  it('mounts the key prefix, writes the artifact at the mount root, verifies, and never reads bytes back', async () => {
    const res = await concatClips(makeEnv(), {
      assetId: 'a1',
      clipUrls: ['https://v/one.mp4', 'https://v/two.mp4'],
      outKey: 'ws1/th1/a1.mp4',
      aspectRatio: '9:16',
    });

    // Reports the direct-to-R2 mount path + the verified object size.
    expect(res).toEqual({ mounted: true, sizeBytes: 12_345 });

    // Mounts the ASSETS binding at /r2, scoped to the key's parent prefix.
    expect(sandboxMock.mountBucket).toHaveBeenCalledWith('ASSETS', '/r2', { prefix: '/ws1/th1' });

    // ffmpeg writes to the bare filename inside the prefixed mount.
    expect(execCommand()).toContain('bash /work/run.sh');
    expect(execCommand()).toContain('"/r2/a1.mp4"');

    // Flushes + verifies the object landed; no read-back, no put.
    expect(sandboxMock.unmountBucket).toHaveBeenCalledWith('/r2');
    expect(headMock).toHaveBeenCalledWith('ws1/th1/a1.mp4');
    expect(sandboxMock.readFile).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();

    // Cleans up the container.
    expect(sandboxMock.destroy).toHaveBeenCalledTimes(1);
  });

  it('passes the clip URLs and a normalization script into the sandbox', async () => {
    await concatClips(makeEnv(), {
      assetId: 'a1',
      clipUrls: ['https://v/one.mp4', 'https://v/two.mp4'],
      outKey: 'ws1/th1/a1.mp4',
      aspectRatio: '16:9',
    });

    expect(writtenTo('/work/urls.txt')).toBe('https://v/one.mp4\nhttps://v/two.mp4\n');

    const script = writtenTo('/work/run.sh')!;
    expect(script).toContain('-f concat');            // concat demuxer
    expect(script).toContain('anullsrc');             // silent-audio injection for clips w/o audio
    expect(script).toContain('cp _out.mp4 "$OUT"');   // sequential copy onto the mount
    expect(script).toContain('scale=1920:1080');      // 16:9 target resolution
  });

  it('uses portrait dimensions for 9:16', async () => {
    await concatClips(makeEnv(), {
      assetId: 'a1',
      clipUrls: ['https://v/one.mp4'],
      outKey: 'ws1/th1/a1.mp4',
      aspectRatio: '9:16',
    });
    expect(writtenTo('/work/run.sh')!).toContain('scale=1080:1920');
  });

  it('throws if the mounted write produced no (or an empty) R2 object', async () => {
    headMock.mockResolvedValue(null);
    await expect(
      concatClips(makeEnv(), {
        assetId: 'a1',
        clipUrls: ['https://v/one.mp4'],
        outKey: 'ws1/th1/a1.mp4',
        aspectRatio: '9:16',
      }),
    ).rejects.toThrow(/missing\/empty/);
    expect(sandboxMock.destroy).toHaveBeenCalledTimes(1); // still cleaned up
  });
});

// ─── concatClips: fallback path (mount unavailable) ───────────────────────────

describe('concatClips — fallback (mount unavailable)', () => {
  it('reads the artifact back and PUTs it with the right content-type', async () => {
    sandboxMock.mountBucket.mockRejectedValue(new Error('mount not supported'));

    const res = await concatClips(makeEnv(), {
      assetId: 'a1',
      clipUrls: ['https://v/one.mp4'],
      outKey: 'ws1/th1/a1.mp4',
      aspectRatio: '9:16',
    });

    // Reports the fallback path + the byte length that was PUT (base64 of 'hello' = 5 bytes).
    expect(res).toEqual({ mounted: false, sizeBytes: 5 });

    // Writes to a local path (not the mount) and reads it back.
    expect(execCommand()).toContain('"/work/out.bin"');
    expect(sandboxMock.readFile).toHaveBeenCalledWith('/work/out.bin', { encoding: 'base64' });
    expect(sandboxMock.unmountBucket).not.toHaveBeenCalled();

    // PUTs the decoded bytes under the full key with the correct content type.
    expect(putMock).toHaveBeenCalledTimes(1);
    const [key, bytes, opts] = putMock.mock.calls[0];
    expect(key).toBe('ws1/th1/a1.mp4');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes as Uint8Array)).toEqual([...'hello'].map((c) => c.charCodeAt(0)));
    expect(opts).toEqual({ httpMetadata: { contentType: 'video/mp4' } });
  });
});

// ─── concatClips: error handling ──────────────────────────────────────────────

describe('concatClips — errors', () => {
  it('surfaces ffmpeg failures (and still destroys the sandbox)', async () => {
    sandboxMock.exec.mockResolvedValue({ success: false, exitCode: 1, stderr: 'ffmpeg exploded' });
    await expect(
      concatClips(makeEnv(), {
        assetId: 'a1',
        clipUrls: ['https://v/one.mp4'],
        outKey: 'ws1/th1/a1.mp4',
        aspectRatio: '9:16',
      }),
    ).rejects.toThrow(/concat failed/);
    expect(sandboxMock.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects with no clips and never touches the sandbox', async () => {
    await expect(
      concatClips(makeEnv(), { assetId: 'a1', clipUrls: [], outKey: 'ws1/th1/a1.mp4', aspectRatio: '9:16' }),
    ).rejects.toThrow(/no clips/);
    expect(getSandboxMock).not.toHaveBeenCalled();
  });
});

// ─── extractLastFrame ─────────────────────────────────────────────────────────

describe('extractLastFrame', () => {
  it('extracts the last frame to R2 and returns its public URL + mount info', async () => {
    const res = await extractLastFrame(makeEnv(), {
      assetId: 'a1',
      clipUrl: 'https://v/clip.mp4',
      outKey: 'ws1/th1/a1-frame-0.png',
    });

    expect(res).toEqual({ publicUrl: 'https://cdn.example.com/ws1/th1/a1-frame-0.png', mounted: true, sizeBytes: 12_345 });
    expect(sandboxMock.mountBucket).toHaveBeenCalledWith('ASSETS', '/r2', { prefix: '/ws1/th1' });
    expect(execCommand()).toContain('"/r2/a1-frame-0.png"');
    expect(writtenTo('/work/src_url.txt')).toBe('https://v/clip.mp4');
    expect(headMock).toHaveBeenCalledWith('ws1/th1/a1-frame-0.png');
    expect(sandboxMock.destroy).toHaveBeenCalledTimes(1);
  });

  it('PUTs a PNG content-type on the fallback path', async () => {
    sandboxMock.mountBucket.mockRejectedValue(new Error('no mount'));
    sandboxMock.readFile.mockResolvedValue({ success: true, content: btoa('png-bytes') });

    await extractLastFrame(makeEnv(), {
      assetId: 'a1',
      clipUrl: 'https://v/clip.mp4',
      outKey: 'ws1/th1/a1-frame-0.png',
    });

    const [key, , opts] = putMock.mock.calls[0];
    expect(key).toBe('ws1/th1/a1-frame-0.png');
    expect(opts).toEqual({ httpMetadata: { contentType: 'image/png' } });
  });
});
