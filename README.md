# @zof-ai/flaky-test-detector

Analyze repeated test outcomes locally to identify **observed instability**. The tool imports JUnit XML or explicit JSON observations, tracks pass/fail transitions, ranks tests for review, and distinguishes insufficient samples, missing observations, skipped tests and execution errors. It never executes or quarantines tests.

Observed inconsistency does not prove that a test is flaky. Source changes, changing inputs, infrastructure, or environment differences may explain it. No confidence score is presented as scientific certainty.

This is an unreleased candidate. Registry namespace, GitHub URLs and Apache-2.0 licensing require approval. Candidate dependencies must be staged from reviewed tarballs until approved publication. Public registry installation has not been verified.

## Quick start

Requires Node.js 22 or 24. In a prepared candidate environment, or after approved dependency publication:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js --root examples --observations stable-observations.json --json
```

The output identifies three observed passing results for `stable`. The candidate registry name is `@zof-ai/flaky-test-detector`; the executable name is `zof-flaky-test-detector`.

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
import { detectFlakiness, analyzeJUnit, formatReport } from '@zof-ai/flaky-test-detector';
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

JUnit import uses the shared `@zof-ai/ci-evidence` normalizer. Test identity is `classname::name` where a class is supplied, otherwise `suite-name::name` for the nearest named suite, otherwise the test name. Ambiguous or redacted identity collisions fail rather than conflating tests. Malformed or unavailable artifacts become explicit run errors while usable observations are preserved.

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

The importer ignores application logs, XML properties, failure bodies, environment variables and source content. Recognizable credentials and URL metadata are redacted. Avoid secrets in test names because no redactor can recognize every arbitrary secret. Read a stable staging directory; this tool is not a sandbox against concurrent hostile filesystem mutation. No network, commands or repository tests run during analysis. No automatic quarantine or uploaded evidence is performed.

## Validation and release

```sh
npm test
npm pack --ignore-scripts
```

Tests cover deterministic JUnit outcomes, qualified identity handling, exact transition denominators, gaps, insufficient samples, duplicate observations, XXE, malformed/oversized XML, missing files, symlinks, redaction, documented CLI commands and a clean tarball installation with explicit candidate dependencies. Cross-platform CI is configured; locally completed runs verify macOS/Node 22. See [security policy](SECURITY.md) and [release procedure](docs/RELEASE.md). Public publication and published installation checks remain approval gates.
