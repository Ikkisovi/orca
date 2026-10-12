import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { AgentSession, DailyAggregate, SessionTurn, TokenUsage } from '../types';
import { calculateCost } from '../analytics/pricing';

function getLocalDay(timestamp: number | string | Date): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ProcessedDshFile {
  filePath: string;
  mtimeMs: number;
  size: number;
  sessions: AgentSession[];
  dailyAggregates: DailyAggregate[];
}

export class DshScanner {
  private cache: Map<string, ProcessedDshFile> = new Map();
  private cacheLoaded = false;

  constructor(
    private readonly searchDirs: string[],
    private readonly cacheFilePath?: string
  ) {}

  private loadCache(): void {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    if (!this.cacheFilePath || !fs.existsSync(this.cacheFilePath)) return;
    try {
      const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.filePath) {
            this.cache.set(item.filePath, item);
          }
        }
      }
    } catch {
      // Ignore cache read errors, start fresh
    }
  }

  private saveCache(): void {
    if (!this.cacheFilePath) return;
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const items = Array.from(this.cache.values());
      const tmpPath = `${this.cacheFilePath}.tmp-${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(items), 'utf8');
      fs.renameSync(tmpPath, this.cacheFilePath);
    } catch (err) {
      console.error('[DshScanner] Failed to write disk cache:', err);
    }
  }

  public async scan(reparseAll = false): Promise<{ sessions: AgentSession[]; dailyAggregates: DailyAggregate[]; fileCount: number }> {
    this.loadCache();
    const files = this.discoverFiles();
    const currentPaths = new Set(files);
    let cacheModified = false;

    const sessionsMap = new Map<string, AgentSession>();
    const dailyMap = new Map<string, DailyAggregate>();

    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        let processed = this.cache.get(filePath);

        if (reparseAll || !processed || processed.mtimeMs !== stat.mtimeMs || processed.size !== stat.size) {
          processed = this.parseDshSessionFile(filePath, stat.mtimeMs, stat.size);
          this.cache.set(filePath, processed);
          cacheModified = true;
        }

        for (const session of processed.sessions) {
          const existing = sessionsMap.get(session.sessionId);
          if (!existing) {
            sessionsMap.set(session.sessionId, { ...session });
          } else {
            this.mergeSession(existing, session);
          }
        }

        for (const daily of processed.dailyAggregates) {
          const key = `${daily.day}::${daily.backend}::${daily.model}::${daily.projectKey}`;
          const existing = dailyMap.get(key);
          if (!existing) {
            dailyMap.set(key, { ...daily });
          } else {
            this.mergeDaily(existing, daily);
          }
        }
      } catch (err) {
        throw new Error(`Cannot scan ${filePath}: ${String(err)}`);
      }
    }

    for (const cachedPath of this.cache.keys()) {
      if (!currentPaths.has(cachedPath)) {
        this.cache.delete(cachedPath);
        cacheModified = true;
      }
    }

    if (cacheModified) {
      this.saveCache();
    }

    const allSessions = Array.from(sessionsMap.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    const allDaily = Array.from(dailyMap.values()).sort((a, b) => b.day.localeCompare(a.day));

    return {
      sessions: allSessions,
      dailyAggregates: allDaily,
      fileCount: files.length
    };
  }

  private discoverFiles(): string[] {
    const files = new Set<string>();

    for (const rootDir of this.searchDirs) {
      if (!fs.existsSync(rootDir)) continue;

      const walk = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
            } else if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.jsonl.zstd'))) {
              files.add(fullPath);
            }
          }
        } catch (err) {
          throw new Error(`Cannot discover ${dir}: ${String(err)}`);
        }
      };

      walk(rootDir);
    }

    return Array.from(files);
  }

  private readFileContent(filePath: string): string {
    if (filePath.endsWith('.zstd')) {
      try {
        const header = Buffer.alloc(4);
        const fd = fs.openSync(filePath, 'r');
        let bytes = 0;
        try { bytes = fs.readSync(fd, header, 0, 4, 0); }
        finally { fs.closeSync(fd); }
        const magic = header.readUInt32LE(0);
        if (bytes !== 4 || (magic !== 0xfd2fb528 && (magic & 0xfffffff0) !== 0x184d2a50)) {
          throw new Error('Not a Zstandard frame');
        }
        return execFileSync("zstdcat", [filePath], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
      } catch (err) {
        throw new Error(`Cannot decompress ${filePath}: ${String(err)}`);
      }
    }
    return fs.readFileSync(filePath, 'utf8');
  }

  private parseDshSessionFile(filePath: string, mtimeMs: number, size: number): ProcessedDshFile {
    const rawContent = this.readFileContent(filePath);
    if (!rawContent) {
      return { filePath, mtimeMs, size, sessions: [], dailyAggregates: [] };
    }

    const lines = rawContent.split('\n');

    let sessionId = path.basename(path.dirname(filePath));
    if (sessionId.startsWith('--') || sessionId === 'sessions') {
      sessionId = path.basename(filePath).replace(/\.jsonl(\.zstd)?$/, '');
    }

    let sessionCwd = '';
    let firstTimestamp = mtimeMs;
    let lastTimestamp = mtimeMs;
    let currentModel = 'deepseek-v4-flash';
    let currentProvider = 'opencode';
    let lastUserPrompt = '';
    let parentSessionId: string | null = null;
    let agentPreset: string | undefined = undefined;
    let origin: string | undefined = undefined;

    const turns: SessionTurn[] = [];
    const dailyMap = new Map<string, DailyAggregate>();

    const totalUsage: TokenUsage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      totalTokens: 0
    };

    let turnIndex = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const obj = JSON.parse(line);

        if (obj.type === 'session') {
          if (obj.id) sessionId = obj.id;
          if (obj.cwd) sessionCwd = obj.cwd;
          if (obj.createdAt) {
            firstTimestamp = Number(obj.createdAt);
            lastTimestamp = Number(obj.createdAt);
          }
          if (obj.parentSession) parentSessionId = obj.parentSession;
          if (obj.origin) origin = obj.origin;
          if (obj.agentPreset) agentPreset = obj.agentPreset;
        } else if (obj.type === 'subagent/descriptor') {
          if (obj.data?.agentModel) currentModel = obj.data.agentModel;
          if (obj.data?.agentProvider) currentProvider = obj.data.agentProvider;
        } else if (obj.type === 'request/header') {
          const cfg = obj.data?.header?.config;
          if (cfg?.model) currentModel = cfg.model;
          if (cfg?.provider) currentProvider = cfg.provider;
        } else if (obj.type === 'agent/inbox/spliced') {
          const inserted = obj.data?.inserted;
          if (Array.isArray(inserted)) {
            for (const item of inserted) {
              if (item.role === 'user' && Array.isArray(item.content)) {
                const textBlock = item.content.find((c: any) => c.type === 'text');
                if (textBlock?.text) lastUserPrompt = String(textBlock.text).slice(0, 200);
              }
            }
          }
        } else if (obj.type === 'assistant/message' && obj.data?.usage) {
          turnIndex++;
          const u = obj.data.usage;
          const msgTime = obj.time ? Number(obj.time) : (obj.data?.timestamp || Date.now());

          if (firstTimestamp === mtimeMs || msgTime < firstTimestamp) {
            firstTimestamp = msgTime;
          }
          if (msgTime > lastTimestamp) {
            lastTimestamp = msgTime;
          }

          const model = obj.data?.message?.model || currentModel;
          const provider = obj.data?.message?.provider || currentProvider;

          const input = u.inputTokens || u.input || 0;
          const output = u.outputTokens || u.output || 0;
          const cacheRead = u.cacheReadTokens || u.cacheRead || 0;
          const cacheWrite = u.cacheWriteTokens || u.cacheWrite || 0;
          const reasoning = u.reasoningTokens || u.reasoning || 0;
          const total = u.totalTokens ?? (input + output + cacheRead + cacheWrite);

          const turnTokens: TokenUsage = {
            input,
            output,
            cacheRead,
            cacheWrite,
            reasoning,
            totalTokens: total
          };

          totalUsage.input += input;
          totalUsage.output += output;
          totalUsage.cacheRead += cacheRead;
          totalUsage.cacheWrite += cacheWrite;
          totalUsage.reasoning += reasoning;
          totalUsage.totalTokens += total;

          const turnCost = calculateCost(turnTokens, model);

          let assistantSnippet = '';
          const content = obj.data?.message?.content;
          if (typeof content === 'string') {
            assistantSnippet = content.slice(0, 200);
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: any) => b?.type === 'text');
            if (textBlock?.text) assistantSnippet = String(textBlock.text).slice(0, 200);
          }

          turns.push({
            turnIndex,
            timestamp: msgTime,
            model,
            provider,
            tokens: turnTokens,
            cost: turnCost,
            userPromptSnippet: lastUserPrompt || undefined,
            assistantSnippet: assistantSnippet || undefined
          });

          // Daily aggregation
          const day = getLocalDay(msgTime);
          const projectKey = sessionCwd ? path.basename(sessionCwd) : 'default';
          const projectLabel = sessionCwd || 'DSH Workspace';
          const fullModel = provider && provider !== 'opencode' ? `${provider}/${model}` : model;
          const dailyKey = `${day}::${fullModel}::${projectKey}`;

          let daily = dailyMap.get(dailyKey);
          if (!daily) {
            daily = {
              day,
              backend: 'dsh',
              model: fullModel,
              provider,
              projectKey,
              projectLabel,
              sessionCount: 0,
              turnCount: 0,
              tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 },
              costUsd: 0
            };
            dailyMap.set(dailyKey, daily);
          }

          daily.turnCount += 1;
          daily.tokens.input += input;
          daily.tokens.output += output;
          daily.tokens.cacheRead += cacheRead;
          daily.tokens.cacheWrite += cacheWrite;
          daily.tokens.reasoning += reasoning;
          daily.tokens.totalTokens += total;
          daily.costUsd += turnCost.totalCost;
        }
      } catch {
        // Ignore JSON error on malformed line
      }
    }

    const sessionCost = calculateCost(totalUsage, currentModel);
    const workspaceLabel = sessionCwd ? path.basename(sessionCwd) : 'DSH Workspace';

    for (const d of dailyMap.values()) {
      d.sessionCount = 1;
    }

    const session: AgentSession = {
      sessionId,
      backend: 'dsh',
      filePath,
      firstTimestamp,
      lastTimestamp,
      durationMs: Math.max(0, lastTimestamp - firstTimestamp),
      cwd: sessionCwd,
      workspaceLabel,
      gitBranch: null,
      model: currentProvider && currentProvider !== 'opencode' ? `${currentProvider}/${currentModel}` : currentModel,
      provider: currentProvider,
      turnCount: turns.length,
      tokens: totalUsage,
      cost: sessionCost,
      turns,
      origin: origin || 'dsh-session',
      parentSessionId,
      agentPreset
    };

    return {
      filePath,
      mtimeMs,
      size,
      sessions: turns.length > 0 ? [session] : [],
      dailyAggregates: Array.from(dailyMap.values())
    };
  }

  private mergeSession(target: AgentSession, incoming: AgentSession): void {
    target.turnCount += incoming.turnCount;
    target.tokens.input += incoming.tokens.input;
    target.tokens.output += incoming.tokens.output;
    target.tokens.cacheRead += incoming.tokens.cacheRead;
    target.tokens.cacheWrite += incoming.tokens.cacheWrite;
    target.tokens.reasoning += incoming.tokens.reasoning;
    target.tokens.totalTokens += incoming.tokens.totalTokens;
    target.cost.inputCost += incoming.cost.inputCost;
    target.cost.outputCost += incoming.cost.outputCost;
    target.cost.cacheReadCost += incoming.cost.cacheReadCost;
    target.cost.cacheWriteCost += incoming.cost.cacheWriteCost;
    target.cost.totalCost += incoming.cost.totalCost;
    target.turns.push(...incoming.turns);
    target.firstTimestamp = Math.min(target.firstTimestamp, incoming.firstTimestamp);
    target.lastTimestamp = Math.max(target.lastTimestamp, incoming.lastTimestamp);
    target.durationMs = Math.max(0, target.lastTimestamp - target.firstTimestamp);
  }

  private mergeDaily(target: DailyAggregate, incoming: DailyAggregate): void {
    target.sessionCount += incoming.sessionCount;
    target.turnCount += incoming.turnCount;
    target.tokens.input += incoming.tokens.input;
    target.tokens.output += incoming.tokens.output;
    target.tokens.cacheRead += incoming.tokens.cacheRead;
    target.tokens.cacheWrite += incoming.tokens.cacheWrite;
    target.tokens.reasoning += incoming.tokens.reasoning;
    target.tokens.totalTokens += incoming.tokens.totalTokens;
    target.costUsd += incoming.costUsd;
  }
}
