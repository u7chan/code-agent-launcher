import type { Config, ResolvedProfile } from './config.js'

export interface ResolveProfileOptions {
  cliProfile?: string
  envProfile?: string
  cliModel?: string
  envModel?: string
  cliEffort?: string
  envEffort?: string
}

export class ProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileError'
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined
}

function availableText(config: Config): string {
  const names = Object.keys(config.profiles ?? {})
  const listed = names.length > 0 ? names.map((name) => `  ${name}`).join('\n') : '  (none defined)'
  return `Available profiles:\n${listed}`
}

export function resolveProfile(config: Config, options: ResolveProfileOptions): ResolvedProfile {
  const cliProfile = nonEmpty(options.cliProfile)
  const envProfile = nonEmpty(options.envProfile)
  const profileName = cliProfile ?? envProfile ?? config.default_profile

  if (profileName === undefined) {
    throw new ProfileError(`no launch profile selected\n\n${availableText(config)}`)
  }

  const profile = config.profiles?.[profileName]
  if (!profile) {
    throw new ProfileError(`unknown profile: ${profileName}\n\n${availableText(config)}`)
  }

  const cliModel = nonEmpty(options.cliModel)
  const envModel = nonEmpty(options.envModel)
  const cliEffort = nonEmpty(options.cliEffort)
  const envEffort = nonEmpty(options.envEffort)

  const model = cliModel ?? envModel ?? profile.model
  const modelSource = cliModel !== undefined ? 'cli' : envModel !== undefined ? 'env' : 'profile'

  const effort = cliEffort ?? envEffort ?? profile.effort
  const effortSource =
    cliEffort !== undefined
      ? 'cli'
      : envEffort !== undefined
        ? 'env'
        : profile.effort !== undefined
          ? 'profile'
          : undefined

  return {
    profile: profileName,
    source: cliProfile !== undefined ? 'cli' : envProfile !== undefined ? 'env' : 'default',
    agent: profile.agent,
    model,
    effort,
    modelSource,
    effortSource,
  }
}
