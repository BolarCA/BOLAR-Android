/**
 * Virus scan boundary (Day 26 "virus scan placeholder interface").
 * Production wires ClamAV / a managed scanner behind this interface; the MVP implementation
 * accepts every object and records `clean`. The result is persisted on DocumentVersion.scanStatus
 * and MediaAsset.status so a real scanner can be dropped in without touching the modules.
 */
export type ScanVerdict = 'clean' | 'infected' | 'skipped';

export interface ScanResult { verdict: ScanVerdict; engine: string; signature?: string }

export interface VirusScanner {
  readonly name: string;
  scan(input: { key: string; body?: Buffer; mimeType: string; sizeBytes: number }): Promise<ScanResult>;
}

export class NoopVirusScanner implements VirusScanner {
  readonly name = 'noop';
  async scan(): Promise<ScanResult> {
    return { verdict: 'clean', engine: this.name };
  }
}

let current: VirusScanner = new NoopVirusScanner();

export function virusScanner(): VirusScanner {
  return current;
}

/** Tests and future production wiring swap the scanner here. */
export function setVirusScanner(scanner: VirusScanner): void {
  current = scanner;
}
