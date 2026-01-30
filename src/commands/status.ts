import chalk from "chalk";
import {
  readPidFile,
  isProcessRunning,
  loadRuntimeState,
  configExists,
  loadConfig,
  getConfigPath,
} from "../lib/config.js";
import {
  printBannerCompact,
  printSection,
  printSuccess,
  printWarning,
  printKeyValue,
  printStatsBox,
  printInfo,
} from "../lib/ui.js";

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

export async function statusCommand(): Promise<void> {
  printBannerCompact();

  // Check config
  if (!configExists()) {
    console.log("");
    printWarning("No configuration found");
    printInfo('Run "rrs-terminal config" to set up');
    console.log("");
    return;
  }

  const config = loadConfig();

  // Config section
  printStatsBox("Configuration", [
    { label: "Config File", value: getConfigPath() },
    { label: "Drone ID", value: `#${config.droneId}`, color: "cyan" },
    {
      label: "Session Key",
      value: `${config.sessionKey.slice(0, 10)}...${config.sessionKey.slice(-6)}`,
    },
  ]);

  // Check if running
  const pid = readPidFile();
  if (pid && isProcessRunning(pid)) {
    console.log(
      chalk.green.bold(`  ● Mining Active`) + chalk.dim(` (PID: ${pid})`),
    );

    // Load runtime state for stats
    const state = loadRuntimeState();
    if (state) {
      const runtime = formatDuration(Date.now() - state.startTime);
      const rate =
        state.stats.blocksDestroyed / ((Date.now() - state.startTime) / 1000);

      printStatsBox("Current Session", [
        { label: "Runtime", value: runtime, color: "cyan" },
        {
          label: "Blocks Destroyed",
          value: state.stats.blocksDestroyed.toLocaleString(),
          color: "green",
        },
        {
          label: "Already Destroyed",
          value: state.stats.blocksAlreadyDestroyed.toLocaleString(),
          color: "yellow",
        },
        {
          label: "Errors",
          value: state.stats.errors.toLocaleString(),
          color: state.stats.errors > 0 ? "red" : "white",
        },
        { label: "Rate", value: `${rate.toFixed(2)} blocks/sec`, color: "cyan" },
        {
          label: "Cap Refreshes",
          value: state.stats.capabilityRefreshes.toLocaleString(),
        },
      ]);
    }
  } else {
    console.log(chalk.yellow.bold(`  ○ Mining Stopped`));

    // Check for last session stats
    const state = loadRuntimeState();
    if (state) {
      printStatsBox("Last Session", [
        {
          label: "Blocks Destroyed",
          value: state.stats.blocksDestroyed.toLocaleString(),
          color: "green",
        },
        { label: "Errors", value: state.stats.errors.toLocaleString() },
      ]);
    }
  }

  console.log("");
  console.log(chalk.dim("  Commands:"));
  console.log(
    chalk.dim("    rrs-terminal start  ") +
      chalk.dim("─") +
      chalk.dim(" Start mining"),
  );
  console.log(
    chalk.dim("    rrs-terminal stop   ") +
      chalk.dim("─") +
      chalk.dim(" Stop mining"),
  );
  console.log(
    chalk.dim("    rrs-terminal config ") +
      chalk.dim("─") +
      chalk.dim(" Update configuration"),
  );
  console.log("");
}
