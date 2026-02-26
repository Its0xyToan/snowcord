# Snowcord

Snowcord is a Discord framework built on top of Discordeno, with file-based command/event loading and a worker runtime for shard/process scaling.

## Features

- File-based commands and events
- Auto command sync to Discord
- Worker runtime (gateway/rest/bot process split)
- Hot reload flows (`update:lazy`, `update:full`)
- Optional Redis-backed cache

## Requirements

- Node.js 20+
- pnpm (recommended in this repo)
- A Discord bot token

## Installation

If you are using this repository directly:

```bash
pnpm install
pnpm build
```

If you use Snowcord as a dependency in another project:

```bash
pnpm add snowcord @discordeno/bot
```

## Quick Start

Create a config file in one of these paths:

- `snowcord.ts`
- `snowcord.config.ts`
- `src/snowcord.ts`
- `src/snowcord.config.ts`

Example `snowcord.ts`:

```ts
import { defineSnowcordConfig, Intents } from "snowcord";

defineSnowcordConfig({
  intents: Intents.Guilds | Intents.GuildMessages,
});
```

Create a command file (`commands/ping.ts`):

```ts
import { defineSnowcordCommand } from "snowcord";

export default defineSnowcordCommand({
  description: "Ping command",
  async execute(interaction) {
    await interaction.respond("Pong!");
  },
});
```

Create an event file (`events/ready.ts`):

```ts
import { defineSnowcordEvent } from "snowcord";

export default defineSnowcordEvent("ready", (_payload, _bot, _context) => {
  console.log("Bot is ready");
});
```

Create `.env`:

```env
SC_BOT_TOKEN=your_bot_token_here
```

Run:

```bash
snowcord dev
```

## Folder Conventions

Use one style only:

1. Root style:
   - `commands/*`
   - `events/*`
2. Bot-prefixed style:
   - `bot/commands/*`
   - `bot/events/*`

Do not mix both styles in the same project.

### Commands

- `commands/ping.ts` -> command name `ping`
- `commands/admin/ban.ts` -> command group `admin`, subcommand `ban`
- Files starting with `_` are ignored for command naming
- Default export is required

Each command can define:

- `description`
- `options`
- `guilds` (for guild-only command registration)
- `actions` (static interaction handlers by `custom_id`)
- `execute(interaction, context)`

### Events

- `events/messageCreate.ts` -> event `messageCreate`
- Default export can be:
  - event handler function, or
  - `{ execute: handler }`
- Files starting with `_` are ignored

## CLI

```bash
snowcord <start|dev|build> [--cwd <path>]
```

- `build`: builds project into `.snowcord/build`
- `start`: build + run runtime
- `dev`: watch mode + automatic reload

### Runtime Terminal Commands

When `start` or `dev` is running, you can type:

- `update:lazy`
- `update:full` (alias: `restart:cluster`)
- `restart:worker {workerId}`
- `restart:shard {shardId}`
- `count:shard`
- `count:worker`
- `count:cluster`

## Worker Runtime

Enable worker mode in config:

```ts
import { defineSnowcordConfig, Intents } from "snowcord";

defineSnowcordConfig({
  intents: Intents.Guilds | Intents.GuildMessages,
  workers: {
    enabled: true,
    totalShards: "auto",
    botWorkers: "auto",
    clusters: [{ id: "cluster-a" }],
  },
});
```

Useful worker options:

- `totalShards`: number or `"auto"`
- `botWorkers`: `"auto"`, number, or explicit worker map
- `clusters`: manual cluster layout
- `shardsPerWorker`, `totalWorkers`
- `restHost`, `restPort`
- `resharding.*`

For multi-cluster process launching, set:

```env
SC_CLUSTER_ID=cluster-a
```

## Cache Configuration

Env-based cache settings:

```env
SC_CACHE_PROVIDER=memory
SC_REDIS_URL=redis://127.0.0.1:6379
SC_REDIS_KEY_PREFIX=snowcord:cache
```

You can also configure cache in `defineSnowcordConfig({ cache: ... })`.

If `SC_CACHE_PROVIDER=redis`, install redis client:

```bash
pnpm add redis
```

## Environment Variables

- `SC_BOT_TOKEN` (required to run bot/workers)
- `SC_CACHE_PROVIDER` (`memory` or `redis`)
- `SC_REDIS_URL`
- `SC_REDIS_KEY_PREFIX`
- `SC_CLUSTER_ID` (optional cluster selection)

## Notes

- Snowcord writes build and command snapshots under `.snowcord/`.
- Consider adding `.snowcord` to `.gitignore` in your bot projects.
