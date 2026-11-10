import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { reviewFindings, isLocalUrl, AI_DEFAULTS } from "../src/ai.js";
import { classifyField, classesInCode, looksProtected, stripStringLiterals } from "../src/fields.js";
import { globToMatcher, isTestLike } from "../src/files.js";
import { aadhaarValid, findIdentifiers, gstinValid, redact, verhoeffCheckDigit, verhoeffValid } from "../src/identifiers.js";
import { render } from "../src/report.js";
import { hasErasurePath } from "../src/rules.js";
import { scan } from "../src/scan.js";

// Synthetic, checksum-valid identifiers. Built at runtime so no literal sits in this file.
const AADHAAR = `99999999999${verhoeffCheckDigit("99999999999")}`;
const PAN = ["ABCPE", "1234", "F"].join("");

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "dpdp-scan-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("identifiers", () => {
  it("validates Verhoeff checksums", () => {
    expect(verhoeffValid("2363")).toBe(true);
    expect(verhoeffValid("2364")).toBe(false);
    expect(verhoeffCheckDigit("236")).toBe("3");
  });

  it("accepts only checksum-valid Aadhaar numbers", () => {
    expect(aadhaarValid(AADHAAR)).toBe(true);
    expect(aadhaarValid(`${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`)).toBe(true);
    expect(aadhaarValid("999999999998")).toBe(false);
    expect(aadhaarValid("123456789012")).toBe(false);
  });

  it("validates GSTIN check characters", () => {
    expect(gstinValid("27AAPFU0939F1ZV")).toBe(true);
    expect(gstinValid("27AAPFU0939F1ZX")).toBe(false);
  });

  it("finds identifiers in a line and ignores look-alikes", () => {
    expect(findIdentifiers(`const a = "${AADHAAR}"`).map((m) => m.kind)).toEqual(["aadhaar"]);
    expect(findIdentifiers(`pan: "${PAN}"`).map((m) => m.kind)).toEqual(["pan"]);
    expect(findIdentifiers("gstin 27AAPFU0939F1ZV").map((m) => m.kind)).toEqual(["gstin"]);
    expect(findIdentifiers("pay to shop.name@okaxis now").map((m) => m.kind)).toEqual(["upi"]);
    expect(findIdentifiers("mail someone@gmail.com")).toEqual([]);
    expect(findIdentifiers("order 123456789012 shipped")).toEqual([]);
    expect(findIdentifiers("version 1.2345.6789.0123")).toEqual([]);
  });

  it("redacts identifier values", () => {
    const out = redact(`aadhaar=${AADHAAR} pan=${PAN}`);
    expect(out).toBe("aadhaar=<AADHAAR> pan=<PAN>");
  });
});

describe("field classification", () => {
  it("classifies names across naming styles", () => {
    expect(classifyField("aadhaarNumber")).toBe("aadhaar");
    expect(classifyField("PAN_NUMBER")).toBe("pan");
    expect(classifyField("user_pan")).toBe("pan");
    expect(classifyField("dateOfBirth")).toBe("dob");
    expect(classifyField("bloodGroup")).toBe("health");
    expect(classifyField("span")).toBeNull();
    expect(classifyField("panel")).toBeNull();
    expect(classifyField("companyId")).toBeNull();
  });

  it("recognises protection hints", () => {
    expect(looksProtected("pan_number_encrypted", "text")).toBe(true);
    expect(looksProtected("aadhaar_hash", "text")).toBe(true);
    expect(looksProtected("aadhaar", "BYTEA")).toBe(true);
    expect(looksProtected("aadhaar_number", "varchar(12)")).toBe(false);
  });

  it("ignores prose inside strings but keeps interpolations", () => {
    expect(classesInCode(`log("phone number updated", userId)`)).toEqual([]);
    expect(classesInCode("log(`hello ${user.phone}`)").map((c) => c.dataClass)).toEqual(["phone"]);
    expect(classesInCode(`print(f"dob is {dob}")`).map((c) => c.dataClass)).toEqual(["dob"]);
    expect(stripStringLiterals(`a("x", b)`)).toBe(`a("", b)`);
  });
});

describe("files", () => {
  it("matches ignore globs", () => {
    expect(globToMatcher("examples/")("examples/app/a.ts")).toBe(true);
    expect(globToMatcher("*.sql")("db/init.sql")).toBe(true);
    expect(globToMatcher("src/**/gen")("src/a/b/gen/x.ts")).toBe(true);
    expect(globToMatcher("examples/")("src/examples.ts")).toBe(false);
  });

  it("detects test-like paths", () => {
    expect(isTestLike("src/__tests__/a.ts")).toBe(true);
    expect(isTestLike("src/user.test.ts")).toBe(true);
    expect(isTestLike("src/user.ts")).toBe(false);
  });
});

describe("erasure detection", () => {
  const compact = (s: string) => [s.toLowerCase().replace(/[\s_"'`]/g, "")];
  it("finds delete paths in common styles", () => {
    expect(hasErasurePath("users", compact("DELETE FROM users WHERE id = $1"))).toBe(true);
    expect(hasErasurePath("users", compact("await db.user.delete({ where })"))).toBe(true);
    expect(hasErasurePath("kyc_documents", compact("kycDocumentRepository.deleteById(id)"))).toBe(true);
    expect(hasErasurePath("Patient", compact("function anonymisePatient(id) {}"))).toBe(true);
    expect(hasErasurePath("users", compact("SELECT * FROM users"))).toBe(false);
  });
});

describe("scan", () => {
  const files = {
    "db/schema.sql": "CREATE TABLE customers (\n  id INT PRIMARY KEY,\n  aadhaar_number VARCHAR(12),\n  pan_hash TEXT,\n  email TEXT\n);\n",
    "src/app.ts": [
      `const sample = "${AADHAAR}";`,
      "logger.info(`kyc for ${customer.aadhaarNumber}`);",
      'logger.info("email sent");',
      "mixpanel.track('signup', {",
      "  email: customer.email,",
      "});",
      `const skipped = "${PAN}"; // dpdp-scan:ignore`,
    ].join("\n"),
    "test/fixtures/data.ts": `export const pan = "${PAN}";\n`,
  };

  it("reports each rule with the right location", async () => {
    const result = await scan({ root: repo(files), ai: "off" });
    const ids = result.findings.map((f) => `${f.ruleId} ${f.path}:${f.line} ${f.severity}`);
    expect(ids).toContain("DPDP001 src/app.ts:1 high");
    expect(ids).toContain("DPDP002 src/app.ts:2 high");
    expect(ids).toContain("DPDP004 src/app.ts:4 medium");
    expect(ids).toContain("DPDP003 db/schema.sql:3 high");
    expect(ids).toContain("DPDP005 db/schema.sql:3 low");
    expect(ids).toContain("DPDP001 test/fixtures/data.ts:1 medium");
    expect(ids.some((id) => id.includes("src/app.ts:3"))).toBe(false);
    expect(ids.some((id) => id.includes("src/app.ts:7"))).toBe(false);
    expect(result.thirdParties).toEqual(["Mixpanel"]);
    expect(result.inventory[0]?.columns.map((c) => c.column)).toEqual(["aadhaar_number", "pan_hash", "email"]);
  });

  it("clears the erasure finding once a delete path exists", async () => {
    const result = await scan({ root: repo({ ...files, "src/erase.ts": "await db.query('DELETE FROM customers WHERE id=$1')" }), ai: "off" });
    expect(result.findings.some((f) => f.ruleId === "DPDP005")).toBe(false);
  });

  it("honours excludes", async () => {
    const result = await scan({ root: repo(files), ai: "off", excludes: ["src/"] });
    expect(result.findings.every((f) => !f.path.startsWith("src/"))).toBe(true);
  });

  it("never writes identifier values into any report format", async () => {
    const result = await scan({ root: repo(files), ai: "off" });
    for (const format of ["pretty", "json", "sarif", "markdown", "html"] as const) {
      const text = render(result, format);
      expect(text).not.toContain(AADHAAR);
      expect(text).not.toContain(PAN);
    }
  });

  it("emits valid SARIF structure", async () => {
    const result = await scan({ root: repo(files), ai: "off" });
    const sarif = JSON.parse(render(result, "sarif"));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBe(result.findings.length);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBeGreaterThan(0);
  });

  it("does not follow symlinks out of the scan root", async () => {
    const outside = repo({ "secret.ts": `const a = "${AADHAAR}";\n` });
    const root = repo({ "src/ok.ts": "export {};\n" });
    symlinkSync(join(outside, "secret.ts"), join(root, "src/link.ts"));
    const result = await scan({ root, ai: "off" });
    expect(result.findings).toEqual([]);
    expect(result.filesScanned).toBe(1);
  });

  it("strips terminal control characters from pretty output", async () => {
    const result = await scan({ root: repo(files), ai: "off" });
    result.findings[0]!.ai = { verdict: "uncertain", confidence: 0.5, explanation: "x\u001b[2Jy", fix: "a\u001b]0;t\u0007b" };
    result.findings[0]!.path = "src/\u001b[31mapp.ts";
    const text = render(result, "pretty");
    expect(text).not.toMatch(/[\u001b\u0007]/);
  });

  it("escapes repository text in the HTML report", async () => {
    const root = repo({ "db/x.sql": "CREATE TABLE t (\n  email TEXT\n);\n", "src/<img src=x onerror=alert(1)>.ts": "console.log(user.email)\n" });
    const html = render(await scan({ root, ai: "off" }), "html");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("ai layer", () => {
  it("treats only loopback URLs as local", () => {
    expect(isLocalUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalUrl("http://localhost:11434")).toBe(true);
    expect(isLocalUrl("https://api.example.com")).toBe(false);
    expect(isLocalUrl("http://localhost.evil.com")).toBe(false);
  });

  it("refuses a remote model server unless allowed", async () => {
    const root = repo({ "a.ts": "console.log(user.email)\n" });
    await expect(scan({ root, ai: "on", aiOptions: { baseUrl: "https://api.example.com" } })).rejects.toThrow(/not local/);
    const auto = await scan({ root, ai: "auto", aiOptions: { baseUrl: "https://api.example.com" } });
    expect(auto.ai.used).toBe(false);
  });

  it("annotates findings without changing severity and sends redacted excerpts", async () => {
    const root = repo({ "src/app.ts": `const sample = "${AADHAAR}";\n` });
    const result = await scan({ root, ai: "off" });
    const bodies: string[] = [];
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(init?.body ?? "");
      const content = JSON.stringify({ verdict: "false_positive", confidence: 4, explanation: "synthetic", fix: "none" });
      return new Response(JSON.stringify({ message: { content } }), { status: 200 });
    }) as unknown as typeof fetch;
    const files = [{ path: "src/app.ts", text: "", lines: [`const sample = "${AADHAAR}";`], testLike: false }];
    const reviewed = await reviewFindings(result.findings, files, { ...AI_DEFAULTS, fetchImpl });
    expect(reviewed).toBe(1);
    expect(result.findings[0]?.severity).toBe("high");
    expect(result.findings[0]?.ai).toMatchObject({ verdict: "false_positive", confidence: 1 });
    expect(bodies.join("")).not.toContain(AADHAAR);
    expect(bodies.join("")).toContain("<AADHAAR>");
  });

  it("drops malformed model output", async () => {
    const root = repo({ "src/app.ts": "console.log(user.email)\n" });
    const result = await scan({ root, ai: "off" });
    const fetchImpl = (async () => new Response(JSON.stringify({ message: { content: "not json" } }), { status: 200 })) as unknown as typeof fetch;
    expect(await reviewFindings(result.findings, [], { ...AI_DEFAULTS, fetchImpl })).toBe(0);
    expect(result.findings[0]?.ai).toBeUndefined();
  });
});
