#!/usr/bin/env node
import { createMainCommand } from "./main.js";
import { createRunCommand } from "./run.js";
import { createModelsCommand } from "./models.js";
import { createDoctorCommand } from "./doctor.js";

async function main(): Promise<void> {
  const program = createMainCommand();

  program.addCommand(createRunCommand());
  program.addCommand(createModelsCommand());
  program.addCommand(createDoctorCommand());

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
