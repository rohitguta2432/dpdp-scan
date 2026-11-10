export type Severity = "high" | "medium" | "low";

export const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/** Category of personal data. Risk tiers are this tool's own; the DPDP Act has no "sensitive" class. */
export type DataClass =
  | "aadhaar"
  | "pan"
  | "gov_id"
  | "bank"
  | "health"
  | "biometric"
  | "caste_religion"
  | "phone"
  | "email"
  | "address"
  | "dob"
  | "financial"
  | "name"
  | "gender";

export interface SourceFile {
  /** Path relative to the scan root, with forward slashes. */
  path: string;
  text: string;
  lines: string[];
  /** True when the path looks like tests, fixtures, mocks, seeds, or examples. */
  testLike: boolean;
}

export interface AiReview {
  verdict: "true_positive" | "false_positive" | "uncertain";
  confidence: number;
  explanation: string;
  fix: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  path: string;
  line: number;
  dataClass: DataClass;
  /** Extra facts about the match, never the raw identifier value. */
  detail?: string;
  /** Set by the optional AI pass. Never changes severity or the exit code. */
  ai?: AiReview;
}

export interface SchemaColumn {
  table: string;
  column: string;
  type: string;
  path: string;
  line: number;
  dataClass: DataClass | null;
  /** True when the name or type suggests encryption, hashing, masking, or tokenisation. */
  protected: boolean;
}

export interface InventoryTable {
  table: string;
  path: string;
  columns: SchemaColumn[];
  hasErasurePath: boolean;
  /** Filled by the optional AI pass. */
  purpose?: string;
  retention?: string;
}

export interface ScanResult {
  root: string;
  filesScanned: number;
  findings: Finding[];
  inventory: InventoryTable[];
  thirdParties: string[];
  ai: { used: boolean; model?: string; note?: string };
}
