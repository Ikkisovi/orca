export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

export interface SessionTurn {
  turnIndex: number;
  timestamp: number;
  model: string;
  provider: string;
  tokens: TokenUsage;
  cost: CostBreakdown;
  userPromptSnippet?: string;
  assistantSnippet?: string;
  toolCallsCount?: number;
}

export interface AgentSession {
  sessionId: string;
  backend: 'pi' | 'dsh';
  filePath: string;
  firstTimestamp: number;
  lastTimestamp: number;
  durationMs: number;
  cwd: string;
  workspaceLabel: string;
  gitBranch: string | null;
  model: string;
  provider: string;
  turnCount: number;
  tokens: TokenUsage;
  cost: CostBreakdown;
  turns: SessionTurn[];
  origin?: string;
  parentSessionId?: string | null;
  agentPreset?: string;
}

export interface DailyAggregate {
  day: string; // YYYY-MM-DD
  backend: 'pi' | 'dsh';
  model: string;
  provider: string;
  projectKey: string;
  projectLabel: string;
  sessionCount: number;
  turnCount: number;
  tokens: TokenUsage;
  costUsd: number;
}

export type RollingTimeRange = '24h' | '7d' | '14d' | '30d' | '60d' | '90d' | 'all' | 'custom';

export interface RollingQueryFilter {
  range?: RollingTimeRange;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  backend?: 'pi' | 'dsh' | 'all';
  workspace?: string;
  model?: string;
  provider?: string;
  search?: string;
  sortBy?: 'tokens' | 'cost' | 'turns' | 'date' | 'duration';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ModelUsageStats {
  model: string;
  provider: string;
  backend: 'pi' | 'dsh' | 'mixed';
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  turnCount: number;
  sessionCount: number;
  costUsd: number;
  percentOfTotal: number;
}

export interface WorkspaceUsageStats {
  projectKey: string;
  projectLabel: string;
  cwd: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  turnCount: number;
  sessionCount: number;
  costUsd: number;
  percentOfTotal: number;
  piTokens: number;
  dshTokens: number;
}

export interface DailyTrendPoint {
  day: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  costUsd: number;
  turnCount: number;
  sessionCount: number;
  piTokens: number;
  dshTokens: number;
  rolling7dAvgTokens?: number;
  cumulativeTokens?: number;
}

export interface UsageSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalCostUsd: number;
  totalSessions: number;
  totalTurns: number;
  activeDays: number;
  avgTokensPerTurn: number;
  avgTokensPerDay: number;
  avgTokensPerSession: number;
  cacheHitRate: number;
  piTokens: number;
  dshTokens: number;
  piSessions: number;
  dshSessions: number;
  piCostUsd: number;
  dshCostUsd: number;
  topModel: string;
  topWorkspace: string;
}

export interface UsageSnapshot {
  scanState: {
    lastScanTime: number;
    piFilesCount: number;
    dshFilesCount: number;
    totalFilesCount: number;
    isScanning: boolean;
    error: string | null;
  };
  summary: UsageSummary;
  dailyTrends: DailyTrendPoint[];
  modelBreakdown: ModelUsageStats[];
  workspaceBreakdown: WorkspaceUsageStats[];
  sessions: AgentSession[];
  filteredSessionCount: number;
}
