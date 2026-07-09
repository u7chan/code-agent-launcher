import { describe, it, expect } from "bun:test";
import {
  buildCommand,
  formatCommandForDisplay,
  runCommandFormat,
} from "./command.js";

describe("buildCommand", () => {
  it("returns bin name as command when not found in PATH", () => {
    const result = buildCommand("non-existent-bin-xyz", ["--model", "foo"]);
    expect(result.command).toBe("non-existent-bin-xyz");
    expect(result.args).toEqual(["--model", "foo"]);
  });

  it("keeps args unchanged", () => {
    const result = buildCommand("echo", ["hello", "world"]);
    expect(result.args).toEqual(["hello", "world"]);
  });
});

describe("formatCommandForDisplay", () => {
  it("joins command and args with spaces", () => {
    expect(formatCommandForDisplay("echo", ["hello", "world"])).toBe(
      "echo hello world"
    );
  });

  it("escapes args containing spaces", () => {
    expect(formatCommandForDisplay("echo", ["hello world"])).toBe(
      'echo "hello world"'
    );
  });

  it("escapes args containing special shell characters", () => {
    expect(formatCommandForDisplay("echo", ["foo|bar"])).toBe(
      'echo "foo|bar"'
    );
    expect(formatCommandForDisplay("echo", ["foo&bar"])).toBe(
      'echo "foo&bar"'
    );
    expect(formatCommandForDisplay("echo", ["foo;bar"])).toBe(
      'echo "foo;bar"'
    );
  });

  it("does not escape simple args", () => {
    expect(formatCommandForDisplay("echo", ["hello"])).toBe("echo hello");
  });
});

describe("runCommandFormat", () => {
  it("produces a full display string with model arg", () => {
    const result = runCommandFormat("opencode", [
      "--model",
      "opencode-go/deepseek-v4-pro",
    ]);
    expect(result).toContain("opencode");
    expect(result).toContain("--model");
    expect(result).toContain("opencode-go/deepseek-v4-pro");
  });
});
