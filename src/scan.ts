import { resolve } from "node:path";
import { AI_DEFAULTS, aiAvailable, describeInventory, isLocalUrl, reviewFindings, type AiOptions } from "./ai.js";
import { loadIgnoreFile, readSourceFiles } from "./files.js";
import { buildInventory, runRules } from "./rules.js";
import { extractSchema } from "./schema.js";
import type { ScanResult } from "./types.js";

export interface ScanOptions {
  root: string;
  excludes?: string[];
  useIgnoreFile?: boolean;
  /** auto: use AI when a local Ollama server has the model. on: fail if unavailable. off: never. */
  ai?: "auto" | "on" | "off";
  aiOptions?: Partial<AiOptions>;
  /** Required to send code excerpts to a model server that is not on this machine. */
  allowRemoteAi?: boolean;
}

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const root = resolve(options.root);
  const excludes = [...(options.excludes ?? []), ...(options.useIgnoreFile === false ? [] : loadIgnoreFile(root))];
  const files = readSourceFiles(root, excludes);
  const columns = extractSchema(files);
  const inventory = buildInventory(columns, files);
  const { findings, thirdParties } = runRules(files, columns, inventory);
  const result: ScanResult = { root, filesScanned: files.length, findings, inventory, thirdParties, ai: { used: false } };

  const mode = options.ai ?? "auto";
  if (mode === "off") return result;

  const aiOptions: AiOptions = { ...AI_DEFAULTS, ...options.aiOptions };
  if (!isLocalUrl(aiOptions.baseUrl) && !options.allowRemoteAi) {
    const note = `AI skipped: ${aiOptions.baseUrl} is not local. Pass --allow-remote-ai to send code excerpts there.`;
    if (mode === "on") throw new Error(note);
    result.ai.note = note;
    return result;
  }
  const available = await aiAvailable(aiOptions);
  if (!available.ok) {
    if (mode === "on") throw new Error(`AI requested but unavailable: ${available.reason}`);
    result.ai.note = `AI skipped: ${available.reason}`;
    return result;
  }
  const reviewed = await reviewFindings(findings, files, aiOptions);
  await describeInventory(inventory, aiOptions);
  result.ai = {
    used: true,
    model: aiOptions.model,
    note: findings.length > reviewed ? `AI reviewed ${reviewed} of ${findings.length} findings` : undefined,
  };
  return result;
}
