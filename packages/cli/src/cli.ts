#!/usr/bin/env node
import { Command } from 'commander'
import { packCommand } from './commands/pack.js'
import { devCommand } from './commands/dev.js'

const program = new Command()
  .name('akp')
  .description('AgentKeeper plugin toolchain')
  .version('0.1.0')

program.addCommand(packCommand)
program.addCommand(devCommand)

program.parse()
