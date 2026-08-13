#!/usr/bin/env node
import { formatError, main } from "../src/cli.js";

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify(formatError(error), null, 2)}\n`);
  process.exitCode = 1;
}

