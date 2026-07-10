import { Command } from 'commander';
import { type Config, configPath, loadConfig, type MultiplexerAdapter } from '../config.js';
import { resolveModel } from '../model.js';
import { executeHerdrRun, executeHerdrStart } from './herdr.js';
import { executeTmuxRun, executeTmuxStart } from './tmux.js';

export interface MuxGlobalOptions {
  model?: string;
  adapter?: string;
  dryRun?: boolean;
}

export class MuxAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MuxAdapterError';
  }
}

export function validateMuxAdapter(config: Config, adapterName: string): MultiplexerAdapter {
  const adapter = config.multiplexer[adapterName];
  if (!adapter || typeof adapter !== 'object' || !(adapter as MultiplexerAdapter).enabled) {
    throw new MuxAdapterError(
      `multiplexer adapter is not enabled: ${adapterName}\n\nCheck:\n  ${
        process.env.OCGO_CONFIG ?? configPath()
      }`,
    );
  }
  return adapter as MultiplexerAdapter;
}

async function dispatchMux(mode: 'start' | 'run', level: string, command: Command): Promise<void> {
  const muxOpts = command.optsWithGlobals() as MuxGlobalOptions;
  const config = loadConfig();
  const adapterName = muxOpts.adapter ?? config.multiplexer.default;

  validateMuxAdapter(config, adapterName);

  const resolved = resolveModel(config, {
    cliModel: muxOpts.model,
    cliLevel: level,
    envModel: process.env.OCGO_MODEL,
    envLevel: process.env.OCGO_LEVEL,
  });

  for (const warning of resolved.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  const extraArgs = command.args.slice(1);
  const cwd = process.cwd();
  const dryRun = muxOpts.dryRun === true;

  if (adapterName === 'herdr') {
    const ctx = {
      config,
      modelId: resolved.modelId,
      level,
      cwd,
      extraArgs,
      dryRun,
    };
    if (mode === 'start') {
      executeHerdrStart(ctx);
    } else {
      executeHerdrRun(ctx);
    }
    return;
  }

  if (adapterName === 'tmux') {
    const ctx = {
      config,
      modelId: resolved.modelId,
      level,
      cwd,
      extraArgs,
      dryRun,
    };
    if (mode === 'start') {
      executeTmuxStart(ctx);
    } else {
      executeTmuxRun(ctx);
    }
    return;
  }

  throw new MuxAdapterError(`unknown multiplexer adapter: ${adapterName}`);
}

export function createMuxCommand(): Command {
  const mux = new Command('mux');

  mux.description('Launch opencode via a multiplexer adapter');

  const start = new Command('start')
    .description('Start an interactive opencode session in a new pane')
    .argument('<level>', 'task level (low, mid, high, etc.)')
    .allowUnknownOption()
    .action(async (level: string) => {
      await dispatchMux('start', level, start);
    });

  const run = new Command('run')
    .description('Run opencode non-interactively in a new pane')
    .argument('<level>', 'task level (low, mid, high, etc.)')
    .allowUnknownOption()
    .action(async (level: string) => {
      await dispatchMux('run', level, run);
    });

  mux.addCommand(start);
  mux.addCommand(run);

  return mux;
}
