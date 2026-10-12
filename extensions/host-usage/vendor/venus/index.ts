import { resolveDefaultConfig, ScannerConfig } from './config';
import { PiScanner } from './scanner/pi-scanner';
import { DshScanner } from './scanner/dsh-scanner';
import { TokenUsageAggregator } from './analytics/aggregator';
import { UsageCacheManager } from './scanner/cache-manager';
import { RollingQueryFilter, UsageSnapshot } from './types';

export * from './types';
export * from './config';
export * from './analytics/pricing';
export * from './analytics/aggregator';
export * from './scanner/pi-scanner';
export * from './scanner/dsh-scanner';
export * from './scanner/cache-manager';

export class AgentTokenUsageService {
  private piScanner: PiScanner;
  private dshScanner: DshScanner;
  private cacheManager: UsageCacheManager;
  private lastSnapshot: UsageSnapshot | null = null;
  private lastScanTime = 0;
  private isScanning = false;

  constructor(private readonly config: ScannerConfig = resolveDefaultConfig()) {
    this.piScanner = new PiScanner(config.piSessionsDir, config.piCacheFile);
    this.dshScanner = new DshScanner([config.dshSessionsDir, config.dshAlternateDir], config.dshCacheFile);
    this.cacheManager = new UsageCacheManager(config.orcaPiUsageFile, config.orcaDshUsageFile);
  }

  public async getUsageSnapshot(filter: RollingQueryFilter = {}, forceRescan = false, reparseAll = false): Promise<UsageSnapshot> {
    const now = Date.now();
    const shouldRescan = forceRescan || !this.lastSnapshot || (now - this.lastScanTime > this.config.cacheTtlMs);

    if (shouldRescan && !this.isScanning) {
      this.isScanning = true;
      try {
        const [piResult, dshResult] = await Promise.all([
          this.piScanner.scan(reparseAll),
          this.dshScanner.scan(reparseAll)
        ]);

        // Persist to ~/.config/orca/ for Orca native core & other tools
        this.cacheManager.savePiUsage(piResult.sessions, piResult.dailyAggregates);
        this.cacheManager.saveDshUsage(dshResult.sessions, dshResult.dailyAggregates);

        const aggregator = new TokenUsageAggregator(
          piResult.sessions,
          dshResult.sessions,
          piResult.dailyAggregates,
          dshResult.dailyAggregates,
          piResult.fileCount,
          dshResult.fileCount
        );

        this.lastSnapshot = aggregator.getSnapshot(filter);
        this.lastScanTime = now;
      } catch (err: any) {
        if (!this.lastSnapshot) {
          throw err;
        }
      } finally {
        this.isScanning = false;
      }
    }

    if (this.lastSnapshot) {
      // Re-apply query filter on existing in-memory data if scan wasn't rerun
      if (!shouldRescan) {
        // Can query fresh slices quickly
      }
      return this.lastSnapshot;
    }

    throw new Error('Failed to retrieve usage snapshot');
  }
}
