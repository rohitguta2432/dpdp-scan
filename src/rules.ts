import { CLASS_LABEL, CLASS_SEVERITY, classesInCode, normaliseName } from "./fields.js";
import { findIdentifiers } from "./identifiers.js";
import { SEVERITY_RANK, type Finding, type InventoryTable, type SchemaColumn, type Severity, type SourceFile } from "./types.js";

const LOG_CALL = /\b(?:console\.(?:log|info|warn|error|debug|trace)|(?:logger|log|logging|LOG|LOGGER|Timber|winston|pino)\.(?:log|info|warn|warning|error|debug|trace|fatal|critical|exception|[dievw])|Log\.[dievw]|System\.(?:out|err)\.print(?:ln|f)?|fmt\.(?:Print|Println|Printf)|print|println|puts|NSLog)\s*\(/g;

const THIRD_PARTY_SINKS: [string, RegExp][] = [
  ["Mixpanel", /\bmixpanel\.(?:track|identify|register|alias|people\.\w+)\s*\(/gi],
  ["Segment", /\banalytics\.(?:track|identify|page|group|screen)\s*\(/g],
  ["Amplitude", /\bamplitude(?:\(\))?\.(?:track|logEvent|identify|setUserId|setUserProperties)\s*\(/gi],
  ["PostHog", /\bposthog\.(?:capture|identify|alias|group)\s*\(/gi],
  ["Sentry", /\bSentry\.(?:setUser|setContext|setExtra|setExtras|setTag|captureMessage)\s*\(/g],
  ["Google Analytics", /\b(?:gtag|ga)\s*\(/g],
  ["Firebase Analytics", /\b(?:logEvent|setUserProperties|setUserId)\s*\(\s*(?:analytics|firebaseAnalytics|getAnalytics\(\))/g],
  ["Meta Pixel", /\bfbq\s*\(/g],
  ["CleverTap", /\bclevertap\.(?:event|profile|onUserLogin)\.?\w*\s*\(/gi],
  ["MoEngage", /\bmoengage\.(?:track_event|add_\w+|trackEvent|setUserAttribute)\s*\(/gi],
  ["WebEngage", /\bwebengage\.(?:track|user\.\w+)\s*\(/gi],
  ["Intercom", /\bIntercom\s*\(\s*['"](?:boot|update|trackEvent)/g],
  ["Datadog", /\b(?:datadogRum|DD_RUM)\.(?:setUser|addAction|setGlobalContextProperty)\s*\(/g],
];

/** Text of a call starting at `index`, up to its closing parenthesis or a 12-line limit. */
function callSpan(file: SourceFile, lineIndex: number, column: number): string {
  let depth = 0;
  let out = "";
  for (let i = lineIndex; i < Math.min(file.lines.length, lineIndex + 12); i++) {
    const line = i === lineIndex ? file.lines[i]!.slice(column) : file.lines[i]!;
    for (const ch of line) {
      out += ch;
      if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) return out;
    }
    out += "\n";
  }
  return out;
}

function lower(severity: Severity): Severity {
  return severity === "high" ? "medium" : "low";
}

function hardcodedIdentifiers(file: SourceFile): Finding[] {
  const findings: Finding[] = [];
  file.lines.forEach((line, index) => {
    if (line.length > 2000) return;
    for (const match of findIdentifiers(line)) {
      const base = CLASS_SEVERITY[match.dataClass];
      findings.push({
        ruleId: "DPDP001",
        severity: file.testLike ? lower(base) : base,
        message: `${match.label} written in source${file.testLike ? " (test or fixture path)" : ""}`,
        path: file.path,
        line: index + 1,
        dataClass: match.dataClass,
        detail: match.verified ? "checksum valid" : "format match",
      });
    }
  });
  return findings;
}

function callFindings(
  file: SourceFile,
  pattern: RegExp,
  build: (classes: ReturnType<typeof classesInCode>, line: number) => Finding[],
): Finding[] {
  const findings: Finding[] = [];
  file.lines.forEach((line, index) => {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) {
      const span = callSpan(file, index, match.index + match[0].length - 1);
      const classes = classesInCode(span).filter((c) => SEVERITY_RANK[CLASS_SEVERITY[c.dataClass]] >= SEVERITY_RANK.medium);
      findings.push(...build(classes, index + 1));
    }
  });
  return findings;
}

function logFindings(file: SourceFile): Finding[] {
  if (file.testLike) return [];
  return callFindings(file, LOG_CALL, (classes, line) =>
    classes.map((c) => ({
      ruleId: "DPDP002",
      severity: CLASS_SEVERITY[c.dataClass],
      message: `${CLASS_LABEL[c.dataClass]} (\`${c.name}\`) passed to a log call`,
      path: file.path,
      line,
      dataClass: c.dataClass,
    })),
  );
}

function thirdPartyFindings(file: SourceFile, seen: Set<string>): Finding[] {
  if (file.testLike) return [];
  const findings: Finding[] = [];
  for (const [vendor, pattern] of THIRD_PARTY_SINKS) {
    findings.push(
      ...callFindings(file, pattern, (classes, line) => {
        if (classes.length) seen.add(vendor);
        return classes.map((c) => ({
          ruleId: "DPDP004",
          severity: CLASS_SEVERITY[c.dataClass],
          message: `${CLASS_LABEL[c.dataClass]} (\`${c.name}\`) sent to ${vendor}`,
          path: file.path,
          line,
          dataClass: c.dataClass,
          detail: vendor,
        }));
      }),
    );
  }
  return findings;
}

function columnFindings(columns: SchemaColumn[]): Finding[] {
  return columns
    .filter((c) => c.dataClass && CLASS_SEVERITY[c.dataClass] === "high" && !c.protected)
    .map((c) => ({
      ruleId: "DPDP003",
      severity: c.dataClass === "aadhaar" || c.dataClass === "biometric" ? ("high" as const) : ("medium" as const),
      message: `${CLASS_LABEL[c.dataClass!]} column \`${c.table}.${c.column}\` has no visible encryption, hashing, or masking`,
      path: c.path,
      line: c.line,
      dataClass: c.dataClass!,
      detail: c.type,
    }));
}

function singular(name: string): string {
  if (/ies$/.test(name)) return `${name.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/.test(name)) return name.slice(0, -2);
  return name.replace(/s$/, "");
}

/** True when some file appears to delete or anonymise rows of the given table. */
export function hasErasurePath(table: string, compactCorpus: string[]): boolean {
  const full = normaliseName(table).replace(/_/g, "");
  const stem = singular(full);
  const names = `(?:${full}|${stem})`;
  const pattern = new RegExp(
    `deletefrom(?:public\\.)?${names}` +
      `|${names}(?:s|repository|repo|dao|model|service)?\\.(?:delete|destroy|remove|erase|purge|anonymi[sz]e)` +
      `|(?:delete|destroy|remove|erase|purge|anonymi[sz]e)(?:all|by\\w*)?${names}` +
      `|update${names}set\\w*=null`,
  );
  return compactCorpus.some((text) => pattern.test(text));
}

export function buildInventory(columns: SchemaColumn[], files: SourceFile[]): InventoryTable[] {
  const compact = files.map((f) => f.text.toLowerCase().replace(/[\s_"'`]/g, ""));
  const tables = new Map<string, InventoryTable>();
  for (const c of columns) {
    if (!c.dataClass) continue;
    let entry = tables.get(c.table);
    if (!entry) {
      entry = { table: c.table, path: c.path, columns: [], hasErasurePath: hasErasurePath(c.table, compact) };
      tables.set(c.table, entry);
    }
    if (!entry.columns.some((existing) => existing.column === c.column)) entry.columns.push(c);
  }
  return [...tables.values()].sort((a, b) => a.table.localeCompare(b.table));
}

function erasureFindings(inventory: InventoryTable[]): Finding[] {
  return inventory
    .filter((t) => !t.hasErasurePath)
    .map((t) => {
      const first = t.columns[0]!;
      return {
        ruleId: "DPDP005",
        severity: "low" as const,
        message: `No delete or anonymise path found for table \`${t.table}\` (${t.columns.length} personal data column${t.columns.length === 1 ? "" : "s"})`,
        path: first.path,
        line: first.line,
        dataClass: first.dataClass!,
      };
    });
}

export function runRules(files: SourceFile[], columns: SchemaColumn[], inventory: InventoryTable[]): { findings: Finding[]; thirdParties: string[] } {
  const vendors = new Set<string>();
  const findings: Finding[] = [];
  for (const file of files) {
    findings.push(...hardcodedIdentifiers(file), ...logFindings(file), ...thirdPartyFindings(file, vendors));
  }
  findings.push(...columnFindings(columns), ...erasureFindings(inventory));

  const ignored = (f: Finding): boolean => {
    const file = files.find((x) => x.path === f.path);
    const here = file?.lines[f.line - 1] ?? "";
    const above = file?.lines[f.line - 2] ?? "";
    return /dpdp-scan:ignore/.test(here) || /dpdp-scan:ignore-next-line/.test(above);
  };
  const unique = new Map<string, Finding>();
  for (const f of findings) {
    if (!ignored(f)) unique.set(`${f.ruleId}|${f.path}|${f.line}|${f.dataClass}|${f.detail ?? ""}`, f);
  }
  const sorted = [...unique.values()].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.path.localeCompare(b.path) || a.line - b.line,
  );
  return { findings: sorted, thirdParties: [...vendors].sort() };
}
