// Modern code analysis using Tree-sitter for accurate AST parsing
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Java from 'tree-sitter-java';
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
 * Modern code analyzer using Tree-sitter for accurate AST parsing
 */
export class TreeSitterCodeAnalyzer {
  private parsers: Map<string, Parser> = new Map();
  private readonly defaultExtensions = ['.js', '.ts', '.jsx', '.tsx', '.java'];
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

  constructor(private rootPath: string = process.cwd()) {
    this.initializeParsers();
  }

  private initializeParsers(): void {
    // JavaScript/JSX parser
    const jsParser = new Parser();
    jsParser.setLanguage(JavaScript);
    this.parsers.set('.js', jsParser);
    this.parsers.set('.jsx', jsParser);

    // TypeScript parser
    const tsParser = new Parser();
    tsParser.setLanguage(TypeScript.typescript);
    this.parsers.set('.ts', tsParser);

    const tsxParser = new Parser();
    tsxParser.setLanguage(TypeScript.tsx);
    this.parsers.set('.tsx', tsxParser);

    // Java parser
    const javaParser = new Parser();
    javaParser.setLanguage(Java);
    this.parsers.set('.java', javaParser);
  }

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
        const matches = await this.extractFunctionDefinitions(file, functionName);
        functionMatches.push(...matches);
      } catch (error) {
        console.error(`Error analyzing file ${file}:`, error);
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
        const matches = await this.extractClassDefinitions(file, className);
        classMatches.push(...matches);
      } catch (error) {
        console.error(`Error analyzing file ${file}:`, error);
      }
    }

    return classMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Find similar code patterns using structural similarity
   */
  public async findSimilarPatterns(
    targetPattern: string,
    options: PatternSearchOptions = this.getDefaultPatternSearchOptions()
  ): Promise<PatternMatch[]> {
    const files = await this.traverseCodebase(this.getDefaultTraversalOptions());
    const patternMatches: PatternMatch[] = [];

    // Parse the target pattern to get its AST structure
    const targetStructure = this.parsePatternStructure(targetPattern);
    if (!targetStructure) return [];

    for (const file of files) {
      try {
        const matches = await this.findStructuralMatches(file, targetStructure, options);
        patternMatches.push(...matches);
      } catch (error) {
        console.error(`Error analyzing patterns in ${file}:`, error);
      }
    }

    return patternMatches
      .filter(match => match.similarity >= options.minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.maxResults);
  }

  /**
   * Extract function definitions from a file using AST parsing
   */
  private async extractFunctionDefinitions(
    filePath: string,
    targetFunction?: string
  ): Promise<FunctionMatch[]> {
    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    const parser = this.parsers.get(ext);

    if (!parser) return [];

    const tree = parser.parse(content);
    const functions: FunctionMatch[] = [];

    this.traverseAST(tree.rootNode, (node) => {
      if (this.isFunctionNode(node)) {
        const functionData = this.extractFunctionData(node, content, filePath);
        if (functionData && (!targetFunction || functionData.name === targetFunction)) {
          functions.push(functionData);
        }
      }
    });

    return functions;
  }

  /**
   * Extract class definitions from a file using AST parsing
   */
  private async extractClassDefinitions(
    filePath: string,
    targetClass?: string
  ): Promise<ClassMatch[]> {
    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    const parser = this.parsers.get(ext);

    if (!parser) return [];

    const tree = parser.parse(content);
    const classes: ClassMatch[] = [];

    this.traverseAST(tree.rootNode, (node) => {
      if (this.isClassNode(node)) {
        const classData = this.extractClassData(node, content, filePath);
        if (classData && (!targetClass || classData.name === targetClass)) {
          classes.push(classData);
        }
      }
    });

    return classes;
  }

  /**
   * Traverse AST nodes with a callback
   */
  private traverseAST(node: Parser.SyntaxNode, callback: (node: Parser.SyntaxNode) => void): void {
    callback(node);
    for (let i = 0; i < node.childCount; i++) {
      this.traverseAST(node.child(i)!, callback);
    }
  }

  /**
   * Check if a node represents a function
   */
  private isFunctionNode(node: Parser.SyntaxNode): boolean {
    return [
      'function_declaration',
      'function_expression',
      'arrow_function',
      'method_definition',
      'function_definition'
    ].includes(node.type);
  }

  /**
   * Check if a node represents a class
   */
  private isClassNode(node: Parser.SyntaxNode): boolean {
    return [
      'class_declaration',
      'interface_declaration',
      'class_definition'
    ].includes(node.type);
  }

  /**
   * Extract function data from AST node
   */
  private extractFunctionData(
    node: Parser.SyntaxNode,
    content: string,
    filePath: string
  ): FunctionMatch | null {
    const nameNode = this.findChildByType(node, ['identifier', 'property_identifier']);
    if (!nameNode) return null;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const signature = this.getNodeText(node, content);

    // Extract parameters
    const parameters: string[] = [];
    const paramsNode = this.findChildByType(node, ['formal_parameters', 'parameters']);
    if (paramsNode) {
      this.traverseAST(paramsNode, (child) => {
        if (child.type === 'identifier' && child.parent?.type !== 'type_annotation') {
          parameters.push(child.text);
        }
      });
    }

    // Check if async
    const isAsync = signature.includes('async');

    // Check if it's a method
    const isMethod = node.parent?.type === 'class_body' || 
                    node.parent?.type === 'method_definition';

    // Get class name if it's a method
    let className: string | undefined;
    if (isMethod) {
      let parent = node.parent;
      while (parent && parent.type !== 'class_declaration') {
        parent = parent.parent;
      }
      if (parent) {
        const classNameNode = this.findChildByType(parent, ['identifier']);
        if (classNameNode) {
          className = classNameNode.text;
        }
      }
    }

    return {
      name,
      filePath,
      startLine,
      endLine,
      signature: signature.split('\n')[0], // First line of signature
      parameters,
      isAsync,
      isMethod,
      ...(className && { className }),
      relevanceScore: this.calculateFunctionRelevance(name, signature)
    };
  }

  /**
   * Extract class data from AST node
   */
  private extractClassData(
    node: Parser.SyntaxNode,
    content: string,
    filePath: string
  ): ClassMatch | null {
    const nameNode = this.findChildByType(node, ['identifier', 'type_identifier']);
    if (!nameNode) return null;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // Extract extends/implements
    let extendsClass: string | undefined;
    const implementsList: string[] = [];

    const extendsClause = this.findChildByType(node, ['extends_clause', 'class_heritage']);
    if (extendsClause) {
      const extendsIdentifier = this.findChildByType(extendsClause, ['identifier', 'type_identifier']);
      if (extendsIdentifier) {
        extendsClass = extendsIdentifier.text;
      }
    }

    const implementsClause = this.findChildByType(node, ['implements_clause']);
    if (implementsClause) {
      this.traverseAST(implementsClause, (child) => {
        if (child.type === 'identifier' || child.type === 'type_identifier') {
          implementsList.push(child.text);
        }
      });
    }

    // Extract methods and properties
    const methods: string[] = [];
    const properties: string[] = [];

    const classBody = this.findChildByType(node, ['class_body']);
    if (classBody) {
      this.traverseAST(classBody, (child) => {
        if (this.isFunctionNode(child)) {
          const methodName = this.findChildByType(child, ['identifier', 'property_identifier']);
          if (methodName) {
            methods.push(methodName.text);
          }
        } else if (child.type === 'field_definition' || child.type === 'property_definition') {
          const propName = this.findChildByType(child, ['identifier', 'property_identifier']);
          if (propName) {
            properties.push(propName.text);
          }
        }
      });
    }

    const isInterface = node.type === 'interface_declaration';
    const isAbstract = this.getNodeText(node, content).includes('abstract');

    return {
      name,
      filePath,
      startLine,
      endLine,
      ...(extendsClass && { extendsClass }),
      implements: implementsList,
      methods,
      properties,
      isAbstract,
      isInterface,
      relevanceScore: this.calculateClassRelevance(name, isInterface, isAbstract)
    };
  }

  /**
   * Parse pattern structure for similarity matching
   */
  private parsePatternStructure(pattern: string): any {
    // Try to parse the pattern with each available parser
    for (const [ext, parser] of this.parsers) {
      try {
        const tree = parser.parse(pattern);
        if (tree.rootNode.hasError) continue;
        
        return {
          tree,
          structure: this.extractStructuralFeatures(tree.rootNode)
        };
      } catch (error) {
        continue;
      }
    }
    return null;
  }

  /**
   * Extract structural features from AST for similarity comparison
   */
  private extractStructuralFeatures(node: Parser.SyntaxNode): any {
    const features = {
      type: node.type,
      childCount: node.childCount,
      childTypes: [] as string[],
      depth: 0
    };

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      features.childTypes.push(child.type);
    }

    return features;
  }

  /**
   * Find structural matches in a file
   */
  private async findStructuralMatches(
    filePath: string,
    targetStructure: any,
    options: PatternSearchOptions
  ): Promise<PatternMatch[]> {
    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    const parser = this.parsers.get(ext);

    if (!parser) return [];

    const tree = parser.parse(content);
    const matches: PatternMatch[] = [];

    this.traverseAST(tree.rootNode, (node) => {
      const similarity = this.calculateStructuralSimilarity(
        node,
        targetStructure.tree.rootNode
      );

      if (similarity >= options.minSimilarity) {
        matches.push({
          pattern: targetStructure.tree.rootNode.text,
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          similarity,
          context: this.extractContext(node, content),
          matchType: this.determineMatchType(similarity)
        });
      }
    });

    return matches;
  }

  /**
   * Calculate structural similarity between two AST nodes
   */
  private calculateStructuralSimilarity(
    node1: Parser.SyntaxNode,
    node2: Parser.SyntaxNode
  ): number {
    if (node1.type !== node2.type) return 0;

    let similarity = 0.5; // Base similarity for same type

    // Compare child structure
    const childTypeSimilarity = this.compareChildTypes(node1, node2);
    similarity += childTypeSimilarity * 0.3;

    // Compare depth and complexity
    const complexitySimilarity = this.compareComplexity(node1, node2);
    similarity += complexitySimilarity * 0.2;

    return Math.min(1.0, similarity);
  }

  /**
   * Compare child types between two nodes
   */
  private compareChildTypes(node1: Parser.SyntaxNode, node2: Parser.SyntaxNode): number {
    const types1: string[] = [];
    const types2: string[] = [];

    for (let i = 0; i < node1.childCount; i++) {
      types1.push(node1.child(i)!.type);
    }

    for (let i = 0; i < node2.childCount; i++) {
      types2.push(node2.child(i)!.type);
    }

    if (types1.length === 0 && types2.length === 0) return 1.0;
    if (types1.length === 0 || types2.length === 0) return 0.0;

    const intersection = types1.filter(type => types2.includes(type));
    const union = [...new Set([...types1, ...types2])];

    return intersection.length / union.length;
  }

  /**
   * Compare complexity between two nodes
   */
  private compareComplexity(node1: Parser.SyntaxNode, node2: Parser.SyntaxNode): number {
    const depth1 = this.getNodeDepth(node1);
    const depth2 = this.getNodeDepth(node2);

    const maxDepth = Math.max(depth1, depth2);
    if (maxDepth === 0) return 1.0;

    return 1.0 - Math.abs(depth1 - depth2) / maxDepth;
  }

  /**
   * Get the depth of an AST node
   */
  private getNodeDepth(node: Parser.SyntaxNode): number {
    let maxDepth = 0;
    
    for (let i = 0; i < node.childCount; i++) {
      const childDepth = this.getNodeDepth(node.child(i)!);
      maxDepth = Math.max(maxDepth, childDepth);
    }

    return maxDepth + 1;
  }

  /**
   * Extract context around a node
   */
  private extractContext(node: Parser.SyntaxNode, content: string): string[] {
    const lines = content.split('\n');
    const startLine = Math.max(0, node.startPosition.row - 2);
    const endLine = Math.min(lines.length, node.endPosition.row + 3);

    return lines.slice(startLine, endLine);
  }

  /**
   * Determine match type based on similarity score
   */
  private determineMatchType(similarity: number): 'exact' | 'structural' | 'semantic' {
    if (similarity > 0.9) return 'exact';
    if (similarity > 0.6) return 'structural';
    return 'semantic';
  }

  /**
   * Find child node by type
   */
  private findChildByType(
    node: Parser.SyntaxNode,
    types: string[]
  ): Parser.SyntaxNode | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (types.includes(child.type)) {
        return child;
      }
    }
    return null;
  }

  /**
   * Get text content of a node
   */
  private getNodeText(node: Parser.SyntaxNode, content: string): string {
    return content.slice(node.startIndex, node.endIndex);
  }

  /**
   * Calculate function relevance score
   */
  private calculateFunctionRelevance(name: string, signature: string): number {
    let score = 0.5;

    if (name.length > 3) score += 0.1;
    if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(name)) score += 0.1;
    if (signature.includes('(') && signature.includes(')')) score += 0.2;
    if (signature.includes('async')) score += 0.1;

    return Math.min(1.0, score);
  }

  /**
   * Calculate class relevance score
   */
  private calculateClassRelevance(
    name: string,
    isInterface: boolean,
    isAbstract: boolean
  ): number {
    let score = 0.5;

    if (/^[A-Z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(name)) score += 0.2;
    if (isInterface) score += 0.1;
    if (isAbstract) score += 0.1;

    return Math.min(1.0, score);
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
          }
        }
      } catch (error) {
        console.error(`Error traversing directory ${dir}:`, error);
      }
    };

    traverse(this.rootPath);
    return files;
  }

  private shouldExclude(filePath: string, excludePatterns: string[]): boolean {
    return excludePatterns.some(pattern => 
      filePath.includes(pattern) || filePath.includes(path.sep + pattern + path.sep)
    );
  }

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
}