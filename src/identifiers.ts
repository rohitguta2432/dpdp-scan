import type { DataClass } from "./types.js";

// Verhoeff checksum tables, used by Aadhaar.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D[c]![P[i % 8]![Number(reversed[i])]!]!;
  }
  return c === 0;
}

/** Check digit that makes `digits + check` Verhoeff-valid. */
export function verhoeffCheckDigit(digits: string): string {
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D[c]![P[(i + 1) % 8]![Number(reversed[i])]!]!;
  }
  return String(INV[c]);
}

export function aadhaarValid(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValid(digits);
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(first14[i]!);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export function gstinValid(value: string): boolean {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value)) return false;
  const state = Number(value.slice(0, 2));
  if (state < 1 || state > 38) return false;
  return gstinCheckChar(value.slice(0, 14)) === value[14];
}

const UPI_HANDLES = [
  "okaxis", "oksbi", "okhdfcbank", "okicici", "ybl", "ibl", "axl", "apl", "paytm", "ptyes",
  "ptaxis", "ptsbi", "pthdfc", "upi", "sbi", "icici", "hdfcbank", "axisbank", "kotak", "barodampay",
  "yesbank", "indus", "idfcbank", "idfcfirst", "federal", "airtel", "jio", "freecharge", "fbl",
  "naviaxis", "yapl", "rapl", "abfspay", "waaxis", "wahdfcbank", "wasbi", "waicici", "jupiteraxis",
  "slice", "fam", "superyes", "pingpay", "timecosmos", "amazonpay", "kmbl", "aubank", "pnb", "cnrb",
];

export interface IdentifierMatch {
  kind: string;
  dataClass: DataClass;
  label: string;
  index: number;
  length: number;
  /** Checksum-verified match, so false positives are unlikely. */
  verified: boolean;
}

interface Detector {
  kind: string;
  dataClass: DataClass;
  label: string;
  regex: RegExp;
  verified: boolean;
  /** Optional extra validation of the matched text. */
  check?: (match: string) => boolean;
  /** When set, the line must also match this for the detector to fire. */
  context?: RegExp;
}

const DETECTORS: Detector[] = [
  {
    kind: "aadhaar",
    dataClass: "aadhaar",
    label: "Aadhaar number",
    regex: /(?<![\d.\-_])[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\d.\-_])/g,
    verified: true,
    check: aadhaarValid,
  },
  {
    kind: "pan",
    dataClass: "pan",
    label: "PAN",
    regex: /(?<![A-Za-z0-9])[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z](?![A-Za-z0-9])/g,
    verified: false,
  },
  {
    kind: "gstin",
    dataClass: "gov_id",
    label: "GSTIN",
    regex: /(?<![A-Za-z0-9])\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z](?![A-Za-z0-9])/g,
    verified: true,
    check: gstinValid,
  },
  {
    kind: "upi",
    dataClass: "bank",
    label: "UPI ID",
    regex: new RegExp(`(?<![\\w.@-])[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@(?:${UPI_HANDLES.join("|")})(?![\\w.-])`, "g"),
    verified: false,
  },
  {
    kind: "ifsc",
    dataClass: "bank",
    label: "IFSC code",
    regex: /(?<![A-Za-z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Za-z0-9])/g,
    verified: false,
    context: /ifsc/i,
  },
  {
    kind: "mobile",
    dataClass: "phone",
    label: "Indian mobile number",
    regex: /(?<![\w+])\+91[ -]?[6-9]\d{4}[ -]?\d{5}(?!\d)/g,
    verified: false,
  },
  {
    kind: "voter_id",
    dataClass: "gov_id",
    label: "Voter ID (EPIC)",
    regex: /(?<![A-Za-z0-9])[A-Z]{3}\d{7}(?![A-Za-z0-9])/g,
    verified: false,
    context: /voter|epic/i,
  },
  {
    kind: "passport",
    dataClass: "gov_id",
    label: "Indian passport number",
    regex: /(?<![A-Za-z0-9])[A-PR-WY][1-9]\d{6}(?![A-Za-z0-9])/g,
    verified: false,
    context: /passport/i,
  },
];

/** Find Indian identifiers written literally in one line of text. */
export function findIdentifiers(line: string): IdentifierMatch[] {
  const matches: IdentifierMatch[] = [];
  for (const detector of DETECTORS) {
    if (detector.context && !detector.context.test(line)) continue;
    detector.regex.lastIndex = 0;
    for (const m of line.matchAll(detector.regex)) {
      if (detector.check && !detector.check(m[0])) continue;
      matches.push({
        kind: detector.kind,
        dataClass: detector.dataClass,
        label: detector.label,
        index: m.index,
        length: m[0].length,
        verified: detector.verified,
      });
    }
  }
  // A GSTIN embeds a PAN; keep the GSTIN and drop the PAN inside it.
  return matches.filter(
    (a) => !matches.some((b) => b !== a && b.index <= a.index && b.index + b.length >= a.index + a.length && b.length > a.length),
  );
}

/** Replace identifier values with placeholders, so text can leave the scanner safely. */
export function redact(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const matches = findIdentifiers(line).sort((a, b) => b.index - a.index);
      let out = line;
      for (const m of matches) {
        out = `${out.slice(0, m.index)}<${m.kind.toUpperCase()}>${out.slice(m.index + m.length)}`;
      }
      return out;
    })
    .join("\n");
}
