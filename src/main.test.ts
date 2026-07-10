import { describe, expect, it } from 'bun:test'
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
})
