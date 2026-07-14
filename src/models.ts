import { Command } from 'commander'
import { runCommand, runCommandFormat } from './command.js'
import { loadConfig } from './config.js'

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
      const agent = config.agents[config.default_agent]
      const provider = agent.provider ?? config.default_agent
      const args = ['models', provider]

      if (options.refresh) {
        args.push('--refresh')
      }

      if (dryRun) {
        console.log(runCommandFormat(agent.bin, args))
        return
      }

      const result = await runCommand(agent.bin, args, {
        stdio: 'inherit',
      })

      if (result.exitCode !== 0 && result.exitCode !== null) {
        process.exit(result.exitCode)
      }
    })

  return command
}
