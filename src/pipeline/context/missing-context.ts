import * as path from 'node:path';
import { TokenBudgetTracker } from './token-budget';

export interface MissingContextRequest {
  requestedFiles: string[];
  requestedSymbols?: string[];
  reason: string;
}

export interface MissingContextRoundResult {
  round: number;
  filesRetrieved: string[];
  symbolsRetrieved: string[];
  rejectedRequests: Array<{ item: string; reason: string }>;
  tokensConsumed: number;
  remainingBudget: number;
  isTerminal: boolean;
  terminalReason?: 'MAX_ROUNDS_REACHED' | 'BUDGET_EXHAUSTED' | 'OUT_OF_SCOPE' | 'SATISFIED';
}

export class MissingContextLoop {
  private maxRounds: number;
  private currentRound = 0;
  private projectRootDir: string;
  private budgetTracker: TokenBudgetTracker;

  constructor(options: {
    projectRootDir: string;
    maxRounds?: number;
    budgetTracker: TokenBudgetTracker;
  }) {
    this.projectRootDir = path.resolve(options.projectRootDir);
    this.maxRounds = options.maxRounds || 3;
    this.budgetTracker = options.budgetTracker;
  }

  public getCurrentRound(): number {
    return this.currentRound;
  }

  /**
   * Authorizes whether a requested file path is safely within the project scope.
   */
  public isAuthorizedPath(requestedPath: string): { authorized: boolean; reason?: string } {
    // 1. Check sensitive filenames
    const basename = path.basename(requestedPath);
    if (/^\.env/i.test(basename) || basename === 'id_rsa' || basename === '.git') {
      return { authorized: false, reason: 'Access to sensitive configuration/secret files is forbidden.' };
    }

    // 2. Resolve relative to project root
    const resolved = path.resolve(this.projectRootDir, requestedPath);

    // 3. Prevent path traversal escaping projectRootDir
    if (!resolved.startsWith(this.projectRootDir)) {
      return { authorized: false, reason: 'Path traversal outside authorized project root is forbidden.' };
    }

    return { authorized: true };
  }

  /**
   * Processes a single round of model-requested missing context.
   */
  public processRound(
    request: MissingContextRequest,
    fileProvider: (filePath: string) => string | null
  ): MissingContextRoundResult {
    this.currentRound++;

    const filesRetrieved: string[] = [];
    const symbolsRetrieved: string[] = [];
    const rejectedRequests: Array<{ item: string; reason: string }> = [];

    // Check round limit
    if (this.currentRound > this.maxRounds) {
      return {
        round: this.currentRound,
        filesRetrieved: [],
        symbolsRetrieved: [],
        rejectedRequests: [{ item: 'round_limit', reason: 'Maximum context request rounds (3) reached.' }],
        tokensConsumed: 0,
        remainingBudget: this.budgetTracker.getRemainingTokens(),
        isTerminal: true,
        terminalReason: 'MAX_ROUNDS_REACHED',
      };
    }

    let tokensConsumed = 0;

    for (const fileReq of request.requestedFiles) {
      const auth = this.isAuthorizedPath(fileReq);
      if (!auth.authorized) {
        rejectedRequests.push({ item: fileReq, reason: auth.reason! });
        continue;
      }

      const content = fileProvider(fileReq);
      if (!content) {
        rejectedRequests.push({ item: fileReq, reason: `File "${fileReq}" not found in project.` });
        continue;
      }

      const estimated = this.budgetTracker.estimateTokens(content);
      if (this.budgetTracker.tryAllocate(estimated)) {
        filesRetrieved.push(fileReq);
        tokensConsumed += estimated;
      } else {
        rejectedRequests.push({ item: fileReq, reason: 'Exceeded remaining token budget.' });
      }
    }

    const budgetExhausted = this.budgetTracker.getRemainingTokens() <= 0;
    const isTerminal = this.currentRound >= this.maxRounds || budgetExhausted;

    return {
      round: this.currentRound,
      filesRetrieved,
      symbolsRetrieved,
      rejectedRequests,
      tokensConsumed,
      remainingBudget: this.budgetTracker.getRemainingTokens(),
      isTerminal,
      terminalReason: budgetExhausted
        ? 'BUDGET_EXHAUSTED'
        : isTerminal
        ? 'MAX_ROUNDS_REACHED'
        : undefined,
    };
  }
}
