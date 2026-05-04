#!/usr/bin/env node --experimental-strip-types
/**
 * Sync upstream changes from https://github.com/nexu-io/open-design
 *
 * Usage:
 *   node --experimental-strip-types scripts/sync-upstream.ts
 *   tsx scripts/sync-upstream.ts
 *
 * Behavior:
 * 1. Ensures the upstream remote exists.
 * 2. Fetches upstream/main.
 * 3. Compares upstream/main with the current branch.
 * 4. If upstream is ahead, merges the changes.
 * 5. On merge conflict: aborts and reports the conflicted files.
 * 6. On clean merge: runs `pnpm typecheck` to validate.
 * 7. If typecheck passes: optionally pushes to origin.
 */

import { execFileSync, spawnSync } from "node:child_process";

const UPSTREAM_URL = "https://github.com/nexu-io/open-design.git";
const UPSTREAM_BRANCH = "upstream/main";

type SyncResult =
  | { kind: "no-updates" }
  | { kind: "conflict"; files: string[] }
  | { kind: "typecheck-failed"; output: string }
  | { kind: "success"; commits: number };

function run(args: string[], cwd?: string): string {
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = new Error(
      `Command failed: ${args.join(" ")}\n${result.stderr || ""}`,
    );
    (err as any).status = result.status;
    (err as any).stderr = result.stderr;
    throw err;
  }
  return result.stdout.trim();
}

function runQuiet(args: string[], cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function getCurrentBranch(): string {
  return run(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
}

function hasUncommittedChanges(): boolean {
  const out = run(["git", "status", "--porcelain"]);
  return out.length > 0;
}

function ensureUpstreamRemote(): void {
  const remotes = run(["git", "remote", "-v"]);
  if (remotes.includes("upstream")) {
    console.log("[sync] upstream remote already exists");
    return;
  }
  console.log(`[sync] adding upstream remote: ${UPSTREAM_URL}`);
  run(["git", "remote", "add", "upstream", UPSTREAM_URL]);
}

function fetchUpstream(): void {
  console.log("[sync] fetching upstream/main...");
  run(["git", "fetch", "upstream", "main"]);
}

function getCommitCountDiff(base: string, target: string): number {
  const out = run(["git", "rev-list", "--count", `${base}..${target}`]);
  const n = Number(out);
  return Number.isFinite(n) ? n : 0;
}

function mergeUpstream(targetBranch: string): boolean {
  console.log(`[sync] merging ${UPSTREAM_BRANCH} into ${targetBranch}...`);
  const result = runQuiet([
    "git",
    "merge",
    "--no-commit",
    "--no-ff",
    UPSTREAM_BRANCH,
  ]);
  if (result.ok) return true;

  // Check for unresolved conflicts
  const status = run(["git", "diff", "--name-only", "--diff-filter=U"]);
  if (status.length > 0) {
    console.error("[sync] merge conflict detected, aborting...");
    runQuiet(["git", "merge", "--abort"]);
    return false;
  }

  // Some other merge error — abort anyway
  console.error("[sync] merge failed, aborting...");
  runQuiet(["git", "merge", "--abort"]);
  return false;
}

function getConflictFiles(): string[] {
  const out = run(["git", "diff", "--name-only", "--diff-filter=U"]);
  return out.length > 0 ? out.split("\n") : [];
}

function runTypecheck(): { ok: boolean; output: string } {
  console.log("[sync] running pnpm typecheck...");
  const result = spawnSync("pnpm", ["typecheck"], {
    encoding: "utf8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

function shouldPush(): boolean {
  const env = process.env.SYNC_UPSTREAM_PUSH;
  if (env === "1" || env === "true") return true;
  // Non-interactive fallback: default to false
  if (!process.stdin.isTTY) return false;

  const answer = run(["node", "-e", `
    process.stdout.write("Push to origin? [y/N] ");
    const buf = require("fs").readFileSync(0, { encoding: "utf8" });
    process.stdout.write(buf.trim().toLowerCase().startsWith("y") ? "y\n" : "n\n");
  `]);
  return answer.trim() === "y";
}

function pushOrigin(branch: string): void {
  console.log(`[sync] pushing to origin/${branch}...`);
  run(["git", "push", "origin", branch]);
}

function main(): SyncResult {
  const branch = getCurrentBranch();
  console.log(`[sync] current branch: ${branch}`);

  if (hasUncommittedChanges()) {
    console.error("[sync] abort: uncommitted changes detected. Commit or stash them first.");
    process.exit(1);
  }

  ensureUpstreamRemote();
  fetchUpstream();

  const ahead = getCommitCountDiff(branch, UPSTREAM_BRANCH);
  const behind = getCommitCountDiff(UPSTREAM_BRANCH, branch);

  console.log(`[sync] upstream/main is ${ahead} commit(s) ahead, ${behind} commit(s) behind ${branch}`);

  if (ahead === 0) {
    console.log("[sync] no updates from upstream.");
    return { kind: "no-updates" };
  }

  const merged = mergeUpstream(branch);
  if (!merged) {
    const files = getConflictFiles();
    return { kind: "conflict", files };
  }

  // Check if the merge actually changed anything
  const mergeHead = runQuiet(["git", "rev-parse", "MERGE_HEAD"]);
  if (!mergeHead.ok) {
    // No MERGE_HEAD means fast-forward or nothing to merge
    console.log("[sync] nothing to merge (already up to date or fast-forward).");
    return { kind: "no-updates" };
  }

  // Commit the merge
  const mergeCommitMsg = `chore: merge upstream/nexu-io/open-design main (${ahead} commits)`;
  run(["git", "commit", "-m", mergeCommitMsg]);
  console.log(`[sync] merge committed: ${mergeCommitMsg}`);

  // Validate
  const typecheck = runTypecheck();
  if (!typecheck.ok) {
    console.error("[sync] typecheck failed — please fix errors manually.");
    console.error(typecheck.output.slice(-2000));
    return { kind: "typecheck-failed", output: typecheck.output };
  }
  console.log("[sync] typecheck passed.");

  if (shouldPush()) {
    pushOrigin(branch);
  } else {
    console.log("[sync] skipped push. Run `git push origin ${branch}` manually when ready.");
  }

  return { kind: "success", commits: ahead };
}

const result = main();

switch (result.kind) {
  case "no-updates":
    process.exit(0);
  case "conflict":
    console.error("[sync] conflicted files:");
    for (const f of result.files) console.error(`  - ${f}`);
    process.exit(2);
  case "typecheck-failed":
    process.exit(3);
  case "success":
    console.log(`[sync] successfully merged ${result.commits} upstream commit(s).`);
    process.exit(0);
}
