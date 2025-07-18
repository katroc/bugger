// Token usage tracking system for MCP tool operations

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  operation: string;
  timestamp: string;
}

export interface SessionTokenUsage {
  sessionId: string;
  startTime: string;
  operations: TokenUsage[];
  totalTokens: number;
  currentOperation?: string;
}

export class TokenUsageTracker {
  private sessionUsage: SessionTokenUsage;
  private static instance: TokenUsageTracker;

  private constructor() {
    this.sessionUsage = {
      sessionId: this.generateSessionId(),
      startTime: new Date().toISOString(),
      operations: [],
      totalTokens: 0
    };
  }

  public static getInstance(): TokenUsageTracker {
    if (!TokenUsageTracker.instance) {
      TokenUsageTracker.instance = new TokenUsageTracker();
    }
    return TokenUsageTracker.instance;
  }

  /**
   * Estimate token count using the same method as context collection engine
   */
  public estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Start tracking a new operation
   */
  public startOperation(operationName: string): void {
    this.sessionUsage.currentOperation = operationName;
  }

  /**
   * Record token usage for the current operation
   */
  public recordUsage(input: string, output: string, operationName?: string): TokenUsage {
    const inputTokens = this.estimateTokenCount(input);
    const outputTokens = this.estimateTokenCount(output);
    const totalTokens = inputTokens + outputTokens;

    const usage: TokenUsage = {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens,
      operation: operationName || this.sessionUsage.currentOperation || 'unknown',
      timestamp: new Date().toISOString()
    };

    this.sessionUsage.operations.push(usage);
    this.sessionUsage.totalTokens += totalTokens;

    return usage;
  }

  /**
   * Get current session usage
   */
  public getSessionUsage(): SessionTokenUsage {
    return { ...this.sessionUsage };
  }


  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private formatNumber(num: number): string {
    return num.toLocaleString();
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}