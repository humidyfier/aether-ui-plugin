import { QuarantinedDuplicateRecord, SourceRange } from '../models/ast.model';

export class AmbiguousDuplicateQuarantineException extends Error {
  constructor(
    public readonly uid: string,
    public readonly record: QuarantinedDuplicateRecord
  ) {
    super(
      `[AETHER QUARANTINE] Ambiguous Duplicate UID detected: "${uid}". Auto-resolution is forbidden. Element is quarantined across ${record.occurrences.length} occurrences.`
    );
    this.name = 'AmbiguousDuplicateQuarantineException';
  }
}

export interface UidOccurrence {
  filePath: string;
  tagName: string;
  componentScopeName: string;
  range: SourceRange;
}

export class QuarantineRegistry {
  private quarantined = new Map<string, QuarantinedDuplicateRecord>();
  private observedOccurrences = new Map<string, UidOccurrence[]>();

  /**
   * Registers a UID occurrence. If the UID was already observed in a different position
   * or file, it triggers the Ambiguous Duplicate Quarantine rule immediately.
   */
  public registerOccurrence(uid: string, occurrence: UidOccurrence): boolean {
    const list = this.observedOccurrences.get(uid) || [];

    const isIdentical = list.some(
      (occ) =>
        occ.filePath === occurrence.filePath &&
        occ.range.start.line === occurrence.range.start.line &&
        occ.range.start.column === occurrence.range.start.column
    );

    if (!isIdentical) {
      list.push(occurrence);
      this.observedOccurrences.set(uid, list);
    }

    if (list.length > 1) {
      // Ambiguous duplicate detected! Quarantine immediately.
      this.quarantine(
        uid,
        list,
        `Ambiguous Duplicate: UID "${uid}" detected across ${list.length} separate elements`
      );
      return true; // Is quarantined
    }

    return this.isQuarantined(uid);
  }

  /**
   * Quarantines a UID explicitly when a duplicate is found.
   */
  public quarantine(
    uid: string,
    occurrences: UidOccurrence[],
    reason = 'Multiple AST nodes share the same data-aether-uid without distinct identity'
  ): QuarantinedDuplicateRecord {
    const existing = this.quarantined.get(uid);
    if (existing) {
      existing.occurrences = occurrences;
      existing.status = 'ACTIVE';
      existing.reason = reason;
      return existing;
    }

    const record: QuarantinedDuplicateRecord = {
      uid,
      status: 'ACTIVE',
      detectedAt: new Date().toISOString(),
      occurrences,
      reason,
    };
    this.quarantined.set(uid, record);
    return record;
  }

  /**
   * Checks if a UID is quarantined.
   */
  public isQuarantined(uid: string): boolean {
    return this.quarantined.has(uid) && this.quarantined.get(uid)?.status === 'ACTIVE';
  }

  /**
   * Ensures UID is safe to mutate. Throws AmbiguousDuplicateQuarantineException if quarantined.
   * Zero auto-resolution rule!
   */
  public assertNotQuarantined(uid: string): void {
    const record = this.quarantined.get(uid);
    if (record && record.status === 'ACTIVE') {
      throw new AmbiguousDuplicateQuarantineException(uid, record);
    }
  }

  /**
   * Returns all active quarantined records.
   */
  public getQuarantinedRecords(): QuarantinedDuplicateRecord[] {
    return Array.from(this.quarantined.values());
  }

  /**
   * Explicitly resolve or clear quarantine after manual developer intervention.
   */
  public resolveQuarantine(uid: string): void {
    const record = this.quarantined.get(uid);
    if (record) {
      record.status = 'RESOLVED';
    }
  }

  public clear(): void {
    this.quarantined.clear();
    this.observedOccurrences.clear();
  }
}
