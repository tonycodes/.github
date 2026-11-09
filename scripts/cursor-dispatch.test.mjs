import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { countRecentLaunches, decide, recentLaunchCountFromSearch } from "./cursor-dispatch.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(root);
const scriptPath = join(root, "cursor-dispatch.mjs");
const ENDPOINT = "https://api.cursor.com/v1/agents";

function load(name) {
  return JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
}

function plan(name, eventName, extra = {}) {
  return decide({ eventName, event: load(name), ...extra });
}

test("issue opened by tonycodes launches a test-first fix against the default branch", () => {
  const result = plan("issue-opened-tonycodes.json", "issues");
  assert.equal(result.dispatch, true);
  assert.equal(result.number, 12);
  assert.equal(result.endpoint, ENDPOINT);
  assert.equal(result.body.autoCreatePR, true);
  assert.equal(result.body.workOnCurrentBranch, false);
  assert.deepEqual(result.body.repos, [
    {
      url: "https://github.com/tonycodes/example",
      startingRef: "main",
    },
  ]);
  const text = result.body.prompt.text;
  assert.match(text, /Fix the parser/);
  assert.match(text, /failing test first/);
  assert.match(text, /Never merge\./);
  assert.match(text, /Never use admin bypass\./);
  assert.match(text, /Never edit rulesets\./);
  assert.match(text, /never deploy, release or trigger deploy workflows/);
  assert.match(text, /never touch workflows, rulesets or secrets/);
  assert.match(text, /never open issues or start agents/);
  assert.match(text, /Open a pull request/);
  assert.match(text, /dev tests, PO after-green review, QA G3/);
  assert.doesNotMatch(text, /Post review comments only/);
  assert.equal(JSON.stringify(result).includes("CURSOR_API_KEY"), false);
  assert.equal(JSON.stringify(result.body).includes("Authorization"), false);
});

test("issue opened by another author without agent-ok is skipped", () => {
  const result = plan("issue-opened-other.json", "issues");
  assert.equal(result.dispatch, false);
  assert.equal(result.body, null);
  assert.match(result.reason, /author/i);
});

test("label agent-ok from another author is plan-only and does not change code", () => {
  const result = plan("issue-opened-agent-ok.json", "issues");
  assert.equal(result.dispatch, true);
  assert.equal(result.number, 14);
  assert.equal(result.body.mode, "plan");
  assert.equal(result.body.autoCreatePR, false);
  assert.equal(result.body.workOnCurrentBranch, false);
  const text = result.body.prompt.text;
  assert.match(text, /Comment a plan only/);
  assert.match(text, /Do not change code/);
  assert.doesNotMatch(text, /failing test first/);
  assertSafetyPhrases(text);
});

test("label agent-ok on a pull request from another author is plan-only", () => {
  const event = load("pr-ready-tonycodes.json");
  event.pull_request.user = { login: "otherperson", type: "User" };
  event.pull_request.labels = [{ name: "agent-ok" }];
  const result = decide({ eventName: "pull_request", event });
  assert.equal(result.dispatch, true);
  assert.equal(result.body.mode, "plan");
  assert.equal(result.body.autoCreatePR, false);
  assert.match(result.body.prompt.text, /Comment a plan only/);
  assert.match(result.body.prompt.text, /Do not change code/);
  assert.doesNotMatch(result.body.prompt.text, /Post review comments only/);
  assertSafetyPhrases(result.body.prompt.text);
});

test("pull request head branch starting with cursor/ is skipped", () => {
  const result = plan("pr-ready-cursor-branch.json", "pull_request");
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /cursor\//);
});

test("pull request opened by a bot is skipped even with agent-ok", () => {
  const result = plan("pr-ready-bot.json", "pull_request");
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /bot/i);
});

test("a Bot user type is skipped even when the login has no [bot] suffix", () => {
  const event = load("pr-ready-tonycodes.json");
  event.pull_request.user = { login: "cursor-app", type: "Bot" };
  const result = decide({ eventName: "pull_request", event });
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /bot/i);
});

test("an issue that already has agent-started is skipped", () => {
  const result = plan("issue-opened-already-started.json", "issues");
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /agent-started/);
});

test("a pull request that already has agent-started is skipped", () => {
  const result = plan("pr-ready-already-started.json", "pull_request");
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /agent-started/);
});

test("live agent-started label skips even when the event snapshot has no label", () => {
  const result = plan("issue-opened-tonycodes.json", "issues", {
    liveLabels: ["agent-started"],
  });
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /agent-started/);
});

test("fork pull requests are skipped", () => {
  const result = plan("pr-ready-fork.json", "pull_request");
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /fork/i);
});

test("a forked repository issue is skipped", () => {
  const event = load("issue-opened-tonycodes.json");
  event.repository.fork = true;
  const result = decide({ eventName: "issues", event });
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /fork/i);
});

test("ready pull request prompts for review comments only and does not push", () => {
  const result = plan("pr-ready-tonycodes.json", "pull_request");
  assert.equal(result.dispatch, true);
  assert.equal(result.number, 34);
  assert.equal(result.endpoint, ENDPOINT);
  assert.equal(result.body.autoCreatePR, false);
  assert.equal(result.body.workOnCurrentBranch, false);
  assert.deepEqual(result.body.repos, [
    {
      url: "https://github.com/tonycodes/example",
      prUrl: "https://github.com/tonycodes/example/pull/34",
    },
  ]);
  const text = result.body.prompt.text;
  assert.match(text, /Add widget/);
  assert.match(text, /Post review comments only/);
  assert.match(text, /Do not push/);
  assert.match(text, /Never merge\./);
  assert.match(text, /Never use admin bypass\./);
  assert.match(text, /Never edit rulesets\./);
  assert.match(text, /never deploy, release or trigger deploy workflows/);
  assert.match(text, /never touch workflows, rulesets or secrets/);
  assert.match(text, /never open issues or start agents/);
  assert.doesNotMatch(text, /failing test first/);
  assert.equal(result.body.mode, undefined);
});

test("issue and pull request prompts are different tasks", () => {
  const issue = plan("issue-opened-tonycodes.json", "issues");
  const review = plan("pr-ready-tonycodes.json", "pull_request");
  assert.notEqual(issue.body.prompt.text, review.body.prompt.text);
  assert.equal(issue.body.autoCreatePR, true);
  assert.equal(review.body.autoCreatePR, false);
});

test("startingRef follows the repository default branch", () => {
  const event = load("issue-opened-tonycodes.json");
  event.repository.default_branch = "develop";
  const result = decide({ eventName: "issues", event });
  assert.equal(result.dispatch, true);
  assert.equal(result.body.repos[0].startingRef, "develop");
});

test("a mismatched repository URL is not sent to the API", () => {
  const event = load("issue-opened-tonycodes.json");
  event.repository.html_url = "https://github.com/evil/example";
  const result = decide({ eventName: "issues", event });
  assert.equal(result.dispatch, false);
  assert.equal(result.body, null);
});

test("a pull request with no head repository is treated as a fork", () => {
  const event = load("pr-ready-tonycodes.json");
  event.pull_request.head.repo = null;
  const result = decide({ eventName: "pull_request", event });
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /fork/i);
});

test("a non-draft pull request opened by tonycodes is reviewed", () => {
  const event = load("pr-ready-tonycodes.json");
  event.action = "opened";
  event.pull_request.draft = false;
  const result = decide({ eventName: "pull_request", event });
  assert.equal(result.dispatch, true);
  assert.match(result.body.prompt.text, /Post review comments only/);
  assert.equal(result.body.autoCreatePR, false);
  assertSafetyPhrases(result.body.prompt.text);
});

test("a draft pull request opened by tonycodes is skipped", () => {
  const event = load("pr-ready-tonycodes.json");
  event.action = "opened";
  event.pull_request.draft = true;
  const result = decide({ eventName: "pull_request", event });
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /draft/i);
});

test("an api-created issue is skipped", () => {
  const event = load("issue-opened-tonycodes.json");
  event.issue.performed_via_github_app = { slug: "bulk-importer", id: 1 };
  const result = decide({ eventName: "issues", event });
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /api-created/);
});

test("a bulk-imported issue is skipped", () => {
  const event = load("issue-opened-tonycodes.json");
  event.issue.author_association = "MANNEQUIN";
  const result = decide({ eventName: "issues", event });
  assert.equal(result.dispatch, false);
  assert.match(result.reason, /bulk-imported/);
});

test("the hourly launch cap skips when the repo already reached the default of 5", () => {
  const capped = plan("issue-opened-tonycodes.json", "issues", { recentLaunchCount: 5 });
  assert.equal(capped.dispatch, false);
  assert.match(capped.reason, /cap of 5 per hour/);
  const allowed = plan("issue-opened-tonycodes.json", "issues", { recentLaunchCount: 4 });
  assert.equal(allowed.dispatch, true);
});

test("launch timestamps outside the last hour do not count toward the cap", () => {
  const now = Date.parse("2026-11-09T22:00:00Z");
  const recent = new Date(now - 30 * 60 * 1000).toISOString();
  const stale = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(countRecentLaunches([recent, stale], now), 1);
  assert.equal(
    recentLaunchCountFromSearch(
      { total_count: 8, items: [{ updated_at: recent }] },
      now,
    ),
    8,
  );
  assert.equal(
    recentLaunchCountFromSearch(
      { total_count: 8, items: [{ updated_at: recent }, { updated_at: stale }] },
      now,
    ),
    1,
  );
});

test("the hourly launch cap honors a configured maximum", () => {
  const capped = plan("issue-opened-tonycodes.json", "issues", {
    recentLaunchCount: 2,
    maxLaunchesPerHour: 2,
  });
  assert.equal(capped.dispatch, false);
  assert.match(capped.reason, /cap of 2 per hour/);
  const allowed = plan("issue-opened-tonycodes.json", "issues", {
    recentLaunchCount: 1,
    maxLaunchesPerHour: 2,
  });
  assert.equal(allowed.dispatch, true);
});

test("the dedupe key is stable for one item and different for another", () => {
  const first = plan("issue-opened-tonycodes.json", "issues");
  const second = plan("issue-opened-tonycodes.json", "issues");
  assert.equal(first.body.agentId, second.body.agentId);
  assert.match(
    first.body.agentId,
    /^bc-[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const review = plan("pr-ready-tonycodes.json", "pull_request");
  assert.notEqual(first.body.agentId, review.body.agentId);
  const otherIssue = plan("issue-opened-agent-ok.json", "issues");
  assert.notEqual(first.body.agentId, otherIssue.body.agentId);
});

test("unsupported actions are skipped", () => {
  const closed = load("issue-opened-tonycodes.json");
  closed.action = "closed";
  assert.equal(decide({ eventName: "issues", event: closed }).dispatch, false);

  assert.equal(decide({ eventName: "push", event: { action: "opened" } }).dispatch, false);
});

test("cli writes a launch plan and github output without an api key", () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-dispatch-"));
  const out = join(dir, "plan.json");
  const githubOutput = join(dir, "github-output.txt");
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--event-name",
      "issues",
      "--event-path",
      join(root, "fixtures", "issue-opened-tonycodes.json"),
      "--out",
      out,
      "--github-output",
      githubOutput,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(body.dispatch, true);
  assert.equal(body.endpoint, ENDPOINT);
  assert.equal(body.body.repos[0].startingRef, "main");
  const output = readFileSync(githubOutput, "utf8");
  assert.match(output, /^dispatch=true$/m);
  assert.match(output, /^number=12$/m);
  assert.doesNotMatch(output, /CURSOR_API_KEY|Authorization/);
  assert.doesNotMatch(readFileSync(out, "utf8"), /CURSOR_API_KEY|Authorization/);
});

test("dispatch workflow pins actions, masks the key, and limits curl", () => {
  const workflow = readFileSync(
    join(repoRoot, ".github", "workflows", "cursor-agent-dispatch.yml"),
    "utf8",
  );
  assert.match(workflow, /^on:\n {2}workflow_call:/m);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /cursor-agent-/);
  assert.match(workflow, /echo "::add-mask::\$\{CURSOR_API_KEY\}"/);
  assert.match(workflow, /--fail-with-body/);
  assert.match(workflow, /--max-time/);
  assert.match(workflow, /https:\/\/api\.cursor\.com\/v1\/agents/);
  assert.match(workflow, /agent-started/);
  assert.match(workflow, /vars\.CURSOR_AGENT_DISPATCH != 'off'/);
  assert.match(workflow, /max_launches_per_hour:/);
  assert.match(workflow, /default:\s*5/);
  assert.match(workflow, /gh label create agent-started[\s\S]*--force/);
  assert.match(workflow, /409/);
  assert.doesNotMatch(workflow, /required:\s*true/);
  const withoutMask = workflow.replaceAll('echo "::add-mask::${CURSOR_API_KEY}"', "");
  assert.doesNotMatch(withoutMask, /echo\b[^\n]*CURSOR_API_KEY/);
  assert.doesNotMatch(workflow, /\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  const uses = [...workflow.matchAll(/^ {8}uses: (\S+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const use of uses) {
    assert.match(use, /@[0-9a-f]{40}$/);
  }
});

function assertSafetyPhrases(text) {
  assert.match(text, /never deploy, release or trigger deploy workflows/);
  assert.match(text, /never touch workflows, rulesets or secrets/);
  assert.match(text, /never open issues or start agents/);
}

test("readme documents the caller snippet", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const cursor = readme.slice(
    readme.indexOf("cursor-agent-dispatch.yml"),
    readme.indexOf("reusable-release.yml"),
  );
  assert.match(cursor, /types: \[opened\]/);
  assert.match(cursor, /types: \[opened, ready_for_review\]/);
  assert.match(
    cursor,
    /uses: tonycodes\/\.github\/\.github\/workflows\/cursor-agent-dispatch\.yml@[0-9a-f]{40}/,
  );
  assert.match(cursor, /contents: read/);
  assert.match(cursor, /issues: write/);
  assert.match(cursor, /pull-requests: write/);
  assert.match(cursor, /CURSOR_API_KEY:\s*\$\{\{\s*secrets\.CURSOR_API_KEY\s*\}\}/);
  assert.doesNotMatch(cursor, /secrets:\s*inherit/);
});
