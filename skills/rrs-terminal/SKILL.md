---
name: rrs-terminal
description: Autonomous block mining for MegaCube. Use when user asks to mine, automate, run the RRS Terminal, or set up autonomous mining.
allowed-tools: Bash(npx rrs-terminal *), Bash(npm *), Read, Write
---

# RRS Terminal - Remote Reclamation Services

You are helping the user operate the RRS Terminal for autonomous MegaCube block mining.

## Overview

RRS Terminal is an interactive CLI tool that automates block destruction on MegaCube. It runs continuously, destroying blocks using the user's Operator License NFT and session key.

## Prerequisites

Before using RRS Terminal, the user must have:

1. **An Operator License NFT** - Purchased from megacorp.global
2. **ETH for gas** - Small amount (~0.01 ETH) in their session wallet
3. **Session key configured on license** - The session wallet must be authorized

## Usage

### Interactive Mode (Recommended)

Just run the tool and use commands interactively:

```bash
npx rrs-terminal
```

This launches an interactive interface where users type commands:

- `config` - Set up session key and drone ID
- `start` - Begin mining
- `stop` - Stop mining
- `status` - Check current status
- `help` - Show all commands
- `quit` - Exit

### Direct Commands (for scripts)

Commands can also be run directly:

```bash
npx rrs-terminal config   # Setup wizard
npx rrs-terminal start    # Start mining
npx rrs-terminal status   # Check status
npx rrs-terminal stop     # Stop mining
```

## Workflow

### First-Time Setup

1. Run `npx rrs-terminal`
2. Type `config` at the prompt
3. The wizard will:
   - Generate or import a session key
   - Auto-detect or ask for the license token ID
   - Save config to `~/.megacube/config.json`
4. After config, the user must:
   - Fund the session wallet with ETH (the wizard shows the address)
   - Set the session wallet as authorized on their license (via megacorp.global UI)

### Starting Mining

In the interactive interface, type `start`:

```
rrs> start
```

The miner will:

- Validate the setup (balance, license authorization)
- Enter a continuous loop destroying random blocks
- Display real-time stats (blocks destroyed, rate, battery)
- Handle authorization renewal automatically

Press `Ctrl+C` to stop mining and return to the prompt.

### Checking Status

```
rrs> status
```

Shows:

- Whether mining is running
- Current session stats (blocks, runtime, rate)
- Configuration summary

## Configuration File

Location: `~/.megacube/config.json`

```json
{
  "sessionKey": "0x...",
  "droneId": 1247,
  "autoRepurchase": false,
  "turboThreshold": 100
}
```

| Field            | Required | Description                                       |
| ---------------- | -------- | ------------------------------------------------- |
| `sessionKey`     | Yes      | Private key for session wallet (NOT main wallet!) |
| `droneId`        | Yes      | Token ID of the Operator License NFT              |
| `autoRepurchase` | No       | Auto-buy Turbo packs (not implemented in v1)      |
| `turboThreshold` | No       | Buy more when charges drop below this             |

## Security Notes

**IMPORTANT:** Explain to the user:

1. **Session keys are separate wallets** - Never use their main wallet's private key
2. **Fund minimally** - Only put small ETH amounts for gas in the session wallet
3. **Session key authorization** - The session wallet must be set as authorized on the license contract
4. **Config file permissions** - The config is saved with mode 0600 (owner read/write only)

## Troubleshooting

### "Session wallet not authorized for license"

The user needs to set their session wallet as an authorized operator on their license:

1. Go to megacorp.global
2. Open Operator License details
3. Click "Set Session Key"
4. Enter the session wallet address

### "Session wallet has no ETH"

Fund the session wallet address shown in the error with a small amount of ETH (~0.01).

### "Verification failed"

The identity verification service may be temporarily unavailable. Check:

- License ownership on the blockchain explorer
- Session key authorization on the license

### "Battery depleted"

The Operator License battery is empty. Wait for the next shift cycle or check megacorp.global for shift status.

### Operations seem slow

Operation rate is governed by your license tier and level. Higher-tier licenses have larger operational capacity. The CLI handles all authorization renewals automatically.

## Cloud Deployment

For 24/7 mining, deploy to Railway, Render, or any VPS:

```bash
# Clone and configure
git clone https://github.com/megacorp-global/rrs-terminal-public
cd rrs-terminal
npm install

# Set environment variables instead of config file
export SESSION_KEY="0x..."
export DRONE_ID="1247"

# Run (direct command mode for servers)
npx rrs-terminal start
```

See the README for one-click deploy buttons.
