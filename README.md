# saywatch-mcp

[![faye916yang-ai/saywatch-mcp MCP server](https://glama.ai/mcp/servers/faye916yang-ai/saywatch-mcp/badges/score.svg)](https://glama.ai/mcp/servers/faye916yang-ai/saywatch-mcp)

Let Claude Code, Cursor, Claude desktop and other MCP clients search and read what you recorded on your Apple Watch with the SayWatch app.

Read-only, local files only, no network access, zero dependencies (Node.js 18+).

SayWatch is an all-day voice recorder for Apple Watch: start it in the morning, and your iPhone transcribes every conversation on-device. Get it on the [App Store](https://apps.apple.com/app/id6835668680).

## Before you start

In the SayWatch iPhone app: **Settings → Let AI on Your Computer Read Recordings → Choose Sync Folder**. We recommend a `SayWatch` folder in iCloud Drive.
The app writes transcripts (never audio) to `<folder>/recordings/*.json`.

## Install

Claude Code:

```bash
claude mcp add saywatch -- npx -y saywatch-mcp
```

Cursor (`~/.cursor/mcp.json`) or Claude desktop (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "saywatch": { "command": "npx", "args": ["-y", "saywatch-mcp"] }
  }
}
```

If your folder isn't `iCloud Drive/SayWatch`, pass `--dir "/path/to/folder"` or set `SAYWATCH_DIR`.

## Tools

| Tool | What it does |
|---|---|
| `list_recordings` | List recordings by time, optionally within a date range |
| `search_recordings` | Full-text search; all keywords must match; returns sentences with context |
| `get_recording` | Read one recording in full, including marks ⚑ |
| `get_day` | Read every recording from one day (defaults to today) |
| `get_marked_moments` | Read what was said around the moments you marked on your watch |

Then just ask your AI: "What did we decide in this morning's meeting?" or "Where did I mention the budget last week?"

## Development

```bash
node server.mjs --dir "/path/to/folder"
```

The server speaks MCP over stdin/stdout (one JSON-RPC message per line) and logs only to stderr.
The export format is `ExportedRecording` (version 1) in the iOS app's `Phone/FolderExport.swift`; keep both sides in sync.

## Publishing (maintainers)

Published on npm as `saywatch-mcp` (https://www.npmjs.com/package/saywatch-mcp); users run it with `npx -y saywatch-mcp`.

1. Change `server.mjs`, test with `node server.mjs --dir <folder with recordings/>`.
2. Bump `version` in `package.json` (0.1.1 → 0.1.2 …) and the two `version` fields in `server.json`; npm never accepts the same version twice.
3. In this folder run `npm publish`. The npm account has 2FA on, so it opens the browser to confirm.
4. Publish the listing to the official MCP Registry: `mcp-publisher login github`, then `mcp-publisher publish` (reads `server.json`).
5. The registry takes a few minutes to show the new version; check with `npm view saywatch-mcp version`.

If the terminal says `npm: command not found`, npm lives in `~/.local/bin` (already added to PATH in `~/.zshrc`).

## 中文说明

让 Claude Code、Cursor、Claude 桌面版等 AI 工具直接搜索你在 Apple Watch 上用「抬手录」录下的话。先在 iPhone 的「设置 → 让电脑上的 AI 读取录音 → 选择同步文件夹」开启同步，再按上面的命令安装即可。只读本地文件，不联网。

## License

MIT
