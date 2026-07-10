import type { CommandSpec } from '../agents/types.js'

export interface TmuxContext {
  command: CommandSpec
  cwd: string
  extraArgs: string[]
  dryRun: boolean
}

export class TmuxAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TmuxAdapterError'
  }
}

export function executeTmuxStart(_ctx: TmuxContext): never {
  throw new TmuxAdapterError('tmux adapter is not implemented')
}

export function executeTmuxRun(_ctx: TmuxContext): never {
  throw new TmuxAdapterError('tmux adapter is not implemented')
}
