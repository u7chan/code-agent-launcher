import { Command } from 'commander';
import { runCommand, runCommandFormat } from './command.js';
import { loadConfig } from './config.js';

export interface ModelsCommandOptions {
  refresh?: boolean;
}

export function createModelsCommand(): Command {
  const command = new Command('models');

  command
    .description('List available OpenCode Go models')
    .option('--refresh', 'Refresh the model list from the provider')
    .action(async (options: ModelsCommandOptions) => {
      const config = loadConfig();
      const dryRun = command.parent?.opts().dryRun === true;
      const args = ['models', config.provider];

      if (options.refresh) {
        args.push('--refresh');
      }

      if (dryRun) {
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

  return command;
}
