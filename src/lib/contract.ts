import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Account,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig, CapabilityBundle } from "../types.js";

/**
 * ABI for MegaCubeV4 contract - only the functions we need
 */
const MEGACUBE_ABI = [
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
          { name: "budget", type: "uint16" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "currentLayer",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "jackpotFeePerBlockWei",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getUnprocessedBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * ABI for CUBED ERC20 token
 */
const CUBED_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * ABI for OperatorLicense contract - only the functions we need
 */
const DRONE_ABI = [
  {
    name: "isAuthorizedFor",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getSessionKey",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
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
          { name: "upgradeBlocksAtStart", type: "uint64" },
        ],
      },
    ],
  },
] as const;

export interface ContractClient {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  megaCubeAddress: `0x${string}`;
  droneAddress: `0x${string}`;
  cubedAddress: `0x${string}`;
}

/**
 * Create a custom chain definition from network config
 */
function createChainFromConfig(networkConfig: NetworkConfig): Chain {
  return {
    id: networkConfig.network.chainId,
    name: networkConfig.network.name,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [networkConfig.network.rpcUrl],
        webSocket: [networkConfig.network.wsUrl],
      },
    },
    blockExplorers: {
      default: {
        name: "Explorer",
        url: networkConfig.network.explorer,
      },
    },
  };
}

/**
 * Create contract client from network config and session key
 */
export function createContractClient(
  networkConfig: NetworkConfig,
  sessionKey: string,
): ContractClient {
  const chain = createChainFromConfig(networkConfig);
  const account = privateKeyToAccount(sessionKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain,
    transport: http(networkConfig.network.rpcUrl),
  });

  const walletClient = createWalletClient({
    chain,
    transport: http(networkConfig.network.rpcUrl),
    account,
  });

  return {
    publicClient,
    walletClient,
    account,
    megaCubeAddress: networkConfig.contracts.MegaCubeV4
      .address as `0x${string}`,
    droneAddress: networkConfig.contracts.OperatorLicense
      .address as `0x${string}`,
    cubedAddress: networkConfig.contracts.Cubed.address as `0x${string}`,
  };
}

/**
 * Check if a wallet is authorized to operate a drone
 */
export async function isAuthorizedForDrone(
  client: ContractClient,
  droneId: number,
  wallet: string,
): Promise<boolean> {
  const result = await client.publicClient.readContract({
    address: client.droneAddress,
    abi: DRONE_ABI,
    functionName: "isAuthorizedFor",
    args: [BigInt(droneId), wallet as `0x${string}`],
  });
  return result;
}

/**
 * Find all drones that have this session address as their session key
 */
export async function findDronesForSessionKey(
  client: ContractClient,
  sessionAddress: string,
): Promise<number[]> {
  // Get total supply to know how many drones exist
  let totalSupply: bigint;
  try {
    totalSupply = await client.publicClient.readContract({
      address: client.droneAddress,
      abi: DRONE_ABI,
      functionName: "totalSupply",
    });
  } catch {
    // If totalSupply not available, check a reasonable range
    totalSupply = 1000n;
  }

  // Token IDs typically start at 1, so check from 0 to totalSupply + buffer
  const maxToCheck = Math.min(Number(totalSupply) + 10, 5000);
  const authorizedDrones: number[] = [];
  const normalizedSession = sessionAddress.toLowerCase();

  // Check in batches of 50 for performance
  const batchSize = 50;
  for (let start = 0; start < maxToCheck; start += batchSize) {
    const end = Math.min(start + batchSize, maxToCheck);
    const checks: Promise<{ tokenId: number; sessionKey: string | null }>[] =
      [];

    for (let tokenId = start; tokenId < end; tokenId++) {
      checks.push(
        client.publicClient
          .readContract({
            address: client.droneAddress,
            abi: DRONE_ABI,
            functionName: "getSessionKey",
            args: [BigInt(tokenId)],
          })
          .then((result) => ({ tokenId, sessionKey: result as string }))
          .catch(() => ({ tokenId, sessionKey: null })),
      );
    }

    const results = await Promise.all(checks);
    for (const { tokenId, sessionKey } of results) {
      if (
        sessionKey &&
        sessionKey !== "0x0000000000000000000000000000000000000000" &&
        sessionKey.toLowerCase() === normalizedSession
      ) {
        authorizedDrones.push(tokenId);
      }
    }
  }

  return authorizedDrones;
}

/**
 * Get the current layer number
 */
export async function getCurrentLayer(client: ContractClient): Promise<bigint> {
  const result = await client.publicClient.readContract({
    address: client.megaCubeAddress,
    abi: MEGACUBE_ABI,
    functionName: "currentLayer",
  });
  return result;
}

/**
 * License status (battery-based system)
 */
export interface LicenseStatus {
  tier: number;
  level: number;
  maxBattery: number;
  currentBattery: number;
  totalBlocksDestroyed: bigint;
}

/**
 * Get license status
 */
export async function getLicenseStatus(
  client: ContractClient,
  licenseId: number,
): Promise<LicenseStatus> {
  const license = await client.publicClient.readContract({
    address: client.droneAddress,
    abi: DRONE_ABI,
    functionName: "getLicense",
    args: [BigInt(licenseId)],
  });

  return {
    tier: license.tier,
    level: license.level,
    maxBattery: license.maxBattery,
    currentBattery: license.currentBattery,
    totalBlocksDestroyed: license.totalBlocksDestroyed,
  };
}

/**
 * Get the jackpot fee per tile in wei
 */
export async function getJackpotFeePerBlock(
  client: ContractClient,
): Promise<bigint> {
  try {
    const result = await client.publicClient.readContract({
      address: client.megaCubeAddress,
      abi: MEGACUBE_ABI,
      functionName: "jackpotFeePerBlockWei",
    });
    return result;
  } catch {
    // Default to 0 if fee lookup fails
    return 0n;
  }
}

/**
 * Result of a destroy tile attempt
 */
export interface DestroyResult {
  success: boolean;
  txHash?: `0x${string}`;
  error?: string;
  alreadyDestroyed?: boolean;
}

/**
 * Destroy a block on the MegaCube
 */
export async function destroyBlock(
  client: ContractClient,
  licenseId: number,
  containerId: number,
  blockId: number,
  capability: CapabilityBundle,
  feePerBlock: bigint,
): Promise<DestroyResult> {
  try {
    const cap = {
      wallet: capability.capability.wallet,
      allowedModes: capability.capability.allowedModes,
      nonce: capability.capability.nonce,
      issuedAt: capability.capability.issuedAt,
      expiresAt: capability.capability.expiresAt,
      budget: capability.capability.budget,
    };

    // Simulate first to catch revert reasons
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
          capability.signature,
        ],
        value: feePerBlock,
        account: client.account,
      });
    } catch (simError) {
      const simMsg =
        simError instanceof Error ? simError.message : String(simError);
      const lowerSim = simMsg.toLowerCase();

      // Log raw simulation error for debugging - truncate for display
      const shortErr = simMsg.substring(0, 200);
      console.log(`  [Sim] Raw error: ${shortErr}`);

      if (lowerSim.includes("already destroyed")) {
        return {
          success: false,
          alreadyDestroyed: true,
          error: "Already destroyed",
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
          error: "Capability budget too low (cap.budget < cost)",
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
      // Return simulation error
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
        capability.signature,
      ],
      value: feePerBlock,
      gas: 500_000n,
    });

    // Wait for receipt
    const receipt = await client.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 30_000,
    });

    if (receipt.status === "success") {
      return { success: true, txHash: hash };
    } else {
      // Transaction reverted on-chain - try to get reason
      return {
        success: false,
        txHash: hash,
        error: "Transaction reverted on-chain",
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerError = errorMessage.toLowerCase();

    // Check for "already destroyed" type errors
    if (
      lowerError.includes("already destroyed") ||
      lowerError.includes("tile already")
    ) {
      return {
        success: false,
        alreadyDestroyed: true,
        error: "Already destroyed",
      };
    }

    // Parse common revert reasons from error message
    if (lowerError.includes("capability expired")) {
      return { success: false, error: "Capability expired" };
    }
    if (
      lowerError.includes("capability exhausted") ||
      lowerError.includes("budget")
    ) {
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

    // For generic reverts, try to extract reason from message
    const revertMatch = errorMessage.match(
      /reverted with reason[:\s]+"?([^"]+)"?/i,
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

/**
 * Get the wallet's ETH balance
 */
export async function getBalance(client: ContractClient): Promise<bigint> {
  return client.publicClient.getBalance({ address: client.account.address });
}

/**
 * Get the owner address of a drone NFT
 */
export async function getDroneOwner(
  client: ContractClient,
  droneId: number,
): Promise<string> {
  const result = await client.publicClient.readContract({
    address: client.droneAddress,
    abi: DRONE_ABI,
    functionName: "ownerOf",
    args: [BigInt(droneId)],
  });
  return result;
}

/**
 * Get a wallet's CUBE token balance (already inscribed)
 */
export async function getCubeBalance(
  client: ContractClient,
  wallet?: string,
): Promise<bigint> {
  try {
    const address = (wallet || client.account.address) as `0x${string}`;
    const result = await client.publicClient.readContract({
      address: client.cubedAddress,
      abi: CUBED_ABI,
      functionName: "balanceOf",
      args: [address],
    });
    return result;
  } catch {
    return 0n;
  }
}

/**
 * Get a wallet's unprocessed $CUBE balance (earned but not yet inscribed)
 */
export async function getUnprocessedCubeBalance(
  client: ContractClient,
  wallet?: string,
): Promise<bigint> {
  try {
    const address = (wallet || client.account.address) as `0x${string}`;
    const result = await client.publicClient.readContract({
      address: client.megaCubeAddress,
      abi: MEGACUBE_ABI,
      functionName: "getUnprocessedBalance",
      args: [address],
    });
    return result;
  } catch {
    return 0n;
  }
}
