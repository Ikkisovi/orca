import * as fs from 'fs';
import * as path from 'path';
import { AgentSession, DailyAggregate } from '../types';

export interface OrcaPersistedUsageState {
  schemaVersion: number;
  worktreeFingerprint: string | null;
  processedFiles?: any[];
  sessions: any[];
  dailyAggregates: any[];
  scanState: {
    enabled: boolean;
    lastScanStartedAt: number | null;
    lastScanCompletedAt: number | null;
    lastScanError: string | null;
  };
}

export class UsageCacheManager {
  constructor(
    private readonly piUsageFilePath: string,
    private readonly dshUsageFilePath: string
  ) {}

  public savePiUsage(sessions: AgentSession[], daily: DailyAggregate[]): void {
    this.writeState(this.piUsageFilePath, {
      schemaVersion: 2,
      worktreeFingerprint: null,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        firstTimestamp: s.firstTimestamp,
        lastTimestamp: s.lastTimestamp,
        model: s.model,
        lastCwd: s.cwd,
        lastGitBranch: s.gitBranch,
        primaryWorktreeId: null,
        primaryRepoId: null,
        turnCount: s.turnCount,
        totalInputTokens: s.tokens.input,
        totalOutputTokens: s.tokens.output,
        totalCacheReadTokens: s.tokens.cacheRead,
        totalCacheWriteTokens: s.tokens.cacheWrite,
        totalReasoningOutputTokens: s.tokens.reasoning,
        totalTokens: s.tokens.totalTokens,
        estimatedCostUsd: s.cost.totalCost,
        locationBreakdown: [{
          cwd: s.cwd,
          gitBranch: s.gitBranch,
          worktreeId: null,
          repoId: null,
          turnCount: s.turnCount,
          inputTokens: s.tokens.input,
          outputTokens: s.tokens.output,
          cacheReadTokens: s.tokens.cacheRead,
          cacheWriteTokens: s.tokens.cacheWrite,
          reasoningTokens: s.tokens.reasoning
        }]
      })),
      dailyAggregates: daily.map(d => ({
        day: d.day,
        model: d.model,
        projectKey: d.projectKey,
        projectLabel: d.projectLabel,
        repoId: null,
        worktreeId: null,
        turnCount: d.turnCount,
        zeroCacheReadTurnCount: 0,
        inputTokens: d.tokens.input,
        outputTokens: d.tokens.output,
        cacheReadTokens: d.tokens.cacheRead,
        cacheWriteTokens: d.tokens.cacheWrite,
        reasoningTokens: d.tokens.reasoning,
        totalTokens: d.tokens.totalTokens,
        estimatedCostUsd: d.costUsd
      })),
      scanState: {
        enabled: true,
        lastScanStartedAt: Date.now() - 50,
        lastScanCompletedAt: Date.now(),
        lastScanError: null
      }
    });
  }

  public saveDshUsage(sessions: AgentSession[], daily: DailyAggregate[]): void {
    this.writeState(this.dshUsageFilePath, {
      schemaVersion: 2,
      worktreeFingerprint: null,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        firstTimestamp: s.firstTimestamp,
        lastTimestamp: s.lastTimestamp,
        model: s.model,
        lastCwd: s.cwd,
        lastGitBranch: s.gitBranch,
        primaryWorktreeId: null,
        primaryRepoId: null,
        turnCount: s.turnCount,
        totalInputTokens: s.tokens.input,
        totalOutputTokens: s.tokens.output,
        totalCacheReadTokens: s.tokens.cacheRead,
        totalCacheWriteTokens: s.tokens.cacheWrite,
        totalReasoningOutputTokens: s.tokens.reasoning,
        totalTokens: s.tokens.totalTokens,
        estimatedCostUsd: s.cost.totalCost,
        locationBreakdown: [{
          cwd: s.cwd,
          gitBranch: s.gitBranch,
          worktreeId: null,
          repoId: null,
          turnCount: s.turnCount,
          inputTokens: s.tokens.input,
          outputTokens: s.tokens.output,
          cacheReadTokens: s.tokens.cacheRead,
          cacheWriteTokens: s.tokens.cacheWrite,
          reasoningTokens: s.tokens.reasoning
        }]
      })),
      dailyAggregates: daily.map(d => ({
        day: d.day,
        model: d.model,
        projectKey: d.projectKey,
        projectLabel: d.projectLabel,
        repoId: null,
        worktreeId: null,
        turnCount: d.turnCount,
        zeroCacheReadTurnCount: 0,
        inputTokens: d.tokens.input,
        outputTokens: d.tokens.output,
        cacheReadTokens: d.tokens.cacheRead,
        cacheWriteTokens: d.tokens.cacheWrite,
        reasoningTokens: d.tokens.reasoning,
        totalTokens: d.tokens.totalTokens,
        estimatedCostUsd: d.costUsd
      })),
      scanState: {
        enabled: true,
        lastScanStartedAt: Date.now() - 50,
        lastScanCompletedAt: Date.now(),
        lastScanError: null
      }
    });
  }

  private writeState(filePath: string, state: OrcaPersistedUsageState): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${filePath}.tmp-${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      console.error(`[UsageCacheManager] Failed to write cache to ${filePath}:`, err);
    }
  }
}
