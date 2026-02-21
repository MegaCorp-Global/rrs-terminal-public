/**
 * User configuration stored at ~/.megacube/config.json
 */
export interface Config {
  /** Private key for session wallet (0x...) - NOT the main wallet */
  sessionKey: string;
  /** Token ID of the Demolition Drone NFT */
  droneId: number;
  /** Auto-buy Turbo packs when low (not implemented in v1) */
  autoRepurchase?: boolean;
  /** Buy more Turbo when charges drop below this (not implemented in v1) */
  turboThreshold?: number;
}

/**
 * Network configuration fetched from https://megacorp.global/contracts.json
 */
export interface NetworkConfig {
  network: {
    name: string;
    chainId: number;
    rpcUrl: string;
    wsUrl: string;
    explorer: string;
  };
  contracts: {
    MegaCubeV5: { address: string };
    OperatorLicense: { address: string };
    ArtifactNFT: { address: string };
    Cubed: { address: string };
  };
  endpoints: {
    relay: string;
    capability: string;
  };
}

/**
 * Capability struct matching the Solidity struct in MegaCubeV4.sol
 */
export interface Capability {
  wallet: `0x${string}`;
  allowedModes: number;
  nonce: bigint;
  issuedAt: bigint;
  expiresAt: bigint;
  budget: number;
}

/**
 * Response from the capability endpoint
 */
export interface CapabilityResponse {
  capability: {
    wallet: string;
    allowedModes: number;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    budget: number;
  };
  signature: string;
}

/**
 * Parsed capability bundle for use in contract calls
 */
export interface CapabilityBundle {
  capability: Capability;
  signature: `0x${string}`;
}

/**
 * Mining session statistics
 */
export interface MiningStats {
  blocksDestroyed: number;
  blocksAlreadyDestroyed: number;
  errors: number;
  startTime: number;
  capabilityRefreshes: number;
}

/**
 * Runtime state written to ~/.megacube/rrs.state.json
 */
export interface RuntimeState {
  pid: number;
  startTime: number;
  stats: MiningStats;
}

/**
 * Capability modes (bitflags)
 */
export const CAP_MODE_MINE = 0x01;
export const CAP_MODE_SPEND = 0x02;
export const CAP_MODE_INSCRIBE = 0x04;

/**
 * Game constants
 */
export const CONTAINERS_PER_LAYER = 1_572_864;
export const TILES_PER_CONTAINER = 1024;
