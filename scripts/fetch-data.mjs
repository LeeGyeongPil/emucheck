#!/usr/bin/env node
// Developer script: download the public aws-emulator evidence and build a data snapshot.
//
//   npm run build && node scripts/fetch-data.mjs --release v1.0.489
//   node scripts/fetch-data.mjs                      (newest release; then use the printed --data command)
//   node scripts/fetch-data.mjs --skip-download --work /path/to/raw --out data/aws-emulator-v1.0.489.json.gz
//
// Needs network access, `git` and `unzip`. The tests never run this script; they use
// test/fixtures/raw and call the builder (src/data/build.ts) directly.
//
// The raw files go to <tmp>/emucheck-raw-<release> (one folder per release, so a run for a newer
// release never reuses the clone of an older one). The snapshot goes to data/aws-emulator-<release>.json.gz
// and data/NOTICE is refreshed next to it. The CLI keeps reading the bundled snapshot until you pass
// `--data <file>` (or set EMUCHECK_DATA); the script prints that command at the end.
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const skipDownload = args.includes("--skip-download");
let work = opt("work", "") ? resolve(opt("work", "")) : "";

/** True when the sparse clone was made from exactly this release tag. */
function cloneIsAt(clone, tag) {
  try {
    const out = execFileSync("git", ["-C", clone, "describe", "--tags", "--exact-match"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() === tag;
  } catch {
    return false;
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "user-agent": "emucheck-fetch-data" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function download(url, file) {
  const res = await fetch(url, { headers: { "user-agent": "emucheck-fetch-data" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

/** Refresh data/NOTICE (sources, pinned versions, licenses) next to the snapshot. */
function writeNotice(file, meta) {
  const text = `emucheck data NOTICE

The snapshot files in this folder are derived data. They contain only operation and service names,
counts, file paths and severities taken from the public sources below. No source code or
documentation text of those projects is copied.

Sources (pinned for this snapshot)

1. aws/aws-emulator ${meta.release}, commit ${meta.commit} (scores.json.gz, open issue record
   headers, handler file names). License: CC0-1.0 (vendor/ excluded, Apache-2.0).
   https://github.com/aws/aws-emulator
2. aws/aws-emulator-evaluation-suite, commit ${meta.manifestCommit} (manifest.jsonl).
   License: CC0-1.0.
   https://github.com/aws/aws-emulator-evaluation-suite
3. botocore ${meta.botocore} (service and operation names from service-2.json).
   License: Apache-2.0.
   https://pypi.org/project/botocore/

emucheck is an unofficial tool and is not affiliated with or endorsed by AWS.

Built at ${meta.builtAt} by scripts/fetch-data.mjs.
data/name-overrides.json is hand-written by emucheck (MIT).
`;
  writeFileSync(file, text);
}

let release = opt("release", "");
if (skipDownload && !work) {
  console.error("--skip-download needs --work <dir> with the raw files of an earlier run. Run without --skip-download first.");
  process.exit(2);
}

if (!skipDownload) {
  const rel = await getJson(
    release
      ? `https://api.github.com/repos/aws/aws-emulator/releases/tags/${release}`
      : "https://api.github.com/repos/aws/aws-emulator/releases/latest",
  );
  release = rel.tag_name;
  const asset = rel.assets.find((a) => a.name === "scores.json.gz");
  if (!asset) throw new Error(`release ${release} has no scores.json.gz asset`);
  console.log(`release ${release}`);
  if (!work) work = join(tmpdir(), `emucheck-raw-${release}`);
  mkdirSync(work, { recursive: true });

  await download(asset.browser_download_url, join(work, "scores.json.gz"));
  writeFileSync(join(work, "scores.json"), gunzipSync(readFileSync(join(work, "scores.json.gz"))));

  const suite = await getJson("https://api.github.com/repos/aws/aws-emulator-evaluation-suite/commits/main");
  await download(
    `https://raw.githubusercontent.com/aws/aws-emulator-evaluation-suite/${suite.sha}/manifest.jsonl`,
    join(work, "manifest.jsonl"),
  );

  const clone = join(work, "emu");
  if (existsSync(clone) && !cloneIsAt(clone, release)) {
    console.log(`existing clone in ${clone} is not at ${release}; cloning again`);
    rmSync(clone, { recursive: true, force: true });
  }
  if (!existsSync(clone)) {
    execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", release, "https://github.com/aws/aws-emulator.git", clone], { stdio: "inherit" });
    execFileSync("git", ["-C", clone, "sparse-checkout", "set", "--no-cone", "/issues/things-that-do-not-work/", "/services/*/src/ops/"], { stdio: "inherit" });
  }
  for (const [name, target] of [["issues", join(clone, "issues", "things-that-do-not-work")], ["services", join(clone, "services")]]) {
    rmSync(join(work, name), { recursive: true, force: true });
    symlinkSync(target, join(work, name));
  }

  const pypi = await getJson("https://pypi.org/pypi/botocore/json");
  const wheel = pypi.urls.find((u) => u.packagetype === "bdist_wheel");
  await download(wheel.url, join(work, "botocore.whl"));
  rmSync(join(work, "bc-tmp"), { recursive: true, force: true });
  rmSync(join(work, "botocore"), { recursive: true, force: true });
  execFileSync("unzip", ["-q", "-o", join(work, "botocore.whl"), "botocore/data/*/*/service-2.json*", "-d", join(work, "bc-tmp")]);
  renameSync(join(work, "bc-tmp", "botocore", "data"), join(work, "botocore"));
  rmSync(join(work, "bc-tmp"), { recursive: true, force: true });

  writeFileSync(
    join(work, "meta.json"),
    `${JSON.stringify({ release, manifestCommit: suite.sha, botocore: pypi.info.version })}\n`,
  );
} else if (!release) {
  release = JSON.parse(readFileSync(join(work, "meta.json"), "utf8")).release;
}

const { buildSnapshot } = await import(new URL("../dist/data/build.js", import.meta.url));
const snapshot = buildSnapshot({ rawDir: work });
const out = resolve(root, opt("out", `data/aws-emulator-${release}.json.gz`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gzipSync(Buffer.from(JSON.stringify(snapshot)), { level: 9 }));
writeNotice(join(dirname(out), "NOTICE"), snapshot.meta);
const stubs = Object.values(snapshot.ops).filter((o) => o.stub).length;
console.log(
  `wrote ${out}: ${Object.keys(snapshot.services).length} services, ${Object.keys(snapshot.ops).length} operations with evidence, ${stubs} stubs, ` +
    `${snapshot.meta.unparsedIssues} unparsed issue files`,
);
// The CLI reads the bundled snapshot unless told otherwise, so say how to use the new file.
console.log(`\nTo use this snapshot:\n  emucheck check . --data ${out}\n  (or set EMUCHECK_DATA=${out})`);
