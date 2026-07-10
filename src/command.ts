import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
}

export interface RunOptions {
  dryRun?: boolean;
  stdio?: 'inherit' | 'pipe';
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** Display-only escaping. Never use for process execution. */
export function escapeShellArg(arg: string): string {
  return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an executable from PATH without invoking a shell.
 * Avoids evaluating special characters in binName.
 */
export function findExecutable(binName: string): string | undefined {
  if (!binName || binName.includes('\0')) {
    return undefined;
  }

  if (isAbsolute(binName) || binName.includes('/') || binName.includes('\\')) {
    return isExecutable(binName) ? binName : undefined;
  }

  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, binName);
    if (isExecutable(candidate)) {
      return candidate;
    }
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
  args: string[],
): { command: string; args: string[] } {
  return {
    command: resolveOpenCodeBin(opencodeBin),
    args,
  };
}

export function formatCommandForDisplay(command: string, args: string[]): string {
  const escapedArgs = args.map((arg) => {
    if (/[\s'"\\|&;<>$()`]/.test(arg)) {
      return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return arg;
  });
  return [command, ...escapedArgs].join(' ');
}

export function runCommandFormat(opencodeBin: string, args: string[]): string {
  const { command, args: cmdArgs } = buildCommand(opencodeBin, args);
  return formatCommandForDisplay(command, cmdArgs);
}

export function runCommand(
  opencodeBin: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const { command, args: cmdArgs } = buildCommand(opencodeBin, args);

  if (options.dryRun) {
    console.log(formatCommandForDisplay(command, cmdArgs));
    return Promise.resolve({ command, args: cmdArgs, exitCode: 0 });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, cmdArgs, {
      stdio: options.stdio ?? 'inherit',
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (exitCode) => {
      resolve({ command, args: cmdArgs, exitCode });
    });
  });
}

export function runCommandSync(
  opencodeBin: string,
  args: string[],
  options: RunOptions = {},
): CommandResult {
  const { command, args: cmdArgs } = buildCommand(opencodeBin, args);

  if (options.dryRun) {
    console.log(formatCommandForDisplay(command, cmdArgs));
    return { command, args: cmdArgs, exitCode: 0 };
  }

  const result = spawnSync(command, cmdArgs, {
    stdio: options.stdio ?? 'inherit',
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
