import chalk from "chalk";
import {
  loadConfig,
  configExists,
  writePidFile,
  removePidFile,
  clearRuntimeState,
  readPidFile,
  isProcessRunning,
} from "../lib/config.js";
import { fetchNetworkConfig } from "../lib/network.js";
import {
  validateMiningSetup,
  createMinerContext,
  startMining,
  stopMining,
} from "../lib/miner.js";
import {
  printBanner,
  printSection,
  printError,
  printSuccess,
  printKeyValue,
  printInfo,
} from "../lib/ui.js";

export async function startCommand(): Promise<void> {
  printBanner();

  // Check if already running
  const existingPid = readPidFile();
  if (existingPid && isProcessRunning(existingPid)) {
    console.log("");
    printError(`Mining is already running (PID: ${existingPid})`);
    printInfo('Use "rrs-terminal stop" to stop it first');
    console.log("");
    process.exit(1);
  }

  // Check config exists
  if (!configExists()) {
    console.log("");
    printError("No configuration found");
    printInfo('Run "rrs-terminal config" to set up your session key and drone');
    console.log("");
    process.exit(1);
  }

  // Load config
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.log("");
    printError(
      `Failed to load config: ${error instanceof Error ? error.message : error}`,
    );
    console.log("");
    process.exit(1);
  }

  printSection("Initializing");

  // Fetch network config
  console.log(chalk.dim("  Fetching network configuration..."));
  let networkConfig;
  try {
    networkConfig = await fetchNetworkConfig();
    printSuccess(`Connected to ${networkConfig.network.name}`);
    printInfo(`Chain ID: ${networkConfig.network.chainId}`);
  } catch (error) {
    printError(
      `Failed to fetch network config: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  // Validate setup
  console.log("");
  const validation = await validateMiningSetup(config, networkConfig);
  if (
    !validation.valid ||
    !validation.client ||
    validation.feePerBlock === undefined ||
    validation.balance === undefined ||
    validation.cubeBalance === undefined ||
    validation.unprocessedCube === undefined ||
    !validation.ownerAddress
  ) {
    console.log("");
    printError(validation.error || "Validation failed");
    console.log("");
    process.exit(1);
  }

  // Write PID file
  writePidFile(process.pid);
  clearRuntimeState();

  // Track if battery was depleted (for proper exit message)
  let batteryDepleted = false;

  // Create miner context
  const ctx = createMinerContext(
    config,
    networkConfig,
    validation.client,
    validation.feePerBlock,
    validation.balance,
    validation.cubeBalance,
    validation.unprocessedCube,
    validation.ownerAddress,
    validation.currentBattery!,
    validation.maxBattery!,
    {
      onBatteryDepleted: () => {
        batteryDepleted = true;
      },
    },
  );

  // Handle graceful shutdown
  const shutdown = () => {
    stopMining(ctx, batteryDepleted);
    removePidFile();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start mining
  printSection("Reclamation Operations");

  try {
    await startMining(ctx);
    // If we get here, mining ended naturally (battery depleted)
    stopMining(ctx, batteryDepleted);
    removePidFile();
  } catch (error) {
    console.log("");
    printError(
      `Mining error: ${error instanceof Error ? error.message : error}`,
    );
    removePidFile();
    process.exit(1);
  }
}
