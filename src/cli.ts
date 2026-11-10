#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { render, type Format } from "./report.js";
import { scan } from "./scan.js";
import { SEVERITY_RANK, type Severity } from "./types.js";

const HELP = `dpdp-scan: find Indian personal data in a codebase and map gaps to the DPDP Act.

Usage: dpdp-scan [path] [options]

Options:
  --format <f>        pretty (default), json, sarif, markdown, html
  --out <file>        write the report to a file instead of stdout
  --inventory <file>  also write the Markdown data inventory to a file
  --html <file>       also write the HTML report to a file
  --fail-on <level>   exit 1 on findings at or above: high (default), medium, low, none
  --exclude <glob>    skip matching paths (repeatable); .dpdpignore is also read
  --no-ignore-file    do not read .dpdpignore
  --ai <mode>         auto (default), on, off. AI runs on a local Ollama server
  --model <name>      Ollama model (default qwen3:14b, or $DPDP_SCAN_MODEL)
  --ai-url <url>      Ollama base URL (default http://127.0.0.1:11434, or $OLLAMA_HOST)
  --allow-remote-ai   permit a non-local --ai-url; code excerpts will leave this machine
  --max-ai <n>        maximum findings sent for AI review (default 40)
  --no-color          plain output
  -h, --help          show this help
  -v, --version       show version

The exit code depends only on deterministic findings. AI output never changes it.`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: "string", default: "pretty" },
      out: { type: "string" },
      inventory: { type: "string" },
      html: { type: "string" },
      "fail-on": { type: "string", default: "high" },
      exclude: { type: "string", multiple: true },
      "no-ignore-file": { type: "boolean", default: false },
      ai: { type: "string", default: "auto" },
      model: { type: "string" },
      "ai-url": { type: "string" },
      "allow-remote-ai": { type: "boolean", default: false },
      "max-ai": { type: "string" },
      "no-color": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log("0.1.0");
    return 0;
  }
  const root = positionals[0] ?? ".";
  const format = values.format as Format;
  const failOn = values["fail-on"] as Severity | "none";
  const ai = values.ai as "auto" | "on" | "off";
  if (!existsSync(root)) throw new Error(`path not found: ${root}`);
  if (!["pretty", "json", "sarif", "markdown", "html"].includes(format)) throw new Error(`unknown --format: ${format}`);
  if (!["high", "medium", "low", "none"].includes(failOn)) throw new Error(`unknown --fail-on: ${failOn}`);
  if (!["auto", "on", "off"].includes(ai)) throw new Error(`unknown --ai: ${ai}`);

  const result = await scan({
    root,
    excludes: values.exclude,
    useIgnoreFile: !values["no-ignore-file"],
    ai,
    allowRemoteAi: values["allow-remote-ai"],
    aiOptions: {
      ...(values.model ? { model: values.model } : {}),
      ...(values["ai-url"] ? { baseUrl: values["ai-url"].replace(/\/+$/, "") } : {}),
      ...(values["max-ai"] ? { maxFindings: Math.max(0, Number(values["max-ai"]) || 0) } : {}),
    },
  });

  const color = !values["no-color"] && !values.out && process.stdout.isTTY === true && !process.env.NO_COLOR;
  const report = render(result, format, color);
  if (values.out) writeFileSync(values.out, report);
  else console.log(report);
  if (values.inventory) writeFileSync(values.inventory, render(result, "markdown"));
  if (values.html) writeFileSync(values.html, render(result, "html"));

  if (failOn === "none") return 0;
  return result.findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]) ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`dpdp-scan: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  },
);
