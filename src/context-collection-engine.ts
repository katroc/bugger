// Context collection engine that orchestrates pattern matching and dependency analysis
import { TreeSitterCodeAnalyzer, FunctionMatch, ClassMatch, PatternMatch } from './treesitter-code-analyzer.js';
import { DependencyAnalyzer, DependencyGraph, FileRelationship } from './dependency-analysis.js';
import { StackTraceParser, ParsedStackTrace, StackTraceContext } from './stack-trace-parser.js';
import * as fs from 'fs';
import * as path from 'path';

export type TaskType = 'bug' | 'feature' | 'improvement';

export interface CodeContext {
  id: string;
  taskId: string;
  taskType: TaskType;
  contextType: 'snippet' | 'file_reference' | 'dependency' | 'pattern';
  source: 'ai_collected' | 'manual';
  filePath: string;
  startLine?: number;
  endLine?: number;
  content?: string;
  description: string;
  relevanceScore: number;
  keywords: string[];
  dateCollected: string;
  dateLastChecked?: string;
  isStale?: boolean;
}

export interface CodeSection {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  relevanceScore: number;
  contextType: 'function' | 'class' | 'import' | 'usage' | 'comment';
  relatedEntities: string[];
}

export interface ContextCollectionConfig {
  maxContextsPerTask: number;
  relevanceThreshold: number;
  maxFileSize: number;
  excludePatterns: string[];
  includeExtensions: string[];
  cacheExpiryHours: number;
  enableStalenessTracking: boolean;
  enablePatternMatching: boolean;
  enableDependencyAnalysis: boolean;
  // Token optimization settings
  maxTokensPerTask: number;
  maxTokensPerContext: number;
  enableIntelligentSummarization: boolean;
  enableContentDeduplication: boolean;
  compressionThreshold: number;
  taskTypeTokenLimits: {
    bug: number;
    feature: number;
    improvement: number;
  };
  contextScoringWeights: {
    keywordMatch: number;
    entityMatch: number;
    intentMatch: number;
    patternSimilarity: number;
    dependencyStrength: number;
    fileProximity: number;
  };
}

export interface ContextCollectionResult {
  contexts: CodeContext[];
  stackTraces?: ParsedStackTrace[];
  summary: {
    totalContexts: number;
    highRelevanceContexts: number;
    mediumRelevanceContexts: number;
    lowRelevanceContexts: number;
    averageRelevanceScore: number;
    processingTimeMs: number;
    filesAnalyzed: number;
    patternsFound: number;
    dependenciesAnalyzed: number;
    stackTracesFound: number;
  };
  recommendations: string[];
  potentialIssues: string[];
}

export interface TaskAnalysisInput {
  taskId: string;
  taskType: TaskType;
  title: string;
  description: string;
  currentState?: string;
  desiredState?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  filesLikelyInvolved?: string[];
  keywords?: string[];
  entities?: string[];
}

/**
 * Main context collection engine that orchestrates all analysis components
 */
export class ContextCollectionEngine {
  private codeAnalyzer: TreeSitterCodeAnalyzer;
  private dependencyAnalyzer: DependencyAnalyzer;
  private config: ContextCollectionConfig;
  private contextCache: Map<string, CodeContext[]> = new Map();
  private allowedRoot: string;

  constructor(
    rootPath: string = process.cwd(),
    config: Partial<ContextCollectionConfig> = {}
  ) {
    const resolvedRoot = path.resolve(process.env.CONTEXT_ROOT || rootPath || process.cwd());
    this.allowedRoot = resolvedRoot;
    this.codeAnalyzer = new TreeSitterCodeAnalyzer(resolvedRoot);
    this.dependencyAnalyzer = new DependencyAnalyzer(resolvedRoot);
    this.config = this.mergeWithDefaultConfig(config);
  }

  /**
   * Collect contexts for a task using all available analysis methods
   */
  public async collectContexts(input: TaskAnalysisInput): Promise<ContextCollectionResult> {
    const startTime = Date.now();
    
    try {
      // Step 1: Analyze task description using text analysis
      const textAnalysis = await this.analyzeTaskText(input);
      
      // Step 2: Parse stack traces (especially useful for bug reports)
      const stackTraces = input.taskType === 'bug' ? 
        await this.parseStackTraces(textAnalysis.combinedText) : [];
      
      // Step 3: Find relevant code patterns
      const patternMatches = this.config.enablePatternMatching ? 
        await this.findRelevantPatterns(textAnalysis) : [];
      
      // Step 4: Analyze dependencies
      const dependencyInfo = this.config.enableDependencyAnalysis ? 
        await this.analyzeDependencies(input.filesLikelyInvolved || []) : null;
      
      // Step 5: Extract code sections (including stack trace contexts)
      const codeSections = await this.extractCodeSections(input, textAnalysis, patternMatches, dependencyInfo, stackTraces);
      
      // Step 6: Score and rank contexts
      const scoredContexts = await this.scoreAndRankContexts(codeSections, textAnalysis, input);
      
      // Step 7: Filter and limit contexts
      const filteredContexts = this.filterContexts(scoredContexts);
      
      // Step 8: Convert to CodeContext objects
      let contexts = await this.convertToCodeContexts(filteredContexts, input);
      
      // Step 9: Apply token optimizations
      contexts = this.deduplicateContexts(contexts);
      contexts = this.applyTokenFiltering(contexts, input.taskType);
      
      // Step 10: Generate summary and recommendations
      const summary = this.generateSummary(contexts, startTime, patternMatches, dependencyInfo, stackTraces);
      const recommendations = this.generateRecommendations(contexts, textAnalysis, patternMatches, stackTraces);
      const potentialIssues = this.identifyPotentialIssues(contexts, dependencyInfo);
      
      // Step 11: Cache results
      this.cacheResults(input.taskId, contexts);
      
      const result: ContextCollectionResult = {
        contexts,
        summary,
        recommendations,
        potentialIssues
      };

      if (stackTraces.length > 0) {
        result.stackTraces = stackTraces;
      }

      return result;
      
    } catch (error) {
      console.error('Error in context collection:', error);
      throw error;
    }
  }

  /**
   * Get cached contexts for a task
   */
  public getCachedContexts(taskId: string): CodeContext[] | null {
    const cached = this.contextCache.get(taskId);
    
    if (cached) {
      // Check if cache is still valid
      const cacheAge = Date.now() - new Date(cached[0]?.dateCollected || 0).getTime();
      const maxAge = this.config.cacheExpiryHours * 60 * 60 * 1000;
      
      if (cacheAge < maxAge) {
        return cached;
      } else {
        // Remove expired cache
        this.contextCache.delete(taskId);
      }
    }
    
    return null;
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<ContextCollectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Clear all caches
   */
  public clearCaches(): void {
    this.contextCache.clear();
    // Cache cleared
  }

  // Private methods

  /**
   * Parse stack traces from task description text
   */
  private async parseStackTraces(combinedText: string): Promise<ParsedStackTrace[]> {
    try {
      if (!StackTraceParser.containsStackTrace(combinedText)) {
        return [];
      }

      const stackTraces = StackTraceParser.extractStackTraces(combinedText);
      
      // Filter for valid, high-confidence stack traces
      return stackTraces.filter(trace => trace.isValid && trace.confidence > 0.5);
    } catch (error) {
      console.error('Error parsing stack traces:', error);
      return [];
    }
  }

  /**
   * Extract stack trace contexts for code collection
   */
  private async extractStackTraceContexts(stackTraces: ParsedStackTrace[]): Promise<CodeSection[]> {
    const sections: CodeSection[] = [];

    for (const stackTrace of stackTraces) {
      const contexts = StackTraceParser.extractStackTraceContexts(stackTrace);
      
      for (const context of contexts) {
        // Check if file exists and is readable within allowed root
        const resolvedStackPath = this.safeResolve(context.filePath);
        if (resolvedStackPath && fs.existsSync(resolvedStackPath)) {
          try {
            const content = await this.readFileSection(
              resolvedStackPath,
              Math.max(1, context.lineNumber - context.contextLines),
              context.lineNumber + context.contextLines
            );

            if (content) {
              const relevanceScore = this.calculateStackTraceRelevance(context.priority, stackTrace.confidence);
              
              sections.push({
                filePath: resolvedStackPath,
                startLine: Math.max(1, context.lineNumber - context.contextLines),
                endLine: context.lineNumber + context.contextLines,
                content,
                relevanceScore,
                contextType: 'function',
                relatedEntities: context.functionName ? [context.functionName] : []
              });
            }
          } catch (error) {
            console.error(`Error reading stack trace context from ${resolvedStackPath}:`, error);
          }
        }
      }
    }

    return sections;
  }

  /**
   * Calculate relevance score for stack trace contexts
   */
  private calculateStackTraceRelevance(priority: 'high' | 'medium' | 'low', confidence: number): number {
    const priorityScores = {
      high: 0.9,
      medium: 0.7,
      low: 0.5
    };

    return Math.min(1.0, priorityScores[priority] * confidence);
  }

  /**
   * Estimate token count for text content
   */
  private estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Intelligently summarize content to reduce token usage
   */
  private summarizeContent(content: string, maxTokens: number): string {
    const estimatedTokens = this.estimateTokenCount(content);
    
    if (estimatedTokens <= maxTokens) {
      return content;
    }
    
    // Target character count based on token limit
    const targetChars = maxTokens * 4;
    
    // If content is code, try to keep complete lines
    const lines = content.split('\n');
    let result = '';
    let currentLength = 0;
    
    for (const line of lines) {
      if (currentLength + line.length + 1 > targetChars) {
        // Try to break at a natural point
        const remainingChars = targetChars - currentLength;
        if (remainingChars > 20) {
          result += line.substring(0, remainingChars - 5) + '...';
        }
        break;
      }
      result += line + '\n';
      currentLength += line.length + 1;
    }
    
    return result.trim();
  }

  /**
   * Deduplicate similar contexts based on content similarity
   */
  private deduplicateContexts(contexts: CodeContext[]): CodeContext[] {
    if (!this.config.enableContentDeduplication) {
      return contexts;
    }
    
    const unique: CodeContext[] = [];
    const seen = new Set<string>();
    
    for (const context of contexts) {
      // Create a hash of the content for deduplication
      const contentHash = this.createContentHash(context.content || '');
      
      if (!seen.has(contentHash)) {
        seen.add(contentHash);
        unique.push(context);
      } else {
        // If duplicate, merge keywords and update relevance score
        const existing = unique.find(c => this.createContentHash(c.content || '') === contentHash);
        if (existing) {
          existing.keywords = [...new Set([...existing.keywords, ...context.keywords])];
          existing.relevanceScore = Math.max(existing.relevanceScore, context.relevanceScore);
        }
      }
    }
    
    return unique;
  }

  /**
   * Create a hash of content for deduplication
   */
  private createContentHash(content: string): string {
    // Simple hash based on normalized content
    const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase();
    return normalized.substring(0, 200); // Use first 200 chars as hash
  }

  /**
   * Apply token-aware filtering to contexts
   */
  private applyTokenFiltering(contexts: CodeContext[], taskType: TaskType): CodeContext[] {
    let totalTokens = 0;
    const filtered: CodeContext[] = [];
    
    // Get task-specific token limit
    const taskTokenLimit = this.config.taskTypeTokenLimits[taskType] || this.config.maxTokensPerTask;
    
    // Sort by relevance score (highest first)
    const sorted = contexts.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    for (const context of sorted) {
      const contextTokens = this.estimateTokenCount(context.content || '');
      
      if (totalTokens + contextTokens <= taskTokenLimit) {
        // Apply summarization if context exceeds per-context limit
        if (contextTokens > this.config.maxTokensPerContext) {
          context.content = this.summarizeContent(context.content || '', this.config.maxTokensPerContext);
          context.description += ' (summarized)';
        }
        
        filtered.push(context);
        totalTokens += this.estimateTokenCount(context.content || '');
      }
    }
    
    return filtered;
  }

  private async analyzeTaskText(input: TaskAnalysisInput): Promise<{
    keywords: string[];
    entities: string[];
    combinedText: string;
  }> {
    // Combine all text fields for analysis
    const textFields = [
      input.title,
      input.description,
      input.currentState,
      input.desiredState,
      input.expectedBehavior,
      input.actualBehavior
    ].filter(Boolean);
    
    const combinedText = textFields.join(' ');
    
    // Use provided keywords and entities, or extract simple ones from input
    const keywords = input.keywords || this.extractSimpleKeywords(combinedText);
    const entities = input.entities || this.extractSimpleEntities(combinedText);
    
    return {
      keywords,
      entities,
      combinedText
    };
  }

  /**
   * Simple keyword extraction (basic fallback when AI analysis isn't available)
   */
  private extractSimpleKeywords(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }
    
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !this.isCommonWord(word));
    
    // Return unique words, limited to top 10
    return Array.from(new Set(words)).slice(0, 10);
  }

  /**
   * Simple entity extraction (basic fallback when AI analysis isn't available)
   */
  private extractSimpleEntities(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }
    
    const entities: string[] = [];
    
    // Extract file paths
    const fileMatches = text.match(/[a-zA-Z0-9_\-]+\.(js|ts|jsx|tsx|py|java|rb|php|go|cs|html|css|json)/g);
    if (fileMatches) entities.push(...fileMatches);
    
    // Extract function-like patterns
    const functionMatches = text.match(/[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/g);
    if (functionMatches) {
      entities.push(...functionMatches.map(m => m.replace(/\s*\($/, '')));
    }
    
    // Extract camelCase/PascalCase identifiers
    const identifierMatches = text.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g);
    if (identifierMatches) entities.push(...identifierMatches);
    
    return Array.from(new Set(entities)).slice(0, 15);
  }

  /**
   * Check if a word is a common English word
   */
  private isCommonWord(word: string): boolean {
    const commonWords = new Set([
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'from', 'up', 'about', 'into', 'over', 'after', 'this', 'that', 'these', 'those',
      'they', 'them', 'their', 'there', 'then', 'than', 'when', 'where', 'why', 'how',
      'what', 'which', 'who', 'will', 'would', 'could', 'should', 'might', 'must',
      'have', 'has', 'had', 'been', 'being', 'are', 'was', 'were', 'is', 'am'
    ]);
    return commonWords.has(word);
  }

  private async findRelevantPatterns(textAnalysis: {
    keywords: string[];
    entities: string[];
    combinedText: string;
  }): Promise<{
    functions: FunctionMatch[];
    classes: ClassMatch[];
    patterns: PatternMatch[];
  }> {
    const functions: FunctionMatch[] = [];
    const classes: ClassMatch[] = [];
    const patterns: PatternMatch[] = [];
    
    // Find functions mentioned in entities (entities are now just strings)
    for (const entity of textAnalysis.entities) {
      // Check if entity looks like a function (contains parentheses or common function patterns)
      if (entity.includes('(') || /^[a-z][a-zA-Z0-9]*$/.test(entity)) {
        const functionMatches = await this.codeAnalyzer.findFunctionDefinitions(entity.replace(/\s*\(.*$/, ''));
        functions.push(...functionMatches);
      }
      
      // Check if entity looks like a class (starts with capital letter)
      if (/^[A-Z][a-zA-Z0-9]*$/.test(entity)) {
        const classMatches = await this.codeAnalyzer.findClassDefinitions(entity);
        classes.push(...classMatches);
      }
    }
    
    // Find similar patterns based on combined text
    if (textAnalysis.combinedText.length > 50) {
      const similarPatterns = await this.codeAnalyzer.findSimilarPatterns(textAnalysis.combinedText);
      patterns.push(...similarPatterns);
    }
    
    return { functions, classes, patterns };
  }

  private async analyzeDependencies(filesLikelyInvolved: string[]): Promise<{
    graph: DependencyGraph;
    fileRelationships: Map<string, FileRelationship>;
  } | null> {
    try {
      const graph = await this.dependencyAnalyzer.buildDependencyGraph();
      const fileRelationships = new Map<string, FileRelationship>();
      
      // Get relationships for files likely involved
      for (const file of filesLikelyInvolved) {
        const resolved = this.safeResolve(file);
        if (resolved && fs.existsSync(resolved)) {
          const relationship = await this.dependencyAnalyzer.mapFileRelationships(resolved);
          fileRelationships.set(resolved, relationship);
        }
      }
      
      return { graph, fileRelationships };
    } catch (error) {
      console.error('Error analyzing dependencies:', error);
      return null;
    }
  }

  private async extractCodeSections(
    input: TaskAnalysisInput,
    textAnalysis: any,
    patternMatches: any,
    dependencyInfo: any,
    stackTraces: ParsedStackTrace[]
  ): Promise<CodeSection[]> {
    const sections: CodeSection[] = [];
    
    // Extract sections from stack traces (highest priority for bugs)
    if (stackTraces.length > 0) {
      const stackTraceSections = await this.extractStackTraceContexts(stackTraces);
      sections.push(...stackTraceSections);
    }
    
    // Extract sections from pattern matches
    for (const funcMatch of patternMatches.functions || []) {
      const content = await this.readFileSection(funcMatch.filePath, funcMatch.startLine, funcMatch.endLine);
      if (content) {
        sections.push({
          filePath: funcMatch.filePath,
          startLine: funcMatch.startLine,
          endLine: funcMatch.endLine,
          content,
          relevanceScore: funcMatch.relevanceScore,
          contextType: 'function',
          relatedEntities: [funcMatch.name]
        });
      }
    }
    
    for (const classMatch of patternMatches.classes || []) {
      const content = await this.readFileSection(classMatch.filePath, classMatch.startLine, classMatch.endLine);
      if (content) {
        sections.push({
          filePath: classMatch.filePath,
          startLine: classMatch.startLine,
          endLine: classMatch.endLine,
          content,
          relevanceScore: classMatch.relevanceScore,
          contextType: 'class',
          relatedEntities: [classMatch.name, ...classMatch.methods]
        });
      }
    }
    
    // Extract sections from files likely involved
    for (const file of input.filesLikelyInvolved || []) {
      const relevantSections = await this.extractRelevantSectionsFromFile(file, textAnalysis);
      sections.push(...relevantSections);
    }
    
    // Extract sections from dependency analysis
    if (dependencyInfo) {
      const importSections = await this.extractImportSections(dependencyInfo);
      sections.push(...importSections);
    }
    
    return sections;
  }

  private async readFileSection(filePath: string, startLine: number, endLine: number): Promise<string | null> {
    try {
      const resolved = this.safeResolve(filePath);
      if (!resolved) return null;
      const stat = fs.statSync(resolved);
      if (stat.size > this.config.maxFileSize) return null;
      const content = fs.readFileSync(resolved, 'utf8');
      const lines = content.split('\n');
      return lines.slice(startLine - 1, endLine).join('\n');
    } catch (error) {
      console.error(`Error reading file section ${filePath}:`, error);
      return null;
    }
  }

  private async extractRelevantSectionsFromFile(
    filePath: string,
    textAnalysis: any
  ): Promise<CodeSection[]> {
    const sections: CodeSection[] = [];
    
    try {
      const resolved = this.safeResolve(filePath);
      if (!resolved) return sections;
      const stat = fs.statSync(resolved);
      if (stat.size > this.config.maxFileSize) return sections;
      const content = fs.readFileSync(resolved, 'utf8');
      const lines = content.split('\n');
      
      // Find lines that contain keywords or entities
      const relevantLines: { line: number; content: string; score: number }[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let score = 0;
        
        // Score based on keyword matches
        for (const keyword of textAnalysis.keywords || []) {
          if (keyword && typeof keyword === 'string' && line.toLowerCase().includes(keyword.toLowerCase())) {
            score += 1; // Simple scoring since we don't have keyword.score anymore
          }
        }
        
        // Score based on entity matches
        for (const entity of textAnalysis.entities || []) {
          if (entity && typeof entity === 'string' && line.includes(entity)) {
            score += 2; // Entities get higher score
          }
        }
        
        if (score > 0) {
          relevantLines.push({ line: i + 1, content: line, score });
        }
      }
      
      // Group relevant lines into sections
      const contextSize = 5; // Lines before and after
      const groupedSections = this.groupRelevantLines(relevantLines, contextSize);
      
      for (const group of groupedSections) {
        const startLine = Math.max(1, group.startLine - contextSize);
        const endLine = Math.min(lines.length, group.endLine + contextSize);
        const sectionContent = lines.slice(startLine - 1, endLine).join('\n');
        
        sections.push({
          filePath: resolved,
          startLine,
          endLine,
          content: sectionContent,
          relevanceScore: group.averageScore,
          contextType: 'usage',
          relatedEntities: group.entities
        });
      }

    } catch (error) {
      console.error(`Error extracting sections from ${filePath}:`, error);
    }
    
    return sections;
  }

  private groupRelevantLines(
    relevantLines: { line: number; content: string; score: number }[],
    contextSize: number
  ): Array<{
    startLine: number;
    endLine: number;
    averageScore: number;
    entities: string[];
  }> {
    if (relevantLines.length === 0) return [];
    
    const groups: Array<{
      startLine: number;
      endLine: number;
      scores: number[];
      entities: string[];
    }> = [];
    
    let currentGroup = {
      startLine: relevantLines[0].line,
      endLine: relevantLines[0].line,
      scores: [relevantLines[0].score],
      entities: []
    };
    
    for (let i = 1; i < relevantLines.length; i++) {
      const line = relevantLines[i];
      
      // If line is close to current group, extend the group
      if (line.line - currentGroup.endLine <= contextSize * 2) {
        currentGroup.endLine = line.line;
        currentGroup.scores.push(line.score);
      } else {
        // Start new group
        groups.push(currentGroup);
        currentGroup = {
          startLine: line.line,
          endLine: line.line,
          scores: [line.score],
          entities: []
        };
      }
    }
    
    groups.push(currentGroup);
    
    return groups.map(group => ({
      startLine: group.startLine,
      endLine: group.endLine,
      averageScore: group.scores.reduce((sum, score) => sum + score, 0) / group.scores.length,
      entities: group.entities
    }));
  }

  private async extractImportSections(dependencyInfo: any): Promise<CodeSection[]> {
    const sections: CodeSection[] = [];
    
    if (!dependencyInfo || !dependencyInfo.fileRelationships) {
      return sections;
    }
    
    for (const [filePath, relationship] of dependencyInfo.fileRelationships.entries()) {
      for (const importStmt of relationship.imports) {
        const content = await this.readFileSection(filePath, importStmt.line, importStmt.line + 1);
        if (content) {
          sections.push({
            filePath,
            startLine: importStmt.line,
            endLine: importStmt.line + 1,
            content,
            relevanceScore: 0.6,
            contextType: 'import',
            relatedEntities: importStmt.imported
          });
        }
      }
    }
    
    return sections;
  }

  private async scoreAndRankContexts(
    sections: CodeSection[],
    textAnalysis: any,
    input: TaskAnalysisInput
  ): Promise<CodeSection[]> {
    const scoredSections = sections.map(section => {
      const score = this.calculateRelevanceScore(section, textAnalysis, input);
      return { ...section, relevanceScore: score };
    });
    
    return scoredSections.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private calculateRelevanceScore(
    section: CodeSection,
    textAnalysis: any,
    input: TaskAnalysisInput
  ): number {
    const weights = this.config.contextScoringWeights;
    let score = 0;
    
    // Keyword match score
    let keywordScore = 0;
    for (const keyword of textAnalysis.keywords) {
      if (section.content.toLowerCase().includes(keyword.toLowerCase())) {
        keywordScore += 1; // Simple scoring since we don't have keyword.score anymore
      }
    }
    score += keywordScore * weights.keywordMatch;
    
    // Entity match score
    let entityScore = 0;
    for (const entity of textAnalysis.entities) {
      if (section.content.includes(entity) || section.relatedEntities.includes(entity)) {
        entityScore += 2; // Entities get higher score
      }
    }
    score += entityScore * weights.entityMatch;
    
    // Intent match score (simplified to use taskType instead of intent)
    const intentScore = this.calculateIntentMatchScore(section, input.taskType);
    score += intentScore * weights.intentMatch;
    
    // File proximity score (if file is explicitly mentioned)
    let proximityScore = 0;
    if (input.filesLikelyInvolved?.includes(section.filePath)) {
      proximityScore = 1.0;
    }
    score += proximityScore * weights.fileProximity;
    
    // Base relevance score from section analysis
    score += section.relevanceScore * 0.3;
    
    return Math.min(1.0, score);
  }

  private calculateIntentMatchScore(section: CodeSection, taskType: TaskType): number {
    // Simple intent matching based on context type and task type
    const taskTypeMatches: Record<string, string[]> = {
      'bug': ['function', 'usage', 'comment'],
      'feature': ['class', 'function', 'import'],
      'improvement': ['function', 'class', 'usage']
    };
    
    const contextTypeMatches = taskTypeMatches[taskType] || [];
    
    return contextTypeMatches.includes(section.contextType) ? 0.8 : 0.3;
  }

  private filterContexts(sections: CodeSection[]): CodeSection[] {
    return sections
      .filter(section => section.relevanceScore >= this.config.relevanceThreshold)
      .slice(0, this.config.maxContextsPerTask);
  }

  private async convertToCodeContexts(
    sections: CodeSection[],
    input: TaskAnalysisInput
  ): Promise<CodeContext[]> {
    const contexts: CodeContext[] = [];
    
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      
      contexts.push({
        id: `${input.taskId}_context_${i}`,
        taskId: input.taskId,
        taskType: input.taskType,
        contextType: this.mapContextType(section.contextType),
        source: 'ai_collected',
        filePath: section.filePath,
        startLine: section.startLine,
        endLine: section.endLine,
        content: section.content,
        description: this.generateContextDescription(section),
        relevanceScore: section.relevanceScore,
        keywords: section.relatedEntities,
        dateCollected: new Date().toISOString(),
        isStale: false
      });
    }
    
    return contexts;
  }

  private mapContextType(sectionType: string): CodeContext['contextType'] {
    const mapping: Record<string, CodeContext['contextType']> = {
      'function': 'snippet',
      'class': 'snippet',
      'import': 'dependency',
      'usage': 'snippet',
      'comment': 'snippet'
    };
    
    return mapping[sectionType] || 'snippet';
  }

  private generateContextDescription(section: CodeSection): string {
    const fileName = path.basename(section.filePath);
    const lineRange = section.startLine === section.endLine ? 
      `line ${section.startLine}` : 
      `lines ${section.startLine}-${section.endLine}`;
    
    return `${section.contextType} in ${fileName} (${lineRange})`;
  }

  private generateSummary(
    contexts: CodeContext[],
    startTime: number,
    patternMatches: any,
    dependencyInfo: any,
    stackTraces: ParsedStackTrace[]
  ): ContextCollectionResult['summary'] {
    const highRelevanceContexts = contexts.filter(c => c.relevanceScore > 0.7).length;
    const mediumRelevanceContexts = contexts.filter(c => c.relevanceScore > 0.4 && c.relevanceScore <= 0.7).length;
    const lowRelevanceContexts = contexts.filter(c => c.relevanceScore <= 0.4).length;
    
    const averageRelevanceScore = contexts.length > 0 ? 
      contexts.reduce((sum, c) => sum + c.relevanceScore, 0) / contexts.length : 0;
    
    const processingTimeMs = Date.now() - startTime;
    const filesAnalyzed = new Set(contexts.map(c => c.filePath)).size;
    const patternsFound = (patternMatches.functions?.length || 0) + 
                         (patternMatches.classes?.length || 0) + 
                         (patternMatches.patterns?.length || 0);
    const dependenciesAnalyzed = dependencyInfo ? dependencyInfo.graph.edges.length : 0;
    const stackTracesFound = stackTraces.length;
    
    return {
      totalContexts: contexts.length,
      highRelevanceContexts,
      mediumRelevanceContexts,
      lowRelevanceContexts,
      averageRelevanceScore,
      processingTimeMs,
      filesAnalyzed,
      patternsFound,
      dependenciesAnalyzed,
      stackTracesFound
    };
  }

  private generateRecommendations(
    contexts: CodeContext[],
    textAnalysis: any,
    patternMatches: any,
    stackTraces: ParsedStackTrace[]
  ): string[] {
    const recommendations: string[] = [];
    
    // Stack trace specific recommendations
    if (stackTraces.length > 0) {
      const highConfidenceTraces = stackTraces.filter(trace => trace.confidence > 0.8);
      if (highConfidenceTraces.length > 0) {
        recommendations.push(`Found ${highConfidenceTraces.length} high-confidence stack trace(s) - code contexts automatically collected from error locations`);
      }
      
      const languages = [...new Set(stackTraces.map(trace => trace.language))];
      if (languages.length > 1) {
        recommendations.push(`Multiple programming languages detected in stack traces: ${languages.join(', ')}`);
      }
      
      const errorTypes = [...new Set(stackTraces.map(trace => trace.errorType).filter(Boolean))];
      if (errorTypes.length > 0) {
        recommendations.push(`Error types identified: ${errorTypes.join(', ')} - consider adding error handling for these cases`);
      }
    }
    
    // Check if we have enough high-quality contexts
    const highQualityContexts = contexts.filter(c => c.relevanceScore > 0.7);
    if (highQualityContexts.length < 3) {
      recommendations.push('Consider adding more specific files or code references to improve context relevance');
    }
    
    // Check for missing function/class definitions
    const functionEntities = textAnalysis.entities.filter((e: any) => e.type === 'function');
    const foundFunctions = patternMatches.functions?.map((f: any) => f.name) || [];
    const missingFunctions = functionEntities.filter((e: any) => !foundFunctions.includes(e.entity));
    
    if (missingFunctions.length > 0) {
      recommendations.push(`Could not find definitions for functions: ${missingFunctions.map((f: any) => f.entity).join(', ')}`);
    }
    
    // Check for architectural patterns
    if (patternMatches.patterns?.length > 0) {
      recommendations.push('Similar code patterns found - consider checking for consistent implementation');
    }
    
    return recommendations;
  }

  private identifyPotentialIssues(
    contexts: CodeContext[],
    dependencyInfo: any
  ): string[] {
    const issues: string[] = [];
    
    // Check for circular dependencies
    if (dependencyInfo?.graph?.cyclicDependencies?.length > 0) {
      issues.push(`Circular dependencies detected in ${dependencyInfo.graph.cyclicDependencies.length} cycles`);
    }
    
    // Check for large files
    const largeFiles = contexts.filter(c => c.content && c.content.length > 5000);
    if (largeFiles.length > 0) {
      issues.push(`Large code sections found in ${largeFiles.length} contexts - consider breaking down`);
    }
    
    // Check for low relevance contexts
    const lowRelevanceCount = contexts.filter(c => c.relevanceScore < 0.3).length;
    if (lowRelevanceCount > contexts.length * 0.5) {
      issues.push('Many contexts have low relevance scores - consider refining task description');
    }
    
    return issues;
  }

  private cacheResults(taskId: string, contexts: CodeContext[]): void {
    this.contextCache.set(taskId, contexts);
    
    // Clean up old cache entries
    const maxCacheSize = 100;
    if (this.contextCache.size > maxCacheSize) {
      const oldestKey = this.contextCache.keys().next().value;
      if (oldestKey) {
        this.contextCache.delete(oldestKey);
      }
    }
  }

  private safeResolve(p: string): string | null {
    try {
      const resolved = path.resolve(p);
      const root = this.allowedRoot;
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        if (this.config.excludePatterns.some((pat) => resolved.includes(pat))) return null;
        return resolved;
      }
      return null;
    } catch {
      return null;
    }
  }

  private mergeWithDefaultConfig(config: Partial<ContextCollectionConfig>): ContextCollectionConfig {
    return {
      maxContextsPerTask: 20,
      relevanceThreshold: 0.3,
      maxFileSize: 100000,
      excludePatterns: ['node_modules', '.git', 'dist', 'build', 'coverage'],
      includeExtensions: ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.rb', '.php', '.go', '.cs'],
      cacheExpiryHours: 24,
      enableStalenessTracking: true,
      enablePatternMatching: true,
      enableDependencyAnalysis: true,
      // Token optimization defaults
      maxTokensPerTask: 2000,
      maxTokensPerContext: 200,
      enableIntelligentSummarization: true,
      enableContentDeduplication: true,
      compressionThreshold: 500,
      taskTypeTokenLimits: {
        bug: 1500,
        feature: 2500,
        improvement: 2000,
      },
      contextScoringWeights: {
        keywordMatch: 0.3,
        entityMatch: 0.3,
        intentMatch: 0.2,
        patternSimilarity: 0.1,
        dependencyStrength: 0.05,
        fileProximity: 0.05
      },
      ...config
    };
  }
}
