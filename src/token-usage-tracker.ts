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

  /**
   * Get usage for a specific operation type
   */
  public getOperationUsage(operationName: string): TokenUsage[] {
    return this.sessionUsage.operations.filter(op => op.operation === operationName);
  }

  /**
   * Get total tokens for a specific operation type
   */
  public getOperationTotal(operationName: string): number {
    return this.getOperationUsage(operationName)
      .reduce((total, usage) => total + usage.total, 0);
  }

  /**
   * Get usage summary
   */
  public getUsageSummary(): {
    totalTokens: number;
    totalOperations: number;
    operationBreakdown: Record<string, { count: number; tokens: number }>;
    sessionDuration: string;
  } {
    const operationBreakdown: Record<string, { count: number; tokens: number }> = {};

    for (const operation of this.sessionUsage.operations) {
      if (!operationBreakdown[operation.operation]) {
        operationBreakdown[operation.operation] = { count: 0, tokens: 0 };
      }
      operationBreakdown[operation.operation].count++;
      operationBreakdown[operation.operation].tokens += operation.total;
    }

    const sessionDuration = this.formatDuration(
      Date.now() - new Date(this.sessionUsage.startTime).getTime()
    );

    return {
      totalTokens: this.sessionUsage.totalTokens,
      totalOperations: this.sessionUsage.operations.length,
      operationBreakdown,
      sessionDuration
    };
  }

  /**
   * Format usage summary for display
   */
  public formatUsageSummary(): string {
    const summary = this.getUsageSummary();
    
    let output = `\n📊 Token Usage Summary\n`;
    output += `Session Duration: ${summary.sessionDuration}\n`;
    output += `Total Operations: ${summary.totalOperations}\n`;
    output += `Total Tokens: ${this.formatNumber(summary.totalTokens)}\n\n`;

    if (Object.keys(summary.operationBreakdown).length > 0) {
      output += `Operation Breakdown:\n`;
      for (const [operation, stats] of Object.entries(summary.operationBreakdown)) {
        output += `  ${operation}: ${stats.count} ops, ${this.formatNumber(stats.tokens)} tokens\n`;
      }
    }

    return output;
  }

  /**
   * Format current operation usage for display
   */
  public formatCurrentUsage(): string {
    const lastOperation = this.sessionUsage.operations[this.sessionUsage.operations.length - 1];
    
    if (!lastOperation) {
      return `Total tokens used: ${this.formatNumber(this.sessionUsage.totalTokens)}`;
    }

    return `Last operation: ${lastOperation.operation} (${this.formatNumber(lastOperation.total)} tokens) | Session total: ${this.formatNumber(this.sessionUsage.totalTokens)} tokens`;
  }

  /**
   * Reset session tracking
   */
  public resetSession(): void {
    this.sessionUsage = {
      sessionId: this.generateSessionId(),
      startTime: new Date().toISOString(),
      operations: [],
      totalTokens: 0
    };
  }

  /**
   * Export usage data
   */
  public exportUsageData(): string {
    return JSON.stringify(this.sessionUsage, null, 2);
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