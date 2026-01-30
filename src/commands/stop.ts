import chalk from "chalk";
import ora from "ora";
import { readPidFile, isProcessRunning, removePidFile } from "../lib/config.js";
import {
  printBannerCompact,
  printSuccess,
  printWarning,
  printInfo,
} from "../lib/ui.js";

export async function stopCommand(): Promise<void> {
  printBannerCompact();

  const pid = readPidFile();

  if (!pid) {
    console.log("");
    printWarning("No mining process found");
    printInfo("Mining may have already stopped");
    console.log("");
    return;
  }

  if (!isProcessRunning(pid)) {
    printWarning("Mining process not running (stale PID file)");
    removePidFile();
    printInfo("Cleaned up stale PID file");
    console.log("");
    return;
  }

  const spinner = ora({
    text: chalk.dim(`Stopping mining process (PID: ${pid})...`),
    spinner: "dots",
  }).start();

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, "SIGTERM");

    // Wait for process to stop (max 5 seconds)
    let attempts = 0;
    while (isProcessRunning(pid) && attempts < 50) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    if (isProcessRunning(pid)) {
      // Force kill if still running
      spinner.text = chalk.dim("Process not responding, forcing stop...");
      process.kill(pid, "SIGKILL");
      removePidFile();
    }

    spinner.stop();
    console.log("");
    printSuccess("Mining stopped");
    console.log("");
  } catch (error) {
    spinner.stop();
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      printWarning("Process already stopped");
      removePidFile();
    } else {
      console.log(
        chalk.red(
          `  ✗ Failed to stop process: ${error instanceof Error ? error.message : error}`,
        ),
      );
    }
    console.log("");
  }
}
