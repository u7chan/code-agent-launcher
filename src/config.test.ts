import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigError, configPath } from "./config.js";

describe("loadConfig", () => {
  let tmpDir: string;
  let originalConfig: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ocgo-config-test-"));
    originalConfig = process.env.OCGO_CONFIG;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalConfig === undefined) {
      delete process.env.OCGO_CONFIG;
    } else {
      process.env.OCGO_CONFIG = originalConfig;
    }
  });

  it("loads a valid config file", () => {
    const configFile = join(tmpDir, "config.yaml");
    writeFileSync(
      configFile,
      `version: 1
opencode_bin: opencode
provider: opencode-go
default_level: mid
levels:
  mid:
    description: Normal
    default_model: deepseek-v4-pro
    models:
      - deepseek-v4-pro
multiplexer:
  default: herdr
  herdr:
    enabled: true
`
    );
    process.env.OCGO_CONFIG = configFile;

    const config = loadConfig();
    expect(config.version).toBe(1);
    expect(config.provider).toBe("opencode-go");
    expect(config.default_level).toBe("mid");
    expect(config.levels.mid.default_model).toBe("deepseek-v4-pro");
  });

  it("throws ConfigError for missing file", () => {
    process.env.OCGO_CONFIG = join(tmpDir, "missing.yaml");
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws ConfigError for invalid YAML", () => {
    const configFile = join(tmpDir, "config.yaml");
    writeFileSync(configFile, "not: valid: yaml: [");
    process.env.OCGO_CONFIG = configFile;
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws ConfigError for missing default_level in levels", () => {
    const configFile = join(tmpDir, "config.yaml");
    writeFileSync(
      configFile,
      `version: 1
opencode_bin: opencode
provider: opencode-go
default_level: heavy
levels:
  low:
    description: Cheap
    default_model: deepseek-v4-flash
    models:
      - deepseek-v4-flash
multiplexer:
  default: herdr
  herdr:
    enabled: true
`
    );
    process.env.OCGO_CONFIG = configFile;
    expect(() => loadConfig()).toThrow(ConfigError);
  });
});

describe("configPath", () => {
  it("respects XDG_CONFIG_HOME", () => {
    const originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
    try {
      expect(configPath()).toBe("/tmp/xdg-test/ocgo/config.yaml");
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalXdg;
      }
    }
  });
});
