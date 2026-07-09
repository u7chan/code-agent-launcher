import { describe, it, expect } from "bun:test";
import {
  normalizeModelId,
  isKnownModel,
  resolveModel,
  findSimilarModel,
  listLevels,
  ModelError,
  stripProvider,
  collectAllModels,
  collectAllFullModelIds,
  isProviderModel,
  validateKnownModel,
  getLevel,
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

describe("stripProvider", () => {
  it("strips known provider prefix", () => {
    expect(stripProvider("opencode-go/deepseek-v4-pro", "opencode-go")).toBe(
      "deepseek-v4-pro"
    );
  });

  it("keeps other provider prefix intact", () => {
    expect(
      stripProvider("anthropic/claude-sonnet-4-5", "opencode-go")
    ).toBe("anthropic/claude-sonnet-4-5");
  });

  it("returns as-is when no slash", () => {
    expect(stripProvider("deepseek-v4-pro", "opencode-go")).toBe(
      "deepseek-v4-pro"
    );
  });
});

describe("collectAllModels", () => {
  it("collects unique short model ids from all levels", () => {
    const models = collectAllModels(makeConfig());
    expect(models).toContain("deepseek-v4-pro");
    expect(models).toContain("qwen3.7-plus");
    expect(models).toContain("kimi-k2.7-code");
    expect(models.length).toBe(6);
  });
});

describe("collectAllFullModelIds", () => {
  it("collects unique full model ids from all levels", () => {
    const models = collectAllFullModelIds(makeConfig());
    expect(models).toContain("opencode-go/deepseek-v4-pro");
    expect(models).toContain("opencode-go/kimi-k2.7-code");
    expect(models.length).toBe(6);
  });
});

describe("isProviderModel", () => {
  it("returns true for provider-prefixed model", () => {
    expect(isProviderModel("opencode-go/deepseek-v4-pro", "opencode-go")).toBe(
      true
    );
  });

  it("returns false for other provider prefix", () => {
    expect(
      isProviderModel("anthropic/claude-sonnet-4-5", "opencode-go")
    ).toBe(false);
  });

  it("returns false for short model id", () => {
    expect(isProviderModel("deepseek-v4-pro", "opencode-go")).toBe(false);
  });
});

describe("validateKnownModel", () => {
  it("returns known=true for configured model", () => {
    expect(validateKnownModel("deepseek-v4-pro", makeConfig())).toEqual({
      known: true,
    });
  });

  it("returns known=false with warning for unknown full id", () => {
    const result = validateKnownModel(
      "opencode-go/unknown-model",
      makeConfig()
    );
    expect(result.known).toBe(false);
    expect(result.warning).toContain("unknown model");
  });

  it("returns known=false for unknown short id", () => {
    expect(validateKnownModel("unknown-model", makeConfig())).toEqual({
      known: false,
    });
  });
});

describe("getLevel", () => {
  it("returns mid level config", () => {
    const level = getLevel(makeConfig(), "mid");
    expect(level.default_model).toBe("deepseek-v4-pro");
    expect(level.models).toContain("deepseek-v4-pro");
    expect(level.models).toContain("qwen3.7-plus");
    expect(level.description).toBe("Normal tasks");
  });

  it("returns low level config", () => {
    const level = getLevel(makeConfig(), "low");
    expect(level.default_model).toBe("deepseek-v4-flash");
    expect(level.models).toContain("mimo-v2.5");
  });

  it("returns high level config", () => {
    const level = getLevel(makeConfig(), "high");
    expect(level.default_model).toBe("kimi-k2.7-code");
    expect(level.models).toContain("glm-5.2");
  });

  it("throws ModelError for unknown level", () => {
    expect(() => getLevel(makeConfig(), "extreme")).toThrow(ModelError);
  });

  it("throws ModelError with available levels in message", () => {
    expect(() => getLevel(makeConfig(), "extreme")).toThrow(
      "Available levels:\n  low\n  mid\n  high"
    );
  });
});
