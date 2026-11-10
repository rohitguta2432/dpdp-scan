# dpdp-scan

AI-enabled scanner that finds Indian personal data in a codebase and maps the gaps to India's Digital Personal Data Protection Act, 2023 (DPDP).

It answers the first question of any DPDP programme: what personal data do we hold, where is it, and where is it leaking? Core obligations under the DPDP Rules, 2025 apply from 13 May 2027.

![15 second demo](docs/demo.mp4)

```
HIGH   DPDP003  db/001_init.sql:7
       Aadhaar column `users.aadhaar_number` has no visible encryption, hashing, or masking  [Act s.8(5); Rules r.6]
       AI true positive (100%): The Aadhaar number is stored in plaintext without encryption, hashing, or masking.

HIGH   DPDP002  src/gesture.ts:3
       PAN (`pan`) passed to a log call  [Act s.8(5); Rules r.6]
       AI false positive (95%): `pan` refers to a map gesture, not a Permanent Account Number.

MEDIUM DPDP004  src/kyc.ts:15
       email address (`email`) sent to Segment  [Act s.8(2), s.5, s.6]
```

## Quick start

Requires Node.js 22 or later. No runtime dependencies.

```bash
git clone https://github.com/rohitguta2432/dpdp-scan && cd dpdp-scan
npm install && npm run build
node dist/cli.js /path/to/your/repo
```

Try it on the bundled leaky demo app:

```bash
node dist/cli.js examples/leaky-app --html report.html --inventory inventory.md
```

Open `report.html#demo` for a scripted 15 second walkthrough of the report.

## What it detects

| Rule | Finds | Reference |
| --- | --- | --- |
| DPDP001 | Identifier values committed to the repo: Aadhaar (Verhoeff checksum), PAN, GSTIN (checksum), UPI ID, IFSC, +91 mobile, voter ID, passport | Act s.8(5); Rules r.6 |
| DPDP002 | Personal data passed to log calls (`console.log`, `logger.info`, `print`, `System.out.println`, and others) | Act s.8(5); Rules r.6 |
| DPDP003 | High-risk columns with no visible encryption, hashing, or masking, in SQL, Prisma, JPA entities, and Django or SQLAlchemy models | Act s.8(5); Rules r.6 |
| DPDP004 | Personal data sent to third parties: Segment, Mixpanel, Amplitude, PostHog, Sentry, Google Analytics, Firebase, Meta Pixel, CleverTap, MoEngage, WebEngage, Intercom, Datadog | Act s.8(2), s.5, s.6 |
| DPDP005 | Tables holding personal data with no delete or anonymise path anywhere in the code | Act s.8(7), s.12; Rules r.8 |

It also writes a **personal data inventory**: every personal data column, its category, whether protection is visible, whether an erasure path exists, and which third parties receive data.

## How AI is used

Detection is deterministic. AI runs after it, on a local model through [Ollama](https://ollama.com), and does three things:

1. **Classifies** each finding as true positive, false positive, or uncertain. A `pan` variable in map-gesture code and a checksum-valid test fixture are typical false positives.
2. **Explains** the risk and suggests a concrete fix.
3. **Describes** each inventory table with a likely purpose and retention approach.

Guardrails:

- **The exit code depends only on deterministic findings.** AI annotates; it never changes severity or fails a build, so CI results are reproducible.
- **Local by default.** A non-local `--ai-url` is refused unless you pass `--allow-remote-ai`.
- **Values are redacted** before any excerpt reaches the model: an Aadhaar number becomes `<AADHAAR>`.
- **Repository text is treated as untrusted.** Model output is schema-constrained, and reports escape everything.

```bash
ollama pull qwen3:14b
node dist/cli.js . --ai on            # fail if the model is unavailable
node dist/cli.js . --ai off           # deterministic only
node dist/cli.js . --model qwen2.5:14b
```

`--ai auto` (the default) uses AI when a local Ollama server has the model and skips it otherwise. AI fix suggestions are model output and need review before use.

## Output formats

```bash
node dist/cli.js . --format sarif --out dpdp.sarif    # GitHub code scanning
node dist/cli.js . --format json
node dist/cli.js . --format markdown                   # data inventory + findings
node dist/cli.js . --format html --out report.html     # single-file report
```

Reports never contain the identifier values themselves, only their location and kind.

## GitHub Action

```yaml
permissions:
  contents: read
  security-events: write
jobs:
  dpdp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rohitguta2432/dpdp-scan@main
        with:
          fail-on: high
```

## Ignoring findings

- One line: add `// dpdp-scan:ignore` on the line, or `// dpdp-scan:ignore-next-line` above it.
- Paths: list globs in `.dpdpignore`, or pass `--exclude 'fixtures/**'`.
- Findings under test, fixture, mock, seed, and example paths are reported one severity level lower.

## Limits

Read these before relying on the output.

- **This is not a compliance determination and not legal advice.** A code scan cannot see consent flows, contracts, notices, or data that lives outside the repository. Rule references are pointers for a reviewer.
- Detection is line and pattern based, not full data-flow analysis. A value renamed before it is logged will be missed.
- "No visible protection" means no hint in the column name or type. Encryption applied in application code or at the disk level is not seen.
- The erasure check is a heuristic over names. Erasure done by a separate service will show as missing.
- Risk tiers (high, medium, low) are this tool's triage order. The DPDP Act does not define a "sensitive" data class.
- PAN, UPI, IFSC, voter ID, and passport matches are format matches without a public checksum, so false positives are possible.

## Roadmap

- Tree-sitter data-flow tracking across assignments and function calls
- Automatic fix pull requests
- TypeORM, Mongoose, Sequelize, and Rails schemas
- npm release (`npx dpdp-scan`)
- Baseline file to report only new findings

## Development

```bash
npm install
npm run build
npm test
```

## License

Apache-2.0
