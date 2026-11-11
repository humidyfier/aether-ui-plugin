export interface ModelTokenizerProfile {
  modelName: string;
  maxContextTokens: number;
  recommendedBudgetTokens: number;
  charsPerToken: number;
}

export const SUPPORTED_MODELS: Record<string, ModelTokenizerProfile> = {
  'gemini-1.5-pro': {
    modelName: 'gemini-1.5-pro',
    maxContextTokens: 1048576,
    recommendedBudgetTokens: 16000,
    charsPerToken: 3.8,
  },
  'gemini-2.0-flash': {
    modelName: 'gemini-2.0-flash',
    maxContextTokens: 1048576,
    recommendedBudgetTokens: 12000,
    charsPerToken: 3.8,
  },
  'gpt-4o': {
    modelName: 'gpt-4o',
    maxContextTokens: 128000,
    recommendedBudgetTokens: 8000,
    charsPerToken: 4.0,
  },
  'claude-3-5-sonnet': {
    modelName: 'claude-3-5-sonnet',
    maxContextTokens: 200000,
    recommendedBudgetTokens: 8000,
    charsPerToken: 3.9,
  },
  generic: {
    modelName: 'generic',
    maxContextTokens: 32000,
    recommendedBudgetTokens: 4000,
    charsPerToken: 4.0,
  },
};

export class TokenBudgetTracker {
  private profile: ModelTokenizerProfile;
  private budgetTokens: number;
  private usedTokens = 0;

  constructor(modelName = 'gemini-1.5-pro', customBudget?: number) {
    this.profile = SUPPORTED_MODELS[modelName] || SUPPORTED_MODELS.generic;
    this.budgetTokens = customBudget || this.profile.recommendedBudgetTokens;
  }

  public getModelName(): string {
    return this.profile.modelName;
  }

  public getBudgetTokens(): number {
    return this.budgetTokens;
  }

  public getUsedTokens(): number {
    return this.usedTokens;
  }

  public getRemainingTokens(): number {
    return Math.max(0, this.budgetTokens - this.usedTokens);
  }

  /**
   * Estimates token count for a given text snippet based on model profile.
   */
  public estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0;
    return Math.ceil(text.length / this.profile.charsPerToken);
  }

  /**
   * Attempts to allocate tokens from the budget. Returns true if within budget.
   */
  public tryAllocate(tokenCount: number): boolean {
    if (this.usedTokens + tokenCount <= this.budgetTokens) {
      this.usedTokens += tokenCount;
      return true;
    }
    return false;
  }

  public forceAllocate(tokenCount: number): void {
    this.usedTokens += tokenCount;
  }

  public reset(): void {
    this.usedTokens = 0;
  }
}
