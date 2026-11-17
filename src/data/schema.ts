import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Snapshot } from "../types.js";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Raised when a snapshot file is missing, unreadable, or has an unsupported format. */
export class SnapshotFormatError extends Error {
  override name = "SnapshotFormatError";
}

/** Path of the snapshot that ships inside the package. */
export const BUNDLED_SNAPSHOT_URL = new URL("../../data/aws-emulator-v1.0.489.json.gz", import.meta.url);

let bundled: Snapshot | undefined;

/** Check the shape of a parsed snapshot and return it typed. */
export function validateSnapshot(value: unknown, source = "snapshot"): Snapshot {
  const v = value as Partial<Snapshot> | null;
  if (!v || typeof v !== "object") throw new SnapshotFormatError(`${source}: expected a JSON object.`);
  if (v.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotFormatError(
      `${source}: unsupported schemaVersion ${String(v.schemaVersion)} (this emucheck reads version ${SNAPSHOT_SCHEMA_VERSION}). ` +
        "Upgrade emucheck or rebuild the snapshot with scripts/fetch-data.mjs.",
    );
  }
  if (!v.meta || typeof v.meta !== "object" || !v.services || typeof v.services !== "object" || !v.ops || typeof v.ops !== "object") {
    throw new SnapshotFormatError(`${source}: missing meta, services or ops section.`);
  }
  return v as Snapshot;
}

/**
 * Load a snapshot. Order: explicit `path`, then the `EMUCHECK_DATA` environment variable,
 * then the bundled snapshot. `.gz` files and plain JSON are both accepted.
 */
export function loadSnapshot(path?: string): Snapshot {
  const explicit = path ?? process.env["EMUCHECK_DATA"];
  if (!explicit) {
    bundled ??= readSnapshotFile(BUNDLED_SNAPSHOT_URL);
    return bundled;
  }
  return readSnapshotFile(explicit);
}

function readSnapshotFile(location: string | URL): Snapshot {
  const label = typeof location === "string" ? location : location.pathname;
  let raw: Buffer;
  try {
    raw = readFileSync(location);
  } catch (error) {
    throw new SnapshotFormatError(`Cannot read snapshot ${label}: ${(error as Error).message}. Check the path given to --data or EMUCHECK_DATA.`);
  }
  const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  let text: string;
  try {
    text = (isGzip ? gunzipSync(raw) : raw).toString("utf8");
  } catch (error) {
    throw new SnapshotFormatError(`Cannot decompress snapshot ${label}: ${(error as Error).message}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SnapshotFormatError(`Snapshot ${label} is not valid JSON: ${(error as Error).message}.`);
  }
  return validateSnapshot(parsed, label);
}
