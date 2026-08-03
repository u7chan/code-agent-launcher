export function assertTty(commandName: string, alternatives: string[]): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const altList = alternatives.map((a) => `  ${a}`).join('\n')
    console.error(
      `Error: \`cagent ${commandName}\` requires a TTY.\n\n` +
        `For non-interactive alternatives:\n${altList}\n`,
    )
    process.exit(1)
  }
}
