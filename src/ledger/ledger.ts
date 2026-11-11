import { randomUUID } from 'node:crypto';
import { createDatabase, ISqliteDatabase } from './db';
import { initializeDatabaseSchema } from './schema';
import { BriefRepository } from './repositories/brief.repository';
import { UXRepository } from './repositories/ux.repository';
import { UIRepository } from './repositories/ui.repository';
import { CheckpointRepository } from './repositories/checkpoint.repository';
import { QuarantineRepository } from './repositories/quarantine.repository';
import { StateRepository } from './repositories/state.repository';

import { ProjectBrief, evaluateBriefReadiness } from '../models/brief.model';
import { UXDirection } from '../models/ux.model';
import { UIConcept } from '../models/ui.model';
import { Checkpoint, CheckpointDiff, VersionManifest } from '../models/checkpoint.model';
import { ManifestEngine, ScanOptions } from '../merkle/manifest';
import { AetherStateMachine } from '../state/state-machine';
import { LifecycleState, StateTransitionEvent } from '../models/state.model';
import { QuarantineRegistry } from '../ast/quarantine';
import { RevisionPointerRegistry } from '../state/revision-pointers';

export interface CreateCheckpointOptions {
  message: string;
  author?: 'user' | 'agent' | 'system';
  directoryPath?: string;
  files?: Array<{ relativePath: string; content: string | Buffer }>;
  scanOptions?: ScanOptions;
  stateSnapshot?: Partial<Checkpoint['stateSnapshot']>;
}

export class StateLedger {
  private db: ISqliteDatabase;
  public readonly briefs: BriefRepository;
  public readonly ux: UXRepository;
  public readonly ui: UIRepository;
  public readonly checkpoints: CheckpointRepository;
  public readonly quarantineRepo: QuarantineRepository;
  public readonly stateRepo: StateRepository;

  public readonly stateMachine: AetherStateMachine;
  public readonly quarantineRegistry: QuarantineRegistry;
  public readonly revisionPointers: RevisionPointerRegistry;

  public getDb(): ISqliteDatabase {
    return this.db;
  }

  constructor(dbPath = ':memory:') {
    this.db = createDatabase(dbPath);
    initializeDatabaseSchema(this.db);

    this.briefs = new BriefRepository(this.db);
    this.ux = new UXRepository(this.db);
    this.ui = new UIRepository(this.db);
    this.checkpoints = new CheckpointRepository(this.db);
    this.quarantineRepo = new QuarantineRepository(this.db);
    this.stateRepo = new StateRepository(this.db);

    this.quarantineRegistry = new QuarantineRegistry();
    this.stateMachine = new AetherStateMachine('Idle');
    this.revisionPointers = new RevisionPointerRegistry('initial-empty', this.db);

    // Subscribe state transitions to persist in StateRepository
    this.stateMachine.subscribe((event) => {
      this.stateRepo.recordTransition(event);
    });
  }

  public getDatabase(): ISqliteDatabase {
    return this.db;
  }

  // ==========================================
  // FR-01: ProjectBrief Management
  // ==========================================
  public saveBrief(briefData: Omit<ProjectBrief, 'id' | 'readiness' | 'version' | 'createdAt' | 'updatedAt'> & { id?: string }): ProjectBrief {
    const id = briefData.id || randomUUID();
    const existing = this.briefs.findById(id);

    const readiness = evaluateBriefReadiness(briefData);
    const now = new Date().toISOString();

    const brief: ProjectBrief = {
      ...briefData,
      id,
      readiness,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.briefs.save(brief);

    // Update state machine context
    this.stateMachine.updateContext({
      briefId: brief.id,
      hasBrief: true,
      isBriefReady: brief.readiness.isReady,
    });

    return brief;
  }

  // ==========================================
  // FR-02 & FR-03: UXDirection Management
  // ==========================================
  public saveUXAlternatives(briefId: string, directions: Array<Omit<UXDirection, 'id' | 'briefId' | 'isSelected' | 'createdAt' | 'updatedAt'>>): UXDirection[] {
    const now = new Date().toISOString();
    const createdList: UXDirection[] = directions.map((dir, idx) => ({
      ...dir,
      id: randomUUID(),
      briefId,
      isSelected: idx === 0 && directions.length === 1, // auto-select if single
      createdAt: now,
      updatedAt: now,
    }));

    this.ux.saveBatch(createdList);
    return createdList;
  }

  public selectUXDirection(briefId: string, directionId: string, notes?: string): UXDirection {
    this.ux.selectDirection(briefId, directionId, notes);
    const selected = this.ux.findById(directionId);
    if (!selected) {
      throw new Error(`UXDirection with ID "${directionId}" not found for brief "${briefId}"`);
    }

    this.stateMachine.updateContext({
      selectedUxDirectionId: directionId,
    });

    return selected;
  }

  // ==========================================
  // FR-06 to FR-08: UIConcept Management
  // ==========================================
  public saveUIConcepts(briefId: string, uxDirectionId: string, concepts: Array<Omit<UIConcept, 'id' | 'briefId' | 'uxDirectionId' | 'isSelected' | 'createdAt' | 'updatedAt'>>): UIConcept[] {
    const now = new Date().toISOString();
    const createdList: UIConcept[] = concepts.map((concept, idx) => ({
      ...concept,
      id: randomUUID(),
      briefId,
      uxDirectionId,
      isSelected: idx === 0 && concepts.length === 1,
      createdAt: now,
      updatedAt: now,
    }));

    this.ui.saveBatch(createdList);
    return createdList;
  }

  public selectUIConcept(briefId: string, conceptId: string): UIConcept {
    this.ui.selectConcept(briefId, conceptId);
    const selected = this.ui.findById(conceptId);
    if (!selected) {
      throw new Error(`UIConcept with ID "${conceptId}" not found for brief "${briefId}"`);
    }

    this.stateMachine.updateContext({
      selectedUiConceptId: conceptId,
    });

    return selected;
  }

  // ==========================================
  // FR-18: Checkpoint Ledger & Merkle File Hashing
  // ==========================================
  public createCheckpoint(options: CreateCheckpointOptions): Checkpoint {
    const latest = this.checkpoints.getLatest();
    const parentCheckpointId = latest ? latest.id : null;
    const versionNumber = latest ? latest.manifest.version + 1 : 1;

    let manifest: VersionManifest;

    if (options.files && options.files.length > 0) {
      const fileEntries = options.files.map((f) =>
        ManifestEngine.hashContent(f.content, f.relativePath)
      );
      manifest = ManifestEngine.createManifest(fileEntries, versionNumber);
    } else if (options.directoryPath) {
      manifest = ManifestEngine.buildManifestFromDirectory(
        options.directoryPath,
        versionNumber,
        options.scanOptions
      );
    } else {
      manifest = ManifestEngine.createManifest([], versionNumber);
    }

    const currentState = this.stateMachine.getState();
    const currentContext = this.stateMachine.getContext();

    const checkpoint: Checkpoint = {
      id: randomUUID(),
      parentCheckpointId,
      timestamp: new Date().toISOString(),
      message: options.message,
      author: options.author || 'system',
      merkleRoot: manifest.merkleRoot,
      stateSnapshot: {
        briefId: currentContext.briefId,
        selectedUxDirectionId: currentContext.selectedUxDirectionId,
        selectedUiConceptId: currentContext.selectedUiConceptId,
        lifecycleState: currentState,
        ...options.stateSnapshot,
      },
      manifest,
    };

    this.checkpoints.save(checkpoint);

    this.stateMachine.updateContext({
      lastCheckpointId: checkpoint.id,
    });

    return checkpoint;
  }

  public diffCheckpoints(baseCheckpointId: string, targetCheckpointId: string): CheckpointDiff {
    const base = this.checkpoints.findById(baseCheckpointId);
    if (!base) {
      throw new Error(`Base checkpoint "${baseCheckpointId}" not found`);
    }

    const target = this.checkpoints.findById(targetCheckpointId);
    if (!target) {
      throw new Error(`Target checkpoint "${targetCheckpointId}" not found`);
    }

    return ManifestEngine.diffManifests(base.manifest, target.manifest, base.id, target.id);
  }

  // ==========================================
  // Strict State Machine Helper
  // ==========================================
  public transitionState(
    toState: LifecycleState,
    action: string,
    actor: 'user' | 'agent' | 'system' = 'user',
    payload?: Record<string, unknown>
  ): StateTransitionEvent {
    return this.stateMachine.transition(toState, action, actor, payload);
  }

  // ==========================================
  // Ambiguous Duplicate Quarantine Synchronization
  // ==========================================
  public syncQuarantinedDuplicates(): void {
    const records = this.quarantineRegistry.getQuarantinedRecords();
    for (const record of records) {
      this.quarantineRepo.save(record);
    }
  }

  public close(): void {
    this.db.close();
  }
}
