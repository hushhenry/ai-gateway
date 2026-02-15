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

program.command('doctor')
  .description('Validate all configured providers (connectivity + tool calling)')
  .option('-p, --port <number>', 'Gateway port', '8192')
  .option('--provider <id>', 'Test a specific provider only')
  .option('-e, --endpoint <type>', 'Endpoint to test: chat, messages, or both', 'chat')
  .option('-v, --verbose', 'Show error details on failure')
  .action(async (opts) => {
    const { runDoctor } = await import('./cli/doctor.js');
    await runDoctor({
      port: parseInt(opts.port),
      provider: opts.provider,
      endpoint: opts.endpoint,
      verbose: opts.verbose,
    });
  });

program.parse();
