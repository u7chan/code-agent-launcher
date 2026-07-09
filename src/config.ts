import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";

export interface LevelConfig {
  description: string;
  default_model: string;
  models: string[];
}

export interface MultiplexerAdapter {
  enabled: boolean;
  start_command_template?: string;
  run_command_template?: string;
  note?: string;
  [key: string]: unknown;
}

export interface MultiplexerConfig {
  default: string;
  [adapter: string]: string | MultiplexerAdapter | undefined;
}

export interface Config {
  version: number;
  opencode_bin: string;
  provider: string;
  default_level: string;
  levels: Record<string, LevelConfig>;
  multiplexer: MultiplexerConfig;
}

function getConfigHome(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome && xdgConfigHome.length > 0) {
    return xdgConfigHome;
  }
  return join(homedir(), ".config");
}

export function configPath(): string {
  return join(getConfigHome(), "ocgo", "config.yaml");
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function assertRecord(
  value: unknown,
  message: string
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(message);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new ConfigError(message);
  }
  return value;
}

function assertNumber(value: unknown, message: string): number {
  if (typeof value !== "number") {
    throw new ConfigError(message);
  }
  return value;
}

function assertStringArray(value: unknown, message: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(message);
  }
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ConfigError(message);
    }
  }
  return value as string[];
}

function parseLevels(raw: unknown): Record<string, LevelConfig> {
  const levelsRecord = assertRecord(raw, "levels must be an object");
  const levels: Record<string, LevelConfig> = {};

  for (const [name, levelRaw] of Object.entries(levelsRecord)) {
    const level = assertRecord(levelRaw, `level "${name}" must be an object`);
    levels[name] = {
      description: assertString(
        level.description,
        `level "${name}".description must be a string`
      ),
      default_model: assertString(
        level.default_model,
        `level "${name}".default_model must be a string`
      ),
      models: assertStringArray(
        level.models,
        `level "${name}".models must be an array of strings`
      ),
    };
  }

  return levels;
}

function parseMultiplexer(raw: unknown): MultiplexerConfig {
  const mux = assertRecord(raw, "multiplexer must be an object");
  const parsed: MultiplexerConfig = {
    default: assertString(
      mux.default,
      "multiplexer.default must be a string"
    ),
  };

  for (const [key, value] of Object.entries(mux)) {
    if (key === "default") continue;
    if (value === undefined || value === null) continue;

    const adapter = assertRecord(
      value,
      `multiplexer adapter "${key}" must be an object`
    );
    parsed[key] = {
      enabled: adapter.enabled === true,
      start_command_template:
        typeof adapter.start_command_template === "string"
          ? adapter.start_command_template
          : undefined,
      run_command_template:
        typeof adapter.run_command_template === "string"
          ? adapter.run_command_template
          : undefined,
      note:
        typeof adapter.note === "string" ? adapter.note : undefined,
    } as MultiplexerAdapter;
  }

  return parsed;
}

export function loadConfig(path?: string): Config {
  const configFile =
    path ?? process.env.OCGO_CONFIG ?? configPath();

  let content: string;
  try {
    content = readFileSync(configFile, "utf-8");
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`config file not found: ${configFile}\n\n${cause}`);
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`failed to parse config YAML: ${cause}`);
  }

  const root = assertRecord(parsed, "config must be a YAML object");

  const levels = parseLevels(root.levels);
  const defaultLevel = assertString(
    root.default_level,
    "default_level must be a string"
  );

  if (!levels[defaultLevel]) {
    throw new ConfigError(
      `default_level "${defaultLevel}" is not defined in levels`
    );
  }

  return {
    version: assertNumber(root.version, "version must be a number"),
    opencode_bin: assertString(
      root.opencode_bin,
      "opencode_bin must be a string"
    ),
    provider: assertString(root.provider, "provider must be a string"),
    default_level: defaultLevel,
    levels,
    multiplexer: parseMultiplexer(root.multiplexer),
  };
}
