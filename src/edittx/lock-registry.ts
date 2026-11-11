import { randomUUID } from 'node:crypto';
import { Project, SyntaxKind, Node } from 'ts-morph';
import { PropertyGroup, UserLockRecord } from './models';

export class UserLockViolationException extends Error {
  constructor(
    public readonly targetUid: string,
    public readonly propertyGroup: PropertyGroup,
    public readonly lockRecord: UserLockRecord,
    detailMessage?: string
  ) {
    super(
      `[USER_LOCKED VIOLATION] Target element "${targetUid}" has locked property group "${propertyGroup}" (Source: ${lockRecord.source}). ${detailMessage || 'Mutation rejected to preserve user choice (BR-06).'}`
    );
    this.name = 'UserLockViolationException';
  }
}

export interface LockAuditEntry {
  action: 'LOCK' | 'UNLOCK' | 'RESET';
  targetUid: string;
  propertyGroup?: PropertyGroup;
  propertyKey?: string;
  source?: string;
  timestamp: string;
}

export class UserLockRegistry {
  private locks = new Map<string, UserLockRecord>(); // Key: `${targetUid}:${propertyGroup}`
  private auditLog: LockAuditEntry[] = [];
  private tsProject: Project;

  constructor() {
    this.tsProject = new Project({ useInMemoryFileSystem: true });
  }

  private makeKey(targetUid: string, group: PropertyGroup): string {
    return `${targetUid}:${group}`;
  }

  /**
   * Locks a property group on a target element.
   */
  public lock(
    targetUid: string,
    propertyGroup: PropertyGroup,
    semanticValue: string,
    source: UserLockRecord['source'] = 'user_direct_edit',
    propertyKey?: string
  ): UserLockRecord {
    const key = this.makeKey(targetUid, propertyGroup);
    const now = new Date().toISOString();

    const record: UserLockRecord = {
      id: randomUUID(),
      targetUid,
      propertyGroup,
      propertyKey,
      semanticValue,
      source,
      lockedAt: now,
      lastAuditedAt: now,
    };

    this.locks.set(key, record);
    this.auditLog.push({
      action: 'LOCK',
      targetUid,
      propertyGroup,
      propertyKey,
      source,
      timestamp: now,
    });

    return record;
  }

  /**
   * Checks if a property group is currently locked for a target UID.
   */
  public isLocked(targetUid: string, propertyGroup: PropertyGroup): boolean {
    return this.locks.has(this.makeKey(targetUid, propertyGroup));
  }

  public getLock(targetUid: string, propertyGroup: PropertyGroup): UserLockRecord | undefined {
    return this.locks.get(this.makeKey(targetUid, propertyGroup));
  }

  public getLocksForTarget(targetUid: string): UserLockRecord[] {
    const results: UserLockRecord[] = [];
    for (const record of this.locks.values()) {
      if (record.targetUid === targetUid) {
        results.push(record);
      }
    }
    return results;
  }

  public getAllLocks(): UserLockRecord[] {
    return Array.from(this.locks.values());
  }

  public getAuditLog(): ReadonlyArray<LockAuditEntry> {
    return [...this.auditLog];
  }

  /**
   * 1-Click auditable unlock for a specific property group.
   */
  public unlock(targetUid: string, propertyGroup: PropertyGroup): boolean {
    const key = this.makeKey(targetUid, propertyGroup);
    const existed = this.locks.delete(key);
    if (existed) {
      this.auditLog.push({
        action: 'UNLOCK',
        targetUid,
        propertyGroup,
        timestamp: new Date().toISOString(),
      });
    }
    return existed;
  }

  /**
   * 1-Click auditable reset: resets all locks for a specific target UID or all locks globally.
   */
  public reset(targetUid?: string): number {
    const now = new Date().toISOString();
    let count = 0;

    if (targetUid) {
      for (const [key, record] of Array.from(this.locks.entries())) {
        if (record.targetUid === targetUid) {
          this.locks.delete(key);
          count++;
        }
      }
      this.auditLog.push({
        action: 'RESET',
        targetUid,
        timestamp: now,
      });
    } else {
      count = this.locks.size;
      this.locks.clear();
      this.auditLog.push({
        action: 'RESET',
        targetUid: '*',
        timestamp: now,
      });
    }

    return count;
  }

  /**
   * Determines if a change is formatting-only vs a semantic AST mutation.
   * Compares the semantic AST representation. If classification is uncertain,
   * preserves the lock and returns false (meaning it cannot be assumed safe).
   */
  public isFormattingOnlyAstChange(oldCodeSnippet: string, newCodeSnippet: string): boolean {
    try {
      const file1 = this.tsProject.createSourceFile('temp_old.tsx', oldCodeSnippet, { overwrite: true });
      const file2 = this.tsProject.createSourceFile('temp_new.tsx', newCodeSnippet, { overwrite: true });

      // Compare AST kind sequence and semantic identifiers
      const nodes1 = file1.getDescendants();
      const nodes2 = file2.getDescendants();

      if (nodes1.length !== nodes2.length) {
        return false;
      }

      for (let i = 0; i < nodes1.length; i++) {
        const n1 = nodes1[i];
        const n2 = nodes2[i];

        if (n1.getKind() !== n2.getKind()) {
          return false;
        }

        // Check semantic token values (identifiers, string literals, numeric literals)
        if (
          Node.isIdentifier(n1) ||
          Node.isStringLiteral(n1) ||
          Node.isNumericLiteral(n1) ||
          Node.isJsxText(n1)
        ) {
          if (n1.getText().trim() !== n2.getText().trim()) {
            return false;
          }
        }
      }

      return true; // Semantic AST is identical; formatting-only
    } catch {
      // If classification is uncertain, preserve the lock and stop!
      return false;
    }
  }

  /**
   * Validates compliance with USER_LOCKED.
   * If property is locked and semantic change is detected, throws UserLockViolationException.
   */
  public assertCompliance(
    targetUid: string,
    attemptedPropertyGroup: PropertyGroup,
    oldValueSnippet: string,
    newValueSnippet: string,
    allowExplicitOverride = false
  ): void {
    if (allowExplicitOverride) return;

    const lock = this.getLock(targetUid, attemptedPropertyGroup);
    if (!lock) return;

    // Check if change is formatting-only via semantic AST comparison
    const isFormatting = this.isFormattingOnlyAstChange(oldValueSnippet, newValueSnippet);
    if (isFormatting) {
      // Semantic value is unchanged; formatting change is permitted
      return;
    }

    // Semantic change on locked property -> throw
    throw new UserLockViolationException(
      targetUid,
      attemptedPropertyGroup,
      lock,
      `Attempted to modify locked ${attemptedPropertyGroup} from "${lock.semanticValue}" to "${newValueSnippet.trim()}".`
    );
  }
}
