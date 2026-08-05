import { Command } from 'commander'
import { getAgentAdapter } from './agents/registry.js'
import { formatCommandSpec, runCommandSpec } from './command.js'
import { type Config, getAgent, loadConfig } from './config.js'
import { isJsonMode, type JsonWarning, outputJsonSuccess } from './json-output.js'

export function formatConfiguredModels(config: Config, agentFilter?: string): string {
  const agentIds = Object.keys(config.agents).filter((id) => !agentFilter || id === agentFilter)

  if (agentFilter && agentIds.length === 0) {
    return `Error: agent "${agentFilter}" is not defined in config`
  }

  const lines: string[] = []
  let first = true

  for (const agentId of agentIds) {
    const isDefault = agentId === config.default_agent
    const label = `${agentId}${isDefault ? ' (default)' : ''}`

    if (!first) lines.push('')
    first = false

    lines.push(`Agent: ${label}`)
    lines.push(`Default profile: ${config.default_profile ?? '(none defined)'}`)
    const profiles = Object.entries(config.profiles ?? {}).filter(
      ([, profile]) => profile.agent === agentId,
    )
    lines.push('')
    if (profiles.length === 0) {
      lines.push('Profiles: (none defined)')
      continue
    }

    const profileWidth = Math.max(7, ...profiles.map(([name]) => name.length))
    const modelWidth = Math.max(5, ...profiles.map(([, profile]) => profile.model.length))
    const effortWidth = Math.max(6, ...profiles.map(([, profile]) => profile.effort?.length ?? 0))
    lines.push(
      `${'PROFILE'.padEnd(profileWidth + 1)} ${'MODEL'.padEnd(modelWidth + 1)} ${'EFFORT'.padEnd(effortWidth + 1)}`,
    )
    for (const [profileName, profile] of profiles) {
      lines.push(
        `${profileName.padEnd(profileWidth + 1)} ${profile.model.padEnd(modelWidth + 1)} ${(profile.effort ?? '-').padEnd(effortWidth + 1)}`,
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
      const globals = command.optsWithGlobals() as {
        agent?: string
        refresh?: boolean
        json?: boolean
      }
      const explicitAgent = globals.agent
      if (explicitAgent) {
        if (!config.agents[explicitAgent]) {
          console.error(`Error: agent "${explicitAgent}" is not defined in config`)
          process.exit(1)
        }
      }
      const json = isJsonMode(globals)
      const warnings: JsonWarning[] = []
      if (globals.refresh) {
        const message =
          '--refresh has no effect on "cagent models". Use "cagent models available --refresh" instead.'
        if (json) {
          warnings.push({
            code: 'REFRESH_IGNORED',
            message,
            details: { option: '--refresh' },
          })
        } else {
          console.warn(`Warning: ${message}`)
        }
      }

      if (json) {
        const agents = Object.entries(config.agents).map(([id, agent]) => ({
          id,
          provider: agent.provider,
          bin: agent.bin,
          model_id_prefix: agent.model_id_prefix ?? true,
        }))
        const profiles = Object.entries(config.profiles ?? {}).map(([name, profile]) => ({
          name,
          ...profile,
        }))
        outputJsonSuccess(
          'models',
          {
            default_agent: config.default_agent,
            default_profile: config.default_profile ?? null,
            agents,
            profiles,
          },
          warnings,
        )
        return
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
