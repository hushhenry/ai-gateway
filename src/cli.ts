#!/usr/bin/env node
import { Command } from 'commander';
import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { AiGateway } from './core/gateway.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('ai-gateway')
  .description('AI Proxy Gateway supporting Vercel AI SDK and various providers')
  .version(pkg.version);

program.command('serve')
  .description('Start the AI Gateway server')
  .option('-p, --port <number>', 'Port to listen on', '3000')
  .action((options) => {
    const port = parseInt(options.port);
    console.log(`Starting AI Gateway on port ${port}...`);
    
    const gateway = new AiGateway();
    
    serve({
      fetch: gateway.fetch,
      port
    });
  });

program.command('login')
  .description('Configure providers (TUI)')
  .action(async () => {
    // @ts-ignore
    const { runLoginTui } = await import('./tui/settings.js');
    await runLoginTui();
  });

program.parse();
