import chalk from "chalk";

/**
 * ASCII art banner for RRS Terminal
 */
const BANNER = `
${chalk.cyan("╔═══════════════════════════════════════════════════════════════╗")}
${chalk.cyan("║")}  ${chalk.bold.white("██████╗ ██████╗ ███████╗")}    ${chalk.dim("Remote Reclamation")}            ${chalk.cyan("║")}
${chalk.cyan("║")}  ${chalk.bold.white("██╔══██╗██╔══██╗██╔════╝")}    ${chalk.dim("Services Division")}             ${chalk.cyan("║")}
${chalk.cyan("║")}  ${chalk.bold.white("██████╔╝██████╔╝███████╗")}    ${chalk.dim.yellow("━━━━━━━━━━━━━━━━━━")}             ${chalk.cyan("║")}
${chalk.cyan("║")}  ${chalk.bold.white("██╔══██╗██╔══██╗╚════██║")}    ${chalk.dim("Autonomous Mining")}             ${chalk.cyan("║")}
${chalk.cyan("║")}  ${chalk.bold.white("██║  ██║██║  ██║███████║")}    ${chalk.dim("Terminal v1.0.0")}               ${chalk.cyan("║")}
${chalk.cyan("║")}  ${chalk.bold.white("╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝")}                                  ${chalk.cyan("║")}
${chalk.cyan("║")}                                                              ${chalk.cyan("║")}
${chalk.cyan("║")}        ${chalk.dim.italic("A Subsidiary of")} ${chalk.white("MEGACORP")} ${chalk.dim("Global")}                    ${chalk.cyan("║")}
${chalk.cyan("╚═══════════════════════════════════════════════════════════════╝")}
`;

/**
 * Compact banner for subsequent commands
 */
const BANNER_COMPACT = `
${chalk.cyan("┌───────────────────────────────────────────┐")}
${chalk.cyan("│")}  ${chalk.bold.white("RRS")} ${chalk.dim("Remote Reclamation Services")}        ${chalk.cyan("│")}
${chalk.cyan("│")}  ${chalk.dim.italic("A Subsidiary of")} ${chalk.white("MEGACORP")} ${chalk.dim("Global")}   ${chalk.cyan("│")}
${chalk.cyan("└───────────────────────────────────────────┘")}
`;

/**
 * Print the full ASCII banner
 */
export function printBanner(): void {
  console.log(BANNER);
}

/**
 * Print a compact banner
 */
export function printBannerCompact(): void {
  console.log(BANNER_COMPACT);
}

/**
 * Print a section header
 */
export function printSection(title: string): void {
  console.log("");
  console.log(chalk.cyan("━".repeat(50)));
  console.log(chalk.bold.white(`  ${title}`));
  console.log(chalk.cyan("━".repeat(50)));
  console.log("");
}

/**
 * Print a success message with checkmark
 */
export function printSuccess(message: string): void {
  console.log(chalk.green(`  ✓ ${message}`));
}

/**
 * Print a warning message
 */
export function printWarning(message: string): void {
  console.log(chalk.yellow(`  ⚠ ${message}`));
}

/**
 * Print an error message
 */
export function printError(message: string): void {
  console.log(chalk.red(`  ✗ ${message}`));
}

/**
 * Print an info line (indented, dimmed)
 */
export function printInfo(message: string): void {
  console.log(chalk.dim(`    ${message}`));
}

/**
 * Print a key-value pair
 */
export function printKeyValue(key: string, value: string): void {
  console.log(`  ${chalk.dim(key + ":")} ${chalk.white(value)}`);
}

/**
 * Print a divider line
 */
export function printDivider(): void {
  console.log(chalk.dim("  " + "─".repeat(46)));
}

/**
 * Print the "next steps" box
 */
export function printNextSteps(steps: string[]): void {
  console.log("");
  console.log(
    chalk.cyan("┌─") +
      chalk.bold.cyan(" Next Steps ") +
      chalk.cyan("─".repeat(35) + "┐"),
  );
  steps.forEach((step, i) => {
    console.log(
      chalk.cyan("│") +
        `  ${chalk.yellow(`${i + 1}.`)} ${step}`.padEnd(48) +
        chalk.cyan("│"),
    );
  });
  console.log(chalk.cyan("└" + "─".repeat(48) + "┘"));
  console.log("");
}

/**
 * Print a stats box
 */
export function printStatsBox(
  title: string,
  stats: Array<{
    label: string;
    value: string;
    color?: "green" | "yellow" | "red" | "cyan" | "white";
  }>,
): void {
  console.log("");
  console.log(
    chalk.cyan("┌─") +
      chalk.bold.cyan(` ${title} `) +
      chalk.cyan("─".repeat(Math.max(0, 45 - title.length)) + "┐"),
  );
  stats.forEach(({ label, value, color = "white" }) => {
    const colorFn = chalk[color] || chalk.white;
    const line = `  ${chalk.dim(label + ":")} ${colorFn(value)}`;
    // Calculate visible length (without ANSI codes) for padding
    const visibleLength = label.length + 2 + value.length + 2;
    const padding = Math.max(0, 46 - visibleLength);
    console.log(chalk.cyan("│") + line + " ".repeat(padding) + chalk.cyan("│"));
  });
  console.log(chalk.cyan("└" + "─".repeat(48) + "┘"));
}
