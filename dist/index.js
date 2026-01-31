#!/usr/bin/env node

// src/index.ts
import chalk6 from "chalk";
import inquirer2 from "inquirer";
import { formatEther as formatEther3 } from "viem";

// src/lib/config.ts
import { homedir } from "os";
import { join } from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync
} from "fs";
var MEGACUBE_DIR = join(homedir(), ".megacube");
var CONFIG_PATH = join(MEGACUBE_DIR, "config.json");
var STATE_PATH = join(MEGACUBE_DIR, "rrs.state.json");
var PID_PATH = join(MEGACUBE_DIR, "rrs.pid");
function ensureConfigDir() {
  if (!existsSync(MEGACUBE_DIR)) {
    mkdirSync(MEGACUBE_DIR, { recursive: true });
  }
}
function configExists() {
  return existsSync(CONFIG_PATH);
}
function getConfigPath() {
  return CONFIG_PATH;
}
function loadConfig() {
  const envSessionKey = process.env.SESSION_KEY;
  const envDroneId = process.env.DRONE_ID;
  if (envSessionKey && envDroneId) {
    let sessionKey = envSessionKey.trim();
    if (!sessionKey.startsWith("0x")) {
      sessionKey = `0x${sessionKey}`;
    }
    if (sessionKey.length !== 66) {
      throw new Error(
        "Invalid SESSION_KEY - must be 64-char hex string (with or without 0x prefix)"
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
      turboThreshold: process.env.TURBO_THRESHOLD ? parseInt(process.env.TURBO_THRESHOLD, 10) : 100
    };
  }
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config file not found at ${CONFIG_PATH}. Run 'rrs-terminal config' to set up, or set SESSION_KEY and DRONE_ID environment variables.`
    );
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config = JSON.parse(raw);
  if (!config.sessionKey || typeof config.sessionKey !== "string") {
    throw new Error("Config missing sessionKey");
  }
  if (!config.sessionKey.startsWith("0x") || config.sessionKey.length !== 66) {
    throw new Error(
      "Invalid sessionKey format - must be 0x-prefixed 64-char hex string"
    );
  }
  if (typeof config.droneId !== "number" || config.droneId < 0) {
    throw new Error("Config missing or invalid droneId");
  }
  return config;
}
function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 384 });
}
function loadRuntimeState() {
  if (!existsSync(STATE_PATH)) {
    return null;
  }
  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveRuntimeState(state) {
  ensureConfigDir();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
function clearRuntimeState() {
  if (existsSync(STATE_PATH)) {
    unlinkSync(STATE_PATH);
  }
}
function writePidFile(pid) {
  ensureConfigDir();
  writeFileSync(PID_PATH, String(pid));
}
function readPidFile() {
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
function removePidFile() {
  if (existsSync(PID_PATH)) {
    unlinkSync(PID_PATH);
  }
}
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function createInitialStats() {
  return {
    blocksDestroyed: 0,
    blocksAlreadyDestroyed: 0,
    errors: 0,
    startTime: Date.now(),
    capabilityRefreshes: 0
  };
}

// src/lib/network.ts
var CONTRACTS_URL = "https://megacorp.global/contracts.json";
var ENDPOINTS = {
  relay: "wss://relay.megacorp.global/ws",
  capability: "https://cap.megacorp.global"
};
var cachedConfig = null;
async function fetchNetworkConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  const response = await fetch(CONTRACTS_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch network config: ${response.status} ${response.statusText}`
    );
  }
  const data = await response.json();
  if (!data.network?.rpcUrl || !data.network?.chainId) {
    throw new Error(
      "Invalid network config: missing network.rpcUrl or network.chainId"
    );
  }
  if (!data.contracts?.MegaCubeV4?.address) {
    throw new Error(
      "Invalid network config: missing contracts.MegaCubeV4.address"
    );
  }
  if (!data.contracts?.OperatorLicense?.address) {
    throw new Error(
      "Invalid network config: missing contracts.OperatorLicense.address"
    );
  }
  const config = {
    network: {
      name: data.network.name,
      chainId: data.network.chainId,
      rpcUrl: data.network.rpcUrl,
      wsUrl: data.network.wsUrl,
      explorer: data.network.explorer
    },
    contracts: {
      MegaCubeV4: { address: data.contracts.MegaCubeV4.address },
      OperatorLicense: {
        address: data.contracts.OperatorLicense.address
      },
      ArtifactNFT: { address: data.contracts.ArtifactNFT?.address || "" },
      Cubed: { address: data.contracts.Cubed?.address || "" }
    },
    endpoints: ENDPOINTS
  };
  cachedConfig = config;
  return config;
}

// src/lib/contract.ts
import {
  createPublicClient,
  createWalletClient,
  http
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
var MEGACUBE_ABI = [
  {
    name: "destroyBlock",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "licenseId", type: "uint256" },
      { name: "containerId", type: "uint256" },
      { name: "blockId", type: "uint256" },
      {
        name: "cap",
        type: "tuple",
        components: [
          { name: "wallet", type: "address" },
          { name: "allowedModes", type: "uint8" },
          { name: "nonce", type: "uint64" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiresAt", type: "uint64" },
          { name: "budget", type: "uint16" }
        ]
      },
      { name: "signature", type: "bytes" }
    ],
    outputs: []
  },
  {
    name: "currentLayer",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "jackpotFeePerBlockWei",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "getUnprocessedBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "uint256" }]
  }
];
var CUBED_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }]
  }
];
var DRONE_ABI = [
  {
    name: "isAuthorizedFor",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "operator", type: "address" }
    ],
    outputs: [{ type: "bool" }]
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }]
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "getSessionKey",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }]
  },
  {
    name: "getLicense",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "license",
        type: "tuple",
        components: [
          { name: "tier", type: "uint8" },
          { name: "level", type: "uint8" },
          { name: "maxBattery", type: "uint32" },
          { name: "currentBattery", type: "uint32" },
          { name: "totalBlocksDestroyed", type: "uint64" },
          { name: "cubedEarned", type: "uint64" },
          { name: "shiftStartedTs", type: "uint64" },
          { name: "lastDepletedTs", type: "uint64" },
          { name: "upgradeInProgress", type: "bool" },
          { name: "upgradeTargetLevel", type: "uint8" },
          { name: "upgradeBlocksAtStart", type: "uint64" }
        ]
      }
    ]
  }
];
function createChainFromConfig(networkConfig) {
  return {
    id: networkConfig.network.chainId,
    name: networkConfig.network.name,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18
    },
    rpcUrls: {
      default: {
        http: [networkConfig.network.rpcUrl],
        webSocket: [networkConfig.network.wsUrl]
      }
    },
    blockExplorers: {
      default: {
        name: "Explorer",
        url: networkConfig.network.explorer
      }
    }
  };
}
function createContractClient(networkConfig, sessionKey) {
  const chain = createChainFromConfig(networkConfig);
  const account = privateKeyToAccount(sessionKey);
  const publicClient = createPublicClient({
    chain,
    transport: http(networkConfig.network.rpcUrl)
  });
  const walletClient = createWalletClient({
    chain,
    transport: http(networkConfig.network.rpcUrl),
    account
  });
  return {
    publicClient,
    walletClient,
    account,
    megaCubeAddress: networkConfig.contracts.MegaCubeV4.address,
    droneAddress: networkConfig.contracts.OperatorLicense.address,
    cubedAddress: networkConfig.contracts.Cubed.address
  };
}
async function isAuthorizedForDrone(client, droneId, wallet) {
  const result = await client.publicClient.readContract({
    address: client.droneAddress,
    abi: DRONE_ABI,
    functionName: "isAuthorizedFor",
    args: [BigInt(droneId), wallet]
  });
  return result;
}
async function findDronesForSessionKey(client, sessionAddress) {
  let totalSupply;
  try {
    totalSupply = await client.publicClient.readContract({
      address: client.droneAddress,
      abi: DRONE_ABI,
      functionName: "totalSupply"
    });
  } catch {
    totalSupply = 1000n;
  }
  const maxToCheck = Math.min(Number(totalSupply) + 10, 5e3);
  const authorizedDrones = [];
  const normalizedSession = sessionAddress.toLowerCase();
  const batchSize = 50;
  for (let start = 0; start < maxToCheck; start += batchSize) {
    const end = Math.min(start + batchSize, maxToCheck);
    const checks = [];
    for (let tokenId = start; tokenId < end; tokenId++) {
      checks.push(
        client.publicClient.readContract({
          address: client.droneAddress,
          abi: DRONE_ABI,
          functionName: "getSessionKey",
          args: [BigInt(tokenId)]
        }).then((result) => ({ tokenId, sessionKey: result })).catch(() => ({ tokenId, sessionKey: null }))
      );
    }
    const results = await Promise.all(checks);
    for (const { tokenId, sessionKey } of results) {
      if (sessionKey && sessionKey !== "0x0000000000000000000000000000000000000000" && sessionKey.toLowerCase() === normalizedSession) {
        authorizedDrones.push(tokenId);
      }
    }
  }
  return authorizedDrones;
}
async function getLicenseStatus(client, licenseId) {
  const license = await client.publicClient.readContract({
    address: client.droneAddress,
    abi: DRONE_ABI,
    functionName: "getLicense",
    args: [BigInt(licenseId)]
  });
  return {
    tier: license.tier,
    level: license.level,
    maxBattery: license.maxBattery,
    currentBattery: license.currentBattery,
    totalBlocksDestroyed: license.totalBlocksDestroyed
  };
}
async function getJackpotFeePerBlock(client) {
  try {
    const result = await client.publicClient.readContract({
      address: client.megaCubeAddress,
      abi: MEGACUBE_ABI,
      functionName: "jackpotFeePerBlockWei"
    });
    return result;
  } catch {
    return 0n;
  }
}
async function destroyBlock(client, licenseId, containerId, blockId, capability, feePerBlock) {
  try {
    const cap = {
      wallet: capability.capability.wallet,
      allowedModes: capability.capability.allowedModes,
      nonce: capability.capability.nonce,
      issuedAt: capability.capability.issuedAt,
      expiresAt: capability.capability.expiresAt,
      budget: capability.capability.budget
    };
    try {
      await client.publicClient.simulateContract({
        address: client.megaCubeAddress,
        abi: MEGACUBE_ABI,
        functionName: "destroyBlock",
        args: [
          BigInt(licenseId),
          BigInt(containerId),
          BigInt(blockId),
          cap,
          capability.signature
        ],
        value: feePerBlock,
        account: client.account
      });
    } catch (simError) {
      const simMsg = simError instanceof Error ? simError.message : String(simError);
      const lowerSim = simMsg.toLowerCase();
      const shortErr = simMsg.substring(0, 200);
      console.log(`  [Sim] Raw error: ${shortErr}`);
      if (lowerSim.includes("already destroyed")) {
        return {
          success: false,
          alreadyDestroyed: true,
          error: "Already destroyed"
        };
      }
      if (lowerSim.includes("capability expired")) {
        return { success: false, error: "Capability expired" };
      }
      if (lowerSim.includes("capability exhausted")) {
        return { success: false, error: "Capability exhausted (on-chain)" };
      }
      if (lowerSim.includes("budget too low")) {
        return {
          success: false,
          error: "Capability budget too low (cap.budget < cost)"
        };
      }
      if (lowerSim.includes("not authorized")) {
        return { success: false, error: "Not authorized for license" };
      }
      if (lowerSim.includes("invalid capability signature")) {
        return { success: false, error: "Invalid capability signature" };
      }
      if (lowerSim.includes("battery depleted")) {
        return { success: false, error: "Battery depleted - shift ended" };
      }
      return { success: false, error: `Sim: ${simMsg.substring(0, 150)}` };
    }
    const hash = await client.walletClient.writeContract({
      chain: client.walletClient.chain,
      account: client.account,
      address: client.megaCubeAddress,
      abi: MEGACUBE_ABI,
      functionName: "destroyBlock",
      args: [
        BigInt(licenseId),
        BigInt(containerId),
        BigInt(blockId),
        cap,
        capability.signature
      ],
      value: feePerBlock,
      gas: 500000n
    });
    const receipt = await client.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 3e4
    });
    if (receipt.status === "success") {
      return { success: true, txHash: hash };
    } else {
      return {
        success: false,
        txHash: hash,
        error: "Transaction reverted on-chain"
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerError = errorMessage.toLowerCase();
    if (lowerError.includes("already destroyed") || lowerError.includes("tile already")) {
      return {
        success: false,
        alreadyDestroyed: true,
        error: "Already destroyed"
      };
    }
    if (lowerError.includes("capability expired")) {
      return { success: false, error: "Capability expired" };
    }
    if (lowerError.includes("capability exhausted") || lowerError.includes("budget")) {
      return { success: false, error: "Capability budget exhausted" };
    }
    if (lowerError.includes("not authorized")) {
      return { success: false, error: "Not authorized for drone" };
    }
    if (lowerError.includes("invalid container")) {
      return { success: false, error: "Invalid container ID" };
    }
    if (lowerError.includes("invalid tile")) {
      return { success: false, error: "Invalid tile ID" };
    }
    if (lowerError.includes("jackpot fee")) {
      return { success: false, error: "Jackpot fee too low" };
    }
    const revertMatch = errorMessage.match(
      /reverted with reason[:\s]+"?([^"]+)"?/i
    );
    if (revertMatch) {
      const reason = revertMatch[1];
      if (reason.toLowerCase().includes("already")) {
        return { success: false, alreadyDestroyed: true, error: reason };
      }
      return { success: false, error: reason };
    }
    return { success: false, error: errorMessage };
  }
}
async function getBalance(client) {
  return client.publicClient.getBalance({ address: client.account.address });
}
async function getDroneOwner(client, droneId) {
  const result = await client.publicClient.readContract({
    address: client.droneAddress,
    abi: DRONE_ABI,
    functionName: "ownerOf",
    args: [BigInt(droneId)]
  });
  return result;
}
async function getCubeBalance(client, wallet) {
  try {
    const address = wallet || client.account.address;
    const result = await client.publicClient.readContract({
      address: client.cubedAddress,
      abi: CUBED_ABI,
      functionName: "balanceOf",
      args: [address]
    });
    return result;
  } catch {
    return 0n;
  }
}
async function getUnprocessedCubeBalance(client, wallet) {
  try {
    const address = wallet || client.account.address;
    const result = await client.publicClient.readContract({
      address: client.megaCubeAddress,
      abi: MEGACUBE_ABI,
      functionName: "getUnprocessedBalance",
      args: [address]
    });
    return result;
  } catch {
    return 0n;
  }
}

// src/commands/start.ts
import chalk3 from "chalk";

// src/lib/miner.ts
import chalk2 from "chalk";
import fs from "fs";
import path from "path";
import os from "os";

// src/types.ts
var CAP_MODE_MINE = 1;
var CONTAINERS_PER_LAYER = 1572864;
var TILES_PER_CONTAINER = 1024;

// src/lib/capability.ts
var capabilityCache = null;
function parseCapabilityResponse(response) {
  return {
    capability: {
      wallet: response.capability.wallet,
      allowedModes: response.capability.allowedModes,
      nonce: BigInt(response.capability.nonce),
      issuedAt: BigInt(response.capability.issuedAt),
      expiresAt: BigInt(response.capability.expiresAt),
      budget: response.capability.budget
    },
    signature: response.signature
  };
}
function isCacheValid(cost) {
  if (!capabilityCache) return false;
  const now = Math.floor(Date.now() / 1e3);
  const expiresAt = Number(capabilityCache.bundle.capability.expiresAt);
  if (now >= expiresAt - 30) return false;
  if (capabilityCache.remainingBudget < cost) return false;
  return true;
}
async function fetchCapability(networkConfig, wallet, droneId, allowedModes = CAP_MODE_MINE) {
  const url = `${networkConfig.endpoints.capability}/capability`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      wallet,
      allowedModes,
      droneId: String(droneId)
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Identity validation failed: ${response.status} - ${errorText}`
    );
  }
  const data = await response.json();
  return parseCapabilityResponse(data);
}
async function getCapability(networkConfig, wallet, droneId, cost = 1) {
  if (isCacheValid(cost)) {
    capabilityCache.remainingBudget -= cost;
    return capabilityCache.bundle;
  }
  const bundle = await fetchCapability(networkConfig, wallet, droneId);
  const expiresAt = Number(bundle.capability.expiresAt);
  const issuedAt = Number(bundle.capability.issuedAt);
  const ttl = expiresAt - issuedAt;
  const nonceHex = bundle.capability.nonce.toString(16).padStart(16, "0");
  console.log(
    `  [Cap] Fresh capability: budget=${bundle.capability.budget}, nonce=0x${nonceHex}, ttl=${ttl}s`
  );
  capabilityCache = {
    bundle,
    remainingBudget: bundle.capability.budget - cost,
    fetchedAt: Date.now()
  };
  return bundle;
}
function getRemainingBudget() {
  return capabilityCache?.remainingBudget ?? 0;
}
function clearCapabilityCache() {
  if (capabilityCache) {
    const nonceHex = capabilityCache.bundle.capability.nonce.toString(16).padStart(16, "0");
    console.log(
      `  [Cap] Clearing cache: nonce=0x${nonceHex}, had ${capabilityCache.remainingBudget} local budget`
    );
  }
  capabilityCache = null;
}
function needsCapabilityRefresh(cost = 1) {
  return !isCacheValid(cost);
}

// src/lib/ui.ts
import chalk from "chalk";
var BANNER = `
${chalk.cyan("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557")}
${chalk.cyan("\u2551")}  ${chalk.bold.white("\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557")}    ${chalk.dim("Remote Reclamation")}            ${chalk.cyan("\u2551")}
${chalk.cyan("\u2551")}  ${chalk.bold.white("\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D")}    ${chalk.dim("Services Division")}             ${chalk.cyan("\u2551")}
${chalk.cyan("\u2551")}  ${chalk.bold.white("\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557")}    ${chalk.dim.yellow("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501")}             ${chalk.cyan("\u2551")}
${chalk.cyan("\u2551")}  ${chalk.bold.white("\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u255A\u2550\u2550\u2550\u2550\u2588\u2588\u2551")}    ${chalk.dim("Autonomous Mining")}             ${chalk.cyan("\u2551")}
${chalk.cyan("\u2551")}  ${chalk.bold.white("\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551")}    ${chalk.dim("Terminal v1.0.0")}               ${chalk.cyan("\u2551")}
${chalk.cyan("\u2551")}  ${chalk.bold.white("\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D")}                                  ${chalk.cyan("\u2551")}
${chalk.cyan("\u2551")}                                                              ${chalk.cyan("\u2551")}
${chalk.cyan("\u2551")}        ${chalk.dim.italic("A Subsidiary of")} ${chalk.white("MEGACORP")} ${chalk.dim("Global")}                    ${chalk.cyan("\u2551")}
${chalk.cyan("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D")}
`;
var BANNER_COMPACT = `
${chalk.cyan("\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510")}
${chalk.cyan("\u2502")}  ${chalk.bold.white("RRS")} ${chalk.dim("Remote Reclamation Services")}        ${chalk.cyan("\u2502")}
${chalk.cyan("\u2502")}  ${chalk.dim.italic("A Subsidiary of")} ${chalk.white("MEGACORP")} ${chalk.dim("Global")}   ${chalk.cyan("\u2502")}
${chalk.cyan("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518")}
`;
function printBanner() {
  console.log(BANNER);
}
function printBannerCompact() {
  console.log(BANNER_COMPACT);
}
function printSection(title) {
  console.log("");
  console.log(chalk.cyan("\u2501".repeat(50)));
  console.log(chalk.bold.white(`  ${title}`));
  console.log(chalk.cyan("\u2501".repeat(50)));
  console.log("");
}
function printSuccess(message) {
  console.log(chalk.green(`  \u2713 ${message}`));
}
function printWarning(message) {
  console.log(chalk.yellow(`  \u26A0 ${message}`));
}
function printError(message) {
  console.log(chalk.red(`  \u2717 ${message}`));
}
function printInfo(message) {
  console.log(chalk.dim(`    ${message}`));
}
function printKeyValue(key, value) {
  console.log(`  ${chalk.dim(key + ":")} ${chalk.white(value)}`);
}
function printNextSteps(steps) {
  console.log("");
  console.log(
    chalk.cyan("\u250C\u2500") + chalk.bold.cyan(" Next Steps ") + chalk.cyan("\u2500".repeat(35) + "\u2510")
  );
  steps.forEach((step, i) => {
    console.log(
      chalk.cyan("\u2502") + `  ${chalk.yellow(`${i + 1}.`)} ${step}`.padEnd(48) + chalk.cyan("\u2502")
    );
  });
  console.log(chalk.cyan("\u2514" + "\u2500".repeat(48) + "\u2518"));
  console.log("");
}
function printStatsBox(title, stats) {
  console.log("");
  console.log(
    chalk.cyan("\u250C\u2500") + chalk.bold.cyan(` ${title} `) + chalk.cyan("\u2500".repeat(Math.max(0, 45 - title.length)) + "\u2510")
  );
  stats.forEach(({ label, value, color = "white" }) => {
    const colorFn = chalk[color] || chalk.white;
    const line = `  ${chalk.dim(label + ":")} ${colorFn(value)}`;
    const visibleLength = label.length + 2 + value.length + 2;
    const padding = Math.max(0, 46 - visibleLength);
    console.log(chalk.cyan("\u2502") + line + " ".repeat(padding) + chalk.cyan("\u2502"));
  });
  console.log(chalk.cyan("\u2514" + "\u2500".repeat(48) + "\u2518"));
}

// src/lib/miner.ts
import { formatEther } from "viem";
var MINE_DELAY_MS = 100;
var GRID_SIZE = 10;
var GRID_EMPTY = chalk2.dim("\u2591");
var GRID_MINING = chalk2.yellow("\u25C6");
var GRID_SUCCESS = chalk2.cyan("\u25AA");
var GRID_FAIL = chalk2.red("\xD7");
var GRID_SKIP = chalk2.gray("\xB7");
var LOG_DIR = path.join(os.homedir(), ".megacube");
var LOG_FILE = path.join(LOG_DIR, "rrs.log");
function logToFile(level, message, data) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const entry = data ? `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}
` : `[${timestamp}] [${level}] ${message}
`;
    fs.appendFileSync(LOG_FILE, entry);
  } catch {
  }
}
function decomposeContainer(containerId) {
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
var FACE_NAMES = ["TOP", "BOTTOM", "NORTH", "SOUTH", "EAST", "WEST"];
function randomContainer() {
  return Math.floor(Math.random() * CONTAINERS_PER_LAYER);
}
function randomBlock() {
  return Math.floor(Math.random() * TILES_PER_CONTAINER);
}
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1e3);
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function validateMiningSetup(config, networkConfig) {
  const spin = (text) => process.stdout.write(`\r  ${chalk2.dim(text)}`);
  const clear = () => process.stdout.write("\r" + " ".repeat(60) + "\r");
  try {
    spin("Initializing secure connection...");
    const client = createContractClient(networkConfig, config.sessionKey);
    await new Promise((r) => setTimeout(r, 200));
    spin("Verifying operator credentials...");
    const balance = await getBalance(client);
    if (balance === 0n) {
      clear();
      console.log(chalk2.red("  \u2717 Session wallet has no ETH"));
      return {
        valid: false,
        error: `Session wallet ${client.account.address} has no ETH. Fund it with ETH for gas.`
      };
    }
    spin(`Validating drone #${config.droneId} license...`);
    const authorized = await isAuthorizedForDrone(
      client,
      config.droneId,
      client.account.address
    );
    if (!authorized) {
      clear();
      console.log(chalk2.red("  \u2717 Session wallet not authorized for drone"));
      return {
        valid: false,
        error: `Session wallet ${client.account.address} is not authorized for drone #${config.droneId}. Set session key on drone first.`
      };
    }
    spin("Reading license battery status...");
    const licenseStatus = await getLicenseStatus(client, config.droneId);
    if (licenseStatus.currentBattery === 0) {
      clear();
      console.log(chalk2.yellow("  \u26A0 License battery is depleted"));
      console.log(chalk2.dim("    Wait for your next shift to begin."));
      return {
        valid: false,
        error: "License battery depleted. Wait for next shift."
      };
    }
    spin("Locating reward destination...");
    const ownerAddress = await getDroneOwner(client, config.droneId);
    spin("Checking $CUBE reserves...");
    const cubeBalance = await getCubeBalance(client, ownerAddress);
    const unprocessedCube = await getUnprocessedCubeBalance(
      client,
      ownerAddress
    );
    spin("Querying current reclamation fees...");
    const feePerBlock = await getJackpotFeePerBlock(client);
    spin("Performing sybil-resistant identity validation...");
    await getCapability(
      networkConfig,
      client.account.address,
      config.droneId,
      0
    );
    clear();
    console.log(chalk2.green("  \u2713 Mining authorization verified"));
    console.log("");
    printKeyValue("Session Wallet", client.account.address);
    printKeyValue("Balance", `${formatEther(balance)} ETH`);
    printKeyValue("License ID", `#${config.droneId}`);
    const batteryPct = Math.round(
      licenseStatus.currentBattery / licenseStatus.maxBattery * 100
    );
    printKeyValue(
      "Battery",
      `${licenseStatus.currentBattery}/${licenseStatus.maxBattery} (${batteryPct}%)`
    );
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
      maxBattery: licenseStatus.maxBattery
    };
  } catch (error) {
    clear();
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(chalk2.red(`  \u2717 Validation failed`));
    return { valid: false, error: errorMessage };
  }
}
function createMinerContext(config, networkConfig, client, feePerBlock, balance, cubeBalance, unprocessedCube, ownerAddress, currentBattery, maxBattery, callbacks = {}) {
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
    lastBatteryRefresh: Date.now()
  };
}
function renderDashboard(ctx) {
  const rate = ctx.stats.blocksDestroyed / ((Date.now() - ctx.stats.startTime) / 1e3);
  const tps = `${rate.toFixed(1)}/s`;
  const blocksNum = ctx.stats.blocksDestroyed.toLocaleString();
  const ethBal = parseFloat(formatEther(ctx.lastBalance)).toFixed(4);
  const earnedCube = parseFloat(formatEther(ctx.lastUnprocessedCube)).toFixed(
    2
  );
  const inscribedCube = parseFloat(formatEther(ctx.lastCubeBalance)).toFixed(2);
  const loc = decomposeContainer(ctx.currentContainer);
  const faceName = FACE_NAMES[loc.face] || `F${loc.face}`;
  const locationStr = `${faceName}/${loc.sector}/${loc.region}/${loc.container}:${ctx.currentBlock}`;
  const batteryPercent = ctx.maxBattery > 0 ? Math.min(ctx.currentBattery / ctx.maxBattery * 100, 100) : 0;
  const barWidth = 20;
  const filledWidth = Math.round(batteryPercent / 100 * barWidth);
  const emptyWidth = barWidth - filledWidth;
  const batteryColor = batteryPercent > 30 ? chalk2.green : batteryPercent > 10 ? chalk2.yellow : chalk2.red;
  const batteryBar = batteryColor("\u2588".repeat(filledWidth)) + chalk2.dim("\u2591".repeat(emptyWidth));
  console.clear();
  console.log("");
  console.log(chalk2.green.bold("  \u26CF  Reclamation Operations Active"));
  console.log(chalk2.dim("  Press Ctrl+C to stop"));
  console.log("");
  console.log(
    `  ${chalk2.bold("BPS:")} ${chalk2.cyan(tps)}    ${chalk2.bold("Blocks:")} ${chalk2.white(blocksNum)}    ${chalk2.bold("ETH:")} ${chalk2.yellow(ethBal)}`
  );
  console.log(
    `  ${chalk2.bold("$CUBE")}  |  ${chalk2.bold("Earned:")} ${chalk2.cyan(earnedCube)}  |  ${chalk2.bold("Inscribed:")} ${chalk2.green(inscribedCube)}`
  );
  console.log(`  ${chalk2.bold("Location:")} ${chalk2.magenta(locationStr)}`);
  console.log("");
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
    `  ${chalk2.bold("Battery")} [${batteryBar}] ${ctx.currentBattery}/${ctx.maxBattery}`
  );
  if (ctx.lastError && ctx.stats.errors > 0) {
    const truncatedError = ctx.lastError.length > 60 ? ctx.lastError.substring(0, 60) + "..." : ctx.lastError;
    console.log("");
    console.log(`  ${chalk2.red("Last Error:")} ${chalk2.dim(truncatedError)}`);
  }
}
async function mineOnce(ctx) {
  const containerId = randomContainer();
  const blockId = randomBlock();
  ctx.currentContainer = containerId;
  ctx.currentBlock = blockId;
  ctx.grid[ctx.gridIndex] = GRID_MINING;
  try {
    const wasRefresh = needsCapabilityRefresh();
    const capability = await getCapability(
      ctx.networkConfig,
      ctx.client.account.address,
      ctx.config.droneId
    );
    const nonceHex = capability.capability.nonce.toString(16).padStart(16, "0");
    if (wasRefresh) {
      ctx.stats.capabilityRefreshes++;
      ctx.callbacks.onCapabilityRefresh?.(capability.capability.budget);
      logToFile("INFO", "Fresh capability obtained", {
        nonce: `0x${nonceHex}`,
        budget: capability.capability.budget,
        expiresAt: Number(capability.capability.expiresAt)
      });
    }
    const result = await destroyBlock(
      ctx.client,
      ctx.config.droneId,
      containerId,
      blockId,
      capability,
      ctx.feePerBlock
    );
    if (result.success) {
      ctx.stats.blocksDestroyed++;
      ctx.grid[ctx.gridIndex] = GRID_SUCCESS;
      ctx.callbacks.onBlockDestroyed?.(containerId, blockId, result.txHash);
      if (ctx.currentBattery > 0) {
        ctx.currentBattery--;
      }
      if (ctx.stats.blocksDestroyed % 25 === 0) {
        try {
          const status = await getLicenseStatus(ctx.client, ctx.config.droneId);
          ctx.currentBattery = status.currentBattery;
          ctx.maxBattery = status.maxBattery;
          ctx.lastBatteryRefresh = Date.now();
        } catch {
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
        nonce: `0x${nonceHex}`
      });
      ctx.callbacks.onError?.(result.error || "Unknown error");
      const lowerError = result.error?.toLowerCase() || "";
      if (lowerError.includes("capability") || lowerError.includes("budget") || lowerError.includes("exhausted")) {
        logToFile("WARN", "Capability error - clearing cache", {
          error: result.error,
          localBudget: getRemainingBudget(),
          blocksDestroyed: ctx.stats.blocksDestroyed
        });
        clearCapabilityCache();
      }
      if (lowerError.includes("battery depleted") || lowerError.includes("shift ended")) {
        ctx.running = false;
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
      error: errorMessage
    });
    ctx.callbacks.onError?.(errorMessage);
    const lowerErrorMsg = errorMessage.toLowerCase();
    if (lowerErrorMsg.includes("capability") || lowerErrorMsg.includes("budget") || lowerErrorMsg.includes("exhausted")) {
      clearCapabilityCache();
    }
  }
  ctx.gridIndex++;
  if (ctx.gridIndex >= GRID_SIZE * GRID_SIZE) {
    ctx.gridIndex = 0;
    ctx.grid = Array(GRID_SIZE * GRID_SIZE).fill(GRID_EMPTY);
  }
  if ((ctx.stats.blocksDestroyed + ctx.stats.errors) % 5 === 0) {
    try {
      ctx.lastBalance = await getBalance(ctx.client);
      ctx.lastUnprocessedCube = await getUnprocessedCubeBalance(
        ctx.client,
        ctx.ownerAddress
      );
      ctx.lastCubeBalance = await getCubeBalance(ctx.client, ctx.ownerAddress);
    } catch {
    }
  }
  ctx.callbacks.onStats?.(ctx.stats);
}
async function startMining(ctx) {
  ctx.running = true;
  logToFile("INFO", "Mining session started", {
    droneId: ctx.config.droneId,
    sessionWallet: ctx.client.account.address,
    ownerWallet: ctx.ownerAddress
  });
  while (ctx.running) {
    await mineOnce(ctx);
    renderDashboard(ctx);
    if (ctx.stats.blocksDestroyed % 10 === 0) {
      saveRuntimeState({
        pid: process.pid,
        startTime: ctx.stats.startTime,
        stats: ctx.stats
      });
    }
    await sleep(MINE_DELAY_MS);
  }
}
function stopMining(ctx, batteryDepleted = false) {
  ctx.running = false;
  const runtime = formatDuration(Date.now() - ctx.stats.startTime);
  const rate = ctx.stats.blocksDestroyed / ((Date.now() - ctx.stats.startTime) / 1e3);
  logToFile(
    "INFO",
    batteryDepleted ? "Shift ended - battery depleted" : "Mining session stopped",
    {
      blocksDestroyed: ctx.stats.blocksDestroyed,
      blocksAlreadyDestroyed: ctx.stats.blocksAlreadyDestroyed,
      errors: ctx.stats.errors,
      runtime,
      bps: rate.toFixed(2)
    }
  );
  console.log("");
  if (batteryDepleted) {
    console.log(chalk2.red.bold("  \u26A0  OPERATOR LICENSE BATTERY DEPLETED"));
    console.log(chalk2.dim("  Reclamation shift complete."));
    console.log("");
    console.log(
      chalk2.yellow("  Your shift has ended. Return to megacorp.global")
    );
    console.log(chalk2.yellow("  to join the queue for your next shift."));
  } else {
    console.log(chalk2.yellow.bold("  \u23F9  Reclamation Operations Suspended"));
  }
  printStatsBox("Shift Summary", [
    {
      label: "Blocks Destroyed",
      value: ctx.stats.blocksDestroyed.toLocaleString(),
      color: "green"
    },
    {
      label: "Already Processed",
      value: ctx.stats.blocksAlreadyDestroyed.toLocaleString(),
      color: "yellow"
    },
    {
      label: "Failures",
      value: ctx.stats.errors.toLocaleString(),
      color: ctx.stats.errors > 0 ? "red" : "white"
    },
    { label: "Shift Duration", value: runtime, color: "cyan" },
    {
      label: "Efficiency",
      value: `${rate.toFixed(2)} blocks/sec`,
      color: "cyan"
    },
    {
      label: "Cap Refreshes",
      value: ctx.stats.capabilityRefreshes.toLocaleString()
    }
  ]);
  if (ctx.stats.errors > 0) {
    console.log("");
    console.log(chalk2.dim(`  Errors logged to: ${LOG_FILE}`));
  }
}

// src/commands/start.ts
async function startCommand() {
  printBanner();
  const existingPid = readPidFile();
  if (existingPid && isProcessRunning(existingPid)) {
    console.log("");
    printError(`Mining is already running (PID: ${existingPid})`);
    printInfo('Use "rrs-terminal stop" to stop it first');
    console.log("");
    process.exit(1);
  }
  if (!configExists()) {
    console.log("");
    printError("No configuration found");
    printInfo('Run "rrs-terminal config" to set up your session key and drone');
    console.log("");
    process.exit(1);
  }
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.log("");
    printError(
      `Failed to load config: ${error instanceof Error ? error.message : error}`
    );
    console.log("");
    process.exit(1);
  }
  printSection("Initializing");
  console.log(chalk3.dim("  Fetching network configuration..."));
  let networkConfig;
  try {
    networkConfig = await fetchNetworkConfig();
    printSuccess(`Connected to ${networkConfig.network.name}`);
    printInfo(`Chain ID: ${networkConfig.network.chainId}`);
  } catch (error) {
    printError(
      `Failed to fetch network config: ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
  console.log("");
  const validation = await validateMiningSetup(config, networkConfig);
  if (!validation.valid || !validation.client || validation.feePerBlock === void 0 || validation.balance === void 0 || validation.cubeBalance === void 0 || validation.unprocessedCube === void 0 || !validation.ownerAddress) {
    console.log("");
    printError(validation.error || "Validation failed");
    console.log("");
    process.exit(1);
  }
  writePidFile(process.pid);
  clearRuntimeState();
  let batteryDepleted = false;
  const ctx = createMinerContext(
    config,
    networkConfig,
    validation.client,
    validation.feePerBlock,
    validation.balance,
    validation.cubeBalance,
    validation.unprocessedCube,
    validation.ownerAddress,
    validation.currentBattery,
    validation.maxBattery,
    {
      onBatteryDepleted: () => {
        batteryDepleted = true;
      }
    }
  );
  const shutdown = () => {
    stopMining(ctx, batteryDepleted);
    removePidFile();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  printSection("Reclamation Operations");
  try {
    await startMining(ctx);
    stopMining(ctx, batteryDepleted);
    removePidFile();
  } catch (error) {
    console.log("");
    printError(
      `Mining error: ${error instanceof Error ? error.message : error}`
    );
    removePidFile();
    process.exit(1);
  }
}

// src/commands/config.ts
import chalk4 from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { formatEther as formatEther2 } from "viem";
import { generatePrivateKey, privateKeyToAccount as privateKeyToAccount2 } from "viem/accounts";
async function configCommand() {
  printBanner();
  if (configExists()) {
    const existing = loadConfig();
    const account = privateKeyToAccount2(existing.sessionKey);
    console.log(chalk4.yellow.bold("  Existing configuration detected\n"));
    printKeyValue("Drone ID", `#${existing.droneId}`);
    printKeyValue("Session Wallet", account.address);
    console.log("");
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: chalk4.green("Keep existing configuration"), value: "keep" },
          {
            name: chalk4.cyan("View backup / export credentials"),
            value: "backup"
          },
          {
            name: chalk4.yellow("Re-detect drones for this session key"),
            value: "redetect"
          },
          {
            name: chalk4.red("Start fresh (new configuration)"),
            value: "fresh"
          }
        ]
      }
    ]);
    if (action === "keep") {
      console.log("");
      printSuccess("Configuration unchanged");
      console.log(chalk4.dim('\n  Type "start" to begin mining\n'));
      return;
    }
    if (action === "backup") {
      showBackup(existing);
      return;
    }
    if (action === "redetect") {
      const droneId2 = await detectDroneForSession(
        existing.sessionKey,
        account.address
      );
      if (droneId2 !== null) {
        saveConfig({ ...existing, droneId: droneId2 });
        console.log("");
        printSuccess(`Configuration updated with Drone #${droneId2}`);
        console.log(chalk4.dim('\n  Type "start" to begin mining\n'));
      }
      return;
    }
    console.log("");
  }
  printSection("How Mining Works");
  console.log(
    chalk4.dim('  MegaCube uses a "session wallet" system for security:')
  );
  console.log("");
  console.log(
    chalk4.white("  1. Your ") + chalk4.cyan("Main Wallet") + chalk4.white(" holds your Drone Operator License")
  );
  console.log(
    chalk4.white("  2. A ") + chalk4.green("Session Wallet") + chalk4.white(" is authorized to mine on its behalf")
  );
  console.log(chalk4.white("  3. Only the session wallet key is stored here"));
  console.log("");
  console.log(
    chalk4.dim(
      "  This way, if your terminal is compromised, only gas money is at risk."
    )
  );
  console.log("");
  const { setupMethod } = await inquirer.prompt([
    {
      type: "list",
      name: "setupMethod",
      message: "How would you like to set up?",
      choices: [
        {
          name: `${chalk4.yellow("\u25CF")} Import from game ${chalk4.dim("(recommended - auto-detects drone)")}`,
          value: "import_session"
        },
        {
          name: `${chalk4.green("\u25CF")} Generate new session wallet ${chalk4.dim("(requires manual setup)")}`,
          value: "generate"
        }
      ]
    }
  ]);
  let sessionKey;
  let sessionAddress;
  let droneId;
  if (setupMethod === "import_session") {
    console.log("");
    console.log(chalk4.dim("  Get your session key from the game:"));
    console.log(
      chalk4.cyan("    megacorp.global \u2192 Wallet HUD \u2192 Session \u2192 Export Key")
    );
    console.log("");
    const { importedKey } = await inquirer.prompt([
      {
        type: "password",
        name: "importedKey",
        message: "Session wallet private key:",
        mask: "\u25CF",
        validate: (input) => {
          const normalized = input.startsWith("0x") ? input.slice(2) : input;
          if (normalized.length !== 64) {
            return "Private key must be 64 hex characters (with or without 0x prefix)";
          }
          if (!/^[a-fA-F0-9]{64}$/.test(normalized)) {
            return "Private key must contain only hexadecimal characters (0-9, a-f)";
          }
          return true;
        }
      }
    ]);
    sessionKey = importedKey.startsWith("0x") ? importedKey : `0x${importedKey}`;
    const account = privateKeyToAccount2(sessionKey);
    sessionAddress = account.address;
    console.log("");
    printSuccess("Session wallet imported");
    printInfo(`Address: ${sessionAddress}`);
    const detectedDrone = await detectDroneForSession(
      sessionKey,
      sessionAddress
    );
    if (detectedDrone === null) {
      return;
    }
    droneId = detectedDrone;
  } else {
    sessionKey = generatePrivateKey();
    const account = privateKeyToAccount2(sessionKey);
    sessionAddress = account.address;
    printSection("New Session Wallet Created");
    console.log(
      chalk4.cyan("  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510")
    );
    console.log(
      chalk4.cyan("  \u2502") + chalk4.bold.yellow(
        "  \u26A0  SAVE THIS INFORMATION - YOU WILL NEED IT LATER   "
      ) + chalk4.cyan("\u2502")
    );
    console.log(
      chalk4.cyan("  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518")
    );
    console.log("");
    console.log(chalk4.bold("  Session Wallet Address:"));
    console.log(chalk4.green(`  ${sessionAddress}`));
    console.log("");
    console.log(chalk4.bold("  Private Key:"));
    console.log(chalk4.yellow(`  ${sessionKey}`));
    console.log("");
    const { savedKey } = await inquirer.prompt([
      {
        type: "confirm",
        name: "savedKey",
        message: "I have saved this information securely",
        default: false
      }
    ]);
    if (!savedKey) {
      console.log("");
      console.log(chalk4.yellow("  Please save before continuing:"));
      console.log(chalk4.dim(`  Address: ${sessionAddress}`));
      console.log(chalk4.dim(`  Key: ${sessionKey}`));
      console.log("");
      await inquirer.prompt([
        {
          type: "input",
          name: "wait",
          message: "Press Enter when you have saved this information..."
        }
      ]);
    }
    printSection("Drone Configuration");
    console.log(
      chalk4.dim("  Enter the token ID of your Demolition Drone NFT.")
    );
    console.log(
      chalk4.dim("  You can find this on megacorp.global or in your wallet.\n")
    );
    const { manualDroneId } = await inquirer.prompt([
      {
        type: "number",
        name: "manualDroneId",
        message: "Drone NFT token ID:",
        validate: (input) => {
          if (isNaN(input) || input < 0) {
            return "Please enter a valid drone ID (non-negative number)";
          }
          return true;
        }
      }
    ]);
    droneId = manualDroneId;
  }
  const config = {
    sessionKey,
    droneId,
    autoRepurchase: false,
    turboThreshold: 100
  };
  saveConfig(config);
  let balanceDisplay = "";
  let hasLowBalance = false;
  try {
    const networkConfig = await fetchNetworkConfig();
    const client = createContractClient(networkConfig, sessionKey);
    const balance = await getBalance(client);
    const balNum = parseFloat(formatEther2(balance));
    hasLowBalance = balNum < 1e-3;
    const balStr = balNum < 1e-4 ? "<0.0001" : balNum.toFixed(4);
    const color = hasLowBalance ? chalk4.yellow : chalk4.green;
    balanceDisplay = color(balStr + " ETH");
  } catch {
    balanceDisplay = chalk4.dim("(unable to fetch)");
  }
  printSection("Setup Complete");
  printSuccess("Configuration saved");
  console.log("");
  printKeyValue("Session Wallet", sessionAddress);
  printKeyValue("Balance", balanceDisplay);
  printKeyValue("Drone ID", `#${droneId}`);
  printKeyValue("Config File", getConfigPath());
  if (setupMethod === "generate") {
    printNextSteps([
      `Fund session wallet with ETH for gas`,
      `Go to megacorp.global \u2192 Your Drone \u2192 Set Session Key`,
      `Enter: ${sessionAddress}`,
      `Return here and type "start" to begin mining`
    ]);
  } else if (hasLowBalance) {
    printNextSteps([
      `Fund session wallet with ETH for gas`,
      `Type "start" to begin mining`
    ]);
  } else {
    printNextSteps([`Type "start" to begin mining`]);
  }
  console.log(
    chalk4.dim('  Tip: Type "backup" anytime to see your credentials\n')
  );
}
async function detectDroneForSession(sessionKey, sessionAddress) {
  const spinner = ora({
    text: chalk4.dim("Connecting to MegaETH..."),
    spinner: "dots"
  }).start();
  try {
    const networkConfig = await fetchNetworkConfig();
    spinner.text = chalk4.dim("Searching for authorized drones...");
    const client = createContractClient(networkConfig, sessionKey);
    const drones = await findDronesForSessionKey(client, sessionAddress);
    spinner.stop();
    if (drones.length === 0) {
      console.log("");
      printError("No drones found for this session key");
      console.log("");
      console.log(
        chalk4.dim("  This session wallet is not authorized on any drone.")
      );
      console.log(chalk4.dim("  Make sure you:"));
      console.log(chalk4.dim("    1. Have a Demolition Drone NFT"));
      console.log(
        chalk4.dim(
          "    2. Set this session key on your drone at megacorp.global"
        )
      );
      console.log("");
      return null;
    }
    if (drones.length === 1) {
      console.log("");
      printSuccess(`Found Drone #${drones[0]}`);
      return drones[0];
    }
    console.log("");
    printSuccess(`Found ${drones.length} drones`);
    console.log("");
    const { selectedDrone } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedDrone",
        message: "Which drone would you like to use?",
        choices: drones.map((id) => ({
          name: `Drone #${id}`,
          value: id
        }))
      }
    ]);
    return selectedDrone;
  } catch (error) {
    spinner.stop();
    console.log("");
    printError(
      `Failed to detect drones: ${error instanceof Error ? error.message : error}`
    );
    console.log("");
    return null;
  }
}
function showBackup(config) {
  const account = privateKeyToAccount2(config.sessionKey);
  printSection("Backup Information");
  console.log(
    chalk4.cyan("  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510")
  );
  console.log(
    chalk4.cyan("  \u2502") + chalk4.bold.yellow(
      "  \u26A0  KEEP THIS INFORMATION SECURE                     "
    ) + chalk4.cyan("\u2502")
  );
  console.log(
    chalk4.cyan("  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518")
  );
  console.log("");
  console.log(chalk4.bold("  Session Wallet Address:"));
  console.log(chalk4.green(`  ${account.address}`));
  console.log("");
  console.log(chalk4.bold("  Session Wallet Private Key:"));
  console.log(chalk4.yellow(`  ${config.sessionKey}`));
  console.log("");
  console.log(chalk4.bold("  Drone ID:"));
  console.log(chalk4.cyan(`  #${config.droneId}`));
  console.log("");
  console.log(chalk4.bold("  Config File:"));
  console.log(chalk4.dim(`  ${getConfigPath()}`));
  console.log("");
  console.log(chalk4.dim("  To recover on a new machine:"));
  console.log(chalk4.dim('  1. Run "rrs-terminal" and type "config"'));
  console.log(chalk4.dim('  2. Choose "Import from game"'));
  console.log(chalk4.dim("  3. Enter your session key - drone auto-detected!"));
  console.log("");
}
async function backupCommand() {
  if (!configExists()) {
    console.log("");
    printWarning("No configuration found");
    printInfo('Run "config" to set up first');
    console.log("");
    return;
  }
  const config = loadConfig();
  showBackup(config);
}

// src/commands/stop.ts
import chalk5 from "chalk";
import ora2 from "ora";
async function stopCommand() {
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
  const spinner = ora2({
    text: chalk5.dim(`Stopping mining process (PID: ${pid})...`),
    spinner: "dots"
  }).start();
  try {
    process.kill(pid, "SIGTERM");
    let attempts = 0;
    while (isProcessRunning(pid) && attempts < 50) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }
    if (isProcessRunning(pid)) {
      spinner.text = chalk5.dim("Process not responding, forcing stop...");
      process.kill(pid, "SIGKILL");
      removePidFile();
    }
    spinner.stop();
    console.log("");
    printSuccess("Mining stopped");
    console.log("");
  } catch (error) {
    spinner.stop();
    if (error.code === "ESRCH") {
      printWarning("Process already stopped");
      removePidFile();
    } else {
      console.log(
        chalk5.red(
          `  \u2717 Failed to stop process: ${error instanceof Error ? error.message : error}`
        )
      );
    }
    console.log("");
  }
}

// src/index.ts
async function fetchSessionBalance() {
  if (!configExists()) return null;
  try {
    const config = loadConfig();
    const networkConfig = await fetchNetworkConfig();
    const client = createContractClient(networkConfig, config.sessionKey);
    const balance = await getBalance(client);
    return formatEther3(balance);
  } catch {
    return null;
  }
}
function formatDuration2(ms) {
  const seconds = Math.floor(ms / 1e3);
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
async function getStatusSummary() {
  const pid = readPidFile();
  const isRunning = pid && isProcessRunning(pid);
  if (isRunning) {
    const state = loadRuntimeState();
    if (state) {
      const runtime = formatDuration2(Date.now() - state.startTime);
      const rate = state.stats.blocksDestroyed / ((Date.now() - state.startTime) / 1e3);
      return {
        status: chalk6.green.bold("\u25CF Mining Active"),
        details: [
          `${chalk6.green(state.stats.blocksDestroyed.toLocaleString())} blocks destroyed`,
          `${runtime} runtime`,
          `${rate.toFixed(1)} blocks/sec`
        ]
      };
    }
    return {
      status: chalk6.green.bold("\u25CF Mining Active"),
      details: [`PID: ${pid}`]
    };
  }
  if (!configExists()) {
    return {
      status: chalk6.yellow.bold("\u25CB Not Configured"),
      details: ['Run "config" to set up your session key and drone']
    };
  }
  const config = loadConfig();
  const balance = await fetchSessionBalance();
  const details = [`Drone #${config.droneId} ready`];
  if (balance !== null) {
    const balNum = parseFloat(balance);
    const balStr = balNum < 1e-4 ? "<0.0001" : balNum.toFixed(4);
    const color = balNum < 1e-3 ? chalk6.yellow : chalk6.green;
    details.push(`${color(balStr)} ETH in session wallet`);
  }
  return {
    status: chalk6.dim("\u25CB Mining Stopped"),
    details
  };
}
async function printWelcome() {
  printBanner();
  const { status, details } = await getStatusSummary();
  console.log(`  ${status}`);
  details.forEach((detail) => {
    console.log(chalk6.dim(`  ${detail}`));
  });
  console.log("");
  console.log(chalk6.yellow.bold("  Commands"));
  console.log(chalk6.dim("  Type a command and press Enter"));
  console.log("");
  console.log(
    `  ${chalk6.cyan("start")}     ${chalk6.dim("\u2500")}  Begin reclamation operations`
  );
  console.log(
    `  ${chalk6.cyan("stop")}      ${chalk6.dim("\u2500")}  Stop reclamation operations`
  );
  console.log(
    `  ${chalk6.cyan("config")}    ${chalk6.dim("\u2500")}  Set up or update configuration`
  );
  console.log(
    `  ${chalk6.cyan("backup")}    ${chalk6.dim("\u2500")}  View your wallet credentials`
  );
  console.log(
    `  ${chalk6.cyan("status")}    ${chalk6.dim("\u2500")}  Show current status`
  );
  console.log(
    `  ${chalk6.cyan("help")}      ${chalk6.dim("\u2500")}  Show all commands`
  );
  console.log(`  ${chalk6.cyan("quit")}      ${chalk6.dim("\u2500")}  Exit`);
  console.log("");
}
function printHelp() {
  console.log("");
  console.log(chalk6.bold("  Available Commands"));
  console.log(chalk6.cyan("  \u2500".repeat(24)));
  console.log("");
  console.log(
    `  ${chalk6.cyan("start")}      Start autonomous reclamation operations`
  );
  console.log(`  ${chalk6.cyan("stop")}       Stop the reclamation operations`);
  console.log(`  ${chalk6.cyan("config")}     Set up or update configuration`);
  console.log(
    `  ${chalk6.cyan("backup")}     View wallet address and private key`
  );
  console.log(`  ${chalk6.cyan("status")}     Show current mining status`);
  console.log(`  ${chalk6.cyan("clear")}      Clear the screen`);
  console.log(`  ${chalk6.cyan("help")}       Show this help message`);
  console.log(`  ${chalk6.cyan("quit")}       Exit RRS Terminal`);
  console.log("");
  console.log(chalk6.dim("  Shortcuts: q = quit, ? = help"));
  console.log("");
}
function printStatus() {
  const pid = readPidFile();
  const isRunning = pid && isProcessRunning(pid);
  console.log("");
  if (!configExists()) {
    console.log(chalk6.yellow("  \u25CB Not Configured"));
    console.log(chalk6.dim('    Run "config" to set up'));
    console.log("");
    return;
  }
  const config = loadConfig();
  console.log(chalk6.bold("  Configuration"));
  console.log(chalk6.dim(`    Drone ID: #${config.droneId}`));
  console.log(
    chalk6.dim(
      `    Session Key: ${config.sessionKey.slice(0, 10)}...${config.sessionKey.slice(-6)}`
    )
  );
  console.log("");
  if (isRunning) {
    console.log(
      chalk6.green.bold("  \u25CF Mining Active") + chalk6.dim(` (PID: ${pid})`)
    );
    const state = loadRuntimeState();
    if (state) {
      const runtime = formatDuration2(Date.now() - state.startTime);
      const rate = state.stats.blocksDestroyed / ((Date.now() - state.startTime) / 1e3);
      console.log(
        chalk6.dim(`    Blocks: ${state.stats.blocksDestroyed.toLocaleString()}`)
      );
      console.log(chalk6.dim(`    Runtime: ${runtime}`));
      console.log(chalk6.dim(`    Rate: ${rate.toFixed(2)} blocks/sec`));
    }
  } else {
    console.log(chalk6.dim("  \u25CB Mining Stopped"));
    const state = loadRuntimeState();
    if (state) {
      console.log(
        chalk6.dim(
          `    Last session: ${state.stats.blocksDestroyed.toLocaleString()} blocks`
        )
      );
    }
  }
  console.log("");
}
async function main() {
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
  await printWelcome();
  while (true) {
    const { command } = await inquirer2.prompt([
      {
        type: "input",
        name: "command",
        message: chalk6.cyan("rrs") + chalk6.dim(">"),
        prefix: ""
      }
    ]);
    const cmd = command.trim().toLowerCase();
    if (!cmd) {
      continue;
    }
    switch (cmd) {
      case "start":
        await startCommand();
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
        console.log(chalk6.dim("\n  Goodbye!\n"));
        process.exit(0);
      default:
        console.log(chalk6.red(`
  Unknown command: ${cmd}`));
        console.log(chalk6.dim('  Type "help" for available commands\n'));
    }
  }
}
main().catch((error) => {
  console.error(chalk6.red(`Error: ${error.message}`));
  process.exit(1);
});
