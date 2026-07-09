import { Command } from "commander";
import { loadConfig } from "./config.js";
import { resolveModel } from "./model.js";
import { runCommand, runCommandFormat } from "./command.js";

export interface RunCommandOptions {
  level?: string;
  model?: string;
}

export function createRunCommand(): Command {
  const command = new Command("run");

  command
    .description("Run opencode non-interactively with a prompt")
    .argument("[level]", "task level (low, mid, high, etc.)")
    .option("-l, --level <level>", "task level")
    .option("-m, --model <model>", "explicit model id")
    .allowUnknownOption()
    .action(async (positionalLevel: string | undefined, options: RunCommandOptions) => {
      const cliLevel = options.level ?? positionalLevel;
      const cliModel = options.model;
      const envModel = process.env.OCGO_MODEL;
      const envLevel = process.env.OCGO_LEVEL;
      const dryRun = command.parent?.opts().dryRun === true;

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

      const extraArgs = command.args.slice(
        positionalLevel !== undefined ? 1 : 0
      );
      const args = ["run", "--model", resolved.modelId, ...extraArgs];

      if (dryRun) {
        console.log(
          `# Resolved level: ${resolved.levelName ?? config.default_level}`
        );
        console.log(runCommandFormat(config.opencode_bin, args));
        return;
      }

      const result = await runCommand(config.opencode_bin, args, {
        stdio: "inherit",
      });

      if (result.exitCode !== 0 && result.exitCode !== null) {
        process.exit(result.exitCode);
      }
    });

  return command;
}
