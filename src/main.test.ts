import { describe, expect, it, spyOn } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommanderError } from 'commander'
import { createMainCommand } from './main.js'
import { VERSION } from './version.js'

function mockTty(stdinIsTTY: boolean, stdoutIsTTY: boolean): () => void {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: stdinIsTTY,
  })
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: stdoutIsTTY,
  })

  return () => {
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor)
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY')
    }
    if (stdoutDescriptor) {
      Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor)
    } else {
      Reflect.deleteProperty(process.stdout, 'isTTY')
    }
  }
}

function writeTestConfig(path: string, bin: string): void {
  writeFileSync(
    path,
    `default_agent: codex
default_level: mid
agents:
  codex:
    bin: ${bin}
    provider: codex
    model_id_prefix: false
    levels:
      mid:
        description: Normal
        default_model: gpt-5
        models: [gpt-5]
multiplexer:
  default: herdr
  herdr:
    enabled: true
`,
    'utf-8',
  )
}

describe('createMainCommand', () => {
  it('fails a bare cagent without a TTY before launching a child process', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cagent-main-test-'))
    const config = join(tmpDir, 'config.yaml')
    const marker = join(tmpDir, 'spawned')
    const agent = join(tmpDir, 'agent.sh')
    writeFileSync(agent, `#!/bin/sh\nprintf spawned > '${marker}'\n`, 'utf-8')
    chmodSync(agent, 0o755)
    writeTestConfig(config, agent)

    const originalConfig = process.env.CAGENT_CONFIG
    process.env.CAGENT_CONFIG = config
    const restoreTty = mockTty(false, true)
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    try {
      const program = createMainCommand()
      await expect(program.parseAsync(['node', 'cagent', 'mid'])).rejects.toThrow('process.exit')
      expect(existsSync(marker)).toBe(false)
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('requires a TTY')
    } finally {
      exitSpy.mockRestore()
      errorSpy.mockRestore()
      restoreTty()
      if (originalConfig === undefined) {
        delete process.env.CAGENT_CONFIG
      } else {
        process.env.CAGENT_CONFIG = originalConfig
      }
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('runs a bare cagent dry-run with a TTY', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cagent-main-test-'))
    const config = join(tmpDir, 'config.yaml')
    writeTestConfig(config, 'node')

    const originalConfig = process.env.CAGENT_CONFIG
    process.env.CAGENT_CONFIG = config
    const restoreTty = mockTty(true, true)
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const program = createMainCommand()
      await program.parseAsync(['node', 'cagent', 'mid', '--dry-run'])
      expect(logSpy).toHaveBeenCalledWith('# Resolved level: mid')
    } finally {
      logSpy.mockRestore()
      restoreTty()
      if (originalConfig === undefined) {
        delete process.env.CAGENT_CONFIG
      } else {
        process.env.CAGENT_CONFIG = originalConfig
      }
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('keeps the hidden adapter option from conflicting with the agent shortcut', () => {
    const program = createMainCommand()
    const agentOption = program.options.find((option) => option.long === '--agent')
    const adapterOption = program.options.find((option) => option.long === '--adapter')

    expect(agentOption?.short).toBe('-a')
    expect(adapterOption?.short).toBeUndefined()
    expect(adapterOption?.hidden).toBe(true)
  })

  describe('version option', () => {
    it('registers -V and --version via Commander built-in version', () => {
      const program = createMainCommand()
      const versionOption = program.options.find((option) => option.long === '--version')
      expect(versionOption).toBeDefined()
      expect(versionOption?.short).toBe('-V')
    })

    it('registers -v as a hidden version alias', () => {
      const program = createMainCommand()
      const vOption = program.options.find((option) => option.short === '-v')
      expect(vOption).toBeDefined()
      expect(vOption?.hidden).toBe(true)
    })

    it('displays version with -V via Commander built-in handler', async () => {
      const program = createMainCommand()
      program.exitOverride()
      try {
        await program.parseAsync(['node', 'cagent', '-V'])
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(CommanderError)
        expect((err as CommanderError).exitCode).toBe(0)
      }
    })

    it('displays version with --version via Commander built-in handler', async () => {
      const program = createMainCommand()
      program.exitOverride()
      try {
        await program.parseAsync(['node', 'cagent', '--version'])
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(CommanderError)
        expect((err as CommanderError).exitCode).toBe(0)
      }
    })

    it('displays version with -v via root action handler', async () => {
      const program = createMainCommand()
      program.exitOverride()
      const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit')
      }) as never)
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      const restoreTty = mockTty(true, true)
      try {
        await expect(program.parseAsync(['node', 'cagent', '-v'])).rejects.toThrow('process.exit')
        expect(logSpy).toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
        logSpy.mockRestore()
        restoreTty()
      }
    })

    it('displays version with -v without a TTY', async () => {
      const program = createMainCommand()
      const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit')
      }) as never)
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      const restoreTty = mockTty(false, false)
      try {
        await expect(program.parseAsync(['node', 'cagent', '-v'])).rejects.toThrow('process.exit')
        expect(exitSpy).toHaveBeenCalledWith(0)
        expect(logSpy).toHaveBeenCalledWith(VERSION)
      } finally {
        exitSpy.mockRestore()
        logSpy.mockRestore()
        restoreTty()
      }
    })
  })

  describe('unknown option boundary', () => {
    it('rejects --unknown as unknown option, not unknown level', async () => {
      const program = createMainCommand()
      program.exitOverride()
      const restoreTty = mockTty(true, true)
      try {
        try {
          await program.parseAsync(['node', 'cagent', '--unknown'])
          expect.unreachable()
        } catch (err) {
          expect(err).toBeInstanceOf(CommanderError)
          expect((err as CommanderError).message).toContain("unknown option '--unknown'")
          expect((err as CommanderError).exitCode).toBe(1)
        }
      } finally {
        restoreTty()
      }
    })

    it('rejects --flag values as unknown options', async () => {
      const program = createMainCommand()
      program.exitOverride()
      const restoreTty = mockTty(true, true)
      try {
        try {
          await program.parseAsync(['node', 'cagent', '--flag'])
          expect.unreachable()
        } catch (err) {
          expect(err).toBeInstanceOf(CommanderError)
          expect((err as CommanderError).message).toContain("unknown option '--flag'")
        }
      } finally {
        restoreTty()
      }
    })

    it('rejects --unknown as an argument error without a TTY', async () => {
      const program = createMainCommand()
      program.exitOverride()
      const restoreTty = mockTty(false, false)
      const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit')
      }) as never)
      try {
        try {
          await program.parseAsync(['node', 'cagent', '--unknown'])
          expect.unreachable()
        } catch (err) {
          expect(err).toBeInstanceOf(CommanderError)
          expect((err as CommanderError).message).toContain("unknown option '--unknown'")
        }
        expect(exitSpy).not.toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
        restoreTty()
      }
    })
  })
})
