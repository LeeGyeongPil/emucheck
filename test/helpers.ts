import { run, type Io } from "../src/main.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI in-process with captured output and an explicit environment. */
export async function cli(args: string[], env: Record<string, string | undefined> = {}): Promise<RunResult> {
  let stdout = "";
  let stderr = "";
  const io: Io = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    env,
    cwd: process.cwd(),
  };
  const code = await run(args, io);
  return { code, stdout, stderr };
}

export const MINI = "test/fixtures/snapshot/mini.json";
export const PROJECT = "test/fixtures/project";
