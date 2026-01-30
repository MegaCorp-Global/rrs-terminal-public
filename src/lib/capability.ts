import type {
  CapabilityBundle,
  CapabilityResponse,
  Capability,
  NetworkConfig,
} from "../types.js";
import { CAP_MODE_MINE } from "../types.js";

interface CachedCapability {
  bundle: CapabilityBundle;
  remainingBudget: number;
  fetchedAt: number;
}

let capabilityCache: CachedCapability | null = null;

/**
 * Parse capability response from the endpoint into our typed format
 */
function parseCapabilityResponse(
  response: CapabilityResponse,
): CapabilityBundle {
  return {
    capability: {
      wallet: response.capability.wallet as `0x${string}`,
      allowedModes: response.capability.allowedModes,
      nonce: BigInt(response.capability.nonce),
      issuedAt: BigInt(response.capability.issuedAt),
      expiresAt: BigInt(response.capability.expiresAt),
      budget: response.capability.budget,
    },
    signature: response.signature as `0x${string}`,
  };
}

/**
 * Check if cached capability is still valid and has remaining budget
 */
function isCacheValid(cost: number): boolean {
  if (!capabilityCache) return false;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number(capabilityCache.bundle.capability.expiresAt);

  // Check if expired (with 30s buffer)
  if (now >= expiresAt - 30) return false;

  // Check if budget exhausted
  if (capabilityCache.remainingBudget < cost) return false;

  return true;
}

/**
 * Fetch a fresh capability from the capability endpoint
 */
async function fetchCapability(
  networkConfig: NetworkConfig,
  wallet: string,
  droneId: number,
  allowedModes: number = CAP_MODE_MINE,
): Promise<CapabilityBundle> {
  const url = `${networkConfig.endpoints.capability}/capability`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      wallet,
      allowedModes,
      droneId: String(droneId),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Identity validation failed: ${response.status} - ${errorText}`,
    );
  }

  const data = (await response.json()) as CapabilityResponse;
  return parseCapabilityResponse(data);
}

/**
 * Get a capability for mining, using cache when possible
 * @param networkConfig - Network configuration with capability endpoint
 * @param wallet - Wallet address (session key address)
 * @param droneId - Drone token ID
 * @param cost - Number of tiles this operation will consume from budget
 * @returns Capability bundle with signature
 */
export async function getCapability(
  networkConfig: NetworkConfig,
  wallet: string,
  droneId: number,
  cost: number = 1,
): Promise<CapabilityBundle> {
  // Check cache first
  if (isCacheValid(cost)) {
    capabilityCache!.remainingBudget -= cost;
    return capabilityCache!.bundle;
  }

  // Fetch fresh capability
  const bundle = await fetchCapability(networkConfig, wallet, droneId);

  // Log capability details for debugging
  const expiresAt = Number(bundle.capability.expiresAt);
  const issuedAt = Number(bundle.capability.issuedAt);
  const ttl = expiresAt - issuedAt;
  const nonceHex = bundle.capability.nonce.toString(16).padStart(16, "0");
  console.log(
    `  [Cap] Fresh capability: budget=${bundle.capability.budget}, nonce=0x${nonceHex}, ttl=${ttl}s`,
  );

  // Cache it
  capabilityCache = {
    bundle,
    remainingBudget: bundle.capability.budget - cost,
    fetchedAt: Date.now(),
  };

  return bundle;
}

/**
 * Get remaining budget in current capability (without fetching)
 */
export function getRemainingBudget(): number {
  return capabilityCache?.remainingBudget ?? 0;
}

/**
 * Force clear the capability cache (useful for testing or after errors)
 */
export function clearCapabilityCache(): void {
  if (capabilityCache) {
    const nonceHex = capabilityCache.bundle.capability.nonce
      .toString(16)
      .padStart(16, "0");
    console.log(
      `  [Cap] Clearing cache: nonce=0x${nonceHex}, had ${capabilityCache.remainingBudget} local budget`,
    );
  }
  capabilityCache = null;
}

/**
 * Check if a capability refresh is needed
 */
export function needsCapabilityRefresh(cost: number = 1): boolean {
  return !isCacheValid(cost);
}
