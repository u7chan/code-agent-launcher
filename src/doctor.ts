import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import chalk from 'chalk'
import { Command } from 'commander'
import { getAgentAdapter } from './agents/registry.js'
import { findExecutable } from './command.js'
import {
  type Config,
  ConfigError,
  loadConfig,
  type MultiplexerAdapter,
  resolveConfigPath,
} from './config.js'
import { collectAllFullModelIds, collectAllModels, normalizeAgentModelId } from './model.js'

export type CheckStatus = 'OK' | 'WARN' | 'ERROR'

export interface CheckResult {
  status: CheckStatus
  message: string
}

function ok(message: string): CheckResult {
  return { status: 'OK', message }
}

function warn(message: string): CheckResult {
  return { status: 'WARN', message }
}

function error(message: string): CheckResult {
  return { status: 'ERROR', message }
}

export interface DoctorOptions {
  refresh?: boolean
}

export function runDoctor(options: DoctorOptions = {}, agentId?: string): CheckResult[] {
  const results: CheckResult[] = []
  const configFile = resolveConfigPath()

  // 1. config.yaml exists
  if (!existsSync(configFile)) {
    results.push(error(`config file not found: ${configFile}`))
    return results
  }
  results.push(ok(`config file exists: ${configFile}`))

  // 2. YAML readable
  let config: Config
  try {
    config = loadConfig()
    results.push(ok('config YAML parsed successfully'))
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : String(err)
    results.push(error(`config validation failed: ${message}`))
    return results
  }

  const effectiveAgentId = agentId ?? config.default_agent
  const activeAgent = config.agents[effectiveAgentId]
  if (!activeAgent) {
    results.push(error(`agent "${effectiveAgentId}" is not defined in config.agents`))
    return results
  }

  // 3. agent bin in PATH
  const binPath = findExecutable(activeAgent.bin)
  if (binPath) {
    results.push(ok(`${effectiveAgentId} binary found: ${binPath}`))
  } else {
    results.push(error(`${effectiveAgentId} binary not found in PATH: ${activeAgent.bin}`))
  }

  // 4. agent provider defined
  const provider = activeAgent.provider
  if (provider.length > 0) {
    results.push(ok(`provider configured: ${provider}`))
  } else {
    results.push(error('provider is not defined'))
  }

  const activeLevels = activeAgent.levels

  // 5. default_level exists
  if (activeLevels[config.default_level]) {
    results.push(ok(`default_level exists: ${config.default_level}`))
  } else {
    results.push(error(`default_level "${config.default_level}" is not defined in levels`))
  }

  // 6-8. per level checks
  for (const [levelName, level] of Object.entries(activeLevels)) {
    if (level.default_model && level.default_model.length > 0) {
      results.push(ok(`level "${levelName}" default_model defined: ${level.default_model}`))
    } else {
      results.push(error(`level "${levelName}" default_model is not defined`))
    }

    const normalizedDefault = normalizeAgentModelId(level.default_model, activeAgent)
    if (level.models.includes(level.default_model)) {
      results.push(ok(`level "${levelName}" default_model is in models: ${level.default_model}`))
    } else {
      results.push(
        error(
          `level "${levelName}" default_model "${level.default_model}" is not in models (normalized: ${normalizedDefault})`,
        ),
      )
    }
  }

  // 9. model id normalization
  try {
    const allModels = collectAllModels(config, effectiveAgentId)
    for (const model of allModels) {
      const normalized = normalizeAgentModelId(model, activeAgent)
      results.push(ok(`model id normalized: ${model} -> ${normalized}`))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    results.push(error(`model id normalization failed: ${message}`))
  }

  // 10. models list via agent bin
  let availableModels: string[] = []
  if (binPath) {
    const agentAdapter = getAgentAdapter(effectiveAgentId)
    if (!agentAdapter.buildModelListCommand) {
      results.push(
        warn(
          `skipped ${effectiveAgentId} models check because the agent does not support model listing`,
        ),
      )
    } else {
      const spec = agentAdapter.buildModelListCommand({
        bin: activeAgent.bin,
        provider,
        refresh: options.refresh,
      })
      const result = spawnSync(binPath, spec.args, {
        shell: false,
        stdio: 'pipe',
        encoding: 'utf-8',
      })
      if (result.status === 0) {
        const refreshLabel = options.refresh ? ' (refreshed)' : ''
        results.push(
          ok(`${effectiveAgentId} models ${provider} executed successfully${refreshLabel}`),
        )
        availableModels = parseModelList(result.stdout, provider)
      } else {
        results.push(
          error(
            `${effectiveAgentId} models ${provider} failed (exit ${result.status ?? 'unknown'})`,
          ),
        )
      }
    }
  } else {
    results.push(warn(`skipped ${effectiveAgentId} models check because binary is not available`))
  }

  // 11. config models exist in actual list
  if (availableModels.length > 0) {
    const configuredModels = collectAllFullModelIds(config, effectiveAgentId)
    for (const model of configuredModels) {
      if (availableModels.includes(model)) {
        results.push(ok(`configured model exists in provider: ${model}`))
      } else {
        results.push(warn(`configured model not found in provider list: ${model}`))
      }
    }
  } else {
    results.push(
      warn('skipped config vs provider model check because provider model list is empty'),
    )
  }

  // 12. multiplexer.default defined
  if (config.multiplexer.default && config.multiplexer.default.length > 0) {
    results.push(ok(`multiplexer.default configured: ${config.multiplexer.default}`))
  } else {
    results.push(error('multiplexer.default is not defined'))
  }

  // 13. multiplexer.default adapter enabled
  const defaultAdapter = config.multiplexer[config.multiplexer.default]
  if (
    defaultAdapter &&
    typeof defaultAdapter === 'object' &&
    (defaultAdapter as MultiplexerAdapter).enabled
  ) {
    results.push(ok(`multiplexer adapter "${config.multiplexer.default}" is enabled`))
  } else {
    results.push(error(`multiplexer adapter "${config.multiplexer.default}" is not enabled`))
  }

  // 14. multiplexer.default adapter command templates
  if (defaultAdapter && typeof defaultAdapter === 'object') {
    const adapter = defaultAdapter as MultiplexerAdapter
    const hasStartTemplate =
      typeof adapter.start_command_template === 'string' &&
      adapter.start_command_template.length > 0
    const hasRunTemplate =
      typeof adapter.run_command_template === 'string' && adapter.run_command_template.length > 0

    if (hasStartTemplate && hasRunTemplate) {
      results.push(
        ok(`multiplexer adapter "${config.multiplexer.default}" has start/run command templates`),
      )
    } else {
      const missing: string[] = []
      if (!hasStartTemplate) missing.push('start_command_template')
      if (!hasRunTemplate) missing.push('run_command_template')
      results.push(
        warn(
          `multiplexer adapter "${config.multiplexer.default}" is missing templates: ${missing.join(', ')}`,
        ),
      )
    }
  }

  // 15. herdr CLI in PATH when default adapter is herdr
  if (config.multiplexer.default === 'herdr') {
    const herdrPath = findExecutable('herdr')
    if (herdrPath) {
      results.push(ok(`herdr binary found: ${herdrPath}`))
    } else {
      results.push(error('herdr binary not found in PATH (required by multiplexer.default)'))
    }
  }

  // 16. agent levels with effort
  for (const [agentId, agentCfg] of Object.entries(config.agents)) {
    for (const [levelName, level] of Object.entries(agentCfg.levels)) {
      if (level.effort) {
        if (agentId === 'opencode-go') {
          results.push(
            ok(
              `opencode-go level "${levelName}" effort "${level.effort}" — effective with cagent run (--variant). Interactive OpenCode sessions do not support effort.`,
            ),
          )
        } else {
          results.push(
            ok(
              `${agentId} level "${levelName}" effort "${level.effort}" — passed as -c model_reasoning_effort to the CLI.`,
            ),
          )
        }
      }
    }
  }

  return results
}

function parseModelList(stdout: string, provider: string): string[] {
  const models: string[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Accept both full ids and short ids from opencode output
    if (trimmed.includes('/')) {
      models.push(trimmed)
    } else {
      models.push(`${provider}/${trimmed}`)
    }
  }
  return models
}

export function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const label =
      result.status === 'OK'
        ? chalk.green('[OK]')
        : result.status === 'WARN'
          ? chalk.yellow('[WARN]')
          : chalk.red('[ERROR]')
    console.log(`${label} ${result.message}`)
  }
}

export function hasErrors(results: CheckResult[]): boolean {
  return results.some((r) => r.status === 'ERROR')
}

export interface DoctorCommandOptions {
  refresh?: boolean
}

export function createDoctorCommand(): Command {
  const command = new Command('doctor')

  command
    .description('Validate environment, configuration, and model definitions')
    .option('--refresh', 'Refresh the provider model list before checking')
    .action((options: DoctorCommandOptions) => {
      const globals = command.optsWithGlobals() as { agent?: string }
      const effectiveAgentId = globals.agent ?? process.env.CAGENT_AGENT ?? undefined
      const results = runDoctor({ refresh: options.refresh === true }, effectiveAgentId)
      printResults(results)
      if (hasErrors(results)) {
        process.exit(1)
      }
    })

  return command
}
