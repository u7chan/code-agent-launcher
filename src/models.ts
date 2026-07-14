import { Command } from 'commander'
import { getAgentAdapter } from './agents/registry.js'
import { formatCommandSpec, runCommandSpec } from './command.js'
import { getAgent, loadConfig } from './config.js'

export interface ModelsCommandOptions {
  refresh?: boolean
}

export function createModelsCommand(): Command {
  const command = new Command('models')

  command
    .description('List available models')
    .option('--refresh', 'Refresh the model list from the provider')
    .action(async (options: ModelsCommandOptions) => {
      const config = loadConfig()
      const dryRun = command.parent?.opts().dryRun === true
      const globals = command.optsWithGlobals() as { agent?: string }
      const effectiveAgentId = globals.agent ?? process.env.CAGENT_AGENT ?? config.default_agent
      const agent = getAgent(config, effectiveAgentId)
      const adapter = getAgentAdapter(effectiveAgentId)
      const provider = agent.provider ?? effectiveAgentId

      if (!adapter.buildModelListCommand) {
        console.error(`Error: agent "${effectiveAgentId}" does not support listing models`)
        process.exit(1)
      }

      const spec = adapter.buildModelListCommand({
        bin: agent.bin,
        provider,
        refresh: options.refresh,
      })

      if (dryRun) {
        console.log(formatCommandSpec(spec))
        return
      }

      const result = await runCommandSpec(spec, {
        stdio: 'inherit',
      })

      if (result.exitCode !== 0 && result.exitCode !== null) {
        process.exit(result.exitCode)
      }
    })

  return command
}
