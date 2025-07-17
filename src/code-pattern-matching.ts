// Code pattern matching system for finding functions, classes, and similar patterns
import * as fs from 'fs';
import * as path from 'path';

export interface FunctionMatch {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  parameters: string[];
  returnType?: string;
  isAsync: boolean;
  isMethod: boolean;
  className?: string;
  accessibility?: 'public' | 'private' | 'protected';
  relevanceScore: number;
}

export interface ClassMatch {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  extendsClass?: string;
  implements: string[];
  methods: string[];
  properties: string[];
  isAbstract: boolean;
  isInterface: boolean;
  relevanceScore: number;
}

export interface PatternMatch {
  pattern: string;
  filePath: string;
  startLine: number;
  endLine: number;
  similarity: number;
  context: string[];
  matchType: 'exact' | 'structural' | 'semantic';
}

export interface ArchitecturalContext {
  configFiles: string[];
  dependencies: string[];
  relationships: Array<{
    from: string;
    to: string;
    type: 'import' | 'inheritance' | 'composition' | 'usage';
    strength: number;
  }>;
  patterns: Array<{
    name: string;
    type: 'mvc' | 'service' | 'repository' | 'factory' | 'singleton' | 'observer';
    files: string[];
    confidence: number;
  }>;
}

export interface CodeTraversalOptions {
  includeExtensions: string[];
  excludePatterns: string[];
  maxDepth: number;
  followSymlinks: boolean;
  ignoreCase: boolean;
}

export interface PatternSearchOptions {
  maxResults: number;
  minSimilarity: number;
  includeComments: boolean;
  normalizeWhitespace: boolean;
  caseSensitive: boolean;
}

/**
 * Main code pattern matching engine
 */
export class CodePatternMatcher {
  private readonly defaultExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.rb', '.php', '.go', '.cs'];
  private readonly defaultExcludePatterns = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '__pycache__',
    '.venv',
    'venv',
    'target',
    'bin',
    'obj'
  ];

  constructor(private rootPath: string = process.cwd()) {}

  /**
   * Find function definitions across the codebase
   */
  public async findFunctionDefinitions(
    functionName?: string,
    options: CodeTraversalOptions = this.getDefaultTraversalOptions()
  ): Promise<FunctionMatch[]> {
    const files = await this.traverseCodebase(options);
    const functionMatches: FunctionMatch[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const matches = this.extractFunctionDefinitions(content, file, functionName);
        functionMatches.push(...matches);
      } catch (error) {
        console.error(`Error reading file ${file}:`, error);
      }
    }

    return functionMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Find class definitions across the codebase
   */
  public async findClassDefinitions(
    className?: string,
    options: CodeTraversalOptions = this.getDefaultTraversalOptions()
  ): Promise<ClassMatch[]> {
    const files = await this.traverseCodebase(options);
    const classMatches: ClassMatch[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const matches = this.extractClassDefinitions(content, file, className);
        classMatches.push(...matches);
      } catch (error) {
        console.error(`Error reading file ${file}:`, error);
      }
    }

    return classMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Find similar code patterns to a given pattern
   */
  public async findSimilarPatterns(
    targetPattern: string,
    options: PatternSearchOptions = this.getDefaultPatternSearchOptions()
  ): Promise<PatternMatch[]> {
    const files = await this.traverseCodebase(this.getDefaultTraversalOptions());
    const patternMatches: PatternMatch[] = [];

    const normalizedTarget = this.normalizePattern(targetPattern, options);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const matches = this.findPatternMatches(content, file, normalizedTarget, options);
        patternMatches.push(...matches);
      } catch (error) {
        console.error(`Error reading file ${file}:`, error);
      }
    }

    return patternMatches
      .filter(match => match.similarity >= options.minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.maxResults);
  }

  /**
   * Analyze architectural context and patterns
   */
  public async analyzeArchitecturalContext(): Promise<ArchitecturalContext> {
    const files = await this.traverseCodebase(this.getDefaultTraversalOptions());
    
    const configFiles = this.findConfigurationFiles(files);
    const dependencies = await this.extractDependencies(files);
    const relationships = await this.analyzeRelationships(files);
    const patterns = await this.detectArchitecturalPatterns(files);

    return {
      configFiles,
      dependencies,
      relationships,
      patterns
    };
  }

  /**
   * Traverse the codebase and collect relevant files
   */
  private async traverseCodebase(options: CodeTraversalOptions): Promise<string[]> {
    const files: string[] = [];
    
    const traverse = (dir: string, currentDepth: number = 0) => {
      if (currentDepth > options.maxDepth) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          // Skip excluded patterns
          if (this.shouldExclude(fullPath, options.excludePatterns)) {
            continue;
          }

          if (entry.isDirectory()) {
            traverse(fullPath, currentDepth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (options.includeExtensions.includes(ext)) {
              files.push(fullPath);
            }
          } else if (entry.isSymbolicLink() && options.followSymlinks) {
            const resolvedPath = fs.readlinkSync(fullPath);
            if (fs.existsSync(resolvedPath)) {
              const stat = fs.statSync(resolvedPath);
              if (stat.isDirectory()) {
                traverse(resolvedPath, currentDepth + 1);
              } else if (stat.isFile()) {
                const ext = path.extname(resolvedPath).toLowerCase();
                if (options.includeExtensions.includes(ext)) {
                  files.push(resolvedPath);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error traversing directory ${dir}:`, error);
      }
    };

    traverse(this.rootPath);
    return files;
  }

  /**
   * Extract function definitions from file content
   */
  private extractFunctionDefinitions(
    content: string,
    filePath: string,
    targetFunction?: string
  ): FunctionMatch[] {
    const functions: FunctionMatch[] = [];
    const lines = content.split('\n');
    
    // Multiple language patterns for function definitions
    const patterns = this.getFunctionPatterns(path.extname(filePath));
    
    for (const pattern of patterns) {
      let match;
      const regex = new RegExp(pattern.regex, 'gm');
      
      while ((match = regex.exec(content)) !== null) {
        const functionName = match[pattern.nameGroup];
        
        // Skip if we're looking for a specific function and this isn't it
        if (targetFunction && functionName !== targetFunction) {
          continue;
        }
        
        const startLine = this.getLineNumber(content, match.index);
        const endLine = this.findFunctionEndLine(content, match.index, startLine);
        
        const returnType = match[pattern.returnGroup || 0] || undefined;
        const className = pattern.classGroup ? match[pattern.classGroup] || undefined : undefined;
        const accessibility = pattern.accessGroup ? (match[pattern.accessGroup] as 'public' | 'private' | 'protected') || undefined : undefined;
        
        const functionMatch: FunctionMatch = {
          name: functionName,
          filePath,
          startLine,
          endLine,
          signature: match[0].trim(),
          parameters: this.extractParameters(match[pattern.paramsGroup || 0] || ''),
          ...(returnType && { returnType }),
          isAsync: pattern.isAsync ? /\basync\b/.test(match[0]) : false,
          isMethod: pattern.isMethod || false,
          ...(className && { className }),
          ...(accessibility && { accessibility }),
          relevanceScore: this.calculateFunctionRelevance(functionName, match[0], content)
        };
        
        functions.push(functionMatch);
      }
    }
    
    return functions;
  }

  /**
   * Extract class definitions from file content
   */
  private extractClassDefinitions(
    content: string,
    filePath: string,
    targetClass?: string
  ): ClassMatch[] {
    const classes: ClassMatch[] = [];
    const lines = content.split('\n');
    
    // Multiple language patterns for class definitions
    const patterns = this.getClassPatterns(path.extname(filePath));
    
    for (const pattern of patterns) {
      let match;
      const regex = new RegExp(pattern.regex, 'gm');
      
      while ((match = regex.exec(content)) !== null) {
        const className = match[pattern.nameGroup];
        
        // Skip if we're looking for a specific class and this isn't it
        if (targetClass && className !== targetClass) {
          continue;
        }
        
        const startLine = this.getLineNumber(content, match.index);
        const endLine = this.findClassEndLine(content, match.index, startLine);
        
        const extendsClass = match[pattern.extendsGroup || 0] || undefined;
        
        const classMatch: ClassMatch = {
          name: className,
          filePath,
          startLine,
          endLine,
          ...(extendsClass && { extendsClass }),
          implements: this.extractImplements(match[pattern.implementsGroup || 0] || ''),
          methods: this.extractClassMethods(content, startLine, endLine),
          properties: this.extractClassProperties(content, startLine, endLine),
          isAbstract: pattern.isAbstract ? /\babstract\b/.test(match[0]) : false,
          isInterface: pattern.isInterface || false,
          relevanceScore: this.calculateClassRelevance(className, match[0], content)
        };
        
        classes.push(classMatch);
      }
    }
    
    return classes;
  }

  /**
   * Find pattern matches in file content
   */
  private findPatternMatches(
    content: string,
    filePath: string,
    normalizedTarget: string,
    options: PatternSearchOptions
  ): PatternMatch[] {
    const matches: PatternMatch[] = [];
    const lines = content.split('\n');
    
    // Split content into logical blocks (functions, classes, etc.)
    const blocks = this.extractCodeBlocks(content);
    
    for (const block of blocks) {
      const normalizedBlock = this.normalizePattern(block.content, options);
      
      // Calculate similarity using multiple metrics
      const similarity = this.calculatePatternSimilarity(normalizedTarget, normalizedBlock);
      
      if (similarity >= options.minSimilarity) {
        matches.push({
          pattern: normalizedTarget,
          filePath,
          startLine: block.startLine,
          endLine: block.endLine,
          similarity,
          context: this.extractBlockContext(content, block.startLine, block.endLine),
          matchType: this.determineMatchType(similarity)
        });
      }
    }
    
    return matches;
  }

  /**
   * Find configuration files in the codebase
   */
  private findConfigurationFiles(files: string[]): string[] {
    const configPatterns = [
      /package\.json$/,
      /composer\.json$/,
      /Gemfile$/,
      /requirements\.txt$/,
      /pom\.xml$/,
      /build\.gradle$/,
      /\.env$/,
      /\.env\./,
      /config\./,
      /\.config\./,
      /\.yml$/,
      /\.yaml$/,
      /\.toml$/,
      /\.ini$/,
      /\.properties$/,
      /docker-compose/,
      /Dockerfile$/,
      /\.dockerignore$/,
      /\.gitignore$/,
      /\.eslintrc/,
      /\.prettierrc/,
      /tsconfig\.json$/,
      /webpack\.config/,
      /babel\.config/,
      /jest\.config/,
      /cypress\.config/
    ];
    
    return files.filter(file => {
      const fileName = path.basename(file);
      return configPatterns.some(pattern => pattern.test(fileName));
    });
  }

  /**
   * Extract dependencies from package files
   */
  private async extractDependencies(files: string[]): Promise<string[]> {
    const dependencies = new Set<string>();
    
    for (const file of files) {
      try {
        const fileName = path.basename(file);
        const content = fs.readFileSync(file, 'utf8');
        
        if (fileName === 'package.json') {
          const packageData = JSON.parse(content);
          this.addDependencies(dependencies, packageData.dependencies);
          this.addDependencies(dependencies, packageData.devDependencies);
          this.addDependencies(dependencies, packageData.peerDependencies);
        } else if (fileName === 'requirements.txt') {
          const lines = content.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
              const dep = trimmed.split(/[>=<]/)[0].trim();
              if (dep) dependencies.add(dep);
            }
          }
        } else if (fileName === 'Gemfile') {
          const matches = content.match(/gem\s+['"]([^'"]+)['"]/g);
          if (matches) {
            for (const match of matches) {
              const dep = match.match(/['"]([^'"]+)['"]/)?.[1];
              if (dep) dependencies.add(dep);
            }
          }
        } else if (fileName.endsWith('pom.xml')) {
          const artifactMatches = content.match(/<artifactId>([^<]+)<\/artifactId>/g);
          if (artifactMatches) {
            for (const match of artifactMatches) {
              const dep = match.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
              if (dep) dependencies.add(dep);
            }
          }
        }
      } catch (error) {
        console.error(`Error extracting dependencies from ${file}:`, error);
      }
    }
    
    return Array.from(dependencies);
  }

  /**
   * Analyze relationships between files
   */
  private async analyzeRelationships(files: string[]): Promise<ArchitecturalContext['relationships']> {
    const relationships: ArchitecturalContext['relationships'] = [];
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const fileRelationships = this.extractFileRelationships(content, file);
        relationships.push(...fileRelationships);
      } catch (error) {
        console.error(`Error analyzing relationships in ${file}:`, error);
      }
    }
    
    return relationships;
  }

  /**
   * Detect architectural patterns in the codebase
   */
  private async detectArchitecturalPatterns(files: string[]): Promise<ArchitecturalContext['patterns']> {
    const patterns: ArchitecturalContext['patterns'] = [];
    
    // MVC pattern detection
    const mvcPattern = this.detectMVCPattern(files);
    if (mvcPattern) patterns.push(mvcPattern);
    
    // Service pattern detection
    const servicePattern = this.detectServicePattern(files);
    if (servicePattern) patterns.push(servicePattern);
    
    // Repository pattern detection
    const repositoryPattern = this.detectRepositoryPattern(files);
    if (repositoryPattern) patterns.push(repositoryPattern);
    
    // Factory pattern detection
    const factoryPattern = this.detectFactoryPattern(files);
    if (factoryPattern) patterns.push(factoryPattern);
    
    // Singleton pattern detection
    const singletonPattern = this.detectSingletonPattern(files);
    if (singletonPattern) patterns.push(singletonPattern);
    
    // Observer pattern detection
    const observerPattern = this.detectObserverPattern(files);
    if (observerPattern) patterns.push(observerPattern);
    
    return patterns;
  }

  // Helper methods

  private getDefaultTraversalOptions(): CodeTraversalOptions {
    return {
      includeExtensions: this.defaultExtensions,
      excludePatterns: this.defaultExcludePatterns,
      maxDepth: 10,
      followSymlinks: false,
      ignoreCase: true
    };
  }

  private getDefaultPatternSearchOptions(): PatternSearchOptions {
    return {
      maxResults: 50,
      minSimilarity: 0.3,
      includeComments: false,
      normalizeWhitespace: true,
      caseSensitive: false
    };
  }

  private shouldExclude(filePath: string, excludePatterns: string[]): boolean {
    return excludePatterns.some(pattern => 
      filePath.includes(pattern) || filePath.includes(path.sep + pattern + path.sep)
    );
  }

  private getFunctionPatterns(extension: string): Array<{
    regex: string;
    nameGroup: number;
    paramsGroup?: number;
    returnGroup?: number;
    classGroup?: number;
    accessGroup?: number;
    isAsync?: boolean;
    isMethod?: boolean;
  }> {
    const patterns = [];
    
    if (['.js', '.ts', '.jsx', '.tsx'].includes(extension)) {
      patterns.push(
        // Regular function declarations
        {
          regex: '(?:^|\\s)(async\\s+)?function\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(([^)]*)\\)(?:\\s*:\\s*([^{]+))?',
          nameGroup: 2,
          paramsGroup: 3,
          returnGroup: 4,
          isAsync: true
        },
        // Arrow functions
        {
          regex: '(?:^|\\s)(?:const|let|var)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*(?:async\\s+)?\\(([^)]*)\\)\\s*=>',
          nameGroup: 1,
          paramsGroup: 2,
          isAsync: true
        },
        // Method definitions
        {
          regex: '(?:^|\\s)(public|private|protected)?\\s*(async\\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(([^)]*)\\)(?:\\s*:\\s*([^{]+))?\\s*{',
          nameGroup: 3,
          paramsGroup: 4,
          returnGroup: 5,
          accessGroup: 1,
          isAsync: true,
          isMethod: true
        }
      );
    } else if (extension === '.py') {
      patterns.push(
        // Python function definitions
        {
          regex: '(?:^|\\s)def\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(([^)]*)\\)(?:\\s*->\\s*([^:]+))?:',
          nameGroup: 1,
          paramsGroup: 2,
          returnGroup: 3
        },
        // Python class methods
        {
          regex: '(?:^|\\s)def\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(\\s*self\\s*(?:,\\s*([^)]*))??\\)(?:\\s*->\\s*([^:]+))?:',
          nameGroup: 1,
          paramsGroup: 2,
          returnGroup: 3,
          isMethod: true
        }
      );
    } else if (extension === '.java') {
      patterns.push(
        // Java method definitions
        {
          regex: '(?:^|\\s)(public|private|protected)?\\s*(static\\s+)?(async\\s+)?([a-zA-Z_$][a-zA-Z0-9_$<>\\[\\]]*)?\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(([^)]*)\\)',
          nameGroup: 5,
          paramsGroup: 6,
          returnGroup: 4,
          accessGroup: 1,
          isMethod: true
        }
      );
    }
    
    return patterns;
  }

  private getClassPatterns(extension: string): Array<{
    regex: string;
    nameGroup: number;
    extendsGroup?: number;
    implementsGroup?: number;
    isAbstract?: boolean;
    isInterface?: boolean;
  }> {
    const patterns = [];
    
    if (['.js', '.ts', '.jsx', '.tsx'].includes(extension)) {
      patterns.push(
        // Class declarations
        {
          regex: '(?:^|\\s)(abstract\\s+)?class\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\\s+extends\\s+([a-zA-Z_$][a-zA-Z0-9_$]*))?(?:\\s+implements\\s+([^{]+))?',
          nameGroup: 2,
          extendsGroup: 3,
          implementsGroup: 4,
          isAbstract: true
        },
        // Interface declarations
        {
          regex: '(?:^|\\s)interface\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\\s+extends\\s+([^{]+))?',
          nameGroup: 1,
          extendsGroup: 2,
          isInterface: true
        }
      );
    } else if (extension === '.py') {
      patterns.push(
        // Python class definitions
        {
          regex: '(?:^|\\s)class\\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\\s*\\(\\s*([^)]*)\\s*\\))?:',
          nameGroup: 1,
          extendsGroup: 2
        }
      );
    } else if (extension === '.java') {
      patterns.push(
        // Java class definitions
        {
          regex: '(?:^|\\s)(public\\s+)?(abstract\\s+)?(final\\s+)?class\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\\s+extends\\s+([a-zA-Z_$][a-zA-Z0-9_$]*))?(?:\\s+implements\\s+([^{]+))?',
          nameGroup: 4,
          extendsGroup: 5,
          implementsGroup: 6,
          isAbstract: true
        },
        // Java interface definitions
        {
          regex: '(?:^|\\s)(public\\s+)?interface\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\\s+extends\\s+([^{]+))?',
          nameGroup: 2,
          extendsGroup: 3,
          isInterface: true
        }
      );
    }
    
    return patterns;
  }

  private getLineNumber(content: string, position: number): number {
    return content.substring(0, position).split('\n').length;
  }

  private findFunctionEndLine(content: string, startPosition: number, startLine: number): number {
    const lines = content.split('\n');
    let braceCount = 0;
    let inFunction = false;
    
    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];
      
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          inFunction = true;
        } else if (char === '}') {
          braceCount--;
          if (inFunction && braceCount === 0) {
            return i + 1;
          }
        }
      }
    }
    
    return startLine + 10; // Default fallback
  }

  private findClassEndLine(content: string, startPosition: number, startLine: number): number {
    // Similar logic to findFunctionEndLine but for classes
    return this.findFunctionEndLine(content, startPosition, startLine);
  }

  private extractParameters(paramsString: string): string[] {
    if (!paramsString || paramsString.trim() === '') {
      return [];
    }
    
    return paramsString.split(',').map(param => param.trim()).filter(param => param);
  }

  private extractImplements(implementsString: string): string[] {
    if (!implementsString || implementsString.trim() === '') {
      return [];
    }
    
    return implementsString.split(',').map(impl => impl.trim()).filter(impl => impl);
  }

  private extractClassMethods(content: string, startLine: number, endLine: number): string[] {
    const methods: string[] = [];
    const lines = content.split('\n').slice(startLine - 1, endLine);
    const classContent = lines.join('\n');
    
    const methodRegex = /(?:^|\s)(public|private|protected)?\s*(async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*{/gm;
    let match;
    
    while ((match = methodRegex.exec(classContent)) !== null) {
      methods.push(match[3]);
    }
    
    return methods;
  }

  private extractClassProperties(content: string, startLine: number, endLine: number): string[] {
    const properties: string[] = [];
    const lines = content.split('\n').slice(startLine - 1, endLine);
    const classContent = lines.join('\n');
    
    const propertyRegex = /(?:^|\s)(public|private|protected)?\s+(readonly\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[:=]/gm;
    let match;
    
    while ((match = propertyRegex.exec(classContent)) !== null) {
      properties.push(match[3]);
    }
    
    return properties;
  }

  private calculateFunctionRelevance(name: string, signature: string, content: string): number {
    let score = 0.5; // Base score
    
    // Boost for descriptive names
    if (name.length > 3) score += 0.1;
    if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(name)) score += 0.1; // camelCase
    
    // Boost for functions with parameters
    if (signature.includes('(') && signature.includes(')')) {
      const paramsMatch = signature.match(/\(([^)]*)\)/);
      if (paramsMatch && paramsMatch[1].trim()) {
        score += 0.2;
      }
    }
    
    // Boost for async functions
    if (signature.includes('async')) score += 0.1;
    
    // Boost for JSDoc comments
    if (content.includes('/**') && content.includes('*/')) score += 0.1;
    
    return Math.min(1.0, score);
  }

  private calculateClassRelevance(name: string, signature: string, content: string): number {
    let score = 0.5; // Base score
    
    // Boost for PascalCase class names
    if (/^[A-Z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(name)) score += 0.2;
    
    // Boost for classes with inheritance
    if (signature.includes('extends')) score += 0.1;
    if (signature.includes('implements')) score += 0.1;
    
    // Boost for abstract classes
    if (signature.includes('abstract')) score += 0.1;
    
    // Boost for JSDoc comments
    if (content.includes('/**') && content.includes('*/')) score += 0.1;
    
    return Math.min(1.0, score);
  }

  private normalizePattern(pattern: string, options: PatternSearchOptions): string {
    let normalized = pattern;
    
    if (options.normalizeWhitespace) {
      normalized = normalized.replace(/\s+/g, ' ').trim();
    }
    
    if (!options.caseSensitive) {
      normalized = normalized.toLowerCase();
    }
    
    if (!options.includeComments) {
      // Remove single-line comments
      normalized = normalized.replace(/\/\/.*$/gm, '');
      // Remove multi-line comments
      normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');
    }
    
    return normalized;
  }

  private extractCodeBlocks(content: string): Array<{ content: string; startLine: number; endLine: number }> {
    const blocks = [];
    const lines = content.split('\n');
    
    let blockStart = 0;
    let braceCount = 0;
    let inBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const char of line) {
        if (char === '{') {
          if (!inBlock) {
            blockStart = i;
            inBlock = true;
          }
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (inBlock && braceCount === 0) {
            blocks.push({
              content: lines.slice(blockStart, i + 1).join('\n'),
              startLine: blockStart + 1,
              endLine: i + 1
            });
            inBlock = false;
          }
        }
      }
    }
    
    return blocks;
  }

  private calculatePatternSimilarity(pattern1: string, pattern2: string): number {
    // Simple similarity calculation using Levenshtein distance
    const distance = this.levenshteinDistance(pattern1, pattern2);
    const maxLength = Math.max(pattern1.length, pattern2.length);
    
    if (maxLength === 0) return 1.0;
    return 1.0 - (distance / maxLength);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  private extractBlockContext(content: string, startLine: number, endLine: number): string[] {
    const lines = content.split('\n');
    const contextBefore = lines.slice(Math.max(0, startLine - 3), startLine - 1);
    const contextAfter = lines.slice(endLine, Math.min(lines.length, endLine + 3));
    
    return [...contextBefore, ...contextAfter];
  }

  private determineMatchType(similarity: number): 'exact' | 'structural' | 'semantic' {
    if (similarity > 0.9) return 'exact';
    if (similarity > 0.6) return 'structural';
    return 'semantic';
  }

  private addDependencies(dependencySet: Set<string>, deps: Record<string, string> | undefined): void {
    if (deps) {
      Object.keys(deps).forEach(dep => dependencySet.add(dep));
    }
  }

  private extractFileRelationships(content: string, filePath: string): ArchitecturalContext['relationships'] {
    const relationships: ArchitecturalContext['relationships'] = [];
    
    // Extract import relationships
    const importRegex = /(?:import|require|from)\s+.*?['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = importRegex.exec(content)) !== null) {
      relationships.push({
        from: filePath,
        to: match[1],
        type: 'import',
        strength: 0.8
      });
    }
    
    return relationships;
  }

  // Architectural pattern detection methods
  private detectMVCPattern(files: string[]): ArchitecturalContext['patterns'][0] | null {
    const modelFiles = files.filter(f => f.includes('model') || f.includes('Model'));
    const viewFiles = files.filter(f => f.includes('view') || f.includes('View') || f.includes('component'));
    const controllerFiles = files.filter(f => f.includes('controller') || f.includes('Controller'));
    
    if (modelFiles.length > 0 && viewFiles.length > 0 && controllerFiles.length > 0) {
      return {
        name: 'Model-View-Controller',
        type: 'mvc',
        files: [...modelFiles, ...viewFiles, ...controllerFiles],
        confidence: 0.8
      };
    }
    
    return null;
  }

  private detectServicePattern(files: string[]): ArchitecturalContext['patterns'][0] | null {
    const serviceFiles = files.filter(f => f.includes('service') || f.includes('Service'));
    
    if (serviceFiles.length >= 2) {
      return {
        name: 'Service Layer',
        type: 'service',
        files: serviceFiles,
        confidence: 0.7
      };
    }
    
    return null;
  }

  private detectRepositoryPattern(files: string[]): ArchitecturalContext['patterns'][0] | null {
    const repositoryFiles = files.filter(f => f.includes('repository') || f.includes('Repository'));
    
    if (repositoryFiles.length >= 1) {
      return {
        name: 'Repository Pattern',
        type: 'repository',
        files: repositoryFiles,
        confidence: 0.6
      };
    }
    
    return null;
  }

  private detectFactoryPattern(files: string[]): ArchitecturalContext['patterns'][0] | null {
    const factoryFiles = files.filter(f => f.includes('factory') || f.includes('Factory'));
    
    if (factoryFiles.length >= 1) {
      return {
        name: 'Factory Pattern',
        type: 'factory',
        files: factoryFiles,
        confidence: 0.5
      };
    }
    
    return null;
  }

  private detectSingletonPattern(files: string[]): ArchitecturalContext['patterns'][0] | null {
    // This would require content analysis to detect singleton implementations
    // For now, return null as it's complex to detect from file names alone
    return null;
  }

  private detectObserverPattern(files: string[]): ArchitecturalContext['patterns'][0] | null {
    const observerFiles = files.filter(f => 
      f.includes('observer') || f.includes('Observer') || 
      f.includes('listener') || f.includes('Listener') ||
      f.includes('event') || f.includes('Event')
    );
    
    if (observerFiles.length >= 2) {
      return {
        name: 'Observer Pattern',
        type: 'observer',
        files: observerFiles,
        confidence: 0.6
      };
    }
    
    return null;
  }
}