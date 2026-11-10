/**
 * Rule catalogue. Citations point to the Digital Personal Data Protection Act, 2023 ("Act")
 * and the Digital Personal Data Protection Rules, 2025 ("Rules"). They are pointers for a
 * human reviewer, not legal advice.
 */
export interface RuleMeta {
  id: string;
  name: string;
  title: string;
  citation: string;
  help: string;
}

export const RULES: Record<string, RuleMeta> = {
  DPDP001: {
    id: "DPDP001",
    name: "hardcoded-personal-data",
    title: "Personal data value written in the repository",
    citation: "Act s.8(5); Rules r.6",
    help: "Real identifiers committed to a repository are exposed to everyone with read access and stay in git history. Remove the value, rotate or purge history if it is real, and use synthetic data in tests.",
  },
  DPDP002: {
    id: "DPDP002",
    name: "personal-data-in-logs",
    title: "Personal data written to logs",
    citation: "Act s.8(5); Rules r.6",
    help: "Logs are widely readable and retained for long periods. Mask or drop the field before logging, or log a stable internal ID instead.",
  },
  DPDP003: {
    id: "DPDP003",
    name: "unprotected-sensitive-column",
    title: "High-risk personal data stored without visible protection",
    citation: "Act s.8(5); Rules r.6",
    help: "No encryption, hashing, masking, or tokenisation is visible for this column. Encrypt it at the field level or store a token, and keep only the last four characters where display is needed.",
  },
  DPDP004: {
    id: "DPDP004",
    name: "third-party-disclosure",
    title: "Personal data sent to a third-party service",
    citation: "Act s.8(2), s.5, s.6",
    help: "Sharing with a processor needs a valid contract, and the purpose must be covered by the notice and consent given to the user. Drop the field, hash it, or confirm the contract and consent cover this use.",
  },
  DPDP005: {
    id: "DPDP005",
    name: "no-erasure-path",
    title: "No code path found that erases this personal data",
    citation: "Act s.8(7), s.12; Rules r.8",
    help: "Personal data must be erased when consent is withdrawn or the purpose is served, and on a valid erasure request. Add a delete or anonymise path for this table, or mark the finding ignored if erasure happens elsewhere.",
  },
};
