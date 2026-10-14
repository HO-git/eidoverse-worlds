// buildcheck-queue — the sequencer's side of the build check: one check at a
// time, each in its own process (server/buildcheck-run.ts), cached by file.
//
// A check loads the collider module and can take seconds; the sequencer only
// ever spawns it and reads the JSON back. Reports are cached in memory and on
// disk (OPT_DIR/checks/), keyed by the model's path and invalidated by its
// mtime — store uploads are content-addressed, so theirs never change, and a
// re-exported library model is checked again. Concurrent asks for one file
// share the run.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { OPT_DIR, ROOT } from "./config.ts";
import { atomicWrite } from "./fsutil.ts";

const CHECK_TIMEOUT_MS = 90_000;
const memo = new Map<string, { mtime: number; report: unknown }>();
const running = new Map<string, Promise<unknown>>();
let queue: Promise<unknown> = Promise.resolve();

const diskPath = (file: string) => join(OPT_DIR, "checks", `${Bun.hash(file).toString(16)}.json`);

/** The build check for the model at `file` — cached, else run (queued behind
 *  any check already running). Rejects when the model can't be checked. */
export function checkFile(file: string): Promise<unknown> {
  let mtime = 0;
  try { mtime = statSync(file).mtimeMs; } catch { return Promise.reject(new Error("no such file")); }
  const hit = memo.get(file);
  if (hit && hit.mtime === mtime) return Promise.resolve(hit.report);
  try {
    const d = JSON.parse(readFileSync(diskPath(file), "utf8"));
    if (d?.file === file && d.mtime === mtime) { memo.set(file, { mtime, report: d.report }); return Promise.resolve(d.report); }
  } catch { /* not checked yet */ }
  const inflight = running.get(file);
  if (inflight) return inflight;
  const run = queue.then(async () => {
    const proc = Bun.spawn([process.execPath, join(ROOT, "server", "buildcheck-run.ts"), file], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), CHECK_TIMEOUT_MS);
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(timer);
    const last = out.trim().split("\n").pop() ?? "";
    let report: any;
    try { report = JSON.parse(last); } catch { throw new Error(proc.exitCode === null || proc.signalCode ? "the check timed out" : "the check failed"); }
    if (report?.error) throw new Error(report.error);
    memo.set(file, { mtime, report });
    try {
      if (!existsSync(join(OPT_DIR, "checks"))) mkdirSync(join(OPT_DIR, "checks"), { recursive: true });
      atomicWrite(diskPath(file), JSON.stringify({ file, mtime, report }));
    } catch { /* memory still has it */ }
    return report;
  });
  running.set(file, run);
  queue = run.catch(() => {});
  void run.finally(() => running.delete(file)).catch(() => {});
  return run;
}
