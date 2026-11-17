import type { Names } from "../names.js";
import { pascalCase } from "../names.js";
import type { Call, Unresolved } from "../types.js";
import { tokenizePython, type Token } from "./pytokens.js";

/** What an expression evaluates to, as far as boto3 is concerned. */
type Value =
  | { k: "boto3" }
  | { k: "session" }
  | { k: "client"; svc: string }
  | { k: "resource"; svc: string }
  | { k: "robj"; svc: string; type: string }
  | { k: "paginator"; svc: string; name: string }
  | null;

/** Client attributes that are not API operations. */
const NON_API_CLIENT_METHODS = new Set([
  "get_paginator",
  "get_waiter",
  "can_paginate",
  "close",
  "generate_presigned_url",
  "generate_presigned_post",
  "waiter_names",
  "meta",
  "exceptions",
]);

/** Methods boto3 injects into a client that are not in the service model. */
const INJECTED_CLIENT_METHODS: Record<string, Record<string, string[]>> = {
  s3: {
    upload_file: ["PutObject"],
    upload_fileobj: ["PutObject"],
    download_file: ["GetObject"],
    download_fileobj: ["GetObject"],
    copy: ["CopyObject"],
  },
};

/** Hand-written resource action table (a generated table from the boto3 resource models is planned). */
const RESOURCE_ACTIONS: Record<string, Record<string, string[]>> = {
  "dynamodb/resource": { create_table: ["CreateTable"], batch_get_item: ["BatchGetItem"], batch_write_item: ["BatchWriteItem"] },
  "dynamodb/Table": {
    query: ["Query"],
    scan: ["Scan"],
    put_item: ["PutItem"],
    get_item: ["GetItem"],
    update_item: ["UpdateItem"],
    delete_item: ["DeleteItem"],
    batch_writer: ["BatchWriteItem"],
    load: ["DescribeTable"],
    delete: ["DeleteTable"],
    update: ["UpdateTable"],
  },
  "s3/resource": { create_bucket: ["CreateBucket"] },
  "s3/Bucket": {
    upload_file: ["PutObject"],
    upload_fileobj: ["PutObject"],
    download_file: ["GetObject"],
    download_fileobj: ["GetObject"],
    put_object: ["PutObject"],
    create: ["CreateBucket"],
    delete: ["DeleteBucket"],
    delete_objects: ["DeleteObjects"],
    copy: ["CopyObject"],
  },
  "s3/Object": {
    put: ["PutObject"],
    get: ["GetObject"],
    delete: ["DeleteObject"],
    upload_file: ["PutObject"],
    download_file: ["GetObject"],
    copy_from: ["CopyObject"],
    load: ["HeadObject"],
  },
  "sqs/resource": { create_queue: ["CreateQueue"], get_queue_by_name: ["GetQueueUrl"] },
  "sqs/Queue": {
    send_message: ["SendMessage"],
    send_messages: ["SendMessageBatch"],
    receive_messages: ["ReceiveMessage"],
    delete: ["DeleteQueue"],
    purge: ["PurgeQueue"],
  },
  "sns/resource": { create_topic: ["CreateTopic"] },
  "sns/Topic": { publish: ["Publish"], subscribe: ["Subscribe"], delete: ["DeleteTopic"] },
};

interface Binding {
  line: number;
  value: Exclude<Value, null>;
}

export interface PythonExtraction {
  calls: Call[];
  unresolved: Unresolved[];
}

/** Extract boto3 operations from one Python source text. */
export function extractPython(source: string, file: string, names: Names): PythonExtraction {
  const calls: Call[] = [];
  const unresolved: Unresolved[] = [];
  const t = tokenizePython(source);
  const match = matchBrackets(t);
  const reverse = new Map<number, number>();
  for (const [open, close] of match) reverse.set(close, open);
  const bindings = new Map<string, Binding[]>();

  const isOp = (index: number, value: string): boolean => index >= 0 && index < t.length && t[index]!.kind === "op" && t[index]!.value === value;
  const isName = (index: number): boolean => index >= 0 && index < t.length && t[index]!.kind === "name";

  /** Service name from the arguments of `client(...)` / `resource(...)` opened at `open`. */
  const serviceArg = (open: number): string | undefined => {
    const close = match.get(open);
    if (close === undefined) return undefined;
    let svc: string | undefined;
    const first = t[open + 1];
    if (first && first.kind === "string" && first.plain) svc = first.value;
    else {
      let depth = 0;
      for (let i = open + 1; i < close; i++) {
        const tok = t[i]!;
        if (tok.kind === "op" && (tok.value === "(" || tok.value === "[" || tok.value === "{")) depth++;
        else if (tok.kind === "op" && (tok.value === ")" || tok.value === "]" || tok.value === "}")) depth--;
        else if (depth === 0 && tok.kind === "name" && tok.value === "service_name" && isOp(i + 1, "=") && t[i + 2]?.kind === "string" && t[i + 2]!.plain) {
          svc = t[i + 2]!.value;
          break;
        }
      }
    }
    return svc !== undefined && names.hasService(svc) ? svc : undefined;
  };

  const lookup = (name: string, line: number): Value => {
    const list = bindings.get(name);
    if (!list) return null;
    let chosen: Binding | undefined;
    for (const b of list) if (b.line <= line) chosen = b;
    return (chosen ?? list[0])!.value;
  };

  /** Value of the expression whose last token is at `end`. */
  const valueAt = (end: number): Value => {
    if (end < 0) return null;
    const tok = t[end]!;
    if (tok.kind === "name") {
      const parts = [tok.value];
      let idx = end;
      while (isOp(idx - 1, ".") && isName(idx - 2)) {
        parts.unshift(t[idx - 2]!.value);
        idx -= 2;
      }
      if (parts[0] === "boto3" && (parts.length === 1 || (parts.length === 2 && parts[1] === "session"))) return { k: "boto3" };
      if (parts.length >= 3 && parts[parts.length - 2] === "meta" && parts[parts.length - 1] === "client") {
        const base = lookup(parts.slice(0, -2).join("."), tok.line);
        if (base && (base.k === "resource" || base.k === "robj")) return { k: "client", svc: base.svc };
      }
      return lookup(parts.join("."), tok.line);
    }
    if (tok.kind === "op" && tok.value === ")") {
      const open = reverse.get(end);
      if (open === undefined || !isName(open - 1)) return null;
      const method = t[open - 1]!.value;
      if (!isOp(open - 2, ".")) return method === "Session" ? { k: "session" } : null;
      const recv = valueAt(open - 3);
      if (!recv) return null;
      if ((recv.k === "boto3" || recv.k === "session") && (method === "client" || method === "resource")) {
        const svc = serviceArg(open);
        return svc ? { k: method, svc } : null;
      }
      if (recv.k === "boto3" && method === "Session") return { k: "session" };
      if (recv.k === "resource" && /^[A-Z]/.test(method)) return { k: "robj", svc: recv.svc, type: method };
      if (recv.k === "client" && method === "get_paginator") {
        const arg = t[open + 1];
        if (arg && arg.kind === "string" && arg.plain) return { k: "paginator", svc: recv.svc, name: arg.value };
      }
    }
    return null;
  };

  // pass 1: `target = <expression>` statements, in source order
  let start = 0;
  for (let i = 0; i <= t.length; i++) {
    if (i < t.length && t[i]!.kind !== "newline") continue;
    if (i > start) recordBinding(start, i);
    start = i + 1;
  }

  function recordBinding(s: number, e: number): void {
    // target: dotted name, optional `: annotation`, then `=`
    let i = s;
    if (!isName(i)) return;
    const parts = [t[i]!.value];
    i++;
    while (isOp(i, ".") && isName(i + 1)) {
      parts.push(t[i + 1]!.value);
      i += 2;
    }
    if (isOp(i, ":")) {
      let depth = 0;
      while (i < e) {
        const tok = t[i]!;
        if (tok.kind === "op" && (tok.value === "(" || tok.value === "[" || tok.value === "{")) depth++;
        else if (tok.kind === "op" && (tok.value === ")" || tok.value === "]" || tok.value === "}")) depth--;
        else if (depth === 0 && tok.kind === "op" && tok.value === "=") break;
        i++;
      }
    }
    if (!isOp(i, "=") || i + 1 >= e) return;
    const value = valueAt(e - 1);
    if (!value) return;
    const name = parts.join(".");
    const list = bindings.get(name) ?? [];
    list.push({ line: t[s]!.line, value });
    bindings.set(name, list);
  }

  const emit = (svc: string, op: string, line: number, how: string, extraction: "certain" | "inferred"): void => {
    calls.push({ file, line, sdk: "boto3", service: svc, op, how, extraction });
  };

  // pass 2: every `.method(` call and every `getattr(...)(` call
  for (let i = 0; i < t.length; i++) {
    const tok = t[i]!;
    if (tok.kind === "name" && tok.value === "getattr" && isOp(i + 1, "(") && !isOp(i - 1, ".")) {
      handleGetattr(i);
      continue;
    }
    if (!(isOp(i, ".") && isName(i + 1) && isOp(i + 2, "("))) continue;
    const method = t[i + 1]!.value;
    const line = t[i + 1]!.line;
    const recv = valueAt(i - 1);
    if (!recv) continue;
    if (recv.k === "client") {
      if (NON_API_CLIENT_METHODS.has(method) || method.startsWith("_")) continue;
      const injected = INJECTED_CLIENT_METHODS[recv.svc]?.[method];
      if (injected) {
        for (const op of injected) emit(recv.svc, op, line, "client-helper", "inferred");
        continue;
      }
      const op = names.opFromSnake(recv.svc, method) ?? pascalCase(method);
      emit(recv.svc, op, line, "client-method", "certain");
    } else if (recv.k === "robj" || recv.k === "resource") {
      const type = recv.k === "robj" ? recv.type : "resource";
      const ops = RESOURCE_ACTIONS[`${recv.svc}/${type}`]?.[method];
      if (ops) for (const op of ops) emit(recv.svc, op, line, "resource-action", "inferred");
    } else if (recv.k === "paginator" && method === "paginate") {
      const op = names.opFromSnake(recv.svc, recv.name) ?? pascalCase(recv.name);
      emit(recv.svc, op, line, "paginator", "certain");
    }
  }

  function handleGetattr(at: number): void {
    const open = at + 1;
    const close = match.get(open);
    if (close === undefined) return;
    // first argument: object, second: attribute name
    let comma = -1;
    let depth = 0;
    for (let i = open + 1; i < close; i++) {
      const tok = t[i]!;
      if (tok.kind === "op" && (tok.value === "(" || tok.value === "[" || tok.value === "{")) depth++;
      else if (tok.kind === "op" && (tok.value === ")" || tok.value === "]" || tok.value === "}")) depth--;
      else if (depth === 0 && tok.kind === "op" && tok.value === ",") {
        comma = i;
        break;
      }
    }
    if (comma < 0) return;
    const target = valueAt(comma - 1);
    if (!target || (target.k !== "client" && target.k !== "robj")) return;
    const attr = t[comma + 1];
    const attrEnd = close;
    if (attr && attr.kind === "string" && attr.plain && comma + 2 === attrEnd) {
      if (target.k === "client" && !NON_API_CLIENT_METHODS.has(attr.value)) {
        emit(target.svc, names.opFromSnake(target.svc, attr.value) ?? pascalCase(attr.value), attr.line, "client-method", "certain");
      }
      return;
    }
    unresolved.push({ file, line: t[at]!.line, sdk: "boto3", reason: "dynamic-getattr" });
  }

  return { calls, unresolved };
}

function matchBrackets(tokens: Token[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((tok, index) => {
    if (tok.kind !== "op") return;
    if (tok.value === "(" || tok.value === "[" || tok.value === "{") stack.push(index);
    else if (tok.value === ")" || tok.value === "]" || tok.value === "}") {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, index);
    }
  });
  return pairs;
}
