#!/usr/bin/env node
import { createConfigCommand } from './config-cmd.js';
import { createDoctorCommand } from './doctor.js';
import { createMainCommand } from './main.js';
import { createModelsCommand } from './models.js';
import { createMuxCommand } from './mux/index.js';
import { createRunCommand } from './run.js';

async function main(): Promise<void> {
  const program = createMainCommand();

  program.addCommand(createRunCommand());
  program.addCommand(createModelsCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createMuxCommand());

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
