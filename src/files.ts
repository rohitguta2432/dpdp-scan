import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "./types.js";

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", ".next", ".turbo", "vendor", "venv",
  ".venv", "__pycache__", ".gradle", ".idea", ".vscode", "coverage", "Pods", ".terraform",
]);
const SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|go\.sum|Cargo\.lock|poetry\.lock|uv\.lock|composer\.lock|Gemfile\.lock)$/;
const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tar|jar|war|class|so|dylib|dll|exe|bin|woff2?|ttf|eot|otf|mp[34]|mov|avi|wasm|map|min\.js|min\.css|sarif|lock)$/i;
const TEST_LIKE = /(^|\/)(tests?|__tests__|specs?|fixtures?|mocks?|__mocks__|seeds?|seeders?|examples?|samples?|testdata|e2e|stubs?)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|(Test|Tests|IT)\.(java|kt)$/i;
const MAX_BYTES = 1_000_000;

export function isTestLike(path: string): boolean {
  return TEST_LIKE.test(path);
}

/** Convert a gitignore-style glob to a predicate over forward-slash relative paths. */
export function globToMatcher(glob: string): (path: string) => boolean {
  let pattern = glob.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  const prefix = anchored || pattern.includes("/") ? "^" : "^(?:.*/)?";
  const regex = new RegExp(`${prefix}${body}(?:/.*)?$`);
  return (path) => regex.test(path);
}

export function loadIgnoreFile(root: string): string[] {
  const file = join(root, ".dpdpignore");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function gitFiles(root: string): string[] | null {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function walk(root: string, dir = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(root, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

export function readSourceFiles(root: string, excludes: string[]): SourceFile[] {
  const matchers = excludes.map(globToMatcher);
  const candidates = gitFiles(root) ?? walk(root);
  const files: SourceFile[] = [];
  for (const path of candidates.sort()) {
    if (path.split("/").some((part) => SKIP_DIRS.has(part))) continue;
    if (SKIP_FILES.test(path) || SKIP_EXTENSIONS.test(path)) continue;
    if (matchers.some((matches) => matches(path))) continue;
    const absolute = join(root, path);
    let buffer: Buffer;
    try {
      const stat = statSync(absolute);
      if (!stat.isFile() || stat.size > MAX_BYTES) continue;
      buffer = readFileSync(absolute);
    } catch {
      continue;
    }
    if (buffer.subarray(0, 8000).includes(0)) continue;
    const text = buffer.toString("utf8");
    files.push({ path, text, lines: text.split("\n"), testLike: isTestLike(path) });
  }
  return files;
}
