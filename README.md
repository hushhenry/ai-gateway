# AI Gateway

A TypeScript AI proxy supporting CLI and Library modes, built with Vercel AI SDK.
Designed to be compatible with `pi-mono` authentication storage.

## Installation

```bash
npm install -g ai-gateway
```

## Usage

### CLI

Start the server:
```bash
ai-gateway serve --port 8080
```

The server provides OpenAI-compatible endpoints:
- `POST /v1/chat/completions`
- `GET /v1/models`

### Library

```typescript
import { AiGateway } from 'ai-gateway';

const gateway = new AiGateway();
// Use gateway.fetch with your Hono/Node server
```

## Configuration

Credentials are looked up in:
1. `~/.config/ai-gateway/auth.json`
2. `~/.config/pi/auth.json`

Format:
```json
{
  "openai": {
    "apiKey": "sk-..."
  },
  "anthropic": {
    "apiKey": "sk-ant-..."
  }
}
```
