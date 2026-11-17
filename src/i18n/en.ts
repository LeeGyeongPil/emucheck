/** English messages. Keys must match `ko.ts` exactly (checked by test/i18n.test.ts). */
export const en: Record<string, string> = {
  "help.text": `emucheck {version} - check which AWS calls in your code the local AWS emulator can serve

Usage:
  emucheck check [paths...]     grade every AWS API call and IaC resource (default path: .)
  emucheck scan [paths...]      list the AWS calls and resources found, without grading
  emucheck explain <svc:Op>     show all evidence for one operation, e.g. dynamodb:PutItem
  emucheck data-info            show which emulator data snapshot is bundled

Options:
  --format table|json|sarif     output format (check; scan supports table|json), default table
  --fail-on <grades>|none       check: exit 1 when one of these grades is found,
                                comma separated, default absent,stub
                                grades: unknown-op absent stub failing partial untested passing
  --show-unresolved             list calls whose operation could not be determined
  --ignore <dir>                skip directories with this name (repeatable)
  --data <file>                 use another snapshot file (or set EMUCHECK_DATA)
  --lang en|ko                  output language (or set EMUCHECK_LANG, LC_ALL, LANG)
  -h, --help                    show this help
  -v, --version                 show the version

Exit codes: 0 ok, 1 --fail-on grade found, 2 usage or input error.
Unofficial tool. Results describe the bundled snapshot, not the newest emulator release.`,

  "table.snapshot": "Snapshot: aws-emulator {release} - commit {commit} - scored {scoredAt} - botocore {botocore}",
  "table.col.grade": "GRADE",
  "table.col.conf": "CONF",
  "table.col.operation": "OPERATION",
  "table.col.where": "WHERE",
  "table.col.evidence": "EVIDENCE",
  "table.col.note": "NOTE",
  "table.col.type": "TYPE",
  "table.col.service": "SERVICE",
  "table.conf.high": "high",
  "table.conf.low": "low",
  "table.resources": "Infrastructure resources (service level only)",
  "table.unresolved": "Unresolved calls (operation could not be determined)",
 
  "table.col.how": "PATTERN",
  "table.extraction.certain": "certain",
  "table.extraction.inferred": "inferred",
  "scan.summary": "{calls} calls, {resources} resources, {unresolved} unresolved - {files} files scanned",
  "table.none": "No AWS SDK calls or resources found in {files} files.",

  "evidence.wire": "wire {pass} pass / {fail} fail",
  "evidence.behavioral": "related checks {pass} pass / {fail} fail",
  "evidence.stub": "scaffolded stub",
  "evidence.none": "no tests",

  "summary.line": "{findings} {opWord} at {sites} {siteWord} - {certain} certain, {inferred} inferred, {unresolved} unresolved - {files} files scanned",
  "word.operation.one": "operation",
  "word.operation.other": "operations",
  "word.site.one": "call site",
  "word.site.other": "call sites",
  "summary.grades": "Grades: {list}",
  "summary.hint.unresolved": "Run with --show-unresolved to list the unresolved calls.",
  "summary.gate.fail": "Gate failed: found {grades} (--fail-on {failOn}). Exit code 1.",
  "summary.gate.pass": "Gate passed (--fail-on {failOn}).",
  "summary.gate.none": "No gate (--fail-on none).",
  "warn.stale": "Warning: the data snapshot is {days} days old (scored {scoredAt}). Results describe that moment, not the newest emulator release.",

  "grade.unknown-op": "unknown-op",
  "grade.absent": "absent",
  "grade.stub": "stub",
  "grade.failing": "failing",
  "grade.partial": "partial",
  "grade.untested": "untested",
  "grade.passing": "passing",
  "grade.desc.unknown-op": "not an operation of that AWS service (typo or extraction error)",
  "grade.desc.absent": "the emulator has no handler or no service for it",
  "grade.desc.stub": "scaffolded handler that answers HTTP 501 NotImplemented",
  "grade.desc.failing": "every recorded wire step for it fails",
  "grade.desc.partial": "mixed results, or only weak evidence of a problem",
  "grade.desc.untested": "no test evidence either way",
  "grade.desc.passing": "recorded tests pass",

  "note.unknown-service": "unknown service \"{service}\"",
  "note.unknown-operation": "{service} has no operation \"{op}\"",
  "note.did-you-mean": "did you mean {op}?",
  "note.service-absent": "the emulator has no {service} service",
  "note.op-absent": "{service}:{op} has no handler in the emulator",
  "note.stub-501": "calls get HTTP 501",
  "note.open-issues": "{count} open record(s) in things-that-do-not-work",
  "note.stale-possible": "open record may be stale",
  "note.behavioral-only": "only related checks fail ({fail} of {total}); the failing step may be another operation",
  "note.related-behavioral-failures": "related checks fail ({fail} of {total}); wire steps pass",
  "note.service-level": "service present, fidelity {pass}/{total} tests pass; no per-operation evidence",

  "unresolved.reason.dynamic-method": "method name is computed at run time",
  "unresolved.reason.dynamic-getattr": "getattr with a computed name",
  "unresolved.reason.parse-error": "file could not be parsed",

  "explain.title": "{key} - {grade} ({confidence} confidence)",
  "explain.grade": "Meaning: {text}",
  "explain.wire": "Wire steps: {pass} pass, {fail} not passing",
  "explain.failed-units": "Failing units: {units}",
  "explain.behavioral": "Related behavioral checks: {pass} pass, {fail} fail, {skipped} skipped ({checks} checks)",
  "explain.issues": "Open records: {count}",
  "explain.issues-more": "  ... and {count} more",
  "skipped.title": "Skipped {count} file(s) that were not analyzed:",
  "skipped.more": "  ... and {count} more",
  "skipped.reason.too-large": "over 5 MB",
  "skipped.reason.unreadable": "could not be read",
  "skipped.reason.template-parse": "template could not be parsed completely",
  "explain.stub": "Stub handler: {path}",
  "explain.links": "Links:",
  "explain.notes": "Notes:",

  "info.title": "Bundled emulator data snapshot",
  "info.release": "aws-emulator release: {value}",
  "info.commit": "scores commit: {value}",
  "info.scoredAt": "scored at: {value}",
  "info.manifest": "evaluation-suite commit: {value}",
  "info.botocore": "botocore: {value}",
  "info.builtAt": "built at: {value}",
  "info.counts": "services: {services} ({emulated} in the emulator), operations with evidence: {ops}, stubs: {stubs}",
  "info.units": "test units: {units}, unparsed issue files: {unparsed}",
  "info.age": "age: {days} days",

  "error.unknown-command": "Unknown command \"{name}\". Run emucheck --help.",
  "error.missing-key": "explain needs an operation such as dynamodb:PutItem.",
  "error.bad-key": "\"{key}\" is not in the form service:Operation, for example dynamodb:PutItem.",
  "error.bad-format": "Unknown format \"{value}\". Use table, json or sarif.",
  "error.bad-grade": "Unknown grade \"{value}\" in --fail-on. Use none or a comma separated list of: {grades}.",
  "error.bad-lang": "Unsupported language \"{value}\". Use en or ko.",
  "error.bad-option": "Invalid option: {detail}. Run emucheck --help.",
  "error.path-not-found": "Path not found: {path}. Pass an existing file or directory, for example emucheck check .",
  "error.snapshot": "Snapshot problem: {detail}",
  "error.scan-format": "scan supports --format table or json.",
};
