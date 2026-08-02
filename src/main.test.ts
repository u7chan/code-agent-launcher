import { describe, expect, it, spyOn } from 'bun:test'
import { CommanderError } from 'commander'
import { createMainCommand } from './main.js'

describe('createMainCommand', () => {
  it('keeps the hidden adapter option from conflicting with the agent shortcut', () => {
    const program = createMainCommand()
    const agentOption = program.options.find((option) => option.long === '--agent')
    const adapterOption = program.options.find((option) => option.long === '--adapter')

    expect(agentOption?.short).toBe('-a')
    expect(adapterOption?.short).toBeUndefined()
    expect(adapterOption?.hidden).toBe(true)
  })

  describe('version option', () => {
    it('registers -v as a version flag', () => {
      const program = createMainCommand()
      const versionOption = program.options.find((option) => option.long === '--version')
      expect(versionOption).toBeDefined()
      expect(versionOption?.short).toBe('-v')
    })

    it('registers -V as a hidden version alias', () => {
      const program = createMainCommand()
      const vOption = program.options.find((option) => option.short === '-V')
      expect(vOption).toBeDefined()
      expect(vOption?.hidden).toBe(true)
    })

    it('displays version with -v instead of unknown level error', async () => {
      const program = createMainCommand()
      program.exitOverride()
      try {
        await program.parseAsync(['node', 'cagent', '-v'])
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(CommanderError)
        expect((err as CommanderError).exitCode).toBe(0)
      }
    })

    it('displays version with --version', async () => {
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

    it('displays version with -V', async () => {
      const program = createMainCommand()
      program.exitOverride()
      const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit')
      }) as never)
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        await expect(program.parseAsync(['node', 'cagent', '-V'])).rejects.toThrow('process.exit')
        expect(logSpy).toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
        logSpy.mockRestore()
      }
    })
  })

  describe('unknown option boundary', () => {
    it('rejects --unknown as unknown option, not unknown level', async () => {
      const program = createMainCommand()
      program.exitOverride()
      try {
        await program.parseAsync(['node', 'cagent', '--unknown'])
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(CommanderError)
        expect((err as CommanderError).message).toContain("unknown option '--unknown'")
        expect((err as CommanderError).exitCode).toBe(1)
      }
    })

    it('rejects --flag values as unknown options', async () => {
      const program = createMainCommand()
      program.exitOverride()
      try {
        await program.parseAsync(['node', 'cagent', '--flag'])
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(CommanderError)
        expect((err as CommanderError).message).toContain("unknown option '--flag'")
      }
    })
  })
})
