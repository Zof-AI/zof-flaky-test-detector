# @zofai/flaky-test-detector

Analyze repeated test outcomes locally to identify **observed instability**. The tool imports JUnit XML or explicit JSON observations, tracks pass/fail transitions, ranks tests for review, and distinguishes insufficient samples, missing observations, skipped tests and execution errors. It never executes or quarantines tests.

Observed inconsistency does not prove that a test is flaky. Source changes, changing inputs, infrastructure, or environment differences may explain it. No confidence score is presented as scientific certainty.

Version 0.1.0 is prepared under the Apache-2.0 license. Use the GitHub source installation below; npm registry publication is not claimed.

<!-- ZOF_RELEASE_INSTALL_START -->
## Install from GitHub source

Requires Node.js 22 or 24, npm, and Git. Filesystem operations require Linux or macOS with Python 3.10 or newer; Windows file operations fail closed. Clone this repository and explicitly prepare its reviewed release dependencies:

```sh
git clone https://github.com/Zof-AI/zof-flaky-test-detector.git
cd zof-flaky-test-detector
node scripts/bootstrap.mjs --allow-network
npm ci --ignore-scripts --prefer-offline
npm run build
npm test
```

The bootstrap downloads only the exact `v0.1.0` dependency assets from [GitHub Releases](https://github.com/Zof-AI/zof-flaky-test-detector/releases), as listed in `scripts/release-dependencies.json`, verifies SHA256 and byte size, and adds them to the npm cache. It does not extract archives, run package scripts, collect application data, or send credentials. Downloads require the explicit flag and follow only HTTPS GitHub asset redirects. Installation then fetches ordinary third-party dependencies from npm. Use a writable npm cache; set `npm_config_cache` consistently for both commands if needed. An unavailable asset, changed hash, or oversized response stops installation.

GitHub source and release artifacts are the initial distribution channel. These instructions do not claim that `@zofai` packages are published on npm or that the VS Code extension is listed in Marketplace.
<!-- ZOF_RELEASE_INSTALL_END -->

## Quick start

Requires Node.js 22 or 24. After the source installation above:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js --root examples --observations stable-observations.json --json
```

The output identifies three observed passing results for `stable`. The package identifier is `@zofai/flaky-test-detector`; the executable name is `zof-flaky-test-detector`.

## Three examples

```sh
# Three repeated JUnit runs: stable, failing, intermittent and insufficient-data cases.
# Exit 1 because observed instability was explicitly requested as a CI failure condition.
node dist/cli.js --root examples --junit junit/run-1.xml --junit junit/run-2.xml --junit junit/run-3.xml --json --fail-on-instability
# Three consistently observed passes; no claim about future stability.
node dist/cli.js --root examples --observations stable-observations.json --json
# A skipped run breaks transition adjacency; observed pass/fail sample count is two.
# Exit 3 because observations are incomplete.
node dist/cli.js --root examples --observations gapped-observations.json --min-samples 2 --json
```

JUnit arguments must be in chronological execution order; files are never sorted by filename. Duplicate paths are rejected. Each file represents one run. A path or user-provided run ID cannot establish that a run is authentic or independently executed.

## API and JSON contract

```js
import { detectFlakiness, analyzeJUnit, formatReport } from '@zofai/flaky-test-detector';
const report = await analyzeJUnit({
  root: '/absolute/path/to/synthetic-results',
  files: ['run-1.xml', 'run-2.xml', 'run-3.xml'],
  minSamples: 3
});
console.log(formatReport(report));
```

`detectFlakiness(runs, { minSamples? })` accepts an array of runs:

```json
[{"id":"run-1","status":"completed","tests":[{"name":"suite::test","status":"passed"}]}]
```

Run statuses are `completed`, `partial`, `missing` and `error`. Test outcomes are `passed`, `failed`, `skipped` and `error`. Run IDs and per-run test names must be unique, including after redaction. `analyzeObservationFile(root, relativePath, options?)` loads this format safely. Missing runs cannot contain test observations. Unknown fields and invalid statuses fail explicitly.

JUnit import uses the shared `@zofai/ci-evidence` normalizer. Test identity is `classname::name` where a class is supplied, otherwise `suite-name::name` for the nearest named suite, otherwise the test name. Ambiguous or redacted identity collisions fail rather than conflating tests. Malformed or unavailable artifacts become explicit run errors while usable observations are preserved.

Reports use `test-instability/v1`. Fields include `runCount`, `minSamples`, `complete`, ranked tests, `runIssues`, limitations, `verificationResult: "not-run"` and `quarantinedTests: []`. Per-test metrics include pass/fail/skipped/error/missing counts, evaluated samples, adjacent comparable pairs, transitions, observed failure rate and observed transition rate.

## Classification and calculations

The minimum pass/fail sample count defaults to 3 and may be set from 2 through 256.

- Fewer eligible samples: `insufficient-data`.
- Both passing and failing outcomes with enough samples: `observed-instability`.
- Otherwise, recorded execution errors: `execution-errors`.
- All eligible outcomes fail: `consistent-fail`.
- All eligible outcomes pass: `consistent-pass`.

An eligible sample is a reported pass or fail. Skipped, missing and error observations stay separate. `observedFailureRate = failed / (passed + failed)`, or null without eligible observations. A transition is a change between passing and failing in **adjacent input runs**. Skips, errors and missing tests break adjacency. `observedTransitionRate = transitions / comparableAdjacentPairs`, or null when no adjacent pair is comparable.

Ranking prioritizes observed instability, execution errors, consistent failure, insufficient data, then consistent passing. Within each category it sorts by descending transition count, descending failure count and test name. This is a review order, not a probability estimate. Error counts never silently become failed assertions.

`complete` means all supplied runs contain observations, each discovered test meets the threshold in every supplied run, and there are no missing/skipped/error outcomes. It does not prove test stability, outcome authenticity, or comprehensive test execution. A partial run can preserve explicitly reported case outcomes while keeping the whole report incomplete.

## CI and security

Exit codes are `0` analysis completed with sufficient observations, `1` observed instability when `--fail-on-instability` is set, `2` invalid input/identity or operational failure, and `3` incomplete observations. An explicitly requested instability failure takes precedence over incompleteness; both remain visible in JSON. Without the flag, inspect classifications directly. No exit status proves verification passed.

Input limits: up to 64 JUnit files, 4 MiB per file, 32 MiB total XML, 256 JSON runs, 10,000 cases per run, and 100,000 observations total. JSON files are limited to 4 MiB. Analysis and report serialization also obey the shared evidence bounds. XML document types and entities are prohibited; external resources are never fetched. No archive extraction occurs. Paths must stay inside an explicit root; symlinks, traversal and URL inputs cannot be read.

The importer ignores application logs, XML properties, failure bodies, environment variables and source content. Recognizable credentials and URL metadata are redacted. Avoid secrets in test names because no redactor can recognize every arbitrary secret. Reads are anchored to directory descriptors and reject symlink replacement; file contents can still change during capture. No network, commands or repository tests run during analysis. No automatic quarantine or uploaded evidence is performed.

## Validation and release

```sh
npm test
npm pack --ignore-scripts
```

Tests cover deterministic JUnit outcomes, qualified identity handling, exact transition denominators, gaps, insufficient samples, duplicate observations, XXE, malformed/oversized XML, missing files, symlinks, redaction, documented CLI commands and a clean tarball installation with explicit candidate dependencies. CI targets Linux/macOS on Node 22/24; only completed jobs establish platform verification. See [security policy](SECURITY.md) and [release procedure](docs/RELEASE.md). Registry publication and live registry installation are not claimed.
