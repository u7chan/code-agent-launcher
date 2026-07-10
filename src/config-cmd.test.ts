import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { configPath } from './config.js'
import { createConfigCommand, DEFAULT_CONFIG } from './config-cmd.js'

describe('createConfigCommand', () => {
  let tmpDir: string
  let originalConfig: string | undefined
  let originalXdg: string | undefined
  let originalEditor: string | undefined
  let originalVisual: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cagent-config-cmd-test-'))
    originalConfig = process.env.CAGENT_CONFIG
    originalXdg = process.env.XDG_CONFIG_HOME
    originalEditor = process.env.EDITOR
    originalVisual = process.env.VISUAL
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg-config')
    delete process.env.CAGENT_CONFIG
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (originalConfig === undefined) {
      delete process.env.CAGENT_CONFIG
    } else {
      process.env.CAGENT_CONFIG = originalConfig
    }
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg
    }
    if (originalEditor === undefined) {
      delete process.env.EDITOR
    } else {
      process.env.EDITOR = originalEditor
    }
    if (originalVisual === undefined) {
      delete process.env.VISUAL
    } else {
      process.env.VISUAL = originalVisual
    }
  })

  describe('config path', () => {
    it('prints the current config file path', async () => {
      const command = createConfigCommand()
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        await command.parseAsync(['node', 'cagent', 'path'])
        expect(logSpy).toHaveBeenCalledWith(configPath())
      } finally {
        logSpy.mockRestore()
      }
    })
  })

  describe('config init', () => {
    it('creates the default config when file does not exist', async () => {
      const command = createConfigCommand()
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        await command.parseAsync(['node', 'cagent', 'init'])
        const path = configPath()
        expect(existsSync(path)).toBe(true)
        expect(readFileSync(path, 'utf-8')).toBe(DEFAULT_CONFIG)
        expect(logSpy).toHaveBeenCalledWith(`Created config file: ${path}`)
      } finally {
        logSpy.mockRestore()
      }
    })

    it('errors when config file already exists', async () => {
      const path = configPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'existing: config\n', 'utf-8')
      const command = createConfigCommand()
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
      })
      try {
        await expect(command.parseAsync(['node', 'cagent', 'init'])).rejects.toThrow('process.exit')
        expect(errorSpy).toHaveBeenCalled()
        const call = errorSpy.mock.calls[0]
        expect(call).toBeArray()
        expect(String(call[0])).toContain('already exists')
      } finally {
        errorSpy.mockRestore()
        exitSpy.mockRestore()
      }
    })

    it('overwrites existing config with --force', async () => {
      const path = configPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'existing: config\n', 'utf-8')
      const command = createConfigCommand()
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        await command.parseAsync(['node', 'cagent', 'init', '--force'])
        expect(readFileSync(path, 'utf-8')).toBe(DEFAULT_CONFIG)
        expect(logSpy).toHaveBeenCalledWith(`Created config file: ${path}`)
      } finally {
        logSpy.mockRestore()
      }
    })

    it('prints default config with --dry-run without writing', async () => {
      const command = createConfigCommand()
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        await command.parseAsync(['node', 'cagent', 'init', '--dry-run'])
        expect(logSpy).toHaveBeenCalledWith(DEFAULT_CONFIG)
        expect(existsSync(configPath())).toBe(false)
      } finally {
        logSpy.mockRestore()
      }
    })

    it('respects CAGENT_CONFIG for init path', async () => {
      const customPath = join(tmpDir, 'custom-init.yaml')
      const command = createConfigCommand()
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      process.env.CAGENT_CONFIG = customPath
      try {
        await command.parseAsync(['node', 'cagent', 'init'])
        expect(existsSync(customPath)).toBe(true)
        expect(readFileSync(customPath, 'utf-8')).toBe(DEFAULT_CONFIG)
        expect(logSpy).toHaveBeenCalledWith(`Created config file: ${customPath}`)
      } finally {
        logSpy.mockRestore()
      }
    })

    it('errors via CAGENT_CONFIG when config file already exists', async () => {
      const customPath = join(tmpDir, 'existing-init.yaml')
      mkdirSync(dirname(customPath), { recursive: true })
      writeFileSync(customPath, 'existing: config\n', 'utf-8')
      process.env.CAGENT_CONFIG = customPath
      const command = createConfigCommand()
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
      })
      try {
        await expect(command.parseAsync(['node', 'cagent', 'init'])).rejects.toThrow('process.exit')
        expect(errorSpy).toHaveBeenCalled()
        const call = errorSpy.mock.calls[0]
        expect(call).toBeArray()
        expect(String(call[0])).toContain('already exists')
      } finally {
        errorSpy.mockRestore()
        exitSpy.mockRestore()
      }
    })
  })

  describe('config edit', () => {
    it('errors when config file does not exist', async () => {
      const command = createConfigCommand()
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
      })
      try {
        await expect(command.parseAsync(['node', 'cagent', 'edit'])).rejects.toThrow('process.exit')
        expect(errorSpy).toHaveBeenCalled()
      } finally {
        errorSpy.mockRestore()
        exitSpy.mockRestore()
      }
    })

    it('errors when editor exits with non-zero status', async () => {
      const path = configPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(
        path,
        `version: 1\nopencode_bin: opencode\nprovider: opencode-go\ndefault_level: mid\nlevels:\n  mid:\n    description: Normal\n    default_model: deepseek-v4-pro\n    models:\n      - deepseek-v4-pro\nmultiplexer:\n  default: herdr\n  herdr:\n    enabled: true\n`,
        'utf-8',
      )
      process.env.EDITOR = 'false'
      delete process.env.VISUAL
      const command = createConfigCommand()
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
      })
      try {
        await expect(command.parseAsync(['node', 'cagent', 'edit'])).rejects.toThrow('process.exit')
      } finally {
        exitSpy.mockRestore()
      }
    })

    it('respects CAGENT_CONFIG for edit path', async () => {
      const customPath = join(tmpDir, 'custom-edit.yaml')
      writeFileSync(
        customPath,
        `version: 1\nopencode_bin: opencode\nprovider: opencode-go\ndefault_level: mid\nlevels:\n  mid:\n    description: Normal\n    default_model: deepseek-v4-pro\n    models:\n      - deepseek-v4-pro\nmultiplexer:\n  default: herdr\n  herdr:\n    enabled: true\n`,
        'utf-8',
      )
      process.env.CAGENT_CONFIG = customPath
      process.env.EDITOR = 'false'
      delete process.env.VISUAL
      const command = createConfigCommand()
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
      })
      try {
        await expect(command.parseAsync(['node', 'cagent', 'edit'])).rejects.toThrow('process.exit')
      } finally {
        exitSpy.mockRestore()
      }
    })
  })
})
