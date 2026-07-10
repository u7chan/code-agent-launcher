import type { Config } from '../config.js';

export interface TmuxContext {
  config: Config;
  modelId: string;
  level: string;
  cwd: string;
  extraArgs: string[];
  dryRun: boolean;
}

export class TmuxAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TmuxAdapterError';
  }
}

export function executeTmuxStart(_ctx: TmuxContext): never {
  throw new TmuxAdapterError('tmux adapter is not implemented');
}

export function executeTmuxRun(_ctx: TmuxContext): never {
  throw new TmuxAdapterError('tmux adapter is not implemented');
}
