/**
 * Local JD store — append-only JSONL files + in-memory index.
 *
 * Zero dependencies, auditable (one record per line), sized for hundreds of
 * JDs. Latest line wins on load, so updates are plain appends. The repository
 * surface is small on purpose: a SQLite backend can swap in behind the same
 * methods if the corpus outgrows this.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JdRecord, JobReport, JdTags } from './schema.js';
import type { Logger } from '../logger.js';

const JDS_FILE = 'jds.jsonl';
const REPORTS_FILE = 'reports.jsonl';

export interface TagSearchFilters {
  techStack?: string[];
  /** All listed flags must be present. */
  riskFlags?: string[];
  /** Records carrying ANY listed flag are excluded (user wants to avoid). */
  excludeRiskFlags?: string[];
  workHours?: string;
  degreeReq?: string;
  yearsReq?: string;
  remote?: boolean;
}

export class JdStore {
  private readonly records = new Map<string, JdRecord>();
  private readonly reports = new Map<string, JobReport[]>();
  private readonly jdsPath: string;
  private readonly reportsPath: string;

  constructor(
    private readonly dataDir: string,
    private readonly log: Logger,
  ) {
    mkdirSync(dataDir, { recursive: true });
    this.jdsPath = join(dataDir, JDS_FILE);
    this.reportsPath = join(dataDir, REPORTS_FILE);
    this.load();
  }

  get size(): number {
    return this.records.size;
  }

  /** Inserts or overwrites (same jobUid re-captured keeps the latest). */
  save(record: JdRecord): void {
    this.records.set(record.jobUid, record);
    appendFileSync(this.jdsPath, `${JSON.stringify(record)}\n`, 'utf8');
    this.log.debug(`store: saved ${record.jobUid} (${this.records.size} total)`);
  }

  updateTags(jobUid: string, tags: JdTags): void {
    const record = this.records.get(jobUid);
    if (!record) throw new Error(`Unknown jobUid: ${jobUid}`);
    const updated: JdRecord = { ...record, tags, taggedAt: new Date().toISOString() };
    this.records.set(jobUid, updated);
    appendFileSync(this.jdsPath, `${JSON.stringify(updated)}\n`, 'utf8');
  }

  findByUid(jobUid: string): JdRecord | undefined {
    return this.records.get(jobUid);
  }

  listRecent(limit = 20): JdRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      .slice(0, limit);
  }

  addReport(jobUid: string, report: Omit<JobReport, 'ts'>): JobReport {
    const stored: JobReport = { ...report, ts: new Date().toISOString() };
    const list = this.reports.get(jobUid) ?? [];
    list.push(stored);
    this.reports.set(jobUid, list);
    appendFileSync(this.reportsPath, `${JSON.stringify({ jobUid, ...stored })}\n`, 'utf8');
    return stored;
  }

  getReports(jobUid: string): JobReport[] {
    return this.reports.get(jobUid) ?? [];
  }

  /** Tag-based coarse filter (semantic search Phase 2a builds on this). */
  searchByTags(filters: TagSearchFilters): JdRecord[] {
    const tech = filters.techStack ?? [];
    const risk = filters.riskFlags ?? [];
    const excludeRisk = filters.excludeRiskFlags ?? [];
    return [...this.records.values()].filter((r) => {
      const tags = r.tags;
      if (!tags) return false;
      if (tech.length > 0 && !tech.every((t) => tags.techStack.includes(t))) return false;
      if (risk.length > 0 && !risk.every((f) => tags.riskFlags.includes(f))) return false;
      if (excludeRisk.length > 0 && excludeRisk.some((f) => tags.riskFlags.includes(f))) return false;
      if (filters.workHours && tags.workHours !== filters.workHours) return false;
      if (filters.degreeReq && tags.degreeReq !== filters.degreeReq) return false;
      if (filters.yearsReq && tags.yearsReq !== filters.yearsReq) return false;
      if (filters.remote === true && tags.remote !== true) return false;
      return true;
    });
  }

  private load(): void {
    this.loadJds();
    this.loadReports();
  }

  private loadJds(): void {
    if (!existsSync(this.jdsPath)) return;
    for (const line of readFileSync(this.jdsPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as JdRecord;
        this.records.set(record.jobUid, record); // latest line wins
      } catch (err) {
        this.log.warn(`store: skipping corrupt line in ${JDS_FILE}: ${(err as Error).message}`);
      }
    }
  }

  private loadReports(): void {
    if (!existsSync(this.reportsPath)) return;
    for (const line of readFileSync(this.reportsPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const { jobUid, ...report } = JSON.parse(line) as JobReport & { jobUid: string };
        const list = this.reports.get(jobUid) ?? [];
        list.push(report);
        this.reports.set(jobUid, list);
      } catch (err) {
        this.log.warn(`store: skipping corrupt line in ${REPORTS_FILE}: ${(err as Error).message}`);
      }
    }
  }
}
