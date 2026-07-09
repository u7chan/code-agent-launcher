import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import chalk from "chalk";
import {
  configPath,
  loadConfig,
  ConfigError,
  type Config,
  type MultiplexerAdapter,
} from "./config.js";
import {
  collectAllFullModelIds,
  collectAllModels,
  normalizeModelId,
} from "./model.js";

export type CheckStatus = "OK" | "WARN" | "ERROR";

export interface CheckResult {
  status: CheckStatus;
  message: string;
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

function ok(message: string): CheckResult {
  return { status: "OK", message };
}

function warn(message: string): CheckResult {
  return { status: "WARN", message };
}

function error(message: string): CheckResult {
  return { status: "ERROR", message };
}

export function runDoctor(): CheckResult[] {
  const results: CheckResult[] = [];
  const configFile = process.env.OCGO_CONFIG ?? configPath();

  // 1. config.yaml exists
  if (!existsSync(configFile)) {
    results.push(error(`config file not found: ${configFile}`));
    return results;
  }
  results.push(ok(`config file exists: ${configFile}`));

  // 2. YAML readable
  let config: Config;
  try {
    config = loadConfig();
    results.push(ok("config YAML parsed successfully"));
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : String(err);
    results.push(error(`config validation failed: ${message}`));
    return results;
  }

  // 3. opencode_bin in PATH
  const opencodePath = findExecutable(config.opencode_bin);
  if (opencodePath) {
    results.push(ok(`opencode binary found: ${opencodePath}`));
  } else {
    results.push(
      error(
        `opencode binary not found in PATH: ${config.opencode_bin}`
      )
    );
  }

  // 4. provider defined
  if (config.provider && config.provider.length > 0) {
    results.push(ok(`provider configured: ${config.provider}`));
  } else {
    results.push(error("provider is not defined"));
  }

  // 5. default_level exists
  if (config.levels[config.default_level]) {
    results.push(
      ok(`default_level exists: ${config.default_level}`)
    );
  } else {
    results.push(
      error(
        `default_level "${config.default_level}" is not defined in levels`
      )
    );
  }

  // 6-8. per level checks
  for (const [levelName, level] of Object.entries(config.levels)) {
    if (level.default_model && level.default_model.length > 0) {
      results.push(
        ok(`level "${levelName}" default_model defined: ${level.default_model}`)
      );
    } else {
      results.push(
        error(`level "${levelName}" default_model is not defined`)
      );
    }

    const normalizedDefault = normalizeModelId(
      level.default_model,
      config.provider
    );
    if (level.models.includes(level.default_model)) {
      results.push(
        ok(
          `level "${levelName}" default_model is in models: ${level.default_model}`
        )
      );
    } else {
      results.push(
        error(
          `level "${levelName}" default_model "${level.default_model}" is not in models (normalized: ${normalizedDefault})`
        )
      );
    }
  }

  // 9. model id normalization
  try {
    const allModels = collectAllModels(config);
    for (const model of allModels) {
      const normalized = normalizeModelId(model, config.provider);
      results.push(
        ok(`model id normalized: ${model} -> ${normalized}`)
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push(error(`model id normalization failed: ${message}`));
  }

  // 10. opencode models opencode-go executable
  let availableModels: string[] = [];
  if (opencodePath) {
    const result = spawnSync(config.opencode_bin, ["models", config.provider], {
      shell: false,
      stdio: "pipe",
      encoding: "utf-8",
    });
    if (result.status === 0) {
      results.push(
        ok(`opencode models ${config.provider} executed successfully`)
      );
      availableModels = parseModelList(result.stdout, config.provider);
    } else {
      results.push(
        error(
          `opencode models ${config.provider} failed (exit ${result.status ?? "unknown"})`
        )
      );
    }
  } else {
    results.push(
      warn(
        `skipped opencode models check because opencode binary is not available`
      )
    );
  }

  // 11. config models exist in actual list
  if (availableModels.length > 0) {
    const configuredModels = collectAllFullModelIds(config);
    for (const model of configuredModels) {
      if (availableModels.includes(model)) {
        results.push(ok(`configured model exists in provider: ${model}`));
      } else {
        results.push(
          warn(`configured model not found in provider list: ${model}`)
        );
      }
    }
  } else {
    results.push(
      warn(
        "skipped config vs provider model check because provider model list is empty"
      )
    );
  }

  // 12. multiplexer.default defined
  if (config.multiplexer.default && config.multiplexer.default.length > 0) {
    results.push(
      ok(`multiplexer.default configured: ${config.multiplexer.default}`)
    );
  } else {
    results.push(error("multiplexer.default is not defined"));
  }

  // 13. multiplexer.default adapter enabled
  const defaultAdapter = config.multiplexer[config.multiplexer.default];
  if (
    defaultAdapter &&
    typeof defaultAdapter === "object" &&
    (defaultAdapter as MultiplexerAdapter).enabled
  ) {
    results.push(
      ok(
        `multiplexer adapter "${config.multiplexer.default}" is enabled`
      )
    );
  } else {
    results.push(
      error(
        `multiplexer adapter "${config.multiplexer.default}" is not enabled`
      )
    );
  }

  // 14. multiplexer.default adapter command templates
  if (defaultAdapter && typeof defaultAdapter === "object") {
    const adapter = defaultAdapter as MultiplexerAdapter;
    const hasStartTemplate =
      typeof adapter.start_command_template === "string" &&
      adapter.start_command_template.length > 0;
    const hasRunTemplate =
      typeof adapter.run_command_template === "string" &&
      adapter.run_command_template.length > 0;

    if (hasStartTemplate && hasRunTemplate) {
      results.push(
        ok(
          `multiplexer adapter "${config.multiplexer.default}" has start/run command templates`
        )
      );
    } else {
      const missing: string[] = [];
      if (!hasStartTemplate) missing.push("start_command_template");
      if (!hasRunTemplate) missing.push("run_command_template");
      results.push(
        warn(
          `multiplexer adapter "${config.multiplexer.default}" is missing templates: ${missing.join(", ")}`
        )
      );
    }
  }

  // 15. herdr CLI in PATH when default adapter is herdr
  if (config.multiplexer.default === "herdr") {
    const herdrPath = findExecutable("herdr");
    if (herdrPath) {
      results.push(ok(`herdr binary found: ${herdrPath}`));
    } else {
      results.push(
        error("herdr binary not found in PATH (required by multiplexer.default)")
      );
    }
  }

  return results;
}

function parseModelList(stdout: string, provider: string): string[] {
  const models: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Accept both full ids and short ids from opencode output
    if (trimmed.includes("/")) {
      models.push(trimmed);
    } else {
      models.push(`${provider}/${trimmed}`);
    }
  }
  return models;
}

export function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const label =
      result.status === "OK"
        ? chalk.green("[OK]")
        : result.status === "WARN"
        ? chalk.yellow("[WARN]")
        : chalk.red("[ERROR]");
    console.log(`${label} ${result.message}`);
  }
}

export function hasErrors(results: CheckResult[]): boolean {
  return results.some((r) => r.status === "ERROR");
}

export function createDoctorCommand(): Command {
  const command = new Command("doctor");

  command
    .description("Validate environment, configuration, and model definitions")
    .action(() => {
      const results = runDoctor();
      printResults(results);
      if (hasErrors(results)) {
        process.exit(1);
      }
    });

  return command;
}
