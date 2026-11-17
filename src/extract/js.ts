import { parse } from "@babel/parser";
import type { Names } from "../names.js";
import type { Call, Unresolved } from "../types.js";

/** `@aws-sdk/lib-dynamodb` document commands and the DynamoDB operation each one sends. */
const LIB_DYNAMODB: Record<string, string> = {
  GetCommand: "GetItem",
  PutCommand: "PutItem",
  UpdateCommand: "UpdateItem",
  DeleteCommand: "DeleteItem",
  QueryCommand: "Query",
  ScanCommand: "Scan",
  BatchGetCommand: "BatchGetItem",
  BatchWriteCommand: "BatchWriteItem",
  TransactGetCommand: "TransactGetItems",
  TransactWriteCommand: "TransactWriteItems",
  ExecuteStatementCommand: "ExecuteStatement",
  BatchExecuteStatementCommand: "BatchExecuteStatement",
  ExecuteTransactionCommand: "ExecuteTransaction",
};

/** `Upload` from `@aws-sdk/lib-storage` may use a single put or a multipart upload. */
const LIB_STORAGE_UPLOAD = ["PutObject", "CreateMultipartUpload", "UploadPart", "CompleteMultipartUpload", "AbortMultipartUpload"];

/** Methods of an aggregated client that are not API operations. */
const NON_API_METHODS = new Set(["send", "destroy", "config", "middlewareStack", "constructor"]);

interface Imported {
  pkg: string;
  name: string;
}

// Babel nodes are walked generically, so a loose node type keeps the code short.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

function walk(node: Node, visit: (n: Node) => void): void {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === "object") walk(child, visit);
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      walk(value, visit);
    }
  }
}

function exprName(node: Node): string | undefined {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression" && !node.computed && node.object?.type === "ThisExpression" && node.property?.type === "Identifier") {
    return `this.${node.property.name}`;
  }
  return undefined;
}

export interface JsExtraction {
  calls: Call[];
  unresolved: Unresolved[];
}

/** Extract AWS SDK for JavaScript v3 operations from one JS or TS source text. */
export function extractJs(source: string, file: string, names: Names): JsExtraction {
  const calls: Call[] = [];
  const unresolved: Unresolved[] = [];
  const isTs = /\.(ts|mts|cts)$/.test(file);
  let ast: Node;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      plugins: isTs ? ["typescript", "decorators-legacy"] : ["typescript", "jsx", "decorators-legacy"],
      errorRecovery: true,
    });
  } catch {
    try {
      ast = parse(source, { sourceType: "unambiguous", plugins: ["jsx", "decorators-legacy"], errorRecovery: true });
    } catch {
      return { calls, unresolved: [{ file, line: 1, sdk: "js-v3", reason: "parse-error" }] };
    }
  }

  const named = new Map<string, Imported>(); // local name -> imported binding
  const namespaces = new Map<string, string>(); // local namespace -> package

  // 1) imports and CommonJS requires from @aws-sdk packages
  walk(ast.program, (n) => {
    if (n.type === "ImportDeclaration" && typeof n.source?.value === "string" && n.source.value.startsWith("@aws-sdk/")) {
      const pkg: string = n.source.value;
      for (const sp of n.specifiers ?? []) {
        if (sp.type === "ImportSpecifier") named.set(sp.local.name, { pkg, name: sp.imported.name ?? sp.imported.value });
        else if (sp.type === "ImportNamespaceSpecifier") namespaces.set(sp.local.name, pkg);
      }
    } else if (
      n.type === "VariableDeclarator" &&
      n.init?.type === "CallExpression" &&
      n.init.callee?.type === "Identifier" &&
      n.init.callee.name === "require" &&
      n.init.arguments?.[0]?.type === "StringLiteral" &&
      n.init.arguments[0].value.startsWith("@aws-sdk/")
    ) {
      const pkg: string = n.init.arguments[0].value;
      if (n.id.type === "ObjectPattern") {
        for (const prop of n.id.properties) {
          if (prop.type === "ObjectProperty" && prop.key?.type === "Identifier" && prop.value?.type === "Identifier") {
            named.set(prop.value.name, { pkg, name: prop.key.name });
          }
        }
      } else if (n.id.type === "Identifier") {
        namespaces.set(n.id.name, pkg);
      }
    }
  });

  const resolve = (callee: Node): Imported | undefined => {
    if (callee?.type === "Identifier") return named.get(callee.name);
    if (
      callee?.type === "MemberExpression" &&
      !callee.computed &&
      callee.object?.type === "Identifier" &&
      namespaces.has(callee.object.name) &&
      callee.property?.type === "Identifier"
    ) {
      return { pkg: namespaces.get(callee.object.name)!, name: callee.property.name };
    }
    return undefined;
  };

  const serviceOf = (pkg: string): string => {
    if (pkg === "@aws-sdk/lib-dynamodb") return "dynamodb";
    if (pkg === "@aws-sdk/lib-storage") return "s3";
    const suffix = pkg.slice("@aws-sdk/client-".length);
    return names.fromJsPackage(suffix) ?? suffix;
  };
  const isClientPkg = (pkg: string): boolean => pkg.startsWith("@aws-sdk/client-");

  const add = (pkg: string, op: string, node: Node, how: string, extraction: "certain" | "inferred"): void => {
    calls.push({ file, line: node.loc.start.line, sdk: "js-v3", service: serviceOf(pkg), op, how, extraction });
  };

  // 2) variables that hold an aggregated client such as `new S3()` (v3 "bare-bones" clients end in Client)
  const aggregated = new Map<string, string>(); // variable -> package
  const noteAggregated = (name: string | undefined, init: Node): void => {
    if (!name || init?.type !== "NewExpression") return;
    const imported = resolve(init.callee);
    if (imported && isClientPkg(imported.pkg) && !imported.name.endsWith("Client") && !imported.name.endsWith("Command")) {
      aggregated.set(name, imported.pkg);
    }
  };
  walk(ast.program, (n) => {
    if (n.type === "VariableDeclarator") noteAggregated(exprName(n.id), n.init);
    else if (n.type === "AssignmentExpression" && n.operator === "=") noteAggregated(exprName(n.left), n.right);
  });

  // 3) call sites
  walk(ast.program, (n) => {
    if (n.type === "NewExpression") {
      const imported = resolve(n.callee);
      if (!imported) return;
      if (imported.pkg === "@aws-sdk/lib-dynamodb" && LIB_DYNAMODB[imported.name]) {
        add(imported.pkg, LIB_DYNAMODB[imported.name]!, n, "lib-dynamodb", "certain");
      } else if (imported.pkg === "@aws-sdk/lib-storage" && imported.name === "Upload") {
        for (const op of LIB_STORAGE_UPLOAD) add(imported.pkg, op, n, "lib-storage", "inferred");
      } else if (isClientPkg(imported.pkg) && imported.name.endsWith("Command")) {
        add(imported.pkg, imported.name.slice(0, -"Command".length), n, "command", "certain");
      }
    } else if (n.type === "CallExpression") {
      const imported = resolve(n.callee);
      if (imported && isClientPkg(imported.pkg) && /^paginate[A-Z]/.test(imported.name)) {
        add(imported.pkg, imported.name.slice("paginate".length), n, "paginator", "certain");
        return;
      }
      const callee = n.callee;
      if (callee?.type === "MemberExpression") {
        const owner = exprName(callee.object);
        const pkg = owner ? aggregated.get(owner) : undefined;
        if (!pkg) return;
        if (!callee.computed && callee.property.type === "Identifier") {
          const method: string = callee.property.name;
          if (NON_API_METHODS.has(method)) return;
          add(pkg, method.charAt(0).toUpperCase() + method.slice(1), n, "aggregated-method", "certain");
        } else if (callee.computed && callee.property.type === "StringLiteral") {
          const method: string = callee.property.value;
          add(pkg, method.charAt(0).toUpperCase() + method.slice(1), n, "aggregated-method", "certain");
        } else if (callee.computed) {
          unresolved.push({ file, line: n.loc.start.line, sdk: "js-v3", reason: "dynamic-method" });
        }
      }
    }
  });

  return { calls, unresolved };
}
