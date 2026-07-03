import { createProgram } from "./program.js";

const program = createProgram();

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
