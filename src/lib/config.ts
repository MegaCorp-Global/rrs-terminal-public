import { homedir } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import type { Config, RuntimeState, MiningStats } from "../types.js";

const MEGACUBE_DIR = join(homedir(), ".megacube");
const CONFIG_PATH = join(MEGACUBE_DIR, "config.json");
const STATE_PATH = join(MEGACUBE_DIR, "rrs.state.json");
const PID_PATH = join(MEGACUBE_DIR, "rrs.pid");

/**
 * Ensure the ~/.megacube directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(MEGACUBE_DIR)) {
    mkdirSync(MEGACUBE_DIR, { recursive: true });
  }
}

/**
 * Check if a config file exists
 */
export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Load user configuration from environment variables or ~/.megacube/config.json
 * Environment variables take precedence (for cloud/container deployment)
 */
export function loadConfig(): Config {
  // Check for environment variable configuration first (for cloud deployment)
  const envSessionKey = process.env.SESSION_KEY;
  const envDroneId = process.env.DRONE_ID;

  if (envSessionKey && envDroneId) {
    // Normalize session key
    let sessionKey = envSessionKey.trim();
    if (!sessionKey.startsWith("0x")) {
      sessionKey = `0x${sessionKey}`;
    }

    // Validate
    if (sessionKey.length !== 66) {
      throw new Error(
        "Invalid SESSION_KEY - must be 64-char hex string (with or without 0x prefix)",
      );
    }

    const droneId = parseInt(envDroneId, 10);
    if (Number.isNaN(droneId) || droneId < 0) {
      throw new Error("Invalid DRONE_ID - must be a positive number");
    }

    return {
      sessionKey,
      droneId,
      autoRepurchase: process.env.AUTO_REPURCHASE === "true",
      turboThreshold: process.env.TURBO_THRESHOLD
        ? parseInt(process.env.TURBO_THRESHOLD, 10)
        : 100,
    };
  }

  // Fall back to config file
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config file not found at ${CONFIG_PATH}. Run 'rrs-terminal config' to set up, or set SESSION_KEY and DRONE_ID environment variables.`,
    );
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config = JSON.parse(raw) as Config;

  // Validate required fields
  if (!config.sessionKey || typeof config.sessionKey !== "string") {
    throw new Error("Config missing sessionKey");
  }
  if (!config.sessionKey.startsWith("0x") || config.sessionKey.length !== 66) {
    throw new Error(
      "Invalid sessionKey format - must be 0x-prefixed 64-char hex string",
    );
  }
  if (typeof config.droneId !== "number" || config.droneId < 0) {
    throw new Error("Config missing or invalid droneId");
  }

  return config;
}

/**
 * Save user configuration to ~/.megacube/config.json
 */
export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Load runtime state from ~/.megacube/rrs.state.json
 */
export function loadRuntimeState(): RuntimeState | null {
  if (!existsSync(STATE_PATH)) {
    return null;
  }
  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw) as RuntimeState;
  } catch {
    return null;
  }
}

/**
 * Save runtime state to ~/.megacube/rrs.state.json
 */
export function saveRuntimeState(state: RuntimeState): void {
  ensureConfigDir();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Clear runtime state file
 */
export function clearRuntimeState(): void {
  if (existsSync(STATE_PATH)) {
    unlinkSync(STATE_PATH);
  }
}

/**
 * Write PID file for process management
 */
export function writePidFile(pid: number): void {
  ensureConfigDir();
  writeFileSync(PID_PATH, String(pid));
}

/**
 * Read PID file
 */
export function readPidFile(): number | null {
  if (!existsSync(PID_PATH)) {
    return null;
  }
  try {
    const raw = readFileSync(PID_PATH, "utf-8").trim();
    const pid = parseInt(raw, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Remove PID file
 */
export function removePidFile(): void {
  if (existsSync(PID_PATH)) {
    unlinkSync(PID_PATH);
  }
}

/**
 * Check if a process with given PID is running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create initial mining stats
 */
export function createInitialStats(): MiningStats {
  return {
    blocksDestroyed: 0,
    blocksAlreadyDestroyed: 0,
    errors: 0,
    startTime: Date.now(),
    capabilityRefreshes: 0,
  };
}
