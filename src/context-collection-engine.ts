// Context collection engine that orchestrates text analysis, pattern matching, and dependency analysis
import { TextAnalyzer, KeywordResult, EntityResult, IntentClassificationResult, TaskType } from './text-analysis.js';
import { CodePatternMatcher, FunctionMatch, ClassMatch, PatternMatch } from './code-pattern-matching.js';
import { DependencyAnalyzer, DependencyGraph, FileRelationship } from './dependency-analysis.js';
import * as fs from 'fs';
import * as path from 'path';

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
  private textAnalyzer: TextAnalyzer;
  private patternMatcher: CodePatternMatcher;
  private dependencyAnalyzer: DependencyAnalyzer;
  private config: ContextCollectionConfig;
  private contextCache: Map<string, CodeContext[]> = new Map();
  private analysisCache: Map<string, any> = new Map();

  constructor(
    rootPath: string = process.cwd(),
    config: Partial<ContextCollectionConfig> = {}
  ) {
    this.textAnalyzer = new TextAnalyzer();
    this.patternMatcher = new CodePatternMatcher(rootPath);
    this.dependencyAnalyzer = new DependencyAnalyzer(rootPath);
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
      
      // Step 2: Find relevant code patterns
      const patternMatches = this.config.enablePatternMatching ? 
        await this.findRelevantPatterns(textAnalysis) : [];
      
      // Step 3: Analyze dependencies
      const dependencyInfo = this.config.enableDependencyAnalysis ? 
        await this.analyzeDependencies(input.filesLikelyInvolved || []) : null;
      
      // Step 4: Extract code sections
      const codeSections = await this.extractCodeSections(input, textAnalysis, patternMatches, dependencyInfo);
      
      // Step 5: Score and rank contexts
      const scoredContexts = await this.scoreAndRankContexts(codeSections, textAnalysis, input);
      
      // Step 6: Filter and limit contexts
      const filteredContexts = this.filterContexts(scoredContexts);
      
      // Step 7: Convert to CodeContext objects
      let contexts = await this.convertToCodeContexts(filteredContexts, input);
      
      // Step 8: Apply token optimizations
      contexts = this.deduplicateContexts(contexts);
      contexts = this.applyTokenFiltering(contexts, input.taskType);
      
      // Step 9: Generate summary and recommendations
      const summary = this.generateSummary(contexts, startTime, patternMatches, dependencyInfo);
      const recommendations = this.generateRecommendations(contexts, textAnalysis, patternMatches);
      const potentialIssues = this.identifyPotentialIssues(contexts, dependencyInfo);
      
      // Step 10: Cache results
      this.cacheResults(input.taskId, contexts);
      
      return {
        contexts,
        summary,
        recommendations,
        potentialIssues
      };
      
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
    this.analysisCache.clear();
  }

  // Private methods

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
    keywords: KeywordResult[];
    entities: EntityResult[];
    intent: IntentClassificationResult;
    combinedText: string;
  }> {
    const cacheKey = `text_analysis_${input.taskId}`;
    
    if (this.analysisCache.has(cacheKey)) {
      return this.analysisCache.get(cacheKey);
    }
    
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
    
    // Extract keywords
    const keywords = this.textAnalyzer.extractKeywords(combinedText, 20);
    
    // Extract entities
    const entities = this.textAnalyzer.extractEntities(combinedText);
    
    // Classify intent
    const intent = this.textAnalyzer.classifyIntent(combinedText, input.taskType);
    
    const result = {
      keywords,
      entities,
      intent,
      combinedText
    };
    
    this.analysisCache.set(cacheKey, result);
    return result;
  }

  private async findRelevantPatterns(textAnalysis: {
    keywords: KeywordResult[];
    entities: EntityResult[];
    intent: IntentClassificationResult;
    combinedText: string;
  }): Promise<{
    functions: FunctionMatch[];
    classes: ClassMatch[];
    patterns: PatternMatch[];
  }> {
    const functions: FunctionMatch[] = [];
    const classes: ClassMatch[] = [];
    const patterns: PatternMatch[] = [];
    
    // Find functions mentioned in entities
    const functionEntities = textAnalysis.entities.filter(e => e.type === 'function');
    for (const entity of functionEntities) {
      const functionMatches = await this.patternMatcher.findFunctionDefinitions(entity.entity);
      functions.push(...functionMatches);
    }
    
    // Find classes mentioned in entities
    const classEntities = textAnalysis.entities.filter(e => e.type === 'class');
    for (const entity of classEntities) {
      const classMatches = await this.patternMatcher.findClassDefinitions(entity.entity);
      classes.push(...classMatches);
    }
    
    // Find similar patterns based on combined text
    if (textAnalysis.combinedText.length > 50) {
      const similarPatterns = await this.patternMatcher.findSimilarPatterns(textAnalysis.combinedText);
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
        if (fs.existsSync(file)) {
          const relationship = await this.dependencyAnalyzer.mapFileRelationships(file);
          fileRelationships.set(file, relationship);
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
    dependencyInfo: any
  ): Promise<CodeSection[]> {
    const sections: CodeSection[] = [];
    
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
      if (fs.existsSync(file)) {
        const relevantSections = await this.extractRelevantSectionsFromFile(file, textAnalysis);
        sections.push(...relevantSections);
      }
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
      const content = fs.readFileSync(filePath, 'utf8');
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
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      // Find lines that contain keywords or entities
      const relevantLines: { line: number; content: string; score: number }[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let score = 0;
        
        // Score based on keyword matches
        for (const keyword of textAnalysis.keywords) {
          if (line.toLowerCase().includes(keyword.keyword.toLowerCase())) {
            score += keyword.score;
          }
        }
        
        // Score based on entity matches
        for (const entity of textAnalysis.entities) {
          if (line.includes(entity.entity)) {
            score += entity.confidence;
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
          filePath,
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
      if (section.content.toLowerCase().includes(keyword.keyword.toLowerCase())) {
        keywordScore += keyword.score;
      }
    }
    score += keywordScore * weights.keywordMatch;
    
    // Entity match score
    let entityScore = 0;
    for (const entity of textAnalysis.entities) {
      if (section.content.includes(entity.entity) || section.relatedEntities.includes(entity.entity)) {
        entityScore += entity.confidence;
      }
    }
    score += entityScore * weights.entityMatch;
    
    // Intent match score
    const intentScore = this.calculateIntentMatchScore(section, textAnalysis.intent);
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

  private calculateIntentMatchScore(section: CodeSection, intent: IntentClassificationResult): number {
    // Simple intent matching based on context type and intent category
    const intentMatches: Record<string, string[]> = {
      'function': ['location', 'type', 'complexity'],
      'class': ['location', 'similarity', 'scope'],
      'import': ['location', 'impact'],
      'usage': ['type', 'scope', 'impact'],
      'comment': ['type', 'scope']
    };
    
    const contextTypeMatches = intentMatches[section.contextType] || [];
    const intentCategory = intent.primaryIntent.category;
    
    return contextTypeMatches.includes(intentCategory) ? 0.8 : 0.3;
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
    dependencyInfo: any
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
    
    return {
      totalContexts: contexts.length,
      highRelevanceContexts,
      mediumRelevanceContexts,
      lowRelevanceContexts,
      averageRelevanceScore,
      processingTimeMs,
      filesAnalyzed,
      patternsFound,
      dependenciesAnalyzed
    };
  }

  private generateRecommendations(
    contexts: CodeContext[],
    textAnalysis: any,
    patternMatches: any
  ): string[] {
    const recommendations: string[] = [];
    
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