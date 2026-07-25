import { Command } from 'commander'
import { getAgentAdapter } from './agents/registry.js'
import { formatCommandSpec, runCommandSpec } from './command.js'
import { type Config, getAgent, loadConfig } from './config.js'

export function formatConfiguredModels(config: Config, agentFilter?: string): string {
  const agentIds = Object.keys(config.agents).filter((id) => !agentFilter || id === agentFilter)

  if (agentFilter && agentIds.length === 0) {
    return `Error: agent "${agentFilter}" is not defined in config`
  }

  const lines: string[] = []
  let first = true

  for (const agentId of agentIds) {
    const agent = config.agents[agentId]
    const isDefault = agentId === config.default_agent
    const label = `${agentId}${isDefault ? ' (default)' : ''}`

    if (!first) lines.push('')
    first = false

    lines.push(`Agent: ${label}`)
    lines.push(`Default level: ${config.default_level}`)

    const levelWidth = Math.max(5, ...Object.keys(agent.levels).map((k) => k.length))
    const modelWidth = Math.max(
      13,
      ...Object.values(agent.levels).map((l) => l.default_model.length),
    )

    lines.push('')
    lines.push(
      `${'LEVEL'.padEnd(levelWidth + 1)} ${'DEFAULT MODEL'.padEnd(modelWidth + 1)} ALLOWED MODELS`,
    )
    for (const [levelName, level] of Object.entries(agent.levels)) {
      lines.push(
        `${levelName.padEnd(levelWidth + 1)} ${level.default_model.padEnd(modelWidth + 1)} ${level.models.join(', ')}`,
      )
    }
  }

  return lines.join('\n')
}

export interface ModelsAvailableOptions {
  refresh?: boolean
}

export function createModelsCommand(): Command {
  const command = new Command('models')

  command
    .description('List configured models')
    .option(
      '--refresh',
      'No effect; use "cagent models available --refresh" to refresh model list from the provider',
    )
    .action(() => {
      const config = loadConfig()
      const globals = command.optsWithGlobals() as { agent?: string; refresh?: boolean }
      const explicitAgent = globals.agent
      if (explicitAgent) {
        if (!config.agents[explicitAgent]) {
          console.error(`Error: agent "${explicitAgent}" is not defined in config`)
          process.exit(1)
        }
      }
      if (globals.refresh) {
        console.warn(
          'Warning: --refresh has no effect on "cagent models". Use "cagent models available --refresh" instead.',
        )
      }
      console.log(formatConfiguredModels(config, explicitAgent ?? undefined))
    })

  const availableCmd = new Command('available')
  availableCmd
    .description('List available models from the provider')
    .option('--refresh', 'Refresh the model list from the provider')
    .action(async (options: ModelsAvailableOptions) => {
      const config = loadConfig()
      const globals = availableCmd.optsWithGlobals() as { agent?: string; dryRun?: boolean }
      const effectiveAgentId = globals.agent ?? process.env.CAGENT_AGENT ?? config.default_agent
      if (!config.agents[effectiveAgentId]) {
        console.error(`Error: agent "${effectiveAgentId}" is not defined in config`)
        process.exit(1)
      }
      const agent = getAgent(config, effectiveAgentId)
      const adapter = getAgentAdapter(effectiveAgentId)

      if (!adapter.buildModelListCommand) {
        console.error(
          `Error: provider model discovery is not supported for agent "${effectiveAgentId}".\n` +
            `Run \`cagent models\` to view configured models.`,
        )
        process.exit(1)
      }

      const spec = adapter.buildModelListCommand({
        bin: agent.bin,
        provider: agent.provider,
        refresh: options.refresh,
      })

      if (globals.dryRun) {
        console.log(formatCommandSpec(spec))
        return
      }

      const result = await runCommandSpec(spec, { stdio: 'inherit' })
      if (result.exitCode !== 0 && result.exitCode !== null) {
        process.exit(result.exitCode)
      }
    })

  command.addCommand(availableCmd)
  return command
}
