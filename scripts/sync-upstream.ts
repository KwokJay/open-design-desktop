#!/usr/bin/env node --experimental-strip-types
/**
 * Sync upstream changes from https://github.com/nexu-io/open-design
 *
 * Usage:
 *   node --experimental-strip-types scripts/sync-upstream.ts
 *   SYNC_UPSTREAM_PUSH=1 node --experimental-strip-types scripts/sync-upstream.ts
 *
 * Safety guarantees:
 * 1. Aborts immediately if the working tree is dirty.
 * 2. Shows local-only commits before merging so you can verify nothing
 *    important will be overwritten.
 * 3. On merge conflict: aborts the merge and exits — never resolves
 *    conflicts automatically.
 * 4. After a clean merge: verifies protected files still exist, runs
 *    pnpm install when lockfile changed, then runs pnpm typecheck.
 * 5. Only pushes after all validations pass.
 */

import { spawnSync } from "node:child_process";

const UPSTREAM_URL = "https://github.com/nexu-io/open-design.git";
const UPSTREAM_BRANCH = "upstream/main";

/** Files that must not be deleted by an upstream merge. */
const PROTECTED_FILES = [
  "scripts/sync-upstream.ts",
  "apps/desktop/src/main/menu.ts",
  "apps/desktop/src/main/tray.ts",
  "apps/desktop/src/main/shortcuts.ts",
  "apps/desktop/src/main/store.ts",
];

type SyncResult =
  | { kind: "no-updates" }
  | { kind: "dirty-worktree" }
  | { kind: "conflict"; files: string[] }
  | { kind: "protected-file-missing"; files: string[] }
  | { kind: "typecheck-failed"; output: string }
  | { kind: "install-failed"; output: string }
  | { kind: "success"; commits: number };

/* ─── shell helpers ─── */

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

/* ─── git helpers ─── */

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

function getCommitMessages(base: string, target: string): string[] {
  const out = run(["git", "log", "--format=%h %s", `${base}..${target}`]);
  return out.length > 0 ? out.split("\n") : [];
}

/* ─── merge with conflict guard ─── */

function attemptMerge(branch: string): { ok: true } | { ok: false; reason: "conflict" | "other"; files: string[] } {
  console.log(`[sync] merging ${UPSTREAM_BRANCH} into ${branch}...`);
  const result = runQuiet(["git", "merge", "--no-commit", "--no-ff", UPSTREAM_BRANCH]);

  if (result.ok) {
    return { ok: true };
  }

  // Determine whether it's a conflict or something else
  const conflicted = run(["git", "diff", "--name-only", "--diff-filter=U"]);
  const files = conflicted.length > 0 ? conflicted.split("\n") : [];

  if (files.length > 0) {
    console.error("[sync] ❌ merge conflict detected — aborting merge!");
    runQuiet(["git", "merge", "--abort"]);
    return { ok: false, reason: "conflict", files };
  }

  console.error("[sync] ❌ merge failed for a non-conflict reason — aborting merge!");
  runQuiet(["git", "merge", "--abort"]);
  return { ok: false, reason: "other", files: [] };
}

/* ─── post-merge verification ─── */

function verifyProtectedFiles(): string[] {
  const missing: string[] = [];
  for (const f of PROTECTED_FILES) {
    const result = runQuiet(["git", "ls-files", "--error-unmatch", f]);
    if (!result.ok) missing.push(f);
  }
  return missing;
}

function showMergeSummary(headBefore: string): void {
  const changed = run(["git", "diff", "--name-only", `${headBefore}..HEAD`]);
  if (changed.length > 0) {
    console.log("[sync] changed files in this merge:");
    for (const line of changed.split("\n").slice(0, 20)) {
      console.log(`  · ${line}`);
    }
    const total = changed.split("\n").length;
    if (total > 20) console.log(`  ... and ${total - 20} more`);
  }
}

/* ─── validation steps ─── */

function runInstallIfNeeded(): { ok: boolean; output: string } {
  const changed = runQuiet(["git", "diff", "--name-only", "HEAD~1"]).stdout;
  if (!changed.includes("pnpm-lock.yaml") && !changed.includes("package.json")) {
    return { ok: true, output: "" };
  }

  console.log("[sync] dependency changes detected, running pnpm install...");
  const result = spawnSync("pnpm", ["install"], {
    encoding: "utf8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
  };
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

/* ─── push ─── */

function shouldPush(): boolean {
  const env = process.env.SYNC_UPSTREAM_PUSH;
  if (env === "1" || env === "true") return true;
  if (!process.stdin.isTTY) return false;

  process.stdout.write("Push to origin? [y/N] ");
  const buf = run(["node", "-e", `
    const buf = require("fs").readFileSync(0, { encoding: "utf8" });
    process.stdout.write(buf.trim().toLowerCase().startsWith("y") ? "y" : "n");
  `]);
  return buf.trim() === "y";
}

function pushOrigin(branch: string): void {
  console.log(`[sync] pushing to origin/${branch}...`);
  run(["git", "push", "origin", branch]);
}

/* ─── main ─── */

function main(): SyncResult {
  const branch = getCurrentBranch();
  console.log(`[sync] current branch: ${branch}`);

  if (hasUncommittedChanges()) {
    console.error("[sync] ❌ abort: uncommitted changes detected. Commit or stash them first.");
    return { kind: "dirty-worktree" };
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

  // Show local-only commits so the user knows what they own
  if (behind > 0) {
    console.log(`[sync] ${behind} local-only commit(s) will be preserved:`);
    for (const line of getCommitMessages(UPSTREAM_BRANCH, branch).slice(0, 10)) {
      console.log(`  · ${line}`);
    }
    if (behind > 10) console.log(`  ... and ${behind - 10} more`);
  }

  // Show what we're about to pull in
  console.log(`[sync] ${ahead} upstream commit(s) to merge:`);
  for (const line of getCommitMessages(branch, UPSTREAM_BRANCH).slice(0, 10)) {
    console.log(`  · ${line}`);
  }
  if (ahead > 10) console.log(`  ... and ${ahead - 10} more`);

  const headBefore = run(["git", "rev-parse", "HEAD"]);

  const mergeResult = attemptMerge(branch);
  if (!mergeResult.ok) {
    return {
      kind: "conflict",
      files: mergeResult.files,
    };
  }

  // Check if the merge actually introduced changes
  const treeDiff = runQuiet(["git", "diff", "--cached", "--quiet"]);
  if (treeDiff.ok) {
    console.log("[sync] merge produced no changes (already up to date).");
    runQuiet(["git", "merge", "--abort"]);
    return { kind: "no-updates" };
  }

  // Commit the merge
  const mergeCommitMsg = `chore: merge upstream/nexu-io/open-design main (${ahead} commits)`;
  run(["git", "commit", "-m", mergeCommitMsg]);
  console.log(`[sync] ✅ merge committed: ${mergeCommitMsg}`);

  // Verify protected files weren't deleted
  const missing = verifyProtectedFiles();
  if (missing.length > 0) {
    console.error("[sync] ❌ protected files missing after merge!");
    for (const f of missing) console.error(`  ✗ ${f}`);
    return { kind: "protected-file-missing", files: missing };
  }
  console.log("[sync] ✅ protected files verified.");

  showMergeSummary(headBefore);

  // Install dependencies if needed
  const install = runInstallIfNeeded();
  if (!install.ok) {
    console.error("[sync] ❌ pnpm install failed.");
    console.error(install.output.slice(-2000));
    return { kind: "install-failed", output: install.output };
  }

  // Typecheck
  const typecheck = runTypecheck();
  if (!typecheck.ok) {
    console.error("[sync] ❌ typecheck failed — please fix errors manually.");
    console.error(typecheck.output.slice(-2000));
    return { kind: "typecheck-failed", output: typecheck.output };
  }
  console.log("[sync] ✅ typecheck passed.");

  if (shouldPush()) {
    pushOrigin(branch);
  } else {
    console.log(`[sync] skipped push. Run \`git push origin ${branch}\` manually when ready.`);
  }

  return { kind: "success", commits: ahead };
}

/* ─── run ─── */

const result = main();

switch (result.kind) {
  case "no-updates":
    process.exit(0);
  case "dirty-worktree":
    process.exit(1);
  case "conflict":
    console.error("[sync] ❌ merge aborted due to conflict. Conflicted files:");
    for (const f of result.files) console.error(`  · ${f}`);
    console.error("[sync] resolve the conflicts manually, then commit the merge.");
    process.exit(2);
  case "protected-file-missing":
    console.error("[sync] ❌ merge aborted because protected files were deleted:");
    for (const f of result.files) console.error(`  · ${f}`);
    console.error("[sync] inspect the merge and restore these files before continuing.");
    process.exit(4);
  case "install-failed":
    console.error("[sync] ❌ dependency installation failed.");
    process.exit(5);
  case "typecheck-failed":
    console.error("[sync] ❌ validation failed. fix errors and commit manually.");
    process.exit(3);
  case "success":
    console.log(`[sync] ✅ successfully merged ${result.commits} upstream commit(s).`);
    process.exit(0);
}
