#!/usr/bin/env node

import chalk from "chalk";
import inquirer from "inquirer";
import { formatEther } from "viem";
import {
  configExists,
  loadConfig,
  readPidFile,
  isProcessRunning,
  loadRuntimeState,
} from "./lib/config.js";
import { fetchNetworkConfig } from "./lib/network.js";
import { createContractClient, getBalance } from "./lib/contract.js";
import { startCommand } from "./commands/start.js";
import { configCommand, backupCommand } from "./commands/config.js";
import { stopCommand } from "./commands/stop.js";
import { printBanner } from "./lib/ui.js";

/**
 * Fetch session wallet ETH balance
 */
async function fetchSessionBalance(): Promise<string | null> {
  if (!configExists()) return null;

  try {
    const config = loadConfig();
    const networkConfig = await fetchNetworkConfig();
    const client = createContractClient(networkConfig, config.sessionKey);
    const balance = await getBalance(client);
    return formatEther(balance);
  } catch {
    return null;
  }
}

/**
 * Format duration in human readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get current status summary
 */
async function getStatusSummary(): Promise<{
  status: string;
  details: string[];
}> {
  const pid = readPidFile();
  const isRunning = pid && isProcessRunning(pid);

  if (isRunning) {
    const state = loadRuntimeState();
    if (state) {
      const runtime = formatDuration(Date.now() - state.startTime);
      const rate =
        state.stats.blocksDestroyed / ((Date.now() - state.startTime) / 1000);
      return {
        status: chalk.green.bold("● Mining Active"),
        details: [
          `${chalk.green(state.stats.blocksDestroyed.toLocaleString())} blocks destroyed`,
          `${runtime} runtime`,
          `${rate.toFixed(1)} blocks/sec`,
        ],
      };
    }
    return {
      status: chalk.green.bold("● Mining Active"),
      details: [`PID: ${pid}`],
    };
  }

  if (!configExists()) {
    return {
      status: chalk.yellow.bold("○ Not Configured"),
      details: ['Run "config" to set up your session key and drone'],
    };
  }

  const config = loadConfig();
  const balance = await fetchSessionBalance();

  const details = [`Drone #${config.droneId} ready`];
  if (balance !== null) {
    const balNum = parseFloat(balance);
    const balStr = balNum < 0.0001 ? "<0.0001" : balNum.toFixed(4);
    const color = balNum < 0.001 ? chalk.yellow : chalk.green;
    details.push(`${color(balStr)} ETH in session wallet`);
  }

  return {
    status: chalk.dim("○ Mining Stopped"),
    details,
  };
}

/**
 * Print the welcome screen
 */
async function printWelcome(): Promise<void> {
  printBanner();


  const { status, details } = await getStatusSummary();

  console.log(`  ${status}`);
  details.forEach((detail) => {
    console.log(chalk.dim(`  ${detail}`));
  });
  console.log("");

  // Commands
  console.log(chalk.yellow.bold("  Commands"));
  console.log(chalk.dim("  Type a command and press Enter"));
  console.log("");
  console.log(
    `  ${chalk.cyan("start")}     ${chalk.dim("─")}  Begin reclamation operations`,
  );
  console.log(
    `  ${chalk.cyan("stop")}      ${chalk.dim("─")}  Stop reclamation operations`,
  );
  console.log(
    `  ${chalk.cyan("config")}    ${chalk.dim("─")}  Set up or update configuration`,
  );
  console.log(
    `  ${chalk.cyan("backup")}    ${chalk.dim("─")}  View your wallet credentials`,
  );
  console.log(
    `  ${chalk.cyan("status")}    ${chalk.dim("─")}  Show current status`,
  );
  console.log(
    `  ${chalk.cyan("help")}      ${chalk.dim("─")}  Show all commands`,
  );
  console.log(`  ${chalk.cyan("quit")}      ${chalk.dim("─")}  Exit`);
  console.log("");
}

/**
 * Print help
 */
function printHelp(): void {
  console.log("");
  console.log(chalk.bold("  Available Commands"));
  console.log(chalk.cyan("  ─".repeat(24)));
  console.log("");
  console.log(
    `  ${chalk.cyan("start")}      Start autonomous reclamation operations`,
  );
  console.log(`  ${chalk.cyan("stop")}       Stop the reclamation operations`);
  console.log(`  ${chalk.cyan("config")}     Set up or update configuration`);
  console.log(
    `  ${chalk.cyan("backup")}     View wallet address and private key`,
  );
  console.log(`  ${chalk.cyan("status")}     Show current mining status`);
  console.log(`  ${chalk.cyan("clear")}      Clear the screen`);
  console.log(`  ${chalk.cyan("help")}       Show this help message`);
  console.log(`  ${chalk.cyan("quit")}       Exit RRS Terminal`);
  console.log("");
  console.log(chalk.dim("  Shortcuts: q = quit, ? = help"));
  console.log("");
}

/**
 * Print status
 */
function printStatus(): void {
  const pid = readPidFile();
  const isRunning = pid && isProcessRunning(pid);

  console.log("");

  if (!configExists()) {
    console.log(chalk.yellow("  ○ Not Configured"));
    console.log(chalk.dim('    Run "config" to set up'));
    console.log("");
    return;
  }

  const config = loadConfig();
  console.log(chalk.bold("  Configuration"));
  console.log(chalk.dim(`    Drone ID: #${config.droneId}`));
  console.log(
    chalk.dim(
      `    Session Key: ${config.sessionKey.slice(0, 10)}...${config.sessionKey.slice(-6)}`,
    ),
  );
  console.log("");

  if (isRunning) {
    console.log(
      chalk.green.bold("  ● Mining Active") + chalk.dim(` (PID: ${pid})`),
    );

    const state = loadRuntimeState();
    if (state) {
      const runtime = formatDuration(Date.now() - state.startTime);
      const rate =
        state.stats.blocksDestroyed / ((Date.now() - state.startTime) / 1000);
      console.log(
        chalk.dim(`    Blocks: ${state.stats.blocksDestroyed.toLocaleString()}`),
      );
      console.log(chalk.dim(`    Runtime: ${runtime}`));
      console.log(chalk.dim(`    Rate: ${rate.toFixed(2)} blocks/sec`));
    }
  } else {
    console.log(chalk.dim("  ○ Mining Stopped"));

    const state = loadRuntimeState();
    if (state) {
      console.log(
        chalk.dim(
          `    Last session: ${state.stats.blocksDestroyed.toLocaleString()} blocks`,
        ),
      );
    }
  }
  console.log("");
}

/**
 * Main interactive loop
 */
async function main(): Promise<void> {
  // Check for direct command (for backwards compat / scripts)
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const cmd = args[0].toLowerCase();
    switch (cmd) {
      case "start":
        await startCommand();
        return;
      case "config":
        await configCommand();
        return;
      case "stop":
        await stopCommand();
        return;
      case "status":
        printBanner();
        printStatus();
        return;
      case "backup":
      case "export":
        await backupCommand();
        return;
      case "--help":
      case "-h":
      case "help":
        printBanner();
        printHelp();
        return;
      case "--version":
      case "-v":
        console.log("1.0.0");
        return;
    }
  }

  // Interactive mode
  await printWelcome();

  while (true) {
    const { command } = await inquirer.prompt<{ command: string }>([
      {
        type: "input",
        name: "command",
        message: chalk.cyan("rrs") + chalk.dim(">"),
        prefix: "",
      },
    ]);

    const cmd = command.trim().toLowerCase();

    if (!cmd) {
      continue;
    }

    switch (cmd) {
      case "start":
        await startCommand();
        // After mining stops, show welcome again
        await printWelcome();
        break;

      case "stop":
        await stopCommand();
        break;

      case "config":
        await configCommand();
        break;

      case "backup":
      case "export":
        await backupCommand();
        break;

      case "status":
        printStatus();
        break;

      case "help":
      case "?":
        printHelp();
        break;

      case "clear":
      case "cls":
        console.clear();
        await printWelcome();
        break;

      case "quit":
      case "exit":
      case "q":
        console.log(chalk.dim("\n  Goodbye!\n"));
        process.exit(0);

      default:
        console.log(chalk.red(`\n  Unknown command: ${cmd}`));
        console.log(chalk.dim('  Type "help" for available commands\n'));
    }
  }
}

main().catch((error) => {
  console.error(chalk.red(`Error: ${error.message}`));
  process.exit(1);
});
