import * as fs from "fs";
import * as path from "path";

/**
 * Regression tests for the `deploy-staging` job guard in
 * .github/workflows/test.yml (issue #188).
 *
 * GitHub Actions expressions can't be executed locally, so instead we
 * extract the job's `if: >-` folded-scalar condition from the workflow
 * file and evaluate it against the same shape of event context GitHub
 * provides (`github`, `github.base_ref`, `github.event.pull_request`, …).
 * Each accepted clause grammar is a subset of what the workflow uses:
 *   <dotted.path> (==|!=) ('literal' | true | false | <dotted.path>)
 * joined with `&&`.
 */

type GithubContext = {
  base_ref?: string;
  actor?: string;
  repository?: string;
  event?: {
    pull_request?: {
      draft?: boolean;
      head?: { repo?: { full_name?: string } };
    };
  };
};

const workflowDir = path.join(process.cwd(), ".github", "workflows");

function readWorkflow(name: string): string {
  return fs.readFileSync(path.join(workflowDir, name), "utf8");
}

/** Extract the `if: >-` folded scalar belonging to a named job. */
function extractJobIfCondition(workflow: string, jobName: string): string {
  const jobHeader = `  ${jobName}:`;
  const jobStart = workflow.indexOf(jobHeader);
  if (jobStart === -1) {
    throw new Error(`Job ${jobName} not found in workflow`);
  }

  const ifMarker = "    if: >-";
  const ifStart = workflow.indexOf(ifMarker, jobStart);
  if (ifStart === -1) {
    throw new Error(`Job ${jobName} has no "if: >-" condition`);
  }

  // The folded scalar ends at the next line that is not indented deeper
  // than the continuation lines (6 spaces).
  const lines = workflow.slice(ifStart).split("\n");
  const conditionLines: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith("      ")) {
      conditionLines.push(line.trim());
    } else {
      break;
    }
  }
  if (conditionLines.length === 0) {
    throw new Error(`Job ${jobName} has an empty if condition`);
  }
  // Folded scalar joins continuation lines with a single space.
  return conditionLines.join(" ");
}

function resolvePath(context: GithubContext, dottedPath: string): unknown {
  let value: unknown = { github: context };
  for (const segment of dottedPath.split(".")) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** Evaluate one `a == b` / `a != b` clause against a GitHub event context. */
function evaluateClause(clause: string, context: GithubContext): boolean {
  const operator = clause.includes("!=") ? "!=" : "==";
  const [lhsRaw, rhsRaw] = clause.split(operator).map((side) => side.trim());

  const resolveSide = (side: string): unknown => {
    if (/^'[^']*'$/.test(side)) {
      return side.slice(1, -1);
    }
    if (side === "true" || side === "false") {
      return side === "true";
    }
    return resolvePath(context, side);
  };

  const lhs = resolveSide(lhsRaw);
  const rhs = resolveSide(rhsRaw);
  return operator === "==" ? lhs === rhs : lhs !== rhs;
}

/** Evaluate the full `&&`-joined condition. */
function evaluateCondition(condition: string, context: GithubContext): boolean {
  return condition
    .split("&&")
    .map((clause) => clause.trim())
    .filter(Boolean)
    .every((clause) => evaluateClause(clause, context));
}

const deployStagingCondition = extractJobIfCondition(
  readWorkflow("test.yml"),
  "deploy-staging",
);

const baseRepo = "pizza-to-the-polls/pizzabase";

function prContext(overrides: Partial<GithubContext> = {}): GithubContext {
  return {
    base_ref: "master",
    actor: "some-human",
    repository: baseRepo,
    event: {
      pull_request: {
        draft: false,
        head: { repo: { full_name: baseRepo } },
      },
    },
    ...overrides,
  };
}

describe("deploy-staging job condition (issue #188)", () => {
  test("condition includes the draft == false guard", () => {
    expect(deployStagingCondition).toContain(
      "github.event.pull_request.draft == false",
    );
  });

  test("condition is a conjunction of four guards", () => {
    const clauses = deployStagingCondition.split("&&").map((c) => c.trim());
    expect(clauses).toHaveLength(4);
  });

  test("draft PR targeting master does not deploy", () => {
    const context = prContext({
      event: {
        pull_request: {
          draft: true,
          head: { repo: { full_name: baseRepo } },
        },
      },
    });
    expect(evaluateCondition(deployStagingCondition, context)).toBe(false);
  });

  test("non-draft PR targeting master from the same repo deploys", () => {
    expect(evaluateCondition(deployStagingCondition, prContext())).toBe(true);
  });

  test("feature-branch PR (draft) still does not deploy", () => {
    const context = prContext({
      base_ref: "feature/draft-pr-no-deploy",
      event: {
        pull_request: { draft: true, head: { repo: { full_name: baseRepo } } },
      },
    });
    expect(evaluateCondition(deployStagingCondition, context)).toBe(false);
  });

  test("feature-branch PR (non-draft) still does not deploy", () => {
    const context = prContext({ base_ref: "feature/some-feature" });
    expect(evaluateCondition(deployStagingCondition, context)).toBe(false);
  });

  test("dependabot PR targeting master does not deploy", () => {
    const context = prContext({ actor: "dependabot[bot]" });
    expect(evaluateCondition(deployStagingCondition, context)).toBe(false);
  });

  test("fork PR targeting master does not deploy", () => {
    const context = prContext({
      event: {
        pull_request: {
          draft: false,
          head: { repo: { full_name: "contributor/pizzabase" } },
        },
      },
    });
    expect(evaluateCondition(deployStagingCondition, context)).toBe(false);
  });

  test("draft guard comes before the repo/actor guards in the condition", () => {
    const clauses = deployStagingCondition.split("&&").map((c) => c.trim());
    expect(clauses[0]).toBe("github.base_ref == 'master'");
    expect(clauses[1]).toBe("github.event.pull_request.draft == false");
  });
});

describe("production deploy workflow (deploy.yml)", () => {
  test("triggers only on push to master, not pull_request", () => {
    const workflow = readWorkflow("deploy.yml");
    const onBlock = workflow.slice(
      workflow.indexOf("on:"),
      workflow.indexOf("jobs:"),
    );
    expect(onBlock).toContain("push:");
    expect(onBlock).toContain("branches: [master]");
    expect(onBlock).not.toContain("pull_request");
  });

  test("does not reference the pull_request event context", () => {
    // deploy.yml fires on push events, where github.event.pull_request is
    // undefined — a draft guard would be a null-context hazard there.
    const workflow = readWorkflow("deploy.yml");
    expect(workflow).not.toContain("github.event.pull_request.draft");
  });
});
