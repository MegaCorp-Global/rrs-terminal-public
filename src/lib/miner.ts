import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import type { Config, MiningStats, NetworkConfig } from "../types.js";
import { CONTAINERS_PER_LAYER, TILES_PER_CONTAINER } from "../types.js";
import {
  getCapability,
  getRemainingBudget,
  needsCapabilityRefresh,
  clearCapabilityCache,
} from "./capability.js";
import {
  createContractClient,
  isAuthorizedForDrone,
  destroyBlock,
  getBalance,
  getCubeBalance,
  getUnprocessedCubeBalance,
  getJackpotFeePerBlock,
  getDroneOwner,
  getLicenseStatus,
  type ContractClient,
} from "./contract.js";
import { saveRuntimeState, createInitialStats } from "./config.js";
import { printKeyValue, printStatsBox } from "./ui.js";
import { formatEther } from "viem";

const MINE_DELAY_MS = 100; // Delay between mining attempts
const GRID_SIZE = 10; // 10x10 mining grid display (100 blocks)

// Mining grid icons - cyan for success (green = rewards)
const GRID_EMPTY = chalk.dim("░");
const GRID_MINING = chalk.yellow("◆");
const GRID_SUCCESS = chalk.cyan("▪");
const GRID_FAIL = chalk.red("×");
const GRID_SKIP = chalk.gray("·");

// Log file path
const LOG_DIR = path.join(os.homedir(), ".megacube");
const LOG_FILE = path.join(LOG_DIR, "rrs.log");

/**
 * Append a log entry to the log file
 */
function logToFile(
  level: "INFO" | "ERROR" | "WARN",
  message: string,
  data?: Record<string, unknown>,
): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const entry = data
      ? `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}\n`
      : `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, entry);
  } catch {
    // Silently ignore log errors
  }
}

export interface MinerCallbacks {
  onBlockDestroyed?: (
    containerId: number,
    blockId: number,
    txHash: string,
  ) => void;
  onBlockAlreadyDestroyed?: (containerId: number, blockId: number) => void;
  onError?: (error: string) => void;
  onCapabilityRefresh?: (budget: number) => void;
  onStats?: (stats: MiningStats) => void;
  onBatteryDepleted?: () => void;
}

export interface MinerContext {
  config: Config;
  networkConfig: NetworkConfig;
  client: ContractClient;
  stats: MiningStats;
  running: boolean;
  callbacks: MinerCallbacks;
  feePerBlock: bigint;
  grid: string[]; // 10x10 grid state
  gridIndex: number; // Current position in grid
  lastBalance: bigint;
  lastCubeBalance: bigint;
  lastUnprocessedCube: bigint;
  // Current mining location
  currentContainer: number;
  currentBlock: number;
  // Drone owner address (receives CUBE rewards)
  ownerAddress: string;
  // Last error for debugging
  lastError: string;
  // Battery status (on-chain)
  currentBattery: number;
  maxBattery: number;
  lastBatteryRefresh: number; // timestamp
}

/**
 * Decompose container ID into hierarchical location
 * Hierarchy: Face (6) → Sector (256/face) → Region (256/sector) → Container (4/region)
 */
function decomposeContainer(containerId: number): {
  face: number;
  sector: number;
  region: number;
  container: number;
} {
  const CONTAINERS_PER_REGION = 4;
  const REGIONS_PER_SECTOR = 256;
  const SECTORS_PER_FACE = 256;

  const container = containerId % CONTAINERS_PER_REGION;
  const remaining1 = Math.floor(containerId / CONTAINERS_PER_REGION);

  const region = remaining1 % REGIONS_PER_SECTOR;
  const remaining2 = Math.floor(remaining1 / REGIONS_PER_SECTOR);

  const sector = remaining2 % SECTORS_PER_FACE;
  const face = Math.floor(remaining2 / SECTORS_PER_FACE);

  return { face, sector, region, container };
}

const FACE_NAMES = ["TOP", "BOTTOM", "NORTH", "SOUTH", "EAST", "WEST"];

/**
 * Pick a random container ID (0 to CONTAINERS_PER_LAYER - 1)
 */
function randomContainer(): number {
  return Math.floor(Math.random() * CONTAINERS_PER_LAYER);
}

/**
 * Pick a random block ID (0 to TILES_PER_CONTAINER - 1)
 */
function randomBlock(): number {
  return Math.floor(Math.random() * TILES_PER_CONTAINER);
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
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate the mining setup before starting
 */
export async function validateMiningSetup(
  config: Config,
  networkConfig: NetworkConfig,
): Promise<{
  valid: boolean;
  error?: string;
  client?: ContractClient;
  feePerBlock?: bigint;
  balance?: bigint;
  cubeBalance?: bigint;
  unprocessedCube?: bigint;
  ownerAddress?: string;
  currentBattery?: number;
  maxBattery?: number;
}> {
  // Simple spinner simulation with process.stdout
  const spin = (text: string) => process.stdout.write(`\r  ${chalk.dim(text)}`);
  const clear = () => process.stdout.write("\r" + " ".repeat(60) + "\r");

  try {
    // Create contract client
    spin("Initializing secure connection...");
    const client = createContractClient(networkConfig, config.sessionKey);
    await new Promise((r) => setTimeout(r, 200));

    // Check wallet balance
    spin("Verifying operator credentials...");
    const balance = await getBalance(client);
    if (balance === 0n) {
      clear();
      console.log(chalk.red("  ✗ Session wallet has no ETH"));
      return {
        valid: false,
        error: `Session wallet ${client.account.address} has no ETH. Fund it with ETH for gas.`,
      };
    }

    // Check drone authorization
    spin(`Validating drone #${config.droneId} license...`);
    const authorized = await isAuthorizedForDrone(
      client,
      config.droneId,
      client.account.address,
    );
    if (!authorized) {
      clear();
      console.log(chalk.red("  ✗ Session wallet not authorized for drone"));
      return {
        valid: false,
        error: `Session wallet ${client.account.address} is not authorized for drone #${config.droneId}. Set session key on drone first.`,
      };
    }

    // Get license status (battery)
    spin("Reading license battery status...");
    const licenseStatus = await getLicenseStatus(client, config.droneId);
    if (licenseStatus.currentBattery === 0) {
      clear();
      console.log(chalk.yellow("  ⚠ License battery is depleted"));
      console.log(chalk.dim("    Wait for your next shift to begin."));
      return {
        valid: false,
        error: "License battery depleted. Wait for next shift.",
      };
    }

    // Get drone owner (receives CUBE rewards)
    spin("Locating reward destination...");
    const ownerAddress = await getDroneOwner(client, config.droneId);

    // Get CUBE balances for the OWNER (not session wallet)
    spin("Checking $CUBE reserves...");
    const cubeBalance = await getCubeBalance(client, ownerAddress);
    const unprocessedCube = await getUnprocessedCubeBalance(
      client,
      ownerAddress,
    );

    // Get jackpot fee
    spin("Querying current reclamation fees...");
    const feePerBlock = await getJackpotFeePerBlock(client);

    // Verify identity validation (capability endpoint)
    spin("Performing sybil-resistant identity validation...");
    await getCapability(
      networkConfig,
      client.account.address,
      config.droneId,
      0,
    );

    clear();
    console.log(chalk.green("  ✓ Mining authorization verified"));

    console.log("");
    printKeyValue("Session Wallet", client.account.address);
    printKeyValue("Balance", `${formatEther(balance)} ETH`);
    printKeyValue("License ID", `#${config.droneId}`);
    const batteryPct = Math.round(
      (licenseStatus.currentBattery / licenseStatus.maxBattery) * 100,
    );
    printKeyValue(
      "Battery",
      `${licenseStatus.currentBattery}/${licenseStatus.maxBattery} (${batteryPct}%)`,
    );

    // Clear the capability we just fetched so we get a fresh one when mining starts
    clearCapabilityCache();

    return {
      valid: true,
      client,
      feePerBlock,
      balance,
      cubeBalance,
      unprocessedCube,
      ownerAddress,
      currentBattery: licenseStatus.currentBattery,
      maxBattery: licenseStatus.maxBattery,
    };
  } catch (error) {
    clear();
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`  ✗ Validation failed`));
    return { valid: false, error: errorMessage };
  }
}

/**
 * Create a miner context
 */
export function createMinerContext(
  config: Config,
  networkConfig: NetworkConfig,
  client: ContractClient,
  feePerBlock: bigint,
  balance: bigint,
  cubeBalance: bigint,
  unprocessedCube: bigint,
  ownerAddress: string,
  currentBattery: number,
  maxBattery: number,
  callbacks: MinerCallbacks = {},
): MinerContext {
  return {
    config,
    networkConfig,
    client,
    stats: createInitialStats(),
    running: false,
    callbacks,
    feePerBlock,
    grid: Array(GRID_SIZE * GRID_SIZE).fill(GRID_EMPTY),
    gridIndex: 0,
    lastBalance: balance,
    lastCubeBalance: cubeBalance,
    lastUnprocessedCube: unprocessedCube,
    currentContainer: 0,
    currentBlock: 0,
    ownerAddress,
    lastError: "",
    currentBattery,
    maxBattery,
    lastBatteryRefresh: Date.now(),
  };
}

/**
 * Render the mining dashboard - clears screen and redraws
 */
function renderDashboard(ctx: MinerContext): void {
  const rate =
    ctx.stats.blocksDestroyed / ((Date.now() - ctx.stats.startTime) / 1000);

  // Format stats
  const tps = `${rate.toFixed(1)}/s`;
  const blocksNum = ctx.stats.blocksDestroyed.toLocaleString();
  const ethBal = parseFloat(formatEther(ctx.lastBalance)).toFixed(4);
  const earnedCube = parseFloat(formatEther(ctx.lastUnprocessedCube)).toFixed(
    2,
  );
  const inscribedCube = parseFloat(formatEther(ctx.lastCubeBalance)).toFixed(2);

  // Decompose current location
  const loc = decomposeContainer(ctx.currentContainer);
  const faceName = FACE_NAMES[loc.face] || `F${loc.face}`;
  const locationStr = `${faceName}/${loc.sector}/${loc.region}/${loc.container}:${ctx.currentBlock}`;

  // Build progress bar for BATTERY (the actual on-chain resource)
  const batteryPercent =
    ctx.maxBattery > 0
      ? Math.min((ctx.currentBattery / ctx.maxBattery) * 100, 100)
      : 0;
  const barWidth = 20;
  const filledWidth = Math.round((batteryPercent / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;
  const batteryColor =
    batteryPercent > 30 ? chalk.green : batteryPercent > 10 ? chalk.yellow : chalk.red;
  const batteryBar =
    batteryColor("█".repeat(filledWidth)) + chalk.dim("░".repeat(emptyWidth));

  // Clear screen and move to top
  console.clear();

  // Header
  console.log("");
  console.log(chalk.green.bold("  ⛏  Reclamation Operations Active"));
  console.log(chalk.dim("  Press Ctrl+C to stop"));
  console.log("");

  // Stats line 1: Performance & ETH
  console.log(
    `  ${chalk.bold("BPS:")} ${chalk.cyan(tps)}    ${chalk.bold("Blocks:")} ${chalk.white(blocksNum)}    ${chalk.bold("ETH:")} ${chalk.yellow(ethBal)}`,
  );
  // Stats line 2: CUBE balances (Earned=cyan/blue, Inscribed=green)
  console.log(
    `  ${chalk.bold("$CUBE")}  |  ${chalk.bold("Earned:")} ${chalk.cyan(earnedCube)}  |  ${chalk.bold("Inscribed:")} ${chalk.green(inscribedCube)}`,
  );
  // Stats line 3: Location
  console.log(`  ${chalk.bold("Location:")} ${chalk.magenta(locationStr)}`);
  console.log("");

  // Grid (10x10 = 20 chars wide with spaces)
  for (let row = 0; row < GRID_SIZE; row++) {
    let rowStr = "  ";
    for (let col = 0; col < GRID_SIZE; col++) {
      const idx = row * GRID_SIZE + col;
      rowStr += ctx.grid[idx] + " ";
    }
    console.log(rowStr);
  }

  console.log("");
  console.log(
    `  ${chalk.bold("Battery")} [${batteryBar}] ${ctx.currentBattery}/${ctx.maxBattery}`,
  );

  // Show last error if any (truncated)
  if (ctx.lastError && ctx.stats.errors > 0) {
    const truncatedError =
      ctx.lastError.length > 60
        ? ctx.lastError.substring(0, 60) + "..."
        : ctx.lastError;
    console.log("");
    console.log(`  ${chalk.red("Last Error:")} ${chalk.dim(truncatedError)}`);
  }
}

/**
 * Run a single mining iteration
 */
async function mineOnce(ctx: MinerContext): Promise<void> {
  // Pick random target and track location
  const containerId = randomContainer();
  const blockId = randomBlock();
  ctx.currentContainer = containerId;
  ctx.currentBlock = blockId;

  // Mark current grid position as "mining"
  ctx.grid[ctx.gridIndex] = GRID_MINING;

  try {
    // Get capability (will fetch fresh if needed, use cache otherwise)
    const wasRefresh = needsCapabilityRefresh();
    const capability = await getCapability(
      ctx.networkConfig,
      ctx.client.account.address,
      ctx.config.droneId,
    );
    const nonceHex = capability.capability.nonce.toString(16).padStart(16, "0");
    if (wasRefresh) {
      ctx.stats.capabilityRefreshes++;
      ctx.callbacks.onCapabilityRefresh?.(capability.capability.budget);
      logToFile("INFO", "Fresh capability obtained", {
        nonce: `0x${nonceHex}`,
        budget: capability.capability.budget,
        expiresAt: Number(capability.capability.expiresAt),
      });
    }

    // Destroy block
    const result = await destroyBlock(
      ctx.client,
      ctx.config.droneId,
      containerId,
      blockId,
      capability,
      ctx.feePerBlock,
    );

    if (result.success) {
      ctx.stats.blocksDestroyed++;
      ctx.grid[ctx.gridIndex] = GRID_SUCCESS;
      ctx.callbacks.onBlockDestroyed?.(containerId, blockId, result.txHash!);

      // Decrement local battery estimate (each block costs 1 battery)
      if (ctx.currentBattery > 0) {
        ctx.currentBattery--;
      }

      // Refresh battery from chain every 25 blocks to stay accurate
      if (ctx.stats.blocksDestroyed % 25 === 0) {
        try {
          const status = await getLicenseStatus(ctx.client, ctx.config.droneId);
          ctx.currentBattery = status.currentBattery;
          ctx.maxBattery = status.maxBattery;
          ctx.lastBatteryRefresh = Date.now();
        } catch {
          // Ignore refresh errors, continue with estimate
        }
      }
    } else if (result.alreadyDestroyed) {
      ctx.stats.blocksAlreadyDestroyed++;
      ctx.grid[ctx.gridIndex] = GRID_SKIP;
      ctx.callbacks.onBlockAlreadyDestroyed?.(containerId, blockId);
    } else {
      ctx.stats.errors++;
      ctx.grid[ctx.gridIndex] = GRID_FAIL;
      ctx.lastError = result.error || "Unknown error";
      logToFile("ERROR", "Block destruction failed", {
        containerId,
        blockId,
        error: result.error,
        nonce: `0x${nonceHex}`,
      });
      ctx.callbacks.onError?.(result.error || "Unknown error");

      // If capability error, clear cache to force refresh
      const lowerError = result.error?.toLowerCase() || "";
      if (
        lowerError.includes("capability") ||
        lowerError.includes("budget") ||
        lowerError.includes("exhausted")
      ) {
        logToFile("WARN", "Capability error - clearing cache", {
          error: result.error,
          localBudget: getRemainingBudget(),
          blocksDestroyed: ctx.stats.blocksDestroyed,
        });
        clearCapabilityCache();
      }

      // If battery is depleted, end shift (no regen)
      if (
        lowerError.includes("battery depleted") ||
        lowerError.includes("shift ended")
      ) {
        ctx.running = false; // Stop this mining session
        logToFile("INFO", "Battery depleted - shift ended");
        ctx.callbacks.onBatteryDepleted?.();
      }
    }
  } catch (error) {
    ctx.stats.errors++;
    ctx.grid[ctx.gridIndex] = GRID_FAIL;
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.lastError = errorMessage;
    logToFile("ERROR", "Block destruction exception", {
      containerId,
      blockId,
      error: errorMessage,
    });
    ctx.callbacks.onError?.(errorMessage);

    // If capability error, clear cache
    const lowerErrorMsg = errorMessage.toLowerCase();
    if (
      lowerErrorMsg.includes("capability") ||
      lowerErrorMsg.includes("budget") ||
      lowerErrorMsg.includes("exhausted")
    ) {
      clearCapabilityCache();
    }
  }

  // Move to next grid position
  ctx.gridIndex++;

  // Reset grid when full
  if (ctx.gridIndex >= GRID_SIZE * GRID_SIZE) {
    ctx.gridIndex = 0;
    ctx.grid = Array(GRID_SIZE * GRID_SIZE).fill(GRID_EMPTY);
  }

  // Update balances periodically (every 5 operations for faster feedback)
  if ((ctx.stats.blocksDestroyed + ctx.stats.errors) % 5 === 0) {
    try {
      ctx.lastBalance = await getBalance(ctx.client);
      // CUBE balances are tracked for the OWNER wallet (receives rewards)
      ctx.lastUnprocessedCube = await getUnprocessedCubeBalance(
        ctx.client,
        ctx.ownerAddress,
      );
      ctx.lastCubeBalance = await getCubeBalance(ctx.client, ctx.ownerAddress);
    } catch {
      // Ignore balance fetch errors
    }
  }

  // Update stats callback
  ctx.callbacks.onStats?.(ctx.stats);
}

/**
 * Start the mining loop
 */
export async function startMining(ctx: MinerContext): Promise<void> {
  ctx.running = true;

  logToFile("INFO", "Mining session started", {
    droneId: ctx.config.droneId,
    sessionWallet: ctx.client.account.address,
    ownerWallet: ctx.ownerAddress,
  });

  while (ctx.running) {
    await mineOnce(ctx);
    renderDashboard(ctx);

    // Save state periodically (every 10 tiles)
    if (ctx.stats.blocksDestroyed % 10 === 0) {
      saveRuntimeState({
        pid: process.pid,
        startTime: ctx.stats.startTime,
        stats: ctx.stats,
      });
    }

    // Rate limit
    await sleep(MINE_DELAY_MS);
  }
}

/**
 * Stop the mining loop gracefully
 */
export function stopMining(ctx: MinerContext, batteryDepleted: boolean = false): void {
  ctx.running = false;

  const runtime = formatDuration(Date.now() - ctx.stats.startTime);
  const rate =
    ctx.stats.blocksDestroyed / ((Date.now() - ctx.stats.startTime) / 1000);

  logToFile("INFO", batteryDepleted ? "Shift ended - battery depleted" : "Mining session stopped", {
    blocksDestroyed: ctx.stats.blocksDestroyed,
    blocksAlreadyDestroyed: ctx.stats.blocksAlreadyDestroyed,
    errors: ctx.stats.errors,
    runtime,
    bps: rate.toFixed(2),
  });

  console.log(""); // Add some space after dashboard
  
  if (batteryDepleted) {
    console.log(chalk.red.bold("  ⚠  OPERATOR LICENSE BATTERY DEPLETED"));
    console.log(chalk.dim("  Reclamation shift complete."));
    console.log("");
    console.log(chalk.yellow("  Your shift has ended. Return to megacorp.global"));
    console.log(chalk.yellow("  to join the queue for your next shift."));
  } else {
    console.log(chalk.yellow.bold("  ⏹  Reclamation Operations Suspended"));
  }

  printStatsBox("Shift Summary", [
    {
      label: "Blocks Destroyed",
      value: ctx.stats.blocksDestroyed.toLocaleString(),
      color: "green",
    },
    {
      label: "Already Processed",
      value: ctx.stats.blocksAlreadyDestroyed.toLocaleString(),
      color: "yellow",
    },
    {
      label: "Failures",
      value: ctx.stats.errors.toLocaleString(),
      color: ctx.stats.errors > 0 ? "red" : "white",
    },
    { label: "Shift Duration", value: runtime, color: "cyan" },
    {
      label: "Efficiency",
      value: `${rate.toFixed(2)} blocks/sec`,
      color: "cyan",
    },
    {
      label: "Cap Refreshes",
      value: ctx.stats.capabilityRefreshes.toLocaleString(),
    },
  ]);

  // Show log file location if there were errors
  if (ctx.stats.errors > 0) {
    console.log("");
    console.log(chalk.dim(`  Errors logged to: ${LOG_FILE}`));
  }
}
