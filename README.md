# RRS Terminal

**Remote Reclamation Services** — Autonomous block mining interface for [MegaCube](https://megacorp.global).

[![npm version](https://img.shields.io/npm/v/rrs-terminal.svg)](https://www.npmjs.com/package/rrs-terminal)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Quick Start

```bash
npx rrs-terminal
```

That's it. The interactive interface will guide you through setup and operations.

## What is RRS Terminal?

RRS Terminal is the official command-line interface for Remote Reclamation Services operators. Run continuous reclamation operations without keeping your browser open.

**Features:**

- Autonomous block reclamation
- Secure session key architecture (never uses your main wallet)
- Real-time operational statistics
- Deploy to cloud for 24/7 operation

## Prerequisites

Before using RRS Terminal, you need:

1. **An Operator License** — Acquire at [megacorp.global](https://megacorp.global)
2. **ETH for gas** — A small amount (~0.01 ETH) in your session wallet
3. **Session key authorization** — Your session wallet must be registered on your license

## Usage

### Interactive Mode

Run `rrs-terminal` and you'll get an interactive interface:

```
╔═══════════════════════════════════════════════════════════════╗
║  ██████╗ ██████╗ ███████╗    Remote Reclamation            ║
║  ██╔══██╗██╔══██╗██╔════╝    Services Division             ║
║  ██████╔╝██████╔╝███████╗    ━━━━━━━━━━━━━━━━━━             ║
║  ██╔══██╗██╔══██╗╚════██║    Autonomous Mining             ║
║  ██║  ██║██║  ██║███████║    Terminal v1.0.0               ║
║  ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝                                  ║
╚═══════════════════════════════════════════════════════════════╝

  Commands:
  start     ─  Begin reclamation operations
  stop      ─  Suspend operations
  config    ─  Set up or update configuration
  status    ─  Show current status
  help      ─  Show all commands
  quit      ─  Exit

rrs>
```

### Commands

| Command  | Description                     |
| -------- | ------------------------------- |
| `config` | Interactive setup wizard        |
| `start`  | Begin autonomous operations     |
| `stop`   | Suspend the reclamation process |
| `status` | Check current operational status|
| `help`   | Show available commands         |
| `quit`   | Exit RRS Terminal               |

## Configuration

The setup wizard (`config`) will guide you through:

1. **Session key setup** — Generate a new wallet or import an existing private key
2. **License ID** — Auto-detected from your session key, or enter manually
3. **Save configuration** — Stored securely at `~/.megacube/config.json`

### Configuration File

```json
{
  "sessionKey": "0x...",
  "droneId": 1247
}
```

| Field        | Required | Description                                            |
| ------------ | -------- | ------------------------------------------------------ |
| `sessionKey` | Yes      | Private key for session wallet (NOT your main wallet!) |
| `droneId`    | Yes      | Token ID of your Operator License                      |

## Security

**Important:** RRS Terminal uses a session key architecture for security:

- **Never use your main wallet's private key** — Generate a new session key
- **Fund minimally** — Only put small amounts of ETH for gas
- **Session key authorization** — Register your session wallet on your license
- **Permissions** — Config file is saved with restricted permissions (mode 0600)

### Setting Up Your Session Key

1. Run `rrs-terminal` and type `config`
2. Generate a new session key and note the wallet address
3. Go to [megacorp.global](https://megacorp.global) and view your Operator License
4. Click "Set Session Key" and enter the session wallet address
5. Fund the session wallet with ETH for gas

## Cloud Deployment

Deploy RRS Terminal to run 24/7. All cloud deployments use environment variables.

### Environment Variables

| Variable      | Required | Description                                  |
| ------------- | -------- | -------------------------------------------- |
| `SESSION_KEY` | Yes      | Session wallet private key (0x-prefixed hex) |
| `DRONE_ID`    | Yes      | Operator License token ID                    |

### Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/rrs-terminal)

1. Click the deploy button
2. Set `SESSION_KEY` and `DRONE_ID` in the Variables tab
3. Deploy

### Render

1. Fork this repository
2. Create a new **Background Worker** on Render
3. Connect your fork
4. Add environment variables
5. Deploy

### Docker

```bash
docker build -t rrs-terminal -f deploy/Dockerfile .
docker run -e SESSION_KEY=0x... -e DRONE_ID=1247 rrs-terminal
```

### VPS / Manual

```bash
git clone https://github.com/megacorp-global/rrs-terminal-public.git
cd rrs-terminal
npm install
npm run build

# Set environment variables
export SESSION_KEY="0x..."
export DRONE_ID="1247"
npm start
```

For persistent operation, use a process manager like PM2:

```bash
npm install -g pm2
SESSION_KEY=0x... DRONE_ID=1247 pm2 start npm --name rrs -- start
pm2 save
```

## Troubleshooting

### "Session wallet not authorized"

Register your session wallet as an authorized operator:

1. Go to megacorp.global
2. Open your Operator License details
3. Click "Set Session Key"
4. Enter the session wallet address shown in the error

### "Session wallet has no ETH"

Fund the session wallet with a small amount of ETH (~0.01) for gas fees.

### "Battery depleted"

Your Operator License battery is empty. Return to megacorp.global to join the queue for your next shift.

### Operations seem slow

Operation rate is governed by your license tier and level. Higher-tier licenses have larger operational capacity.

## How It Works

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ RRS Terminal    │─────▶│ Identity        │─────▶│ MegaCube        │
│ (this CLI)      │      │ Verification    │      │ Contract        │
└─────────────────┘      └─────────────────┘      └─────────────────┘
        │                                                  │
        │                                                  │
        └──────────────────────────────────────────────────┘
                    Reclamation transactions
```

1. CLI verifies your operator identity
2. Receives operational authorization
3. Submits reclamation transactions to the MegaCube contract
4. When authorization expires, automatically renews and continues

## License

MIT License — see [LICENSE](LICENSE) for details.

## Links

- [MegaCube](https://megacorp.global) — Main interface
- [Project Persistence](https://megacorp.global/persistence) — Remote Reclamation Services
- [GitHub](https://github.com/megacorp-global/rrs-terminal-public) — Source code

---

_Built by MEGACORP Remote Reclamation Services Division_
