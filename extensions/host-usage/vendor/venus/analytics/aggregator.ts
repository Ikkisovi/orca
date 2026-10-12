import {
  AgentSession,
  DailyAggregate,
  DailyTrendPoint,
  ModelUsageStats,
  RollingQueryFilter,
  RollingTimeRange,
  TokenUsage,
  UsageSnapshot,
  UsageSummary,
  WorkspaceUsageStats
} from '../types';

export class TokenUsageAggregator {
  constructor(
    private readonly piSessions: AgentSession[],
    private readonly dshSessions: AgentSession[],
    private readonly piDaily: DailyAggregate[],
    private readonly dshDaily: DailyAggregate[],
    private readonly piFilesCount: number,
    private readonly dshFilesCount: number
  ) {}

  public getSnapshot(filter: RollingQueryFilter = {}): UsageSnapshot {
    const cutoffDate = this.resolveCutoffDate(filter);
    const backendFilter = filter.backend ?? 'all';
    const workspaceFilter = filter.workspace?.toLowerCase().trim();
    const modelFilter = filter.model?.toLowerCase().trim();
    const searchFilter = filter.search?.toLowerCase().trim();

    // 1. Filter sessions
    const allSessions = [
      ...(backendFilter === 'dsh' ? [] : this.piSessions),
      ...(backendFilter === 'pi' ? [] : this.dshSessions)
    ];

    const filteredSessions = allSessions.filter(session => {
      if (cutoffDate && session.lastTimestamp < cutoffDate.getTime()) {
        return false;
      }
      if (workspaceFilter && !session.cwd.toLowerCase().includes(workspaceFilter) && !session.workspaceLabel.toLowerCase().includes(workspaceFilter)) {
        return false;
      }
      if (modelFilter && !session.model.toLowerCase().includes(modelFilter)) {
        return false;
      }
      if (searchFilter) {
        const matchesId = session.sessionId.toLowerCase().includes(searchFilter);
        const matchesCwd = session.cwd.toLowerCase().includes(searchFilter);
        const matchesModel = session.model.toLowerCase().includes(searchFilter);
        const matchesPrompt = session.turns.some(t =>
          (t.userPromptSnippet && t.userPromptSnippet.toLowerCase().includes(searchFilter)) ||
          (t.assistantSnippet && t.assistantSnippet.toLowerCase().includes(searchFilter))
        );
        if (!matchesId && !matchesCwd && !matchesModel && !matchesPrompt) {
          return false;
        }
      }
      return true;
    });

    // Sort sessions
    const sortBy = filter.sortBy ?? 'date';
    const sortOrder = filter.sortOrder ?? 'desc';
    const multiplier = sortOrder === 'asc' ? 1 : -1;

    filteredSessions.sort((a, b) => {
      if (sortBy === 'tokens') {
        return (a.tokens.totalTokens - b.tokens.totalTokens) * multiplier;
      }
      if (sortBy === 'cost') {
        return (a.cost.totalCost - b.cost.totalCost) * multiplier;
      }
      if (sortBy === 'turns') {
        return (a.turnCount - b.turnCount) * multiplier;
      }
      if (sortBy === 'duration') {
        return (a.durationMs - b.durationMs) * multiplier;
      }
      // default 'date'
      return (a.lastTimestamp - b.lastTimestamp) * multiplier;
    });

    // 2. Filter daily aggregates
    const allDaily = [
      ...(backendFilter === 'dsh' ? [] : this.piDaily),
      ...(backendFilter === 'pi' ? [] : this.dshDaily)
    ];

    const cutoffDayStr = cutoffDate ? cutoffDate.toISOString().split('T')[0] : null;

    const filteredDaily = allDaily.filter(d => {
      if (cutoffDayStr && d.day < cutoffDayStr) return false;
      if (workspaceFilter && !d.projectLabel.toLowerCase().includes(workspaceFilter) && !d.projectKey.toLowerCase().includes(workspaceFilter)) return false;
      if (modelFilter && !d.model.toLowerCase().includes(modelFilter)) return false;
      return true;
    });

    // 3. Compute Summary
    const summary = this.buildSummary(filteredSessions, filteredDaily);

    // 4. Compute Daily Trends (with 7d rolling moving average)
    const dailyTrends = this.buildDailyTrends(filteredDaily);

    // 5. Compute Model Breakdown
    const modelBreakdown = this.buildModelBreakdown(filteredSessions, summary.totalTokens);

    // 6. Compute Workspace Breakdown
    const workspaceBreakdown = this.buildWorkspaceBreakdown(filteredSessions, summary.totalTokens);

    // 7. Paginate sessions for the view
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const paginatedSessions = filteredSessions.slice(offset, offset + limit);

    return {
      scanState: {
        lastScanTime: Date.now(),
        piFilesCount: this.piFilesCount,
        dshFilesCount: this.dshFilesCount,
        totalFilesCount: this.piFilesCount + this.dshFilesCount,
        isScanning: false,
        error: null
      },
      summary,
      dailyTrends,
      modelBreakdown,
      workspaceBreakdown,
      sessions: paginatedSessions,
      filteredSessionCount: filteredSessions.length
    };
  }

  private resolveCutoffDate(filter: RollingQueryFilter): Date | null {
    if (filter.startDate) {
      const d = new Date(filter.startDate);
      if (!isNaN(d.getTime())) return d;
    }

    const range: RollingTimeRange = filter.range ?? '30d';
    if (range === 'all') return null;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const daysMap: Record<RollingTimeRange, number> = {
      '24h': 1,
      '7d': 7,
      '14d': 14,
      '30d': 30,
      '60d': 60,
      '90d': 90,
      'all': 0,
      'custom': 30
    };

    const days = daysMap[range] ?? 30;
    now.setDate(now.getDate() - (days - 1));
    return now;
  }

  private buildSummary(sessions: AgentSession[], daily: DailyAggregate[]): UsageSummary {
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let reasoningTokens = 0;
    let totalCostUsd = 0;
    let totalTurns = 0;

    let piTokens = 0;
    let dshTokens = 0;
    let piSessions = 0;
    let dshSessions = 0;
    let piCostUsd = 0;
    let dshCostUsd = 0;

    const modelTokensMap = new Map<string, number>();
    const wsTokensMap = new Map<string, number>();
    const activeDaysSet = new Set<string>();

    for (const s of sessions) {
      if (s.backend === 'pi') {
        piSessions++;
        piTokens += s.tokens.totalTokens;
        piCostUsd += s.cost.totalCost;
      } else {
        dshSessions++;
        dshTokens += s.tokens.totalTokens;
        dshCostUsd += s.cost.totalCost;
      }

      totalTokens += s.tokens.totalTokens;
      inputTokens += s.tokens.input;
      outputTokens += s.tokens.output;
      cacheReadTokens += s.tokens.cacheRead;
      cacheWriteTokens += s.tokens.cacheWrite;
      reasoningTokens += s.tokens.reasoning;
      totalCostUsd += s.cost.totalCost;
      totalTurns += s.turnCount;

      modelTokensMap.set(s.model, (modelTokensMap.get(s.model) || 0) + s.tokens.totalTokens);
      const ws = s.workspaceLabel || 'Default';
      wsTokensMap.set(ws, (wsTokensMap.get(ws) || 0) + s.tokens.totalTokens);
    }

    for (const d of daily) {
      activeDaysSet.add(d.day);
    }

    const activeDays = Math.max(1, activeDaysSet.size);
    const totalSessions = sessions.length;

    const avgTokensPerTurn = totalTurns > 0 ? Math.round(totalTokens / totalTurns) : 0;
    const avgTokensPerDay = activeDays > 0 ? Math.round(totalTokens / activeDays) : 0;
    const avgTokensPerSession = totalSessions > 0 ? Math.round(totalTokens / totalSessions) : 0;
    const cacheDenominator = inputTokens + cacheReadTokens;
    const cacheHitRate = cacheDenominator > 0 ? Math.round((cacheReadTokens / cacheDenominator) * 10000) / 100 : 0;

    // Top model
    let topModel = 'None';
    let maxModelTokens = -1;
    for (const [m, tok] of modelTokensMap.entries()) {
      if (tok > maxModelTokens) {
        maxModelTokens = tok;
        topModel = m;
      }
    }

    // Top workspace
    let topWorkspace = 'None';
    let maxWsTokens = -1;
    for (const [w, tok] of wsTokensMap.entries()) {
      if (tok > maxWsTokens) {
        maxWsTokens = tok;
        topWorkspace = w;
      }
    }

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens,
      totalCostUsd: Math.round(totalCostUsd * 1000) / 1000,
      totalSessions,
      totalTurns,
      activeDays,
      avgTokensPerTurn,
      avgTokensPerDay,
      avgTokensPerSession,
      cacheHitRate,
      piTokens,
      dshTokens,
      piSessions,
      dshSessions,
      piCostUsd: Math.round(piCostUsd * 1000) / 1000,
      dshCostUsd: Math.round(dshCostUsd * 1000) / 1000,
      topModel,
      topWorkspace
    };
  }

  private buildDailyTrends(dailyAggregates: DailyAggregate[]): DailyTrendPoint[] {
    const dayMap = new Map<string, DailyTrendPoint>();

    for (const d of dailyAggregates) {
      let pt = dayMap.get(d.day);
      if (!pt) {
        pt = {
          day: d.day,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          costUsd: 0,
          turnCount: 0,
          sessionCount: 0,
          piTokens: 0,
          dshTokens: 0
        };
        dayMap.set(d.day, pt);
      }

      pt.totalTokens += d.tokens.totalTokens;
      pt.inputTokens += d.tokens.input;
      pt.outputTokens += d.tokens.output;
      pt.cacheReadTokens += d.tokens.cacheRead;
      pt.cacheWriteTokens += d.tokens.cacheWrite;
      pt.reasoningTokens += d.tokens.reasoning;
      pt.costUsd += d.costUsd;
      pt.turnCount += d.turnCount;
      pt.sessionCount += d.sessionCount;

      if (d.backend === 'pi') {
        pt.piTokens += d.tokens.totalTokens;
      } else {
        pt.dshTokens += d.tokens.totalTokens;
      }
    }

    const sortedDays = Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day));

    // Calculate rolling 7-day average & cumulative tokens
    let cumulative = 0;
    for (let i = 0; i < sortedDays.length; i++) {
      cumulative += sortedDays[i].totalTokens;
      sortedDays[i].cumulativeTokens = cumulative;
      sortedDays[i].costUsd = Math.round(sortedDays[i].costUsd * 1000) / 1000;

      // 7-day rolling window
      const windowStart = Math.max(0, i - 6);
      const windowItems = sortedDays.slice(windowStart, i + 1);
      const sum = windowItems.reduce((acc, curr) => acc + curr.totalTokens, 0);
      sortedDays[i].rolling7dAvgTokens = Math.round(sum / windowItems.length);
    }

    return sortedDays;
  }

  private buildModelBreakdown(sessions: AgentSession[], grandTotalTokens: number): ModelUsageStats[] {
    const map = new Map<string, ModelUsageStats>();

    for (const s of sessions) {
      let entry = map.get(s.model);
      if (!entry) {
        entry = {
          model: s.model,
          provider: s.provider,
          backend: s.backend,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          turnCount: 0,
          sessionCount: 0,
          costUsd: 0,
          percentOfTotal: 0
        };
        map.set(s.model, entry);
      }

      if (entry.backend !== s.backend && entry.backend !== 'mixed') {
        entry.backend = 'mixed';
      }

      entry.totalTokens += s.tokens.totalTokens;
      entry.inputTokens += s.tokens.input;
      entry.outputTokens += s.tokens.output;
      entry.cacheReadTokens += s.tokens.cacheRead;
      entry.cacheWriteTokens += s.tokens.cacheWrite;
      entry.reasoningTokens += s.tokens.reasoning;
      entry.turnCount += s.turnCount;
      entry.sessionCount += 1;
      entry.costUsd += s.cost.totalCost;
    }

    const result = Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
    for (const item of result) {
      item.percentOfTotal = grandTotalTokens > 0 ? Math.round((item.totalTokens / grandTotalTokens) * 10000) / 100 : 0;
      item.costUsd = Math.round(item.costUsd * 1000) / 1000;
    }

    return result;
  }

  private buildWorkspaceBreakdown(sessions: AgentSession[], grandTotalTokens: number): WorkspaceUsageStats[] {
    const map = new Map<string, WorkspaceUsageStats>();

    for (const s of sessions) {
      const key = s.cwd || 'default';
      let entry = map.get(key);
      if (!entry) {
        entry = {
          projectKey: key,
          projectLabel: s.workspaceLabel || key,
          cwd: s.cwd,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          turnCount: 0,
          sessionCount: 0,
          costUsd: 0,
          percentOfTotal: 0,
          piTokens: 0,
          dshTokens: 0
        };
        map.set(key, entry);
      }

      entry.totalTokens += s.tokens.totalTokens;
      entry.inputTokens += s.tokens.input;
      entry.outputTokens += s.tokens.output;
      entry.cacheReadTokens += s.tokens.cacheRead;
      entry.turnCount += s.turnCount;
      entry.sessionCount += 1;
      entry.costUsd += s.cost.totalCost;

      if (s.backend === 'pi') {
        entry.piTokens += s.tokens.totalTokens;
      } else {
        entry.dshTokens += s.tokens.totalTokens;
      }
    }

    const result = Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
    for (const item of result) {
      item.percentOfTotal = grandTotalTokens > 0 ? Math.round((item.totalTokens / grandTotalTokens) * 10000) / 100 : 0;
      item.costUsd = Math.round(item.costUsd * 1000) / 1000;
    }

    return result;
  }
}
