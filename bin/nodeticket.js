#!/usr/bin/env node
/**
 * nodeticket CLI dispatcher.
 */
const parseArgs = require('../src/cli/args');
const { run } = require('../src/cli/runner');
const commands = require('../src/cli/commands');

function printTopHelp() {
  const lines = ['Usage: nodeticket <command> [options]', '', 'Commands:'];
  for (const [name, cmd] of Object.entries(commands)) {
    lines.push(`  ${name.padEnd(18)} ${cmd.describe || ''}`);
  }
  lines.push('', 'Run `nodeticket <command> --help` for command-specific options.');
  process.stdout.write(lines.join('\n') + '\n');
}

const argv = process.argv.slice(2);
const name = argv[0];

if (!name || name === '--help' || name === '-h' || name === 'help') {
  printTopHelp();
  process.exit(0);
}

const cmd = commands[name];
if (!cmd) {
  process.stderr.write(`unknown command: ${name}\n`);
  printTopHelp();
  process.exit(2);
}

const args = parseArgs(argv.slice(1));

if (args.help || args.h) {
  process.stdout.write((cmd.help || cmd.describe || '') + '\n');
  process.exit(0);
}

run(cmd.handler, args);
