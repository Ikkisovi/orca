import * as fs from 'fs';
import * as path from 'path';
import { AgentSession, DailyAggregate, SessionTurn, TokenUsage } from '../types';
import { calculateCost } from '../analytics/pricing';

function getLocalDay(timestamp: number | string | Date): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ProcessedPiFile {
  filePath: string;
  mtimeMs: number;
  size: number;
  sessions: AgentSession[];
  dailyAggregates: DailyAggregate[];
}

export class PiScanner {
  private cache: Map<string, ProcessedPiFile> = new Map();
  private cacheLoaded = false;

  constructor(
    private readonly sessionsDir: string,
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
      console.error('[PiScanner] Failed to write disk cache:', err);
    }
  }

  public async scan(reparseAll = false): Promise<{ sessions: AgentSession[]; dailyAggregates: DailyAggregate[]; fileCount: number }> {
    if (!fs.existsSync(this.sessionsDir)) {
      return { sessions: [], dailyAggregates: [], fileCount: 0 };
    }

    this.loadCache();
    const files = this.discoverFiles(this.sessionsDir);
    const currentPaths = new Set(files);
    let cacheModified = false;

    const sessionsMap = new Map<string, AgentSession>();
    const dailyMap = new Map<string, DailyAggregate>();

    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        let processed = this.cache.get(filePath);

        if (reparseAll || !processed || processed.mtimeMs !== stat.mtimeMs || processed.size !== stat.size) {
          processed = this.parsePiSessionFile(filePath, stat.mtimeMs, stat.size);
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

  private discoverFiles(rootDir: string): string[] {
    const files: string[] = [];

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            files.push(fullPath);
          }
        }
      } catch (err) {
        throw new Error(`Cannot discover ${dir}: ${String(err)}`);
      }
    };

    walk(rootDir);
    return files;
  }

  private parsePiSessionFile(filePath: string, mtimeMs: number, size: number): ProcessedPiFile {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    let sessionId = path.basename(filePath, '.jsonl');
    let sessionCwd = '';
    let firstTimestamp = mtimeMs;
    let lastTimestamp = mtimeMs;
    let currentModel = 'unknown';
    let currentProvider = 'pi';
    let lastUserPrompt = '';
    let parentSessionId: string | null = null;
    let agentPreset: string | undefined = undefined;

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
          if (obj.timestamp) {
            const t = new Date(obj.timestamp).getTime();
            if (!isNaN(t)) {
              firstTimestamp = t;
              lastTimestamp = t;
            }
          }
          if (obj.parentSession) parentSessionId = obj.parentSession;
        } else if (obj.type === 'model_change') {
          if (obj.modelId) currentModel = obj.modelId;
          if (obj.provider) currentProvider = obj.provider;
        } else if (obj.type === 'session_info') {
          if (obj.name) agentPreset = obj.name;
        } else if (obj.type === 'message') {
          const msg = obj.message;
          const msgTimestamp = obj.timestamp ? new Date(obj.timestamp).getTime() : (msg?.timestamp || Date.now());

          if (firstTimestamp === mtimeMs || msgTimestamp < firstTimestamp) {
            firstTimestamp = msgTimestamp;
          }
          if (msgTimestamp > lastTimestamp) {
            lastTimestamp = msgTimestamp;
          }

          if (msg?.role === 'user') {
            if (typeof msg.content === 'string') {
              lastUserPrompt = msg.content.slice(0, 200);
            } else if (Array.isArray(msg.content)) {
              const textBlock = msg.content.find((b: any) => b?.type === 'text');
              if (textBlock?.text) lastUserPrompt = String(textBlock.text).slice(0, 200);
            }
          } else if (msg?.role === 'assistant' && msg?.usage) {
            turnIndex++;
            const u = msg.usage;
            const model = msg.model || currentModel;
            const provider = msg.provider || currentProvider;

            const input = u.input || u.inputTokens || u.promptTokens || 0;
            const output = u.output || u.outputTokens || u.completionTokens || 0;
            const cacheRead = u.cacheRead || u.cacheReadTokens || u.cachedInputTokens || 0;
            const cacheWrite = u.cacheWrite || u.cacheWriteTokens || 0;
            const reasoning = u.reasoning || u.reasoningTokens || u.reasoningOutputTokens || 0;
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
            if (typeof msg.content === 'string') {
              assistantSnippet = msg.content.slice(0, 200);
            } else if (Array.isArray(msg.content)) {
              const textBlock = msg.content.find((b: any) => b?.type === 'text');
              if (textBlock?.text) assistantSnippet = String(textBlock.text).slice(0, 200);
            }

            turns.push({
              turnIndex,
              timestamp: msgTimestamp,
              model,
              provider,
              tokens: turnTokens,
              cost: turnCost,
              userPromptSnippet: lastUserPrompt || undefined,
              assistantSnippet: assistantSnippet || undefined
            });

            // Daily rollup
            const day = getLocalDay(msgTimestamp);
            const projectKey = sessionCwd ? path.basename(sessionCwd) : 'default';
            const projectLabel = sessionCwd || 'Default Workspace';
            const fullModel = provider && provider !== 'pi' ? `${provider}/${model}` : model;
            const dailyKey = `${day}::${fullModel}::${projectKey}`;

            let daily = dailyMap.get(dailyKey);
            if (!daily) {
              daily = {
                day,
                backend: 'pi',
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
        }
      } catch {
        // Ignore single-line malformed JSON
      }
    }

    const sessionCost = calculateCost(totalUsage, currentModel);
    const workspaceLabel = sessionCwd ? path.basename(sessionCwd) : 'Pi Workspace';

    // Count 1 session for each daily bucket created
    for (const d of dailyMap.values()) {
      d.sessionCount = 1;
    }

    const session: AgentSession = {
      sessionId,
      backend: 'pi',
      filePath,
      firstTimestamp,
      lastTimestamp,
      durationMs: Math.max(0, lastTimestamp - firstTimestamp),
      cwd: sessionCwd,
      workspaceLabel,
      gitBranch: null,
      model: currentProvider && currentProvider !== 'pi' ? `${currentProvider}/${currentModel}` : currentModel,
      provider: currentProvider,
      turnCount: turns.length,
      tokens: totalUsage,
      cost: sessionCost,
      turns,
      origin: 'pi-agent',
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
