#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("aroh-forge")
  .description("Autonomous plan-build-review CLI for code generation")
  .version("0.1.0");

program
  .command("plan <source>")
  .description("Generate execution plans from a PRD file or description")
  .option("--auto", "Run without approval gates")
  .option("--verbose", "Stream agent output")
  .option("--name <name>", "Plan set name (inferred from source if omitted)")
  .action(async (source: string, options) => {
    console.log(`[forge] plan: ${source}`, options);
    // TODO: wire up planner agent
  });

program
  .command("build <planSet>")
  .description("Execute plans (implement + review)")
  .option("--auto", "Run without approval gates")
  .option("--verbose", "Stream agent output")
  .option("--dry-run", "Validate and show execution plan without running")
  .action(async (planSet: string, options) => {
    console.log(`[forge] build: ${planSet}`, options);
    // TODO: wire up orchestrator
  });

program
  .command("review <planSet>")
  .description("Review existing code against plans")
  .option("--fix", "Auto-fix identified issues")
  .option("--verbose", "Stream agent output")
  .action(async (planSet: string, options) => {
    console.log(`[forge] review: ${planSet}`, options);
    // TODO: wire up reviewer agent
  });

program
  .command("status")
  .description("Check running builds")
  .action(async () => {
    console.log("[forge] status");
    // TODO: read .forge-state.json
  });

program.parse();
