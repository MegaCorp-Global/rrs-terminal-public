import type { NetworkConfig } from "../types.js";

/**
 * Network configuration for RRS Terminal
 * Fetches contract addresses and endpoints from megacorp.global
 */

const CONTRACTS_URL = "https://megacorp.global/contracts.json";

const ENDPOINTS = {
  relay: "wss://relay.megacorp.global/ws",
  capability: "https://cap.megacorp.global",
};

let cachedConfig: NetworkConfig | null = null;

/**
 * Fetch network configuration from megacorp.global/contracts.json
 * Caches the result for the lifetime of the process
 */
export async function fetchNetworkConfig(): Promise<NetworkConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const response = await fetch(CONTRACTS_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch network config: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  // Validate required fields
  if (!data.network?.rpcUrl || !data.network?.chainId) {
    throw new Error(
      "Invalid network config: missing network.rpcUrl or network.chainId",
    );
  }
  if (!data.contracts?.MegaCubeV5?.address) {
    throw new Error(
      "Invalid network config: missing contracts.MegaCubeV5.address",
    );
  }
  if (!data.contracts?.OperatorLicense?.address) {
    throw new Error(
      "Invalid network config: missing contracts.OperatorLicense.address",
    );
  }

  // Map the raw config to our expected format
  const config: NetworkConfig = {
    network: {
      name: data.network.name,
      chainId: data.network.chainId,
      rpcUrl: data.network.rpcUrl,
      wsUrl: data.network.wsUrl,
      explorer: data.network.explorer,
    },
    contracts: {
      MegaCubeV5: { address: data.contracts.MegaCubeV5.address },
      OperatorLicense: {
        address: data.contracts.OperatorLicense.address,
      },
      ArtifactNFT: { address: data.contracts.ArtifactNFT?.address || "" },
      Cubed: { address: data.contracts.Cubed?.address || "" },
    },
    endpoints: ENDPOINTS,
  };

  cachedConfig = config;
  return config;
}

/**
 * Clear the cached network config (useful for testing)
 */
export function clearNetworkConfigCache(): void {
  cachedConfig = null;
}

/**
 * Check if running in development mode (always false in production build)
 */
export function isStageEnvironment(): boolean {
  return false;
}
