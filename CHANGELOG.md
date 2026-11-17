# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-17

### Added

- `check`, `scan`, `explain` and `data-info` commands.
- Static extraction of AWS SDK for JavaScript v3 calls (imports, `lib-dynamodb`, `lib-storage` Upload, paginators, aggregated clients) with `@babel/parser`.
- Static extraction of boto3 calls (clients, sessions, resources, paginators, inline clients) with a built-in Python tokenizer.
- Extraction of resource types from CloudFormation JSON/YAML (including `cdk.out`) and Terraform.
- Ordered grades `unknown-op`, `absent`, `stub`, `failing`, `partial`, `untested`, `passing` with confidence and evidence links; wire-step evidence ranks above behavioral aggregates.
- Table, JSON and SARIF 2.1.0 output, and a `--fail-on` exit code for CI.
- Bundled snapshot of aws-emulator v1.0.489 (scores, evaluation-suite manifest, open issue records, scaffolded stubs, handler lists, botocore names) plus `scripts/fetch-data.mjs` to rebuild it.
- English and Korean output selected with `--lang`, `EMUCHECK_LANG`, `LC_ALL`, `LC_MESSAGES` or `LANG`.
- Library API: `scan`, `check`, `explain`, `loadSnapshot`, `buildSnapshot` and the report renderers.
