#!/usr/bin/env node
/**
 * Pre-deploy gate: block `wrangler deploy` until no Workflow instances are still
 * in flight.
 *
 * WHY: deploying resets the Worker + its Durable Objects. The ffmpeg step runs
 * inside the Sandbox DO, so a deploy mid-stitch kills the running ffmpeg (seen in
 * prod as "Durable Object reset because its code was updated"). Waiting for every
 * generation-workflow / publish-workflow instance to finish first avoids killing
 * long-video / continue / combine jobs partway through.
 *
 * It polls `wrangler workflows instances list <name> --status <running|queued>`
 * and only exits 0 (allow deploy) once both statuses are empty for all workflows.
 *
 * Env knobs:
 *   FORCE_DEPLOY=1        skip the check entirely (emergency deploys)
 *   WF_NAMES=a,b          workflows to watch (default generation-workflow,publish-workflow)
 *   WF_ENV=development    pass through `--env` (default: none → production)
 *   WF_POLL_INTERVAL_MS   re-check cadence (default 15000)
 *   WF_TIMEOUT_MS         give up after this (default 1800000 = 30 min). In CI set this
 *                         BELOW your build time limit (e.g. 600000) so the build isn't killed mid-wait.
 *   WF_ON_ERROR           what to do when wrangler can't report status (auth/network):
 *                           "abort"  (default) → exit 1, block the deploy (safe)
 *                           "proceed"          → exit 0, allow the deploy (use if the CI
 *                                                token can't read Workflows instances)
 *   WF_WRANGLER           override the wrangler invocation, e.g. "npx wrangler". Auto-detected
 *                         otherwise: local node_modules/.bin/wrangler, else `npx wrangler` (for CI).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);

const WORKFLOWS = (process.env.WF_NAMES || 'generation-workflow,publish-workflow')
  .split(',').map((s) => s.trim()).filter(Boolean);
const BLOCKING_STATUSES = ['running', 'queued']; // paused/errored/complete/terminated are terminal-ish
const INTERVAL_MS = Number(process.env.WF_POLL_INTERVAL_MS || 15_000);
const TIMEOUT_MS = Number(process.env.WF_TIMEOUT_MS || 30 * 60 * 1000);
const ENV_FLAG = process.env.WF_ENV ? ['--env', process.env.WF_ENV] : [];
const ON_ERROR = (process.env.WF_ON_ERROR || 'abort').toLowerCase(); // 'abort' | 'proceed'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMPTY_HINT = /no instances|there are no|empty/i;

// Resolve how to invoke wrangler:
//   1. WF_WRANGLER override (e.g. "npx wrangler")
//   2. workspace-local node_modules/.bin/wrangler (fast — local dev)
//   3. `npx wrangler` fallback (CI / Cloudflare Workers Builds, where deps aren't installed)
const here = path.dirname(fileURLToPath(import.meta.url));
const localBin = path.resolve(here, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const WR = process.env.WF_WRANGLER
  ? (() => { const p = process.env.WF_WRANGLER.split(' ').filter(Boolean); return { cmd: p[0], base: p.slice(1) }; })()
  : existsSync(localBin)
    ? { cmd: localBin, base: [] }
    : { cmd: npx, base: ['--yes', 'wrangler'] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[predeploy] ${m}`);
const err = (m) => console.error(`[predeploy] ${m}`);

if (process.env.FORCE_DEPLOY === '1') {
  log('FORCE_DEPLOY=1 — skipping in-flight workflow check.');
  process.exit(0);
}

/** Raw list output for one workflow+status (stdout+stderr merged), tolerant of non-zero exits. */
async function listRaw(name, status) {
  const args = [...WR.base, 'workflows', 'instances', 'list', name, '--status', status, '--per-page', '100', ...ENV_FLAG];
  try {
    const { stdout, stderr } = await run(WR.cmd, args, { maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, out: `${stdout}\n${stderr}` };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}\n${e.stderr ?? ''}`, error: e };
  }
}

/**
 * Is there ≥1 instance for name+status? Retries once on an undetermined result.
 * Throws with `.undetermined = true` when wrangler failed AND gave no parseable output.
 */
async function hasInstances(name, status) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await listRaw(name, status);
    if (UUID.test(res.out)) return true;
    if (EMPTY_HINT.test(res.out) || res.ok) return false;
    if (attempt === 0) { await sleep(2000); continue; } // transient? try once more
    const e = new Error(`Could not query ${name} (${status}).\n${res.out.trim()}`);
    e.undetermined = true;
    throw e;
  }
  return false;
}

/** List of "name:status" pairs that currently have in-flight instances. */
async function activeInFlight() {
  const active = [];
  for (const name of WORKFLOWS) {
    for (const status of BLOCKING_STATUSES) {
      if (await hasInstances(name, status)) active.push(`${name}:${status}`);
    }
  }
  return active;
}

log(`Checking in-flight instances for: ${WORKFLOWS.join(', ')}${ENV_FLAG.length ? ` (env=${process.env.WF_ENV})` : ''}`);

const start = Date.now();
while (true) {
  let active;
  try {
    active = await activeInFlight();
  } catch (e) {
    if (e.undetermined) {
      err(e.message);
      if (ON_ERROR === 'proceed') {
        err('Could not determine workflow status; WF_ON_ERROR=proceed → allowing deploy.');
        process.exit(0);
      }
      err('Could not determine workflow status (auth/network?). Aborting to stay safe.');
      err('Set WF_ON_ERROR=proceed to deploy anyway when status is unreadable, or FORCE_DEPLOY=1 to skip the check.');
      process.exit(1);
    }
    throw e;
  }

  if (active.length === 0) {
    log('No running/queued workflow instances. Safe to deploy. ✅');
    process.exit(0);
  }

  const elapsed = Date.now() - start;
  if (elapsed > TIMEOUT_MS) {
    err(`Timed out after ${Math.round(TIMEOUT_MS / 60000)} min — still in flight: ${active.join(', ')}. Aborting deploy.`);
    err('Increase WF_TIMEOUT_MS to wait longer, or set FORCE_DEPLOY=1 to deploy anyway (will kill in-progress ffmpeg).');
    process.exit(1);
  }

  log(`In-flight: ${active.join(', ')} — waiting ${Math.round(INTERVAL_MS / 1000)}s (elapsed ${Math.round(elapsed / 1000)}s)…`);
  await sleep(INTERVAL_MS);
}
