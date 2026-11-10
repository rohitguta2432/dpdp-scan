import type { DataClass, Severity } from "./types.js";

/** Risk tier per class. This is the tool's own triage order, not a legal category. */
export const CLASS_SEVERITY: Record<DataClass, Severity> = {
  aadhaar: "high",
  pan: "high",
  gov_id: "high",
  bank: "high",
  health: "high",
  biometric: "high",
  caste_religion: "high",
  phone: "medium",
  email: "medium",
  address: "medium",
  dob: "medium",
  financial: "medium",
  name: "low",
  gender: "low",
};

export const CLASS_LABEL: Record<DataClass, string> = {
  aadhaar: "Aadhaar",
  pan: "PAN",
  gov_id: "government ID",
  bank: "bank or UPI detail",
  health: "health data",
  biometric: "biometric data",
  caste_religion: "caste or religion",
  phone: "phone number",
  email: "email address",
  address: "address",
  dob: "date of birth",
  financial: "financial detail",
  name: "name",
  gender: "gender",
};

// Patterns run against a normalised name: lower case, words joined by "_".
const FIELD_PATTERNS: [DataClass, RegExp][] = [
  ["aadhaar", /(^|_)(aadhaar|aadhar|adhaar|uidai)(_|$)/],
  ["pan", /(^|_)(pan|pancard)(_(no|num|number|card|id))?$|(^|_)pan_(no|num|number|card|id)(_|$)/],
  ["biometric", /(^|_)(biometric|biometrics|fingerprint|iris|face_(template|embedding|encoding)|voiceprint)(_|$)/],
  ["health", /(^|_)(diagnosis|prescription|medical|abha|blood_group|allergy|allergies|disease|health_(id|record|condition|data))(_|$)/],
  ["caste_religion", /(^|_)(caste|religion)(_|$)/],
  ["gov_id", /(^|_)(passport|voter_id|epic_(no|number)|driving_licen[cs]e|dl_number|gstin|ration_card)(_|$)/],
  ["bank", /(^|_)(account_(no|num|number)|acc_(no|number)|bank_account|ifsc|upi_id|vpa|card_number|cvv)(_|$)/],
  ["dob", /(^|_)(dob|date_of_birth|birth_date|birthdate|birthday)(_|$)/],
  ["phone", /(^|_)(phone|mobile|msisdn|whatsapp|contact_(no|number))(_|$)/],
  ["email", /(^|_)(email|e_mail)(_|$)/],
  ["address", /(^|_)(address|addr|pincode|pin_code|postal_code|street|landmark)(_|$)/],
  ["financial", /(^|_)(salary|income|credit_score|cibil|net_worth|loan_amount)(_|$)/],
  ["name", /(^|_)(full_name|first_name|last_name|father_name|mother_name|guardian_name|customer_name|patient_name|user_name)(_|$)/],
  ["gender", /(^|_)(gender|sex)(_|$)/],
];

/** `panNumber`, `PAN_NUMBER`, `pan-number` all become `pan_number`. */
export function normaliseName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

export function classifyField(name: string): DataClass | null {
  // Drop protection suffixes so `pan_hash` and `pan_number_encrypted` still classify as PAN.
  const normalised = normaliseName(name).replace(/(_(enc|encrypted|cipher|ciphertext|hash|hashed|digest|token|tokenised|tokenized|masked|last4|last_4))+$/, "");
  if (!normalised) return null;
  for (const [dataClass, pattern] of FIELD_PATTERNS) {
    if (pattern.test(normalised)) return dataClass;
  }
  return null;
}

const PROTECTED_NAME = /(^|_)(enc|encrypted|cipher|ciphertext|hash|hashed|digest|token|tokenised|tokenized|masked|last4|last_4|ref|reference)(_|$)/;
const PROTECTED_TYPE = /\b(bytea|blob|binary|varbinary|bytes)\b/i;

/** True when a column name or type suggests the value is not stored in the clear. */
export function looksProtected(name: string, type: string): boolean {
  return PROTECTED_NAME.test(normaliseName(name)) || PROTECTED_TYPE.test(type);
}

/**
 * Remove string literal contents so prose such as "phone updated" is not read as a variable.
 * Interpolated parts (`${x}`, f-string `{x}`) are kept, because they are real data flow.
 */
export function stripStringLiterals(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const ch = code[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const fString = /[fF]$/.test(out);
      let j = i + 1;
      let kept = "";
      while (j < code.length && code[j] !== ch) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        const interpolation = ch === "`" && code[j] === "$" && code[j + 1] === "{";
        const fInterpolation = fString && code[j] === "{" && code[j + 1] !== "{";
        if (interpolation || fInterpolation) {
          const start = interpolation ? j + 2 : j + 1;
          let depth = 1;
          let k = start;
          while (k < code.length && depth > 0) {
            if (code[k] === "{") depth++;
            else if (code[k] === "}") depth--;
            k++;
          }
          kept += ` ${code.slice(start, k - 1)} `;
          j = k;
          continue;
        }
        j++;
      }
      out += `""${kept}`;
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Personal data classes referenced by identifiers in a piece of code. */
export function classesInCode(code: string): { dataClass: DataClass; name: string }[] {
  const found = new Map<DataClass, string>();
  const stripped = stripStringLiterals(code);
  for (const m of stripped.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const dataClass = classifyField(m[0]);
    if (dataClass && !found.has(dataClass)) found.set(dataClass, m[0]);
  }
  return [...found].map(([dataClass, name]) => ({ dataClass, name }));
}
