import { readFileSync } from "node:fs";
import type { ServiceInfo, Snapshot } from "./types.js";

interface Overrides {
  smithyNamespaces: Record<string, string>;
  cloudformation: Record<string, string>;
  terraformPrefixes: [string, string][];
}

let overridesCache: Overrides | undefined;

/** Load the exception table that ships in `data/name-overrides.json`. */
export function loadOverrides(): Overrides {
  if (!overridesCache) {
    const url = new URL("../data/name-overrides.json", import.meta.url);
    overridesCache = JSON.parse(readFileSync(url, "utf8")) as Overrides;
  }
  return overridesCache;
}

/** Lower-case alphanumerics only; the smithy namespace rule for a botocore `serviceId`. */
export function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** JS package suffix for a botocore `serviceId` (`CloudWatch Logs` becomes `cloudwatch-logs`). */
export function jsPackageName(serviceId: string): string {
  return serviceId.toLowerCase().replace(/ /g, "-");
}

const FIRST_CAP = /(.)([A-Z][a-z]+)/g;
const NUMBER_CAP = /([a-z])([0-9]+)/g;
const END_CAP = /([a-z0-9])([A-Z])/g;
const SPECIAL_CASE = /[A-Z]{2,}s$/;

/**
 * Port of botocore's `xform_name`: converts an operation name such as `DescribeDBInstances`
 * to the snake_case method name boto3 exposes (`describe_db_instances`).
 */
export function xformName(name: string, sep = "_"): string {
  if (name.includes(sep)) return name;
  let value = name;
  const special = SPECIAL_CASE.exec(value);
  if (special) {
    value = `${value.slice(0, value.length - special[0].length)}${sep}${special[0].toLowerCase()}`;
  }
  const s1 = value.replace(FIRST_CAP, `$1${sep}$2`);
  const s2 = s1.replace(NUMBER_CAP, `$1${sep}$2`);
  return s2.replace(END_CAP, `$1${sep}$2`).toLowerCase();
}

/** Look-up tables that translate every naming scheme to the boto3 service name. */
export class Names {
  private readonly services: Record<string, ServiceInfo>;
  private readonly jsToService = new Map<string, string>();
  private readonly nsToService = new Map<string, string>();
  private readonly compactToService = new Map<string, string>();
  private readonly opSets = new Map<string, Set<string>>();
  private readonly snakeMaps = new Map<string, Map<string, string>>();
  private readonly overrides: Overrides;

  constructor(snapshot: Pick<Snapshot, "services">) {
    this.services = snapshot.services;
    this.overrides = loadOverrides();
    for (const name of Object.keys(this.services).sort()) {
      const info = this.services[name]!;
      if (!this.jsToService.has(info.js)) this.jsToService.set(info.js, name);
      if (!this.nsToService.has(info.ns)) this.nsToService.set(info.ns, name);
      const c = compact(info.serviceId);
      if (!this.compactToService.has(c)) this.compactToService.set(c, name);
    }
    for (const [ns, service] of Object.entries(this.overrides.smithyNamespaces)) {
      this.nsToService.set(ns, service);
    }
  }

  hasService(service: string): boolean {
    return Object.hasOwn(this.services, service);
  }

  /** Operations of a service according to botocore; empty when the service is unknown. */
  opsOf(service: string): Set<string> {
    let set = this.opSets.get(service);
    if (!set) {
      set = new Set(this.services[service]?.ops ?? []);
      this.opSets.set(service, set);
    }
    return set;
  }

  hasOp(service: string, op: string): boolean {
    return this.opsOf(service).has(op);
  }

  /** `@aws-sdk/client-<suffix>` suffix to boto3 name, for example `sfn` to `stepfunctions`. */
  fromJsPackage(suffix: string): string | undefined {
    return this.jsToService.get(suffix) ?? (this.hasService(suffix) ? suffix : undefined);
  }

  /** Smithy namespace (`cloudwatchlogs`) to boto3 name. */
  fromSmithyNamespace(ns: string): string | undefined {
    return this.nsToService.get(ns);
  }

  /** CloudFormation type namespace (`Logs` in `AWS::Logs::LogGroup`) to boto3 name. */
  fromCloudFormation(typeName: string): string | undefined {
    const parts = typeName.split("::");
    if (parts[0] !== "AWS" || parts.length < 3) return undefined;
    const table = this.overrides.cloudformation;
    const pair = `${parts[1]}::${parts[2]}`;
    const hit = table[pair] ?? table[parts[1]!];
    if (hit) return hit;
    return this.byLooseName(parts[1]!);
  }

  /** Terraform resource or data type (`aws_sfn_state_machine`) to boto3 name. */
  fromTerraform(type: string): string | undefined {
    if (!type.startsWith("aws_")) return undefined;
    const rest = type.slice("aws_".length);
    for (const [prefix, service] of this.overrides.terraformPrefixes) {
      if (rest === prefix || rest.startsWith(prefix)) return service;
    }
    const tokens = rest.split("_");
    for (let n = 1; n <= Math.min(tokens.length, 3); n++) {
      const hit = this.byLooseName(tokens.slice(0, n).join(""));
      if (hit) return hit;
    }
    return undefined;
  }

  /** Reverse of `xformName`: `describe_db_instances` becomes `DescribeDBInstances`. */
  opFromSnake(service: string, snake: string): string | undefined {
    let map = this.snakeMaps.get(service);
    if (!map) {
      map = new Map();
      for (const op of this.opsOf(service)) {
        const key = xformName(op);
        if (!map.has(key)) map.set(key, op);
      }
      this.snakeMaps.set(service, map);
    }
    return map.get(snake);
  }

  private byLooseName(name: string): string | undefined {
    const lower = name.toLowerCase();
    if (this.hasService(lower)) return lower;
    return this.compactToService.get(compact(name)) ?? this.nsToService.get(compact(name));
  }
}

/** PascalCase guess for a snake_case method that is not in the operation list. */
export function pascalCase(snake: string): string {
  return snake
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
