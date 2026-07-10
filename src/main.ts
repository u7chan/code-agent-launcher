import { Command, Option } from 'commander';
import { loadConfig } from './config.js';
import { resolveModel } from './model.js';
import { runCommand, runCommandFormat } from './command.js';

export interface MainOptions {
  level?: string;
  model?: string;
  dryRun?: boolean;
  adapter?: string;
}

export function createMainCommand(): Command {
  const program = new Command();

  program
    .name('ocgo')
    .description('OpenCode Go wrapper CLI for model routing')
    .version('0.1.0')
    .argument('[level]', 'task level (low, mid, high, etc.)')
    .option('-l, --level <level>', 'task level')
    .option('-m, --model <model>', 'explicit model id')
    .option('-d, --dry-run', 'print the opencode command without executing')
    .addOption(
      new Option('-a, --adapter <adapter>', 'multiplexer adapter to use')
        .default(undefined)
        .hideHelp(),
    )
    .allowUnknownOption()
    .action(async (positionalLevel: string | undefined, options: MainOptions) => {
      const cliLevel = options.level ?? positionalLevel;
      const cliModel = options.model;
      const envModel = process.env.OCGO_MODEL;
      const envLevel = process.env.OCGO_LEVEL;

      const config = loadConfig();
      const resolved = resolveModel(config, {
        cliModel,
        cliLevel,
        envModel,
        envLevel,
      });

      for (const warning of resolved.warnings) {
        console.warn(`Warning: ${warning}`);
      }

      const extraArgs = program.args.slice(positionalLevel !== undefined ? 1 : 0);
      const args = ['--model', resolved.modelId, ...extraArgs];

      if (options.dryRun) {
        console.log(`# Resolved level: ${resolved.levelName ?? config.default_level}`);
        console.log(runCommandFormat(config.opencode_bin, args));
        return;
      }

      const result = await runCommand(config.opencode_bin, args, {
        stdio: 'inherit',
      });

      if (result.exitCode !== 0 && result.exitCode !== null) {
        process.exit(result.exitCode);
      }
    });

  return program;
}

export async function main(argv: string[]): Promise<void> {
  const program = createMainCommand();
  await program.parseAsync(argv);
}
