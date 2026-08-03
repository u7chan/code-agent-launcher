import { describe, expect, it, spyOn } from 'bun:test'
import { assertTty } from './tty.js'

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

describe('assertTty', () => {
  it('passes when stdin and stdout are TTYs', () => {
    const restoreTty = mockTty(true, true)
    const exitSpy = spyOn(process, 'exit')
    try {
      assertTty('test', ['cagent config path'])
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      restoreTty()
    }
  })

  it('exits when stdin is not a TTY', () => {
    const restoreTty = mockTty(false, true)
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    try {
      expect(() => assertTty('test', ['cagent config path'])).toThrow('process.exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      restoreTty()
    }
  })

  it('exits when stdout is not a TTY', () => {
    const restoreTty = mockTty(true, false)
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    try {
      expect(() => assertTty('test', ['cagent config path'])).toThrow('process.exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      restoreTty()
    }
  })

  it('includes non-interactive alternatives in the error message', () => {
    const restoreTty = mockTty(false, false)
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    try {
      expect(() =>
        assertTty('[level]', ['cagent run <level> -- "<prompt>"', 'cagent mux start <level>']),
      ).toThrow('process.exit')
      const message = String(errorSpy.mock.calls[0]?.[0])
      expect(message).toContain('cagent run <level> -- "<prompt>"')
      expect(message).toContain('cagent mux start <level>')
    } finally {
      exitSpy.mockRestore()
      errorSpy.mockRestore()
      restoreTty()
    }
  })
})
