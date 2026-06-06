/**
 * Automated code review service.
 *
 * Runs a battery of static heuristics over a code snippet to surface likely
 * bugs, security smells, and style issues, then assigns a quality score. The
 * rule set is intentionally language-light so it works across JavaScript /
 * TypeScript / Python and other C-family languages.
 */

import { z } from "zod";

import type { ServiceDefinition, ServiceResult } from "./types";
import { clamp, round } from "./util";

interface Rule {
  id: string;
  severity: "info" | "warning" | "error";
  pattern: RegExp;
  message: string;
}

const RULES: Rule[] = [
  {
    id: "no-eval",
    severity: "error",
    pattern: /\beval\s*\(/,
    message: "Use of eval() is a serious security risk; avoid dynamic code execution.",
  },
  {
    id: "no-hardcoded-secret",
    severity: "error",
    pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{6,}["']/i,
    message: "Possible hardcoded secret. Load credentials from the environment instead.",
  },
  {
    id: "no-debug-logging",
    severity: "warning",
    pattern: /console\.(log|debug)\s*\(|print\s*\(/,
    message: "Debug logging left in code; remove or route through a logger before shipping.",
  },
  {
    id: "no-todo",
    severity: "info",
    pattern: /\b(TODO|FIXME|HACK|XXX)\b/,
    message: "Unresolved TODO/FIXME marker.",
  },
  {
    id: "no-empty-catch",
    severity: "warning",
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    message: "Empty catch block swallows errors silently.",
  },
  {
    id: "no-double-equals",
    severity: "warning",
    pattern: /[^=!<>]==[^=]/,
    message: "Loose equality (==) found; prefer strict equality (===).",
  },
  {
    id: "no-var",
    severity: "info",
    pattern: /\bvar\s+\w+/,
    message: "Use of 'var'; prefer 'let' or 'const' for block scoping.",
  },
];

const SEVERITY_WEIGHT: Record<Rule["severity"], number> = { info: 1, warning: 4, error: 10 };

const schema = z.object({
  code: z
    .string()
    .min(1, "code is required")
    .max(50_000, "code must be 50,000 characters or fewer")
    .describe("The source code snippet to review"),
  language: z
    .string()
    .max(30)
    .optional()
    .describe("Optional language hint, e.g. typescript, python"),
});

/**
 * Review a code snippet against the static rule set.
 *
 * @param args - Raw arguments validated against the service schema.
 * @returns A {@link ServiceResult} with findings, a score, and a grade.
 */
function handler(args: Record<string, unknown>): ServiceResult {
  const { code, language } = schema.parse(args);
  const lines = code.split(/\r?\n/);

  const findings: Array<{
    rule: string;
    severity: Rule["severity"];
    line: number;
    message: string;
    excerpt: string;
  }> = [];

  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          line: index + 1,
          message: rule.message,
          excerpt: line.trim().slice(0, 160),
        });
      }
    }
    if (line.length > 120) {
      findings.push({
        rule: "max-line-length",
        severity: "info",
        line: index + 1,
        message: `Line exceeds 120 characters (${line.length}).`,
        excerpt: line.trim().slice(0, 160),
      });
    }
  });

  const penalty = findings.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 1), 0);
  const score = clamp(round(100 - penalty, 0), 0, 100);
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  const counts = {
    error: findings.filter(f => f.severity === "error").length,
    warning: findings.filter(f => f.severity === "warning").length,
    info: findings.filter(f => f.severity === "info").length,
  };

  return {
    summary: `Code quality ${grade} (${score}/100) with ${findings.length} findings.`,
    data: {
      language: language ?? "auto",
      qualityScore: score,
      grade,
      lineCount: lines.length,
      findingCounts: counts,
      findings: findings.slice(0, 100),
    },
  };
}

/**
 * Automated code review service definition.
 */
export const codeReviewService: ServiceDefinition = {
  name: "code_review",
  title: "Automated Code Review",
  category: "developer-tools",
  description:
    "Static analysis of a code snippet for security smells, likely bugs, and style issues across " +
    "C-family languages and Python, returning line-level findings and a quality grade.",
  price: "$0.02",
  shape: schema.shape,
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "The source code snippet to review" },
      language: { type: "string", description: "Optional language hint, e.g. typescript, python" },
    },
    required: ["code"],
  },
  exampleInput: {
    code: "var apiKey = 'sk_live_abc123456';\nif (x == 1) { eval(userInput); }",
    language: "javascript",
  },
  exampleOutput: {
    qualityScore: 76,
    grade: "C",
    findingCounts: { error: 2, warning: 1, info: 1 },
    findings: [{ rule: "no-eval", severity: "error", line: 2 }],
  },
  http: { method: "POST", path: "/v1/code-review" },
  handler,
};
