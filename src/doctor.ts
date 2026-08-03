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
import { isJsonMode, outputJsonSuccess } from './json-output.js'
import { collectAllFullModelIds, collectAllModels, normalizeAgentModelId } from './model.js'

export type CheckStatus = 'OK' | 'WARN' | 'ERROR' | 'SKIP'

export interface CheckResult {
  status: CheckStatus
  message: string
  id: string
  details?: Record<string, unknown>
}

function ok(id: string, message: string, details?: Record<string, unknown>): CheckResult {
  return { status: 'OK', message, id, details }
}

function warn(id: string, message: string, details?: Record<string, unknown>): CheckResult {
  return { status: 'WARN', message, id, details }
}

function skip(id: string, message: string, details?: Record<string, unknown>): CheckResult {
  return { status: 'SKIP', message, id, details }
}

function error(id: string, message: string, details?: Record<string, unknown>): CheckResult {
  return { status: 'ERROR', message, id, details }
}

export interface DoctorOptions {
  refresh?: boolean
}

export function runDoctor(options: DoctorOptions = {}, agentId?: string): CheckResult[] {
  const results: CheckResult[] = []
  const configFile = resolveConfigPath()

  // 1. config.yaml exists
  if (!existsSync(configFile)) {
    results.push(
      error('config.exists', `config file not found: ${configFile}`, { path: configFile }),
    )
    return results
  }
  results.push(ok('config.exists', `config file exists: ${configFile}`, { path: configFile }))

  // 2. YAML readable
  let config: Config
  try {
    config = loadConfig()
    results.push(ok('config.valid', 'config YAML parsed successfully', { path: configFile }))
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : String(err)
    results.push(
      error('config.valid', `config validation failed: ${message}`, { path: configFile }),
    )
    return results
  }

  const effectiveAgentId = agentId ?? config.default_agent
  const activeAgent = config.agents[effectiveAgentId]
  if (!activeAgent) {
    results.push(
      error('config.default_agent', `agent "${effectiveAgentId}" is not defined in config.agents`, {
        agent: effectiveAgentId,
      }),
    )
    return results
  }

  // 3. agent bin in PATH
  const binPath = findExecutable(activeAgent.bin)
  if (binPath) {
    results.push(
      ok('agent.bin', `${effectiveAgentId} binary found: ${binPath}`, {
        agent: effectiveAgentId,
        bin: activeAgent.bin,
        path: binPath,
      }),
    )
  } else {
    results.push(
      error('agent.bin', `${effectiveAgentId} binary not found in PATH: ${activeAgent.bin}`, {
        agent: effectiveAgentId,
        bin: activeAgent.bin,
      }),
    )
  }

  // 4. agent provider defined
  const provider = activeAgent.provider
  if (provider.length > 0) {
    results.push(
      ok('agent.provider', `provider configured: ${provider}`, {
        agent: effectiveAgentId,
        provider,
      }),
    )
  } else {
    results.push(error('agent.provider', 'provider is not defined', { agent: effectiveAgentId }))
  }

  const activeLevels = activeAgent.levels

  // 5. default_level exists
  if (activeLevels[config.default_level]) {
    results.push(
      ok('agent.levels', `default_level exists: ${config.default_level}`, {
        agent: effectiveAgentId,
        default_level: config.default_level,
        levels: Object.keys(activeLevels),
      }),
    )
  } else {
    results.push(
      error('agent.levels', `default_level "${config.default_level}" is not defined in levels`, {
        agent: effectiveAgentId,
        default_level: config.default_level,
        levels: Object.keys(activeLevels),
      }),
    )
  }

  // 6-8. per level checks
  for (const [levelName, level] of Object.entries(activeLevels)) {
    if (level.default_model && level.default_model.length > 0) {
      results.push(
        ok(
          'agent.level.default_model',
          `level "${levelName}" default_model defined: ${level.default_model}`,
          {
            agent: effectiveAgentId,
            level: levelName,
            default_model: level.default_model,
          },
        ),
      )
    } else {
      results.push(
        error('agent.level.default_model', `level "${levelName}" default_model is not defined`, {
          agent: effectiveAgentId,
          level: levelName,
        }),
      )
    }

    const normalizedDefault = normalizeAgentModelId(level.default_model, activeAgent)
    if (level.models.includes(level.default_model)) {
      results.push(
        ok(
          'agent.level.models',
          `level "${levelName}" default_model is in models: ${level.default_model}`,
          {
            agent: effectiveAgentId,
            level: levelName,
            default_model: level.default_model,
            models: level.models,
          },
        ),
      )
    } else {
      results.push(
        error(
          'agent.level.models',
          `level "${levelName}" default_model "${level.default_model}" is not in models (normalized: ${normalizedDefault})`,
          {
            agent: effectiveAgentId,
            level: levelName,
            default_model: level.default_model,
            normalized_default_model: normalizedDefault,
            models: level.models,
          },
        ),
      )
    }
  }

  // 9. model id normalization
  try {
    const allModels = collectAllModels(config, effectiveAgentId)
    for (const model of allModels) {
      const normalized = normalizeAgentModelId(model, activeAgent)
      results.push(
        ok('agent.models.normalization', `model id normalized: ${model} -> ${normalized}`, {
          agent: effectiveAgentId,
          model,
          normalized_model: normalized,
        }),
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    results.push(
      error('agent.models.normalization', `model id normalization failed: ${message}`, {
        agent: effectiveAgentId,
      }),
    )
  }

  // 10. models list via agent bin
  let availableModels: string[] = []
  if (binPath) {
    const agentAdapter = getAgentAdapter(effectiveAgentId)
    if (!agentAdapter.buildModelListCommand) {
      results.push(
        skip(
          'agent.models.list',
          `skipped ${effectiveAgentId} models check because the agent does not support model listing`,
          { agent: effectiveAgentId, provider, reason: 'unsupported' },
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
          ok(
            'agent.models.list',
            `${effectiveAgentId} models ${provider} executed successfully${refreshLabel}`,
            {
              agent: effectiveAgentId,
              provider,
              refresh: options.refresh === true,
            },
          ),
        )
        availableModels = parseModelList(result.stdout, provider)
      } else {
        results.push(
          error(
            'agent.models.list',
            `${effectiveAgentId} models ${provider} failed (exit ${result.status ?? 'unknown'})`,
            {
              agent: effectiveAgentId,
              provider,
              exit_code: result.status,
            },
          ),
        )
      }
    }
  } else {
    results.push(
      warn(
        'agent.models.list',
        `skipped ${effectiveAgentId} models check because binary is not available`,
        {
          agent: effectiveAgentId,
          provider,
          reason: 'binary_unavailable',
        },
      ),
    )
  }

  // 11. config models exist in actual list
  if (availableModels.length > 0) {
    const configuredModels = collectAllFullModelIds(config, effectiveAgentId)
    for (const model of configuredModels) {
      if (availableModels.includes(model)) {
        results.push(
          ok('agent.models.configured', `configured model exists in provider: ${model}`, {
            agent: effectiveAgentId,
            model,
            available: true,
          }),
        )
      } else {
        results.push(
          warn('agent.models.configured', `configured model not found in provider list: ${model}`, {
            agent: effectiveAgentId,
            model,
            available: false,
          }),
        )
      }
    }
  } else {
    results.push(
      warn(
        'agent.models.configured',
        'skipped config vs provider model check because provider model list is empty',
        {
          agent: effectiveAgentId,
          reason: 'provider_model_list_empty',
        },
      ),
    )
  }

  // 12. multiplexer.default defined
  if (config.multiplexer.default && config.multiplexer.default.length > 0) {
    results.push(
      ok('multiplexer.default', `multiplexer.default configured: ${config.multiplexer.default}`, {
        adapter: config.multiplexer.default,
      }),
    )
  } else {
    results.push(error('multiplexer.default', 'multiplexer.default is not defined'))
  }

  // 13. multiplexer.default adapter enabled
  const defaultAdapter = config.multiplexer[config.multiplexer.default]
  if (
    defaultAdapter &&
    typeof defaultAdapter === 'object' &&
    (defaultAdapter as MultiplexerAdapter).enabled
  ) {
    results.push(
      ok('multiplexer.adapter', `multiplexer adapter "${config.multiplexer.default}" is enabled`, {
        adapter: config.multiplexer.default,
        enabled: true,
      }),
    )
  } else {
    results.push(
      error(
        'multiplexer.adapter',
        `multiplexer adapter "${config.multiplexer.default}" is not enabled`,
        {
          adapter: config.multiplexer.default,
          enabled: false,
        },
      ),
    )
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
        ok(
          'multiplexer.templates',
          `multiplexer adapter "${config.multiplexer.default}" has start/run command templates`,
          {
            adapter: config.multiplexer.default,
            start: true,
            run: true,
          },
        ),
      )
    } else {
      const missing: string[] = []
      if (!hasStartTemplate) missing.push('start_command_template')
      if (!hasRunTemplate) missing.push('run_command_template')
      results.push(
        warn(
          'multiplexer.templates',
          `multiplexer adapter "${config.multiplexer.default}" is missing templates: ${missing.join(', ')}`,
          {
            adapter: config.multiplexer.default,
            missing,
          },
        ),
      )
    }
  }

  // 15. herdr CLI in PATH when default adapter is herdr
  if (config.multiplexer.default === 'herdr') {
    const herdrPath = findExecutable('herdr')
    if (herdrPath) {
      results.push(ok('multiplexer.herdr', `herdr binary found: ${herdrPath}`, { path: herdrPath }))
    } else {
      results.push(
        error(
          'multiplexer.herdr',
          'herdr binary not found in PATH (required by multiplexer.default)',
        ),
      )
    }
  }

  // 16. agent levels with effort
  for (const [agentId, agentCfg] of Object.entries(config.agents)) {
    for (const [levelName, level] of Object.entries(agentCfg.levels)) {
      if (level.effort) {
        if (agentId === 'opencode-go') {
          results.push(
            ok(
              'agent.level.effort',
              `opencode-go level "${levelName}" effort "${level.effort}" — effective with cagent run (--variant). Interactive OpenCode sessions do not support effort.`,
              { agent: agentId, level: levelName, effort: level.effort },
            ),
          )
        } else {
          results.push(
            ok(
              'agent.level.effort',
              `${agentId} level "${levelName}" effort "${level.effort}" — passed as -c model_reasoning_effort to the CLI.`,
              { agent: agentId, level: levelName, effort: level.effort },
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

export function printResults(results: CheckResult[], json = false): void {
  if (json) {
    const summary = {
      ok: results.filter((result) => result.status === 'OK').length,
      warn: results.filter((result) => result.status === 'WARN').length,
      error: results.filter((result) => result.status === 'ERROR').length,
      skip: results.filter((result) => result.status === 'SKIP').length,
    }
    outputJsonSuccess('doctor', { summary, checks: results })
    return
  }

  for (const result of results) {
    const label =
      result.status === 'OK'
        ? chalk.green('[OK]')
        : result.status === 'WARN'
          ? chalk.yellow('[WARN]')
          : result.status === 'SKIP'
            ? chalk.cyan('[SKIP]')
            : chalk.red('[ERROR]')
    console.log(`${label} ${result.message}`)
  }
}

export function hasErrors(results: CheckResult[]): boolean {
  return results.some((r) => r.status === 'ERROR')
}

export interface DoctorCommandOptions {
  refresh?: boolean
  json?: boolean
}

export function createDoctorCommand(): Command {
  const command = new Command('doctor')

  command
    .description('Validate environment, configuration, and model definitions')
    .option('--refresh', 'Refresh the provider model list before checking')
    .action((options: DoctorCommandOptions) => {
      const globals = command.optsWithGlobals() as DoctorCommandOptions & { agent?: string }
      const effectiveAgentId = globals.agent ?? process.env.CAGENT_AGENT ?? undefined
      const results = runDoctor({ refresh: options.refresh === true }, effectiveAgentId)
      printResults(results, isJsonMode(globals))
      if (hasErrors(results)) {
        process.exit(1)
      }
    })

  return command
}
