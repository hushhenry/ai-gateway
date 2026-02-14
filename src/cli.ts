#!/usr/bin/env node
import { Command } from 'commander';
import { serve } from '@hono/node-server';
import { AiGateway } from './core/gateway.js';

const program = new Command();

program
  .name('ai-gateway')
  .description('AI Proxy Gateway supporting Vercel AI SDK and various providers')
  .version('1.0.0');

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
