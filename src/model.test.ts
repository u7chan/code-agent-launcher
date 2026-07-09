import { describe, it, expect } from "bun:test";
import {
  normalizeModelId,
  isKnownModel,
  resolveModel,
  findSimilarModel,
  listLevels,
  ModelError,
} from "./model.js";
import type { Config } from "./config.js";

function makeConfig(): Config {
  return {
    version: 1,
    opencode_bin: "opencode",
    provider: "opencode-go",
    default_level: "mid",
    levels: {
      low: {
        description: "Cheap tasks",
        default_model: "deepseek-v4-flash",
        models: ["deepseek-v4-flash", "mimo-v2.5"],
      },
      mid: {
        description: "Normal tasks",
        default_model: "deepseek-v4-pro",
        models: ["deepseek-v4-pro", "qwen3.7-plus"],
      },
      high: {
        description: "Complex tasks",
        default_model: "kimi-k2.7-code",
        models: ["kimi-k2.7-code", "glm-5.2"],
      },
    },
    multiplexer: {
      default: "herdr",
      herdr: { enabled: true },
    },
  };
}

describe("normalizeModelId", () => {
  it("adds provider prefix to short ids", () => {
    expect(normalizeModelId("kimi-k2.7-code", "opencode-go")).toBe(
      "opencode-go/kimi-k2.7-code"
    );
  });

  it("keeps full ids unchanged", () => {
    expect(
      normalizeModelId("anthropic/claude-sonnet-4-5", "opencode-go")
    ).toBe("anthropic/claude-sonnet-4-5");
  });

  it("rejects empty ids", () => {
    expect(() => normalizeModelId("", "opencode-go")).toThrow(ModelError);
  });
});

describe("isKnownModel", () => {
  it("returns true for configured short models", () => {
    expect(isKnownModel("kimi-k2.7-code", makeConfig())).toBe(true);
  });

  it("returns true for configured full models", () => {
    expect(isKnownModel("opencode-go/kimi-k2.7-code", makeConfig())).toBe(
      true
    );
  });

  it("returns false for unknown models", () => {
    expect(isKnownModel("unknown-model", makeConfig())).toBe(false);
  });
});

describe("resolveModel", () => {
  it("prioritizes CLI --model", () => {
    const result = resolveModel(makeConfig(), {
      cliModel: "glm-5.2",
      cliLevel: "low",
    });
    expect(result.modelId).toBe("opencode-go/glm-5.2");
  });

  it("falls back to env model", () => {
    const result = resolveModel(makeConfig(), {
      envModel: "qwen3.7-plus",
    });
    expect(result.modelId).toBe("opencode-go/qwen3.7-plus");
  });

  it("uses CLI level default model", () => {
    const result = resolveModel(makeConfig(), { cliLevel: "high" });
    expect(result.modelId).toBe("opencode-go/kimi-k2.7-code");
  });

  it("uses env level default model", () => {
    const result = resolveModel(makeConfig(), { envLevel: "low" });
    expect(result.modelId).toBe("opencode-go/deepseek-v4-flash");
  });

  it("uses config default level", () => {
    const result = resolveModel(makeConfig(), {});
    expect(result.modelId).toBe("opencode-go/deepseek-v4-pro");
  });

  it("rejects unknown short models with suggestion", () => {
    expect(() =>
      resolveModel(makeConfig(), { cliModel: "kimi-k2.7-cod" })
    ).toThrow("unknown model in config");
  });

  it("warns for unknown full models", () => {
    const result = resolveModel(makeConfig(), {
      cliModel: "opencode-go/unknown-model",
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.modelId).toBe("opencode-go/unknown-model");
  });
});

describe("findSimilarModel", () => {
  it("suggests close matches", () => {
    const suggestion = findSimilarModel("kimi-k2.7-cod", makeConfig());
    expect(suggestion).toBe("kimi-k2.7-code");
  });

  it("returns undefined for very different inputs", () => {
    const suggestion = findSimilarModel("xyz", makeConfig());
    expect(suggestion).toBeUndefined();
  });
});

describe("listLevels", () => {
  it("lists configured levels", () => {
    expect(listLevels(makeConfig())).toEqual(["low", "mid", "high"]);
  });
});
