import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface ScannerConfig {
  piSessionsDir: string;
  dshSessionsDir: string;
  dshAlternateDir: string;
  orcaUserDataDir: string;
  orcaPiUsageFile: string;
  orcaDshUsageFile: string;
  piCacheFile: string;
  dshCacheFile: string;
  cacheTtlMs: number;
}

const HOME = os.homedir();

export function resolveDefaultConfig(): ScannerConfig {
  const orcaUserDataDir = path.join(HOME, '.config', 'orca');
  const piSessionsDir = path.join(HOME, '.pi', 'agent', 'sessions');
  const dshSessionsDir = path.join(HOME, '.dsh', 'sessions');
  const dshAlternateDir = '/mnt/intel_ssd/ikkipipi_data/dsh_sessions';

  return {
    piSessionsDir,
    dshSessionsDir,
    dshAlternateDir,
    orcaUserDataDir,
    orcaPiUsageFile: path.join(orcaUserDataDir, 'orca-pi-usage.json'),
    orcaDshUsageFile: path.join(orcaUserDataDir, 'orca-dsh-usage.json'),
    piCacheFile: path.join(orcaUserDataDir, '.pi-session-cache.json'),
    dshCacheFile: path.join(orcaUserDataDir, '.dsh-session-cache.json'),
    cacheTtlMs: 15 * 1000 // 15s cache TTL for fast live polling
  };
}
