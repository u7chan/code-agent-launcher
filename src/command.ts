import { spawn, spawnSync } from "node:child_process";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
}

export interface RunOptions {
  dryRun?: boolean;
  stdio?: "inherit" | "pipe";
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function escapeShellArg(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function findExecutable(binName: string): string | undefined {
  try {
    const result = spawnSync(
      "sh",
      ["-c", `command -v ${escapeShellArg(binName)}`],
      {
        shell: false,
        stdio: "pipe",
        encoding: "utf-8",
      }
    );
    if (result.status === 0) {
      return result.stdout.trim();
    }
  } catch {
    // fall through
  }
  return undefined;
}

export function resolveOpenCodeBin(opencodeBin: string): string {
  const executable = findExecutable(opencodeBin);
  if (executable) {
    return executable;
  }
  return opencodeBin;
}

export function buildCommand(
  opencodeBin: string,
  args: string[]
): { command: string; args: string[] } {
  return {
    command: resolveOpenCodeBin(opencodeBin),
    args,
  };
}

export function formatCommandForDisplay(
  command: string,
  args: string[]
): string {
  const escapedArgs = args.map((arg) => {
    if (/[\s'"\\|&;<>$()`]/.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });
  return [command, ...escapedArgs].join(" ");
}

export function runCommandFormat(opencodeBin: string, args: string[]): string {
  const { command, args: cmdArgs } = buildCommand(opencodeBin, args);
  return formatCommandForDisplay(command, cmdArgs);
}

export function runCommand(
  opencodeBin: string,
  args: string[],
  options: RunOptions = {}
): Promise<CommandResult> {
  const { command, args: cmdArgs } = buildCommand(opencodeBin, args);

  if (options.dryRun) {
    console.log(formatCommandForDisplay(command, cmdArgs));
    return Promise.resolve({ command, args: cmdArgs, exitCode: 0 });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, cmdArgs, {
      stdio: options.stdio ?? "inherit",
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (exitCode) => {
      resolve({ command, args: cmdArgs, exitCode });
    });
  });
}

export function runCommandSync(
  opencodeBin: string,
  args: string[],
  options: RunOptions = {}
): CommandResult {
  const { command, args: cmdArgs } = buildCommand(opencodeBin, args);

  if (options.dryRun) {
    console.log(formatCommandForDisplay(command, cmdArgs));
    return { command, args: cmdArgs, exitCode: 0 };
  }

  const result = spawnSync(command, cmdArgs, {
    stdio: options.stdio ?? "inherit",
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
  });

  return {
    command,
    args: cmdArgs,
    exitCode: result.status ?? (result.error ? 1 : 0),
  };
}
