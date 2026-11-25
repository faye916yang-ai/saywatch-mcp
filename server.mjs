#!/usr/bin/env node
// saywatch-mcp：让 Claude Code、Cursor、Claude 桌面版等 AI 工具读取 SayWatch（抬手录）同步到电脑的文字。
// 零依赖，只读本地文件夹，不联网。协议：MCP（JSON-RPC 2.0，stdio，每行一条消息）。
//
// 用法：
//   npx -y saywatch-mcp                       # 默认读 iCloud 云盘/SayWatch
//   npx -y saywatch-mcp --dir "/path/to/folder"
//   或环境变量 SAYWATCH_DIR=/path/to/folder

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const VERSION = "0.1.1";
const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_DIR = join(homedir(), "Library/Mobile Documents/com~apple~CloudDocs/SayWatch");

function resolveRoot(argv) {
  const i = argv.indexOf("--dir");
  if (i !== -1 && argv[i + 1]) return argv[i + 1].replace(/^~(?=\/|$)/, homedir());
  if (process.env.SAYWATCH_DIR) return process.env.SAYWATCH_DIR.replace(/^~(?=\/|$)/, homedir());
  return DEFAULT_DIR;
}

const ROOT = resolveRoot(process.argv.slice(2));
const REC_DIR = join(ROOT, "recordings");

// ---------- 读取数据 ----------

async function loadAll() {
  if (!existsSync(REC_DIR)) return { recordings: [], missing: true, notDownloaded: 0 };
  const names = await readdir(REC_DIR);

  // iCloud “优化存储”会把文件变成 .xxx.json.icloud 占位符：触发下载，并告诉 AI 有多少还没下来。
  const placeholders = names.filter((n) => n.startsWith(".") && n.endsWith(".json.icloud"));
  for (const p of placeholders) {
    execFile("brctl", ["download", join(REC_DIR, p)], () => {});
  }

  const recordings = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    try {
      const raw = JSON.parse(await readFile(join(REC_DIR, name), "utf8"));
      if (raw.version !== 1) continue;
      recordings.push({
        id: raw.id,
        start: new Date(raw.start),
        end: new Date(raw.end),
        duration: raw.duration,
        language: raw.language,
        summary: raw.summary ?? null,
        marks: (raw.marks ?? []).map((d) => new Date(d)),
        lines: (raw.lines ?? []).map((l) => ({ time: new Date(l.time), text: l.text })),
      });
    } catch {
      // 正在同步写入的文件可能读到一半，跳过即可。
    }
  }
  recordings.sort((a, b) => a.start - b.start);
  return { recordings, missing: false, notDownloaded: placeholders.length };
}

// ---------- 格式化 ----------

const dayKey = (d) => d.toLocaleDateString("sv-SE"); // 本地时区的 YYYY-MM-DD
const clock = (d) => d.toLocaleTimeString("sv-SE"); // 本地时区的 HH:MM:SS
const hm = (d) => clock(d).slice(0, 5);

function duration(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

function header(r) {
  const marks = r.marks.length ? `, ${r.marks.length} mark(s)` : "";
  return `${dayKey(r.start)} ${hm(r.start)}–${hm(r.end)} (${duration(r.duration)}${marks}) id=${r.id}`;
}

/** 全文：句子按时间排，标记以 ⚑ 插在对应位置。 */
function fullText(r) {
  const items = [
    ...r.lines.map((l) => ({ t: l.time, s: `[${clock(l.time)}] ${l.text}` })),
    ...r.marks.map((m) => ({ t: m, s: `[${clock(m)}] ⚑ MARK (the user flagged the moment from here as important)` })),
  ].sort((a, b) => a.t - b.t);
  let out = `## ${header(r)}\n`;
  if (r.summary) out += `Summary:\n${r.summary}\n\n`;
  out += items.length ? items.map((i) => i.s).join("\n") : "(no speech detected)";
  return out;
}

function parseDay(input) {
  const v = String(input ?? "today").trim().toLowerCase();
  const now = new Date();
  if (v === "today" || v === "今天" || v === "") return dayKey(now);
  if (v === "yesterday" || v === "昨天") return dayKey(new Date(now.getTime() - 86_400_000));
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw rpcError(-32602, `Invalid date "${input}". Use YYYY-MM-DD, "today" or "yesterday".`);
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n[Truncated: ${text.length - max} more characters. Use search_recordings or get_recording for a narrower view.]`;
}

function notice(data) {
  const notes = [];
  if (data.notDownloaded > 0) {
    notes.push(`Note: ${data.notDownloaded} recording file(s) are still in iCloud and not downloaded to this Mac yet; a download was requested, try again shortly.`);
  }
  return notes.length ? "\n\n" + notes.join("\n") : "";
}

function missingFolderText() {
  return `The SayWatch folder was not found at:\n${ROOT}\n\n` +
    `Ask the user to: (1) in the iPhone app, open Settings > "让电脑上的 AI 读取录音" (Let AI on your computer read recordings) and choose a sync folder ` +
    `(recommended: iCloud Drive/SayWatch); (2) make sure it has synced to this Mac. ` +
    `If the folder is elsewhere, start this server with --dir "<path>".`;
}

// ---------- 工具 ----------

const tools = [
  {
    name: "list_recordings",
    description:
      "List the user's Apple Watch voice recordings (most recent first) with time range, length, number of marks and a preview. " +
      "Use this to see what was recorded on which days. Transcripts are usually Chinese or English.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Earliest day, YYYY-MM-DD (inclusive). Optional." },
        to: { type: "string", description: "Latest day, YYYY-MM-DD (inclusive). Optional." },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 30 },
      },
    },
    run: async ({ from, to, limit = 30 }, data) => {
      const f = from ? parseDay(from) : null;
      const t = to ? parseDay(to) : null;
      const list = data.recordings
        .filter((r) => (!f || dayKey(r.start) >= f) && (!t || dayKey(r.start) <= t))
        .reverse()
        .slice(0, limit);
      if (!list.length) return "No recordings in that range.";
      return list
        .map((r) => {
          const preview = (r.summary ?? r.lines.slice(0, 3).map((l) => l.text).join(" ")).slice(0, 120);
          return `- ${header(r)}\n  ${preview || "(no speech detected)"}`;
        })
        .join("\n");
    },
  },
  {
    name: "search_recordings",
    description:
      "Full-text search over everything the user said in their recordings. All whitespace-separated terms must appear in a sentence " +
      "(case-insensitive). Returns matching sentences with timestamps, recording id and surrounding context. " +
      "Search in the language the user spoke (often Chinese); try synonyms if nothing is found.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords, e.g. \"预算 周五\"" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        context: { type: "integer", minimum: 0, maximum: 5, default: 1, description: "Sentences of context before/after each hit." },
      },
      required: ["query"],
    },
    run: async ({ query, limit = 20, context = 1 }, data) => {
      const terms = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) throw rpcError(-32602, "query must not be empty");
      const blocks = [];
      let hits = 0;
      for (const r of [...data.recordings].reverse()) {
        r.lines.forEach((line, i) => {
          if (hits >= limit) return;
          const text = line.text.toLowerCase();
          if (!terms.every((t) => text.includes(t))) return;
          hits++;
          const ctx = r.lines
            .slice(Math.max(0, i - context), i + context + 1)
            .map((l) => `${l === line ? ">" : " "} [${clock(l.time)}] ${l.text}`)
            .join("\n");
          blocks.push(`### ${dayKey(line.time)} ${hm(line.time)} (id=${r.id})\n${ctx}`);
        });
        if (hits >= limit) break;
      }
      if (!hits) return `No sentences contain all of: ${terms.join(", ")}.`;
      return `${hits} match(es)${hits >= limit ? " (limit reached)" : ""}:\n\n` + blocks.join("\n\n");
    },
  },
  {
    name: "get_recording",
    description: "Get the full transcript of one recording by id (from list_recordings or search_recordings), with timestamps and the user's marks (⚑).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        max_chars: { type: "integer", minimum: 1000, default: 60000 },
      },
      required: ["id"],
    },
    run: async ({ id, max_chars = 60000 }, data) => {
      const r = data.recordings.find((x) => x.id === id);
      if (!r) return `No recording with id "${id}". Use list_recordings to see available ids.`;
      return truncate(fullText(r), max_chars);
    },
  },
  {
    name: "get_day",
    description:
      "Get all transcripts from one day in time order — use for questions like \"what did I discuss today\" or \"summarize yesterday\". " +
      "Long days are truncated; then use search_recordings or get_recording.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, \"today\" or \"yesterday\". Default today (local time).", default: "today" },
        max_chars: { type: "integer", minimum: 1000, default: 60000 },
      },
    },
    run: async ({ date, max_chars = 60000 }, data) => {
      const key = parseDay(date);
      const list = data.recordings.filter((r) => dayKey(r.start) === key);
      if (!list.length) return `No recordings on ${key}.`;
      return truncate(`${list.length} recording(s) on ${key}:\n\n` + list.map(fullText).join("\n\n"), max_chars);
    },
  },
  {
    name: "get_marked_moments",
    description:
      "Get what was said around each moment the user flagged on their watch (the user taps \"mark\" when something important is said; " +
      "the mark is already placed ~30s before the tap). Usually the most important parts of a day.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, \"today\" or \"yesterday\". Ignored if id is given. Default today." },
        id: { type: "string", description: "Limit to one recording." },
        seconds_after: { type: "integer", minimum: 10, maximum: 600, default: 90 },
      },
    },
    run: async ({ date, id, seconds_after = 90 }, data) => {
      const list = id
        ? data.recordings.filter((r) => r.id === id)
        : data.recordings.filter((r) => dayKey(r.start) === parseDay(date));
      const blocks = [];
      for (const r of list) {
        for (const m of r.marks) {
          const from = m.getTime() - 10_000;
          const to = m.getTime() + seconds_after * 1000;
          const lines = r.lines.filter((l) => l.time.getTime() >= from && l.time.getTime() <= to);
          blocks.push(
            `### ⚑ ${dayKey(m)} ${clock(m)} (id=${r.id})\n` +
              (lines.length ? lines.map((l) => `[${clock(l.time)}] ${l.text}`).join("\n") : "(no speech around this mark)"),
          );
        }
      }
      if (!blocks.length) return "No marked moments found.";
      return `${blocks.length} marked moment(s):\n\n` + blocks.join("\n\n");
    },
  },
];

// ---------- JSON-RPC / MCP ----------

function rpcError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

async function handle(method, params) {
  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      return {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "saywatch", version: VERSION },
        instructions:
          "Read-only access to the user's Apple Watch voice recordings, transcribed on their iPhone. " +
          "Timestamps are in the user's local time. Transcripts may contain recognition errors. " +
          "Quote timestamps when citing what was said.",
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case "tools/call": {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) throw rpcError(-32602, `Unknown tool: ${params?.name}`);
      const data = await loadAll();
      if (data.missing) return { content: [{ type: "text", text: missingFolderText() }], isError: true };
      try {
        const text = await tool.run(params.arguments ?? {}, data);
        return { content: [{ type: "text", text: text + notice(data) }] };
      } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
    default:
      throw rpcError(-32601, `Method not found: ${method}`);
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // 通知，无需回复
  try {
    send({ jsonrpc: "2.0", id: msg.id, result: await handle(msg.method, msg.params ?? {}) });
  } catch (e) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: e.code ?? -32603, message: e.message } });
  }
});

process.stderr.write(`saywatch-mcp ${VERSION} reading ${ROOT}\n`);
