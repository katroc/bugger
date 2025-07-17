// Text analysis module for extracting keywords and entities from task descriptions
import * as fs from 'fs';
import * as path from 'path';

export interface KeywordResult {
  keyword: string;
  score: number;
  frequency: number;
}

export interface EntityResult {
  entity: string;
  type: 'function' | 'class' | 'file' | 'variable';
  confidence: number;
}

export interface AnalysisResult {
  keywords: string[];
  entities: string[];
  intent: string;
  confidence: number;
}

export interface IntentResult {
  intent: string;
  confidence: number;
  category: string;
  subIntents?: string[];
}

export type TaskType = 'bug' | 'feature' | 'improvement';

export interface IntentClassificationResult {
  primaryIntent: IntentResult;
  secondaryIntents: IntentResult[];
  taskType: TaskType;
  confidence: number;
}

/**
 * Text analyzer for extracting keywords, entities, and intent from task descriptions
 */
export class TextAnalyzer {
  private commonWords: Set<string>;
  private programmingTerms: Set<string>;
  private documentFrequency: Map<string, number>;
  private totalDocuments: number;

  constructor() {
    this.commonWords = new Set([
      'the', 'and', 'or', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might',
      'must', 'shall', 'this', 'that', 'these', 'those', 'it', 'they', 'we', 'you',
      'he', 'she', 'him', 'her', 'them', 'their', 'our', 'your', 'of', 'from',
      'as', 'but', 'not', 'no', 'yes', 'all', 'any', 'some', 'many', 'few', 'most',
      'other', 'another', 'such', 'what', 'which', 'who', 'whom', 'whose', 'when',
      'where', 'why', 'how', 'if', 'then', 'else', 'than', 'more', 'less', 'very',
      'too', 'so', 'just', 'now', 'here', 'there', 'up', 'down', 'out', 'off',
      'over', 'under', 'again', 'further', 'then', 'once'
    ]);

    this.programmingTerms = new Set([
      'function', 'class', 'method', 'variable', 'constant', 'interface', 'type',
      'module', 'import', 'export', 'return', 'throw', 'catch', 'try', 'async',
      'await', 'promise', 'callback', 'event', 'listener', 'handler', 'component',
      'service', 'controller', 'model', 'view', 'router', 'middleware', 'api',
      'endpoint', 'request', 'response', 'http', 'https', 'json', 'xml', 'html',
      'css', 'javascript', 'typescript', 'python', 'java', 'react', 'angular',
      'vue', 'node', 'express', 'database', 'sql', 'mongodb', 'redis', 'cache',
      'session', 'cookie', 'token', 'auth', 'authentication', 'authorization',
      'login', 'logout', 'user', 'admin', 'role', 'permission', 'security',
      'validation', 'sanitization', 'encryption', 'hash', 'password', 'email',
      'form', 'input', 'output', 'file', 'upload', 'download', 'stream', 'buffer',
      'array', 'object', 'string', 'number', 'boolean', 'null', 'undefined',
      'error', 'exception', 'bug', 'fix', 'patch', 'update', 'upgrade', 'deploy',
      'build', 'compile', 'test', 'debug', 'log', 'console', 'config', 'setting',
      'environment', 'development', 'production', 'staging', 'server', 'client',
      'frontend', 'backend', 'fullstack', 'framework', 'library', 'package',
      'dependency', 'version', 'git', 'commit', 'branch', 'merge', 'pull', 'push'
    ]);

    this.documentFrequency = new Map();
    this.totalDocuments = 0;
  }

  /**
   * Extract keywords from text using TF-IDF algorithm
   */
  public extractKeywords(text: string, maxKeywords: number = 10): KeywordResult[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Tokenize and clean text
    const tokens = this.tokenize(text);
    const cleanTokens = this.filterTokens(tokens);

    if (cleanTokens.length === 0) {
      return [];
    }

    // Calculate term frequency
    const termFrequency = this.calculateTermFrequency(cleanTokens);
    
    // Calculate TF-IDF scores
    const tfidfScores = this.calculateTFIDF(termFrequency, cleanTokens.length);

    // Sort by score and return top keywords
    return Array.from(tfidfScores.entries())
      .map(([term, score]) => ({
        keyword: term,
        score: score,
        frequency: termFrequency.get(term) || 0
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxKeywords);
  }

  /**
   * Extract domain-specific programming terms
   */
  public extractProgrammingTerms(text: string): string[] {
    const tokens = this.tokenize(text);
    const programmingTerms: string[] = [];

    for (const token of tokens) {
      const lowerToken = token.toLowerCase();
      if (this.programmingTerms.has(lowerToken)) {
        programmingTerms.push(token);
      }
    }

    // Also check for case-sensitive programming terms like React, Angular, etc.
    const caseSensitiveTerms = ['React', 'Angular', 'Vue', 'Node', 'Express', 'MongoDB', 'Redis'];
    const words = text.split(/\s+/);
    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '');
      if (caseSensitiveTerms.includes(cleanWord)) {
        programmingTerms.push(cleanWord);
      }
    }

    // Remove duplicates and return
    return Array.from(new Set(programmingTerms));
  }

  /**
   * Extract entities (functions, classes, files, variables) from text
   */
  public extractEntities(text: string): EntityResult[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Check if text has any code-related context
    const hasCodeContext = this.hasCodeContext(text);
    
    const entities: EntityResult[] = [];
    
    // Extract function names
    entities.push(...this.extractFunctionNames(text));
    
    // Extract class names
    entities.push(...this.extractClassNames(text));
    
    // Extract file paths and code references
    entities.push(...this.extractFilePaths(text));
    entities.push(...this.extractCodeReferences(text));
    
    // Extract variable names (only if there's code context)
    if (hasCodeContext) {
      entities.push(...this.extractVariableNames(text));
    }
    
    // Filter out low-confidence entities if no clear code context
    const filteredEntities = hasCodeContext 
      ? entities 
      : entities.filter(e => e.confidence > 0.6);
    
    return this.deduplicateEntities(filteredEntities).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Extract function names from text
   */
  private extractFunctionNames(text: string): EntityResult[] {
    const functionPatterns = [
      // function functionName()
      /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      // functionName() or functionName(args) - standalone function calls (more permissive)
      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      // object.methodName() - method calls
      /\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      // async functionName
      /\basync\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      // arrow functions: const name = () =>
      /\bconst\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\([^)]*\)\s*=>/g,
      // let/var name = () =>
      /\b(?:let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\([^)]*\)\s*=>/g,
      // method or function mentions in text
      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s+(?:method|function)\b/g,
      /\b(?:method|function)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g,
      // "the functionName method" or "functionName function"
      /\bthe\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+(?:method|function)\b/g,
    ];

    const functions: EntityResult[] = [];
    
    for (const pattern of functionPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const functionName = match[1];
        if (functionName && this.isValidIdentifier(functionName) && 
            !this.commonWords.has(functionName.toLowerCase()) &&
            functionName.length > 1) {
          
          // Skip very common words that might be matched by the permissive pattern
          if (pattern.source.includes('\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(')) {
            // This is the permissive pattern, be more selective
            if (this.commonWords.has(functionName.toLowerCase()) || 
                ['user', 'error', 'data', 'info', 'text', 'name', 'value', 'item', 'list'].includes(functionName.toLowerCase())) {
              continue;
            }
          }
          
          functions.push({
            entity: functionName,
            type: 'function',
            confidence: this.calculateEntityConfidence(functionName, 'function', text)
          });
        }
      }
    }

    return this.deduplicateEntities(functions);
  }

  /**
   * Extract class names from text
   */
  private extractClassNames(text: string): EntityResult[] {
    const classPatterns = [
      // class ClassName
      /\bclass\s+([A-Z][a-zA-Z0-9_$]*)/g,
      // new ClassName()
      /\bnew\s+([A-Z][a-zA-Z0-9_$]*)\s*\(/g,
      // extends ClassName
      /\bextends\s+([A-Z][a-zA-Z0-9_$]*)/g,
      // implements ClassName
      /\bimplements\s+([A-Z][a-zA-Z0-9_$]*)/g,
    ];

    const classes: EntityResult[] = [];
    
    for (const pattern of classPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const className = match[1];
        if (className && this.isValidIdentifier(className) && className.length > 2) {
          classes.push({
            entity: className,
            type: 'class',
            confidence: this.calculateEntityConfidence(className, 'class', text)
          });
        }
      }
    }

    // Only extract PascalCase words if there's clear code context
    if (this.hasCodeContext(text)) {
      const pascalCasePattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]*)*)\b/g;
      let match;
      while ((match = pascalCasePattern.exec(text)) !== null) {
        const className = match[1];
        if (className && this.isValidIdentifier(className) && className.length > 2 &&
            !this.commonWords.has(className.toLowerCase()) &&
            // Skip common English words that happen to be capitalized
            !['This', 'That', 'These', 'Those', 'The', 'A', 'An', 'And', 'Or', 'But', 'If', 'When', 'Where', 'How', 'Why', 'What', 'Who'].includes(className)) {
          classes.push({
            entity: className,
            type: 'class',
            confidence: this.calculateEntityConfidence(className, 'class', text)
          });
        }
      }
    }

    return this.deduplicateEntities(classes);
  }

  /**
   * Extract file paths from text
   */
  private extractFilePaths(text: string): EntityResult[] {
    const filePatterns = [
      // Relative paths: ./path/file.ext or ../path/file.ext
      /\.\.?\/[a-zA-Z0-9_\-\/\.]+\.[a-zA-Z0-9]+/g,
      // Absolute paths: /path/file.ext
      /\/[a-zA-Z0-9_\-\/\.]+\.[a-zA-Z0-9]+/g,
      // Windows paths: C:\path\file.ext
      /[A-Z]:\\[a-zA-Z0-9_\-\\\.]+\.[a-zA-Z0-9]+/g,
      // Common file patterns: filename.ext
      /\b[a-zA-Z0-9_\-]+\.(js|ts|jsx|tsx|py|java|rb|php|go|cs|html|css|json|md|yml|yaml|xml|sql|sh|bat)\b/g,
      // Path patterns: src/path/file.ext or path/to/file.ext
      /\b[a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-]+)*\/[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+/g,
      // Directory paths without extensions: src/components, api/auth
      /\b[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-\/]+(?!\.[a-zA-Z0-9]+)/g,
      // Scoped packages: @package/name
      /@[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-]+/g,
      // Hyphenated packages: package-name
      /\b[a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)+\b/g,
    ];

    const files: EntityResult[] = [];
    
    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const filePath = match[0];
        if (filePath && (filePath.includes('.') || filePath.includes('/') || filePath.includes('@') || filePath.includes('-'))) {
          // Skip if it's just a common word with hyphens
          if (filePath.includes('-') && !filePath.includes('/') && !filePath.includes('@') && !filePath.includes('.')) {
            // Only include if it looks like a package name (has multiple parts)
            const parts = filePath.split('-');
            if (parts.length < 2 || parts.some(part => this.commonWords.has(part.toLowerCase()))) {
              continue;
            }
          }
          
          files.push({
            entity: filePath,
            type: 'file',
            confidence: this.calculateEntityConfidence(filePath, 'file', text)
          });
        }
      }
    }

    // Also extract path components as separate entities for better keyword extraction
    const pathComponents: EntityResult[] = [];
    for (const file of files) {
      if (file.entity.includes('/')) {
        const parts = file.entity.split('/');
        for (const part of parts) {
          if (part && part.length > 2 && !this.commonWords.has(part.toLowerCase()) && 
              !part.includes('.') && /^[a-zA-Z][a-zA-Z0-9_\-]*$/.test(part)) {
            pathComponents.push({
              entity: part,
              type: 'file',
              confidence: Math.max(0.3, file.confidence - 0.2)
            });
          }
        }
      }
    }

    return this.deduplicateEntities([...files, ...pathComponents]);
  }

  /**
   * Extract code references (method calls, property access, etc.) from text
   */
  private extractCodeReferences(text: string): EntityResult[] {
    const codeReferences: EntityResult[] = [];
    
    // Method calls with dot notation: object.method()
    this.extractWithPattern(text, /([a-zA-Z_$][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, 
      (matches) => {
        if (matches[1]) codeReferences.push({ entity: matches[1], type: 'variable', confidence: 0.6 });
        if (matches[2]) codeReferences.push({ entity: matches[2], type: 'function', confidence: 0.7 });
      });

    // Property access: object.property
    this.extractWithPattern(text, /([a-zA-Z_$][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)\b(?!\s*\()/g,
      (matches) => {
        if (matches[1]) codeReferences.push({ entity: matches[1], type: 'variable', confidence: 0.5 });
        if (matches[2]) codeReferences.push({ entity: matches[2], type: 'variable', confidence: 0.6 });
      });

    // Template literals with variables: ${variable}
    this.extractWithPattern(text, /\$\{([a-zA-Z_$][a-zA-Z0-9_$]*)\}/g,
      (matches) => {
        if (matches[1]) codeReferences.push({ entity: matches[1], type: 'variable', confidence: 0.7 });
      });

    // Destructuring patterns: { prop, prop2 } or { prop: alias }
    this.extractWithPattern(text, /\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*(?:\s*,\s*[a-zA-Z_$][a-zA-Z0-9_$]*)*)\s*\}/g,
      (matches) => {
        if (matches[1]) {
          // Split by comma and extract each property
          const props = matches[1].split(',').map(p => p.trim());
          for (const prop of props) {
            // Handle { prop: alias } pattern
            const colonIndex = prop.indexOf(':');
            const propName = colonIndex > -1 ? prop.substring(0, colonIndex).trim() : prop;
            if (propName && this.isValidIdentifier(propName)) {
              codeReferences.push({ entity: propName, type: 'variable', confidence: 0.7 });
            }
          }
        }
      });

    // Import statements: import { name1, name2 } from 'module'
    this.extractWithPattern(text, /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
      (matches) => {
        if (matches[1]) {
          const imports = matches[1].split(',').map(i => i.trim());
          for (const imp of imports) {
            const colonIndex = imp.indexOf(':');
            const importName = colonIndex > -1 ? imp.substring(0, colonIndex).trim() : imp;
            if (importName && this.isValidIdentifier(importName)) {
              const entityType = /^[A-Z]/.test(importName) ? 'class' : 'function';
              codeReferences.push({ entity: importName, type: entityType, confidence: 0.8 });
            }
          }
        }
        if (matches[2]) {
          codeReferences.push({ entity: matches[2], type: 'file', confidence: 0.9 });
        }
      });

    // Export statements: export { name1, name2 } or "Export { name1, name2 } statement"
    this.extractWithPattern(text, /export\s*\{\s*([^}]+)\s*\}/gi,
      (matches) => {
        if (matches[1]) {
          const exports = matches[1].split(',').map(e => e.trim());
          for (const exp of exports) {
            const colonIndex = exp.indexOf(':');
            const exportName = colonIndex > -1 ? exp.substring(0, colonIndex).trim() : exp;
            if (exportName && this.isValidIdentifier(exportName)) {
              const entityType = /^[A-Z]/.test(exportName) ? 'class' : 'function';
              codeReferences.push({ entity: exportName, type: entityType, confidence: 0.8 });
            }
          }
        }
      });

    // Also handle export statements mentioned in text
    this.extractWithPattern(text, /export\s*\{\s*([^}]+)\s*\}\s*statement/gi,
      (matches) => {
        if (matches[1]) {
          const exports = matches[1].split(',').map(e => e.trim());
          for (const exp of exports) {
            const colonIndex = exp.indexOf(':');
            const exportName = colonIndex > -1 ? exp.substring(0, colonIndex).trim() : exp;
            if (exportName && this.isValidIdentifier(exportName)) {
              const entityType = /^[A-Z]/.test(exportName) ? 'class' : 'function';
              codeReferences.push({ entity: exportName, type: entityType, confidence: 0.8 });
            }
          }
        }
      });

    // Array/object access: obj[key] or obj['key']
    this.extractWithPattern(text, /([a-zA-Z_$][a-zA-Z0-9_$]*)\[['"]?([a-zA-Z_$][a-zA-Z0-9_$]*)['"]?\]/g,
      (matches) => {
        if (matches[1]) codeReferences.push({ entity: matches[1], type: 'variable', confidence: 0.6 });
        if (matches[2]) codeReferences.push({ entity: matches[2], type: 'variable', confidence: 0.5 });
      });

    // JSX component references: <ComponentName>
    this.extractWithPattern(text, /<([A-Z][a-zA-Z0-9]*)/g,
      (matches) => {
        if (matches[1]) codeReferences.push({ entity: matches[1], type: 'class', confidence: 0.8 });
      });

    // CSS class references: className="class-name" or class="class-name"
    this.extractWithPattern(text, /(?:className|class)=['"]([a-zA-Z0-9_-]+)['"]/g,
      (matches) => {
        if (matches[1]) codeReferences.push({ entity: matches[1], type: 'file', confidence: 0.7 });
      });

    // URL/API endpoint patterns: '/api/endpoint' or "/api/endpoint"
    this.extractWithPattern(text, /['"]([\/][a-zA-Z0-9_\-\/]+)['"]/g,
      (matches) => {
        if (matches[1]) codeReferences.push({ entity: matches[1], type: 'file', confidence: 0.8 });
      });

    return this.deduplicateEntities(codeReferences);
  }

  /**
   * Helper method to extract entities using a pattern and callback
   */
  private extractWithPattern(text: string, pattern: RegExp, callback: (matches: string[]) => void): void {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Filter out empty matches and common words
      const filteredMatches = match.filter(m => 
        m && m.trim().length > 1 && !this.commonWords.has(m.toLowerCase())
      );
      if (filteredMatches.length > 0) {
        callback(match);
      }
    }
  }

  /**
   * Extract variable names from text
   */
  private extractVariableNames(text: string): EntityResult[] {
    const variablePatterns = [
      // const/let/var variableName
      /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      // camelCase variables (but not in regular text)
      /\b([a-z][a-zA-Z0-9]*(?:[A-Z][a-z0-9]*)*)\b/g,
      // snake_case variables
      /\b([a-z]+(?:_[a-z0-9]+)+)\b/g,
    ];

    const variables: EntityResult[] = [];
    
    for (const pattern of variablePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const variableName = match[1];
        if (variableName && this.isValidIdentifier(variableName) && 
            !this.programmingTerms.has(variableName.toLowerCase()) &&
            !this.commonWords.has(variableName.toLowerCase()) &&
            variableName.length > 2) {
          
          // For camelCase pattern, only include if it's likely a variable
          if (pattern.source.includes('camelCase') || pattern.source.includes('[a-z][a-zA-Z0-9]')) {
            // Skip if it's just a regular word that happens to be camelCase
            const hasCodeContext = text.toLowerCase().includes('variable') || 
                                 text.toLowerCase().includes('const') ||
                                 text.toLowerCase().includes('let') ||
                                 text.toLowerCase().includes('var') ||
                                 /\b(const|let|var)\s+/.test(text);
            
            if (!hasCodeContext && !this.isLikelyCodeIdentifier(variableName)) {
              continue;
            }
          }
          
          variables.push({
            entity: variableName,
            type: 'variable',
            confidence: this.calculateEntityConfidence(variableName, 'variable', text)
          });
        }
      }
    }

    return this.deduplicateEntities(variables);
  }

  /**
   * Check if a string is a valid identifier
   */
  private isValidIdentifier(identifier: string): boolean {
    // Must start with letter, underscore, or $
    // Can contain letters, numbers, underscores, $
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(identifier);
  }

  /**
   * Calculate confidence score for an entity
   */
  private calculateEntityConfidence(entity: string, type: string, context: string): number {
    let confidence = 0.5; // Base confidence
    
    // Boost confidence based on context clues
    const lowerContext = context.toLowerCase();
    const lowerEntity = entity.toLowerCase();
    
    switch (type) {
      case 'function':
        if (lowerContext.includes('function') || lowerContext.includes('method') || 
            lowerContext.includes('call') || entity.includes('()')) {
          confidence += 0.3;
        }
        if (this.isCodeIdentifier(entity)) {
          confidence += 0.2;
        }
        break;
        
      case 'class':
        if (lowerContext.includes('class') || lowerContext.includes('component') ||
            lowerContext.includes('service') || lowerContext.includes('controller')) {
          confidence += 0.3;
        }
        if (/^[A-Z]/.test(entity)) { // Starts with capital letter
          confidence += 0.2;
        }
        break;
        
      case 'file':
        if (entity.includes('/') || entity.includes('\\') || entity.includes('.')) {
          confidence += 0.3;
        }
        if (lowerContext.includes('file') || lowerContext.includes('import') ||
            lowerContext.includes('require')) {
          confidence += 0.2;
        }
        break;
        
      case 'variable':
        if (lowerContext.includes('variable') || lowerContext.includes('const') ||
            lowerContext.includes('let') || lowerContext.includes('var')) {
          confidence += 0.3;
        }
        if (this.isCodeIdentifier(entity)) {
          confidence += 0.1;
        }
        break;
    }
    
    // Penalize very common words
    if (this.commonWords.has(lowerEntity)) {
      confidence -= 0.4;
    }
    
    // Boost programming-related terms
    if (this.programmingTerms.has(lowerEntity)) {
      confidence += 0.1;
    }
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Remove duplicate entities
   */
  private deduplicateEntities(entities: EntityResult[]): EntityResult[] {
    const seen = new Map<string, EntityResult>();
    
    for (const entity of entities) {
      const key = `${entity.entity.toLowerCase()}-${entity.type}`;
      const existing = seen.get(key);
      
      if (!existing || entity.confidence > existing.confidence) {
        seen.set(key, entity);
      }
    }
    
    return Array.from(seen.values());
  }

  /**
   * Update document frequency for TF-IDF calculation
   */
  public updateDocumentFrequency(texts: string[]): void {
    this.totalDocuments = texts.length;
    this.documentFrequency.clear();

    for (const text of texts) {
      const tokens = this.tokenize(text);
      const uniqueTokens = new Set(this.filterTokens(tokens));

      for (const token of uniqueTokens) {
        const currentCount = this.documentFrequency.get(token) || 0;
        this.documentFrequency.set(token, currentCount + 1);
      }
    }
  }

  /**
   * Tokenize text into individual words
   */
  private tokenize(text: string): string[] {
    // Handle camelCase and PascalCase
    const camelCaseExpanded = text.replace(/([a-z])([A-Z])/g, '$1 $2');
    
    // Handle snake_case and kebab-case
    const caseExpanded = camelCaseExpanded.replace(/[_-]/g, ' ');
    
    // Extract words, preserving file extensions and paths
    const tokens = caseExpanded
      .toLowerCase()
      .replace(/[^\w\s\.\/\\]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0);

    return tokens;
  }

  /**
   * Filter out common words and very short tokens
   */
  private filterTokens(tokens: string[]): string[] {
    return tokens.filter(token => {
      const lowerToken = token.toLowerCase();
      return (
        token.length > 2 &&
        !this.commonWords.has(lowerToken) &&
        !/^\d+$/.test(token) // Remove pure numbers
      );
    });
  }

  /**
   * Calculate term frequency for tokens
   */
  private calculateTermFrequency(tokens: string[]): Map<string, number> {
    const termFreq = new Map<string, number>();
    
    for (const token of tokens) {
      const lowerToken = token.toLowerCase();
      termFreq.set(lowerToken, (termFreq.get(lowerToken) || 0) + 1);
    }

    return termFreq;
  }

  /**
   * Calculate TF-IDF scores for terms
   */
  private calculateTFIDF(termFrequency: Map<string, number>, totalTerms: number): Map<string, number> {
    const tfidfScores = new Map<string, number>();

    for (const [term, freq] of termFrequency.entries()) {
      // Term Frequency (normalized)
      const tf = freq / totalTerms;
      
      // Inverse Document Frequency
      const docFreq = this.documentFrequency.get(term) || 1;
      const totalDocs = Math.max(this.totalDocuments, 1); // Avoid division by zero
      const idf = Math.log(totalDocs / docFreq);
      
      // TF-IDF Score with programming term boost
      let tfidf = tf * Math.max(idf, 0.1); // Ensure positive score
      
      // Boost programming-related terms
      if (this.programmingTerms.has(term)) {
        tfidf *= 1.5;
      }
      
      // Boost terms that look like code identifiers
      if (this.isCodeIdentifier(term)) {
        tfidf *= 1.3;
      }

      tfidfScores.set(term, tfidf);
    }

    return tfidfScores;
  }

  /**
   * Check if a term looks like a code identifier
   */
  private isCodeIdentifier(term: string): boolean {
    // Check for camelCase, PascalCase, snake_case patterns
    const codePatterns = [
      /^[a-z]+[A-Z][a-zA-Z]*$/, // camelCase
      /^[A-Z][a-zA-Z]*$/, // PascalCase
      /^[a-z]+_[a-z_]+$/, // snake_case
      /\.(js|ts|py|java|rb|php|go|cs|html|css|json|md|yml|yaml)$/, // file extensions
      /^[a-zA-Z]+\.[a-zA-Z]+/, // method calls like obj.method
    ];

    return codePatterns.some(pattern => pattern.test(term));
  }

  /**
   * Check if a term is likely a code identifier (more lenient than isCodeIdentifier)
   */
  private isLikelyCodeIdentifier(term: string): boolean {
    // Check for patterns that suggest code usage
    return (
      // Has camelCase pattern
      /^[a-z]+[A-Z][a-zA-Z]*$/.test(term) ||
      // Has snake_case pattern
      /^[a-z]+_[a-z_]+$/.test(term) ||
      // Contains common code prefixes/suffixes
      /^(get|set|is|has|can|should|will|on|handle|process|create|update|delete|fetch|load|save|init|start|stop|run|exec)/.test(term.toLowerCase()) ||
      /(Handler|Service|Controller|Manager|Provider|Factory|Builder|Util|Helper|Config|Settings|Data|Info|Result|Response|Request|Error|Exception)$/.test(term) ||
      // Programming-related terms
      this.programmingTerms.has(term.toLowerCase())
    );
  }

  /**
   * Check if text has code-related context
   */
  private hasCodeContext(text: string): boolean {
    const lowerText = text.toLowerCase();
    
    // Check for explicit programming keywords
    const codeKeywords = [
      'function', 'class', 'method', 'variable', 'const', 'let', 'var',
      'import', 'export', 'require', 'module', 'component', 'service',
      'api', 'endpoint', 'database', 'query', 'error', 'exception',
      'bug', 'fix', 'code', 'script', 'file', 'directory', 'path'
    ];
    
    const hasKeywords = codeKeywords.some(keyword => lowerText.includes(keyword));
    
    // Check for code patterns
    const codePatterns = [
      /\b[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/,  // function calls
      /\.[a-zA-Z_$][a-zA-Z0-9_$]*/,       // property access
      /\b[a-zA-Z_$][a-zA-Z0-9_$]*\.[a-zA-Z_$][a-zA-Z0-9_$]*/,  // object.property
      /[a-zA-Z0-9_\-]+\.(js|ts|jsx|tsx|py|java|rb|php|go|cs|html|css|json)/,  // file extensions
      /\/[a-zA-Z0-9_\-\/]+/,              // paths
      /@[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-]+/, // scoped packages
      /\$\{[a-zA-Z_$][a-zA-Z0-9_$]*\}/,   // template literals
      /<[A-Z][a-zA-Z0-9]*>/,              // JSX components
      /\b(const|let|var)\s+[a-zA-Z_$]/,   // variable declarations
      /\bclass\s+[A-Z][a-zA-Z0-9_$]*/,    // class declarations
    ];
    
    const hasPatterns = codePatterns.some(pattern => pattern.test(text));
    
    return hasKeywords || hasPatterns;
  }

  /**
   * Classify intent for task types (bug location, feature similarity, improvement scope)
   */
  public classifyIntent(text: string, taskType: TaskType): IntentClassificationResult {
    if (!text || text.trim().length === 0) {
      return {
        primaryIntent: { intent: 'unknown', confidence: 0, category: 'general' },
        secondaryIntents: [],
        taskType,
        confidence: 0
      };
    }

    const lowerText = text.toLowerCase();
    const keywords = this.extractKeywords(text, 15);
    const entities = this.extractEntities(text);
    
    let primaryIntent: IntentResult;
    let secondaryIntents: IntentResult[] = [];
    
    switch (taskType) {
      case 'bug':
        primaryIntent = this.classifyBugIntent(lowerText, keywords, entities);
        secondaryIntents = this.classifyBugSecondaryIntents(lowerText, keywords, entities);
        break;
      case 'feature':
        primaryIntent = this.classifyFeatureIntent(lowerText, keywords, entities);
        secondaryIntents = this.classifyFeatureSecondaryIntents(lowerText, keywords, entities);
        break;
      case 'improvement':
        primaryIntent = this.classifyImprovementIntent(lowerText, keywords, entities);
        secondaryIntents = this.classifyImprovementSecondaryIntents(lowerText, keywords, entities);
        break;
      default:
        primaryIntent = { intent: 'unknown', confidence: 0, category: 'general' };
    }

    // Calculate overall confidence based on primary intent and context strength
    const overallConfidence = this.calculateOverallIntentConfidence(primaryIntent, secondaryIntents, text);

    return {
      primaryIntent,
      secondaryIntents,
      taskType,
      confidence: overallConfidence
    };
  }

  /**
   * Classify bug-specific intent (location, type, severity)
   */
  private classifyBugIntent(text: string, keywords: KeywordResult[], entities: EntityResult[]): IntentResult {
    const bugPatterns = {
      // Location-based intents
      frontend: {
        keywords: ['ui', 'interface', 'component', 'render', 'display', 'css', 'html', 'react', 'angular', 'vue', 'dom', 'browser', 'client'],
        confidence: 0.8,
        category: 'location'
      },
      backend: {
        keywords: ['api', 'server', 'database', 'query', 'endpoint', 'service', 'controller', 'model', 'auth', 'middleware'],
        confidence: 0.8,
        category: 'location'
      },
      database: {
        keywords: ['database', 'sql', 'query', 'table', 'schema', 'migration', 'connection', 'mongodb', 'postgres', 'mysql'],
        confidence: 0.9,
        category: 'location'
      },
      authentication: {
        keywords: ['auth', 'login', 'logout', 'token', 'session', 'permission', 'role', 'security', 'password'],
        confidence: 0.85,
        category: 'location'
      },
      
      // Type-based intents
      logic_error: {
        keywords: ['wrong', 'incorrect', 'unexpected', 'logic', 'calculation', 'algorithm', 'condition', 'if', 'else'],
        confidence: 0.7,
        category: 'type'
      },
      runtime_error: {
        keywords: ['crash', 'exception', 'error', 'null', 'undefined', 'reference', 'memory', 'timeout'],
        confidence: 0.8,
        category: 'type'
      },
      performance: {
        keywords: ['slow', 'performance', 'speed', 'optimization', 'memory', 'cpu', 'load', 'latency'],
        confidence: 0.75,
        category: 'type'
      },
      integration: {
        keywords: ['integration', 'api', 'external', 'third-party', 'webhook', 'callback', 'sync'],
        confidence: 0.7,
        category: 'type'
      }
    };

    return this.findBestIntentMatch(text, keywords, entities, bugPatterns);
  }

  /**
   * Classify feature-specific intent (similarity, complexity, scope)
   */
  private classifyFeatureIntent(text: string, keywords: KeywordResult[], entities: EntityResult[]): IntentResult {
    const featurePatterns = {
      // Similarity-based intents
      crud_operations: {
        keywords: ['create', 'read', 'update', 'delete', 'add', 'edit', 'remove', 'list', 'view', 'manage'],
        confidence: 0.8,
        category: 'similarity'
      },
      user_management: {
        keywords: ['user', 'account', 'profile', 'registration', 'login', 'auth', 'permission', 'role'],
        confidence: 0.85,
        category: 'similarity'
      },
      data_visualization: {
        keywords: ['chart', 'graph', 'dashboard', 'report', 'analytics', 'visualization', 'display', 'show'],
        confidence: 0.8,
        category: 'similarity'
      },
      api_integration: {
        keywords: ['api', 'integration', 'external', 'service', 'webhook', 'endpoint', 'rest', 'graphql'],
        confidence: 0.8,
        category: 'similarity'
      },
      
      // Complexity-based intents
      simple_ui: {
        keywords: ['button', 'form', 'input', 'field', 'simple', 'basic', 'page', 'view'],
        confidence: 0.6,
        category: 'complexity'
      },
      complex_workflow: {
        keywords: ['workflow', 'process', 'step', 'wizard', 'multi', 'complex', 'advanced', 'pipeline'],
        confidence: 0.8,
        category: 'complexity'
      },
      real_time: {
        keywords: ['real-time', 'live', 'websocket', 'streaming', 'notification', 'instant', 'immediate'],
        confidence: 0.9,
        category: 'complexity'
      }
    };

    return this.findBestIntentMatch(text, keywords, entities, featurePatterns);
  }

  /**
   * Classify improvement-specific intent (scope, impact, priority)
   */
  private classifyImprovementIntent(text: string, keywords: KeywordResult[], entities: EntityResult[]): IntentResult {
    const improvementPatterns = {
      // Scope-based intents
      performance_optimization: {
        keywords: ['performance', 'optimize', 'speed', 'faster', 'efficient', 'memory', 'cpu', 'cache', 'load'],
        confidence: 0.9,
        category: 'scope'
      },
      code_quality: {
        keywords: ['refactor', 'clean', 'maintainable', 'readable', 'structure', 'organize', 'quality'],
        confidence: 0.8,
        category: 'scope'
      },
      security_enhancement: {
        keywords: ['security', 'secure', 'vulnerability', 'encryption', 'auth', 'permission', 'safe'],
        confidence: 0.9,
        category: 'scope'
      },
      user_experience: {
        keywords: ['ux', 'ui', 'user', 'experience', 'interface', 'usability', 'accessibility', 'design'],
        confidence: 0.8,
        category: 'scope'
      },
      
      // Impact-based intents
      architectural: {
        keywords: ['architecture', 'structure', 'design', 'pattern', 'framework', 'system', 'infrastructure'],
        confidence: 0.85,
        category: 'impact'
      },
      localized: {
        keywords: ['function', 'method', 'component', 'specific', 'single', 'individual', 'particular'],
        confidence: 0.6,
        category: 'impact'
      },
      cross_cutting: {
        keywords: ['across', 'throughout', 'global', 'system-wide', 'all', 'entire', 'multiple'],
        confidence: 0.8,
        category: 'impact'
      }
    };

    return this.findBestIntentMatch(text, keywords, entities, improvementPatterns);
  }

  /**
   * Find the best intent match based on keyword and entity analysis
   */
  private findBestIntentMatch(
    text: string, 
    keywords: KeywordResult[], 
    entities: EntityResult[], 
    patterns: Record<string, { keywords: string[], confidence: number, category: string }>
  ): IntentResult {
    let bestMatch: IntentResult = { intent: 'general', confidence: 0.3, category: 'general' };
    let bestScore = 0;

    const keywordStrings = keywords.map(k => k.keyword.toLowerCase());
    const entityStrings = entities.map(e => e.entity.toLowerCase());
    const allTerms = [...keywordStrings, ...entityStrings];

    for (const [intentName, pattern] of Object.entries(patterns)) {
      let score = 0;
      let matchCount = 0;

      // Check keyword matches
      for (const patternKeyword of pattern.keywords) {
        if (text.includes(patternKeyword)) {
          score += 2; // Direct text match gets higher score
          matchCount++;
        } else if (allTerms.some(term => term.includes(patternKeyword) || patternKeyword.includes(term))) {
          score += 1; // Partial match gets lower score
          matchCount++;
        }
      }

      // Calculate confidence based on match ratio and pattern confidence
      const matchRatio = matchCount / pattern.keywords.length;
      const finalScore = score * matchRatio * pattern.confidence;

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestMatch = {
          intent: intentName,
          confidence: Math.min(0.95, finalScore / 10), // Normalize to 0-0.95 range
          category: pattern.category
        };
      }
    }

    return bestMatch;
  }

  /**
   * Classify secondary intents for bugs
   */
  private classifyBugSecondaryIntents(text: string, keywords: KeywordResult[], entities: EntityResult[]): IntentResult[] {
    const secondaryIntents: IntentResult[] = [];

    // Check for severity indicators
    if (text.includes('critical') || text.includes('urgent') || text.includes('blocking')) {
      secondaryIntents.push({ intent: 'high_severity', confidence: 0.8, category: 'severity' });
    } else if (text.includes('minor') || text.includes('cosmetic') || text.includes('low')) {
      secondaryIntents.push({ intent: 'low_severity', confidence: 0.7, category: 'severity' });
    }

    // Check for reproducibility
    if (text.includes('always') || text.includes('consistently') || text.includes('every time')) {
      secondaryIntents.push({ intent: 'reproducible', confidence: 0.8, category: 'reproducibility' });
    } else if (text.includes('sometimes') || text.includes('intermittent') || text.includes('random')) {
      secondaryIntents.push({ intent: 'intermittent', confidence: 0.7, category: 'reproducibility' });
    }

    return secondaryIntents;
  }

  /**
   * Classify secondary intents for features
   */
  private classifyFeatureSecondaryIntents(text: string, keywords: KeywordResult[], entities: EntityResult[]): IntentResult[] {
    const secondaryIntents: IntentResult[] = [];

    // Check for urgency
    if (text.includes('urgent') || text.includes('asap') || text.includes('priority')) {
      secondaryIntents.push({ intent: 'high_priority', confidence: 0.8, category: 'priority' });
    }

    // Check for user-facing vs internal
    if (text.includes('user') || text.includes('customer') || text.includes('client')) {
      secondaryIntents.push({ intent: 'user_facing', confidence: 0.7, category: 'visibility' });
    } else if (text.includes('internal') || text.includes('admin') || text.includes('developer')) {
      secondaryIntents.push({ intent: 'internal', confidence: 0.7, category: 'visibility' });
    }

    return secondaryIntents;
  }

  /**
   * Classify secondary intents for improvements
   */
  private classifyImprovementSecondaryIntents(text: string, keywords: KeywordResult[], entities: EntityResult[]): IntentResult[] {
    const secondaryIntents: IntentResult[] = [];

    // Check for effort estimation
    if (text.includes('quick') || text.includes('simple') || text.includes('easy')) {
      secondaryIntents.push({ intent: 'low_effort', confidence: 0.7, category: 'effort' });
    } else if (text.includes('complex') || text.includes('major') || text.includes('significant')) {
      secondaryIntents.push({ intent: 'high_effort', confidence: 0.8, category: 'effort' });
    }

    // Check for impact scope
    if (text.includes('breaking') || text.includes('compatibility') || text.includes('migration')) {
      secondaryIntents.push({ intent: 'breaking_change', confidence: 0.9, category: 'impact' });
    }

    return secondaryIntents;
  }

  /**
   * Calculate overall intent confidence
   */
  private calculateOverallIntentConfidence(
    primaryIntent: IntentResult, 
    secondaryIntents: IntentResult[], 
    text: string
  ): number {
    let confidence = primaryIntent.confidence;

    // Boost confidence if we have supporting secondary intents
    if (secondaryIntents.length > 0) {
      const avgSecondaryConfidence = secondaryIntents.reduce((sum, intent) => sum + intent.confidence, 0) / secondaryIntents.length;
      confidence = Math.min(0.95, confidence + (avgSecondaryConfidence * 0.1));
    }

    // Boost confidence if text has clear code context
    if (this.hasCodeContext(text)) {
      confidence = Math.min(0.95, confidence + 0.05);
    }

    // Penalize very short descriptions
    if (text.length < 20) {
      confidence *= 0.8;
    }

    return Math.max(0.1, confidence);
  }

  /**
   * Get keyword extraction statistics
   */
  public getStats(): { totalDocuments: number; vocabularySize: number } {
    return {
      totalDocuments: this.totalDocuments,
      vocabularySize: this.documentFrequency.size
    };
  }
}

/**
 * Singleton instance for global use
 */
export const textAnalyzer = new TextAnalyzer();