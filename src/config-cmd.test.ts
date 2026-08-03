import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { configPath } from './config.js'
import { createConfigCommand, DEFAULT_CONFIG } from './config-cmd.js'
import { createMainCommand } from './main.js'

const validFixture = `default_agent: opencode-go
default_level: mid
agents:
  opencode-go:
    bin: opencode
    provider: opencode-go
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

    it('outputs the current config path as JSON', async () => {
      const program = createMainCommand()
      program.addCommand(createConfigCommand())
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      const customPath = join(tmpDir, 'custom-config.yaml')
      process.env.CAGENT_CONFIG = customPath
      try {
        await program.parseAsync(['node', 'cagent', 'config', 'path', '--json'])
        expect(logSpy).toHaveBeenCalledTimes(1)
        const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
        expect(output.schema_version).toBe(1)
        expect(output.ok).toBe(true)
        expect(output.operation).toBe('config.path')
        expect(output.data.path).toBe(customPath)
        expect(output.data.source).toBe('CAGENT_CONFIG')
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

    it('outputs the default config as JSON without writing', async () => {
      const program = createMainCommand()
      program.addCommand(createConfigCommand())
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        await program.parseAsync(['node', 'cagent', 'config', 'init', '--json'])
        expect(logSpy).toHaveBeenCalledTimes(1)
        const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
        expect(output.schema_version).toBe(1)
        expect(output.ok).toBe(true)
        expect(output.operation).toBe('config.init')
        expect(output.data.config).toBe(DEFAULT_CONFIG)
        expect(existsSync(configPath())).toBe(false)
      } finally {
        logSpy.mockRestore()
      }
    })

    it('uses a root dry-run option after the config init subcommand', async () => {
      const program = createMainCommand()
      program.addCommand(createConfigCommand())
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        await program.parseAsync(['node', 'cagent', 'config', 'init', '--dry-run'])
        expect(logSpy).toHaveBeenCalledWith(DEFAULT_CONFIG)
        expect(existsSync(dirname(configPath()))).toBe(false)
        expect(existsSync(configPath())).toBe(false)
      } finally {
        logSpy.mockRestore()
      }
    })

    it('does not overwrite an existing config when root dry-run is used', async () => {
      const path = configPath()
      const existingConfig = 'existing: config\n'
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, existingConfig, 'utf-8')
      const program = createMainCommand()
      program.addCommand(createConfigCommand())
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      try {
        await program.parseAsync(['node', 'cagent', 'config', 'init', '--dry-run'])
        expect(logSpy).toHaveBeenCalledWith(DEFAULT_CONFIG)
        expect(readFileSync(path, 'utf-8')).toBe(existingConfig)
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
    it('fails without a TTY before starting the editor', async () => {
      const path = configPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, validFixture, 'utf-8')
      const marker = join(tmpDir, 'editor-started')
      const editor = join(tmpDir, 'editor.sh')
      writeFileSync(editor, `#!/bin/sh\nprintf started > '${marker}'\n`, 'utf-8')
      chmodSync(editor, 0o755)
      process.env.EDITOR = editor
      delete process.env.VISUAL

      const restoreTty = mockTty(false, true)
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
      })
      try {
        const command = createConfigCommand()
        await expect(command.parseAsync(['node', 'cagent', 'edit'])).rejects.toThrow('process.exit')
        expect(existsSync(marker)).toBe(false)
        expect(String(errorSpy.mock.calls[0]?.[0])).toContain('requires a TTY')
      } finally {
        exitSpy.mockRestore()
        errorSpy.mockRestore()
        restoreTty()
      }
    })

    it('starts the editor with a TTY', async () => {
      const path = configPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, validFixture, 'utf-8')
      const marker = join(tmpDir, 'editor-started')
      const editor = join(tmpDir, 'editor.sh')
      writeFileSync(editor, `#!/bin/sh\nprintf started > '${marker}'\n`, 'utf-8')
      chmodSync(editor, 0o755)
      process.env.EDITOR = editor
      delete process.env.VISUAL

      const restoreTty = mockTty(true, true)
      try {
        const command = createConfigCommand()
        await command.parseAsync(['node', 'cagent', 'edit'])
        expect(existsSync(marker)).toBe(true)
      } finally {
        restoreTty()
      }
    })

    it('errors when config file does not exist', async () => {
      const restoreTty = mockTty(true, true)
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
        restoreTty()
      }
    })

    it('errors when editor exits with non-zero status', async () => {
      const path = configPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, validFixture, 'utf-8')
      process.env.EDITOR = 'false'
      delete process.env.VISUAL
      const command = createConfigCommand()
      const restoreTty = mockTty(true, true)
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
      })
      try {
        await expect(command.parseAsync(['node', 'cagent', 'edit'])).rejects.toThrow('process.exit')
      } finally {
        exitSpy.mockRestore()
        restoreTty()
      }
    })

    it('respects CAGENT_CONFIG for edit path', async () => {
      const customPath = join(tmpDir, 'custom-edit.yaml')
      writeFileSync(customPath, validFixture, 'utf-8')
      process.env.CAGENT_CONFIG = customPath
      process.env.EDITOR = 'false'
      delete process.env.VISUAL
      const command = createConfigCommand()
      const restoreTty = mockTty(true, true)
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
      })
      try {
        await expect(command.parseAsync(['node', 'cagent', 'edit'])).rejects.toThrow('process.exit')
      } finally {
        exitSpy.mockRestore()
        restoreTty()
      }
    })
  })
})
