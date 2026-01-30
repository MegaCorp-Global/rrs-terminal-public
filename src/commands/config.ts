import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  saveConfig,
  configExists,
  getConfigPath,
  loadConfig,
} from "../lib/config.js";
import { fetchNetworkConfig } from "../lib/network.js";
import {
  createContractClient,
  findDronesForSessionKey,
  getBalance,
} from "../lib/contract.js";
import {
  printBanner,
  printSection,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printKeyValue,
  printNextSteps,
} from "../lib/ui.js";
import type { Config } from "../types.js";

export async function configCommand(): Promise<void> {
  printBanner();

  // Check if config already exists
  if (configExists()) {
    const existing = loadConfig();
    const account = privateKeyToAccount(existing.sessionKey as `0x${string}`);

    console.log(chalk.yellow.bold("  Existing configuration detected\n"));
    printKeyValue("Drone ID", `#${existing.droneId}`);
    printKeyValue("Session Wallet", account.address);
    console.log("");

    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: chalk.green("Keep existing configuration"), value: "keep" },
          {
            name: chalk.cyan("View backup / export credentials"),
            value: "backup",
          },
          {
            name: chalk.yellow("Re-detect drones for this session key"),
            value: "redetect",
          },
          {
            name: chalk.red("Start fresh (new configuration)"),
            value: "fresh",
          },
        ],
      },
    ]);

    if (action === "keep") {
      console.log("");
      printSuccess("Configuration unchanged");
      console.log(chalk.dim('\n  Type "start" to begin mining\n'));
      return;
    }

    if (action === "backup") {
      showBackup(existing);
      return;
    }

    if (action === "redetect") {
      // Re-detect drones for existing session key
      const droneId = await detectDroneForSession(
        existing.sessionKey,
        account.address,
      );
      if (droneId !== null) {
        saveConfig({ ...existing, droneId });
        console.log("");
        printSuccess(`Configuration updated with Drone #${droneId}`);
        console.log(chalk.dim('\n  Type "start" to begin mining\n'));
      }
      return;
    }

    // action === 'fresh' - continue with full setup below
    console.log("");
  }

  // Explain what we're setting up
  printSection("How Mining Works");

  console.log(
    chalk.dim('  MegaCube uses a "session wallet" system for security:'),
  );
  console.log("");
  console.log(
    chalk.white("  1. Your ") +
      chalk.cyan("Main Wallet") +
      chalk.white(" holds your Drone Operator License"),
  );
  console.log(
    chalk.white("  2. A ") +
      chalk.green("Session Wallet") +
      chalk.white(" is authorized to mine on its behalf"),
  );
  console.log(chalk.white("  3. Only the session wallet key is stored here"));
  console.log("");
  console.log(
    chalk.dim(
      "  This way, if your terminal is compromised, only gas money is at risk.",
    ),
  );
  console.log("");

  // Choose setup method
  const { setupMethod } = await inquirer.prompt<{ setupMethod: string }>([
    {
      type: "list",
      name: "setupMethod",
      message: "How would you like to set up?",
      choices: [
        {
          name: `${chalk.yellow("●")} Import from game ${chalk.dim("(recommended - auto-detects drone)")}`,
          value: "import_session",
        },
        {
          name: `${chalk.green("●")} Generate new session wallet ${chalk.dim("(requires manual setup)")}`,
          value: "generate",
        },
      ],
    },
  ]);

  let sessionKey: string;
  let sessionAddress: string;
  let droneId: number;

  if (setupMethod === "import_session") {
    // Import existing session wallet
    console.log("");
    console.log(chalk.dim("  Get your session key from the game:"));
    console.log(
      chalk.cyan("    megacorp.global → Wallet HUD → Session → Export Key"),
    );
    console.log("");

    const { importedKey } = await inquirer.prompt<{ importedKey: string }>([
      {
        type: "password",
        name: "importedKey",
        message: "Session wallet private key:",
        mask: "●",
        validate: (input: string) => {
          const normalized = input.startsWith("0x") ? input.slice(2) : input;
          if (normalized.length !== 64) {
            return "Private key must be 64 hex characters (with or without 0x prefix)";
          }
          if (!/^[a-fA-F0-9]{64}$/.test(normalized)) {
            return "Private key must contain only hexadecimal characters (0-9, a-f)";
          }
          return true;
        },
      },
    ]);

    sessionKey = importedKey.startsWith("0x")
      ? importedKey
      : `0x${importedKey}`;
    const account = privateKeyToAccount(sessionKey as `0x${string}`);
    sessionAddress = account.address;

    console.log("");
    printSuccess("Session wallet imported");
    printInfo(`Address: ${sessionAddress}`);

    // Auto-detect drone
    const detectedDrone = await detectDroneForSession(
      sessionKey,
      sessionAddress,
    );
    if (detectedDrone === null) {
      return; // Error already shown
    }
    droneId = detectedDrone;
  } else {
    // Generate new session wallet
    sessionKey = generatePrivateKey();
    const account = privateKeyToAccount(sessionKey as `0x${string}`);
    sessionAddress = account.address;

    printSection("New Session Wallet Created");

    console.log(
      chalk.cyan("  ┌──────────────────────────────────────────────────────┐"),
    );
    console.log(
      chalk.cyan("  │") +
        chalk.bold.yellow(
          "  ⚠  SAVE THIS INFORMATION - YOU WILL NEED IT LATER   ",
        ) +
        chalk.cyan("│"),
    );
    console.log(
      chalk.cyan("  └──────────────────────────────────────────────────────┘"),
    );
    console.log("");
    console.log(chalk.bold("  Session Wallet Address:"));
    console.log(chalk.green(`  ${sessionAddress}`));
    console.log("");
    console.log(chalk.bold("  Private Key:"));
    console.log(chalk.yellow(`  ${sessionKey}`));
    console.log("");

    // Make them confirm they saved it
    const { savedKey } = await inquirer.prompt<{ savedKey: boolean }>([
      {
        type: "confirm",
        name: "savedKey",
        message: "I have saved this information securely",
        default: false,
      },
    ]);

    if (!savedKey) {
      console.log("");
      console.log(chalk.yellow("  Please save before continuing:"));
      console.log(chalk.dim(`  Address: ${sessionAddress}`));
      console.log(chalk.dim(`  Key: ${sessionKey}`));
      console.log("");

      await inquirer.prompt([
        {
          type: "input",
          name: "wait",
          message: "Press Enter when you have saved this information...",
        },
      ]);
    }

    // For new wallets, we need the drone ID manually since it's not authorized yet
    printSection("Drone Configuration");

    console.log(
      chalk.dim("  Enter the token ID of your Demolition Drone NFT."),
    );
    console.log(
      chalk.dim("  You can find this on megacorp.global or in your wallet.\n"),
    );

    const { manualDroneId } = await inquirer.prompt<{ manualDroneId: number }>([
      {
        type: "number",
        name: "manualDroneId",
        message: "Drone NFT token ID:",
        validate: (input: number) => {
          if (isNaN(input) || input < 0) {
            return "Please enter a valid drone ID (non-negative number)";
          }
          return true;
        },
      },
    ]);
    droneId = manualDroneId;
  }

  // Build and save config
  const config: Config = {
    sessionKey,
    droneId,
    autoRepurchase: false,
    turboThreshold: 100,
  };

  saveConfig(config);

  // Fetch balance for display
  let balanceDisplay = "";
  let hasLowBalance = false;
  try {
    const networkConfig = await fetchNetworkConfig();
    const client = createContractClient(networkConfig, sessionKey);
    const balance = await getBalance(client);
    const balNum = parseFloat(formatEther(balance));
    hasLowBalance = balNum < 0.001;
    const balStr = balNum < 0.0001 ? "<0.0001" : balNum.toFixed(4);
    const color = hasLowBalance ? chalk.yellow : chalk.green;
    balanceDisplay = color(balStr + " ETH");
  } catch {
    balanceDisplay = chalk.dim("(unable to fetch)");
  }

  // Success + next steps
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
      `Go to megacorp.global → Your Drone → Set Session Key`,
      `Enter: ${sessionAddress}`,
      `Return here and type "start" to begin mining`,
    ]);
  } else if (hasLowBalance) {
    printNextSteps([
      `Fund session wallet with ETH for gas`,
      `Type "start" to begin mining`,
    ]);
  } else {
    printNextSteps([`Type "start" to begin mining`]);
  }

  console.log(
    chalk.dim('  Tip: Type "backup" anytime to see your credentials\n'),
  );
}

/**
 * Detect which drone(s) this session key is authorized for
 */
async function detectDroneForSession(
  sessionKey: string,
  sessionAddress: string,
): Promise<number | null> {
  const spinner = ora({
    text: chalk.dim("Connecting to MegaETH..."),
    spinner: "dots",
  }).start();

  try {
    // Fetch network config
    const networkConfig = await fetchNetworkConfig();
    spinner.text = chalk.dim("Searching for authorized drones...");

    // Create a minimal client just for reading
    const client = createContractClient(networkConfig, sessionKey);

    // Find drones
    const drones = await findDronesForSessionKey(client, sessionAddress);

    spinner.stop();

    if (drones.length === 0) {
      console.log("");
      printError("No drones found for this session key");
      console.log("");
      console.log(
        chalk.dim("  This session wallet is not authorized on any drone."),
      );
      console.log(chalk.dim("  Make sure you:"));
      console.log(chalk.dim("    1. Have a Demolition Drone NFT"));
      console.log(
        chalk.dim(
          "    2. Set this session key on your drone at megacorp.global",
        ),
      );
      console.log("");
      return null;
    }

    if (drones.length === 1) {
      console.log("");
      printSuccess(`Found Drone #${drones[0]}`);
      return drones[0];
    }

    // Multiple drones - let user choose
    console.log("");
    printSuccess(`Found ${drones.length} drones`);
    console.log("");

    const { selectedDrone } = await inquirer.prompt<{ selectedDrone: number }>([
      {
        type: "list",
        name: "selectedDrone",
        message: "Which drone would you like to use?",
        choices: drones.map((id) => ({
          name: `Drone #${id}`,
          value: id,
        })),
      },
    ]);

    return selectedDrone;
  } catch (error) {
    spinner.stop();
    console.log("");
    printError(
      `Failed to detect drones: ${error instanceof Error ? error.message : error}`,
    );
    console.log("");
    return null;
  }
}

/**
 * Show backup information
 */
function showBackup(config: Config): void {
  const account = privateKeyToAccount(config.sessionKey as `0x${string}`);

  printSection("Backup Information");

  console.log(
    chalk.cyan("  ┌──────────────────────────────────────────────────────┐"),
  );
  console.log(
    chalk.cyan("  │") +
      chalk.bold.yellow(
        "  ⚠  KEEP THIS INFORMATION SECURE                     ",
      ) +
      chalk.cyan("│"),
  );
  console.log(
    chalk.cyan("  └──────────────────────────────────────────────────────┘"),
  );
  console.log("");

  console.log(chalk.bold("  Session Wallet Address:"));
  console.log(chalk.green(`  ${account.address}`));
  console.log("");
  console.log(chalk.bold("  Session Wallet Private Key:"));
  console.log(chalk.yellow(`  ${config.sessionKey}`));
  console.log("");
  console.log(chalk.bold("  Drone ID:"));
  console.log(chalk.cyan(`  #${config.droneId}`));
  console.log("");
  console.log(chalk.bold("  Config File:"));
  console.log(chalk.dim(`  ${getConfigPath()}`));
  console.log("");

  console.log(chalk.dim("  To recover on a new machine:"));
  console.log(chalk.dim('  1. Run "rrs-terminal" and type "config"'));
  console.log(chalk.dim('  2. Choose "Import from game"'));
  console.log(chalk.dim("  3. Enter your session key - drone auto-detected!"));
  console.log("");
}

/**
 * Backup command - show credentials
 */
export async function backupCommand(): Promise<void> {
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
