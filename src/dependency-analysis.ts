// Dependency analysis system for import/require analysis and file relationship mapping
import * as fs from 'fs';
import * as path from 'path';

export interface ImportStatement {
  source: string;
  imported: string[];
  type: 'import' | 'require' | 'dynamic';
  isTypeOnly: boolean;
  isDefault: boolean;
  alias?: string;
  line: number;
}

export interface ExportStatement {
  exported: string[];
  type: 'export' | 'module.exports' | 'exports';
  isDefault: boolean;
  source?: string;
  line: number;
}

export interface DependencyRelationship {
  from: string;
  to: string;
  type: 'import' | 'require' | 'dynamic' | 'inheritance' | 'composition' | 'usage';
  strength: number;
  imports: string[];
  line: number;
}

export interface FileRelationship {
  filePath: string;
  dependencies: string[];
  dependents: string[];
  imports: ImportStatement[];
  exports: ExportStatement[];
  cyclicDependencies: string[];
  relationshipStrength: number;
  isEntryPoint: boolean;
  isLeafNode: boolean;
}

export interface DependencyGraph {
  nodes: Map<string, FileRelationship>;
  edges: DependencyRelationship[];
  entryPoints: string[];
  leafNodes: string[];
  cyclicDependencies: string[][];
  clusters: string[][];
  metrics: {
    totalFiles: number;
    totalDependencies: number;
    averageDependencies: number;
    maxDependencies: number;
    cyclicDependencyCount: number;
    cohesion: number;
    coupling: number;
  };
}

export interface ModuleSystem {
  type: 'commonjs' | 'esmodule' | 'amd' | 'umd' | 'mixed';
  confidence: number;
  examples: string[];
}

export interface DependencyAnalysisOptions {
  includeExtensions: string[];
  excludePatterns: string[];
  followSymlinks: boolean;
  resolveAliases: boolean;
  includeNodeModules: boolean;
  maxDepth: number;
  detectCircularDependencies: boolean;
  analyzeTypeImports: boolean;
}

/**
 * Main dependency analysis engine
 */
export class DependencyAnalyzer {
  private readonly defaultExtensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
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

  private aliasMap: Map<string, string> = new Map();
  private baseUrl: string = '';

  constructor(private rootPath: string = process.cwd()) {
    this.loadPathAliases();
  }

  /**
   * Analyze imports and requires in a file
   */
  public async analyzeImports(filePath: string): Promise<ImportStatement[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return this.extractImports(content, filePath);
    } catch (error) {
      console.error(`Error analyzing imports in ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Analyze exports in a file
   */
  public async analyzeExports(filePath: string): Promise<ExportStatement[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return this.extractExports(content, filePath);
    } catch (error) {
      console.error(`Error analyzing exports in ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Build complete dependency graph for the project
   */
  public async buildDependencyGraph(options: DependencyAnalysisOptions = this.getDefaultOptions()): Promise<DependencyGraph> {
    const files = await this.findSourceFiles(options);
    const nodes = new Map<string, FileRelationship>();
    const edges: DependencyRelationship[] = [];

    // First pass: collect all imports and exports
    for (const file of files) {
      const imports = await this.analyzeImports(file);
      const exports = await this.analyzeExports(file);
      
      const fileRelationship: FileRelationship = {
        filePath: file,
        dependencies: [],
        dependents: [],
        imports,
        exports,
        cyclicDependencies: [],
        relationshipStrength: 0,
        isEntryPoint: false,
        isLeafNode: false
      };

      nodes.set(file, fileRelationship);
    }

    // Second pass: resolve dependencies and build relationships
    for (const [filePath, fileRel] of nodes.entries()) {
      for (const importStmt of fileRel.imports) {
        const resolvedPath = await this.resolveModulePath(importStmt.source, filePath, options);
        
        if (resolvedPath && nodes.has(resolvedPath)) {
          // Add to dependencies
          fileRel.dependencies.push(resolvedPath);
          
          // Add to dependents
          const dependentFile = nodes.get(resolvedPath);
          if (dependentFile) {
            dependentFile.dependents.push(filePath);
          }
          
          // Create edge
          edges.push({
            from: filePath,
            to: resolvedPath,
            type: importStmt.type as any,
            strength: this.calculateDependencyStrength(importStmt),
            imports: importStmt.imported,
            line: importStmt.line
          });
        }
      }
    }

    // Third pass: detect entry points and leaf nodes
    for (const [filePath, fileRel] of nodes.entries()) {
      fileRel.isEntryPoint = fileRel.dependents.length === 0 && fileRel.dependencies.length > 0;
      fileRel.isLeafNode = fileRel.dependencies.length === 0 && fileRel.dependents.length > 0;
      fileRel.relationshipStrength = this.calculateRelationshipStrength(fileRel);
    }

    // Detect circular dependencies
    let cyclicDependencies: string[][] = [];
    if (options.detectCircularDependencies) {
      cyclicDependencies = this.detectCircularDependencies(nodes);
      
      // Add cyclic dependencies to nodes
      for (const cycle of cyclicDependencies) {
        for (const file of cycle) {
          const fileRel = nodes.get(file);
          if (fileRel) {
            fileRel.cyclicDependencies = cycle.filter(f => f !== file);
          }
        }
      }
    }

    // Detect clusters
    const clusters = this.detectClusters(nodes, edges);

    // Calculate metrics
    const metrics = this.calculateMetrics(nodes, edges, cyclicDependencies);

    return {
      nodes,
      edges,
      entryPoints: Array.from(nodes.values()).filter(f => f.isEntryPoint).map(f => f.filePath),
      leafNodes: Array.from(nodes.values()).filter(f => f.isLeafNode).map(f => f.filePath),
      cyclicDependencies,
      clusters,
      metrics
    };
  }

  /**
   * Map file relationships for navigation
   */
  public async mapFileRelationships(
    filePath: string,
    options: DependencyAnalysisOptions = this.getDefaultOptions()
  ): Promise<FileRelationship> {
    const imports = await this.analyzeImports(filePath);
    const exports = await this.analyzeExports(filePath);
    
    const dependencies: string[] = [];
    const dependents: string[] = [];
    
    // Resolve dependencies
    for (const importStmt of imports) {
      const resolvedPath = await this.resolveModulePath(importStmt.source, filePath, options);
      if (resolvedPath) {
        dependencies.push(resolvedPath);
      }
    }
    
    // Find dependents (files that import this file)
    const allFiles = await this.findSourceFiles(options);
    for (const file of allFiles) {
      if (file === filePath) continue;
      
      const fileImports = await this.analyzeImports(file);
      for (const importStmt of fileImports) {
        const resolvedPath = await this.resolveModulePath(importStmt.source, file, options);
        if (resolvedPath === filePath) {
          dependents.push(file);
          break;
        }
      }
    }
    
    return {
      filePath,
      dependencies,
      dependents,
      imports,
      exports,
      cyclicDependencies: [],
      relationshipStrength: this.calculateRelationshipStrength({
        dependencies,
        dependents
      } as any),
      isEntryPoint: dependents.length === 0 && dependencies.length > 0,
      isLeafNode: dependencies.length === 0 && dependents.length > 0
    };
  }

  /**
   * Detect module system used in the project
   */
  public async detectModuleSystem(options: DependencyAnalysisOptions = this.getDefaultOptions()): Promise<ModuleSystem> {
    const files = await this.findSourceFiles(options);
    const systemCounts = {
      commonjs: 0,
      esmodule: 0,
      amd: 0,
      umd: 0
    };
    
    const examples: string[] = [];
    
    for (const file of files.slice(0, 50)) { // Sample first 50 files
      try {
        const content = fs.readFileSync(file, 'utf8');
        
        // Check for CommonJS
        if (content.includes('require(') || content.includes('module.exports') || content.includes('exports.')) {
          systemCounts.commonjs++;
          if (examples.length < 3) examples.push(`${file}: require/module.exports`);
        }
        
        // Check for ES Modules
        if (content.includes('import ') || content.includes('export ')) {
          systemCounts.esmodule++;
          if (examples.length < 3) examples.push(`${file}: import/export`);
        }
        
        // Check for AMD
        if (content.includes('define(') || content.includes('require.config')) {
          systemCounts.amd++;
          if (examples.length < 3) examples.push(`${file}: AMD define`);
        }
        
        // Check for UMD
        if (content.includes('typeof exports') && content.includes('typeof module') && content.includes('define.amd')) {
          systemCounts.umd++;
          if (examples.length < 3) examples.push(`${file}: UMD pattern`);
        }
      } catch (error) {
        console.error(`Error analyzing module system in ${file}:`, error);
      }
    }
    
    const total = Object.values(systemCounts).reduce((sum, count) => sum + count, 0);
    const maxCount = Math.max(...Object.values(systemCounts));
    
    let dominantSystem: ModuleSystem['type'] = 'mixed';
    let confidence = 0;
    
    if (total > 0) {
      if (systemCounts.esmodule === maxCount) {
        dominantSystem = 'esmodule';
        confidence = systemCounts.esmodule / total;
      } else if (systemCounts.commonjs === maxCount) {
        dominantSystem = 'commonjs';
        confidence = systemCounts.commonjs / total;
      } else if (systemCounts.amd === maxCount) {
        dominantSystem = 'amd';
        confidence = systemCounts.amd / total;
      } else if (systemCounts.umd === maxCount) {
        dominantSystem = 'umd';
        confidence = systemCounts.umd / total;
      }
      
      // If multiple systems have significant usage, it's mixed
      const significantSystems = Object.values(systemCounts).filter(count => count / total > 0.2);
      if (significantSystems.length > 1) {
        dominantSystem = 'mixed';
        confidence = 1 - (maxCount / total);
      }
    }
    
    return {
      type: dominantSystem,
      confidence,
      examples
    };
  }

  // Private helper methods

  private async findSourceFiles(options: DependencyAnalysisOptions): Promise<string[]> {
    const files: string[] = [];
    
    const traverse = async (dir: string, currentDepth: number = 0) => {
      if (currentDepth > options.maxDepth) return;
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (this.shouldExclude(fullPath, options.excludePatterns)) {
            continue;
          }
          
          if (entry.isDirectory()) {
            await traverse(fullPath, currentDepth + 1);
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
                await traverse(resolvedPath, currentDepth + 1);
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
    
    await traverse(this.rootPath);
    return files;
  }

  private extractImports(content: string, filePath: string): ImportStatement[] {
    const imports: ImportStatement[] = [];
    const lines = content.split('\n');
    
    // ES Module imports
    const esImportPatterns = [
      // import { named } from 'module'
      /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
      // import defaultExport from 'module'
      /import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s*['"]([^'"]+)['"]/g,
      // import defaultExport, { named } from 'module'
      /import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
      // import * as namespace from 'module'
      /import\s*\*\s*as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s*['"]([^'"]+)['"]/g,
      // import 'module' (side effect)
      /import\s*['"]([^'"]+)['"]/g,
      // import type { Type } from 'module'
      /import\s+type\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
      // import type DefaultType from 'module'
      /import\s+type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s*['"]([^'"]+)['"]/g
    ];
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      
      for (const pattern of esImportPatterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const importStmt = this.parseESImport(match, lineIndex + 1);
          if (importStmt) {
            imports.push(importStmt);
          }
        }
      }
      
      // CommonJS require()
      const requirePattern = /(?:const|let|var)\s+(?:\{([^}]+)\}|([a-zA-Z_$][a-zA-Z0-9_$]*))?\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let requireMatch;
      while ((requireMatch = requirePattern.exec(line)) !== null) {
        const imported = requireMatch[1] ? 
          requireMatch[1].split(',').map(s => s.trim()) : 
          requireMatch[2] ? [requireMatch[2]] : [];
        
        imports.push({
          source: requireMatch[3],
          imported,
          type: 'require',
          isTypeOnly: false,
          isDefault: !requireMatch[1], // If not destructured, it's default
          line: lineIndex + 1
        });
      }
      
      // Dynamic imports
      const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let dynamicMatch;
      while ((dynamicMatch = dynamicImportPattern.exec(line)) !== null) {
        imports.push({
          source: dynamicMatch[1],
          imported: [],
          type: 'dynamic',
          isTypeOnly: false,
          isDefault: false,
          line: lineIndex + 1
        });
      }
    }
    
    return imports;
  }

  private extractExports(content: string, filePath: string): ExportStatement[] {
    const exports: ExportStatement[] = [];
    const lines = content.split('\n');
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      
      // ES Module exports
      const esExportPatterns = [
        // export { named }
        { pattern: /export\s*\{\s*([^}]+)\s*\}/, isDefault: false },
        // export default
        { pattern: /export\s+default\s+/, isDefault: true },
        // export const/let/var
        { pattern: /export\s+(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$,\s]*)/g, isDefault: false },
        // export function
        { pattern: /export\s+function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g, isDefault: false },
        // export class
        { pattern: /export\s+class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g, isDefault: false },
        // export { named } from 'module'
        { pattern: /export\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/, isDefault: false },
        // export * from 'module'
        { pattern: /export\s*\*\s*from\s*['"]([^'"]+)['"]/, isDefault: false }
      ];
      
      for (const { pattern, isDefault } of esExportPatterns) {
        const match = pattern.exec(line);
        if (match) {
          const exported = isDefault ? ['default'] : 
            match[1] ? match[1].split(',').map(s => s.trim()) : ['*'];
          
          exports.push({
            exported,
            type: 'export',
            isDefault,
            source: match[2],
            line: lineIndex + 1
          });
        }
      }
      
      // CommonJS module.exports
      const moduleExportsPattern = /module\.exports\s*=\s*(.+)/;
      const moduleExportsMatch = moduleExportsPattern.exec(line);
      if (moduleExportsMatch) {
        exports.push({
          exported: ['default'],
          type: 'module.exports',
          isDefault: true,
          line: lineIndex + 1
        });
      }
      
      // CommonJS exports.property
      const exportsPattern = /exports\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/;
      const exportsMatch = exportsPattern.exec(line);
      if (exportsMatch) {
        exports.push({
          exported: [exportsMatch[1]],
          type: 'exports',
          isDefault: false,
          line: lineIndex + 1
        });
      }
    }
    
    return exports;
  }

  private parseESImport(match: RegExpExecArray, lineNumber: number): ImportStatement | null {
    const fullMatch = match[0];
    
    // Import type detection
    const isTypeOnly = fullMatch.includes('import type');
    
    // Extract source (always the last capture group for module path)
    const source = match[match.length - 1];
    
    // Determine import type and parse imported items
    let imported: string[] = [];
    let isDefault = false;
    let alias: string | undefined;
    
    if (fullMatch.includes('* as ')) {
      // import * as namespace from 'module'
      const namespaceMatch = fullMatch.match(/\*\s*as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (namespaceMatch) {
        imported = ['*'];
        alias = namespaceMatch[1];
      }
    } else if (fullMatch.includes('{')) {
      // import { named } from 'module' or import default, { named } from 'module'
      const namedMatch = fullMatch.match(/\{\s*([^}]+)\s*\}/);
      if (namedMatch) {
        imported = namedMatch[1].split(',').map(s => s.trim());
      }
      
      // Check for default import combined with named imports
      const defaultMatch = fullMatch.match(/import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,/);
      if (defaultMatch) {
        imported.unshift(defaultMatch[1]);
        isDefault = true;
      }
    } else if (fullMatch.match(/import\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s+from/)) {
      // import defaultExport from 'module'
      const defaultMatch = fullMatch.match(/import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from/);
      if (defaultMatch) {
        imported = [defaultMatch[1]];
        isDefault = true;
      }
    } else if (fullMatch.match(/import\s*['"]([^'"]+)['"]/)) {
      // import 'module' (side effect)
      imported = [];
      isDefault = false;
    }
    
    return {
      source,
      imported,
      type: 'import',
      isTypeOnly,
      isDefault,
      ...(alias && { alias }),
      line: lineNumber
    };
  }

  private async resolveModulePath(
    source: string,
    currentFile: string,
    options: DependencyAnalysisOptions
  ): Promise<string | null> {
    // Handle relative paths
    if (source.startsWith('./') || source.startsWith('../')) {
      const currentDir = path.dirname(currentFile);
      const resolvedPath = path.resolve(currentDir, source);
      
      // Try different extensions
      for (const ext of options.includeExtensions) {
        const pathWithExt = resolvedPath + ext;
        if (fs.existsSync(pathWithExt)) {
          return pathWithExt;
        }
      }
      
      // Try index files
      for (const ext of options.includeExtensions) {
        const indexPath = path.join(resolvedPath, `index${ext}`);
        if (fs.existsSync(indexPath)) {
          return indexPath;
        }
      }
      
      return null;
    }
    
    // Handle absolute paths (rare in imports)
    if (path.isAbsolute(source)) {
      return fs.existsSync(source) ? source : null;
    }
    
    // Handle path aliases
    if (options.resolveAliases && this.aliasMap.has(source)) {
      const aliasPath = this.aliasMap.get(source)!;
      return await this.resolveModulePath(aliasPath, currentFile, options);
    }
    
    // Handle node_modules (if included)
    if (options.includeNodeModules) {
      const nodeModulesPath = path.join(this.rootPath, 'node_modules', source);
      if (fs.existsSync(nodeModulesPath)) {
        return nodeModulesPath;
      }
    }
    
    return null;
  }

  private calculateDependencyStrength(importStmt: ImportStatement): number {
    let strength = 0.5; // Base strength
    
    // Type-only imports have lower strength
    if (importStmt.isTypeOnly) {
      strength *= 0.5;
    }
    
    // Dynamic imports have lower strength
    if (importStmt.type === 'dynamic') {
      strength *= 0.7;
    }
    
    // More imported items = higher strength
    if (importStmt.imported.length > 0) {
      strength += Math.min(0.3, importStmt.imported.length * 0.1);
    }
    
    // Default imports have higher strength
    if (importStmt.isDefault) {
      strength += 0.1;
    }
    
    return Math.min(1.0, strength);
  }

  private calculateRelationshipStrength(fileRel: Partial<FileRelationship>): number {
    const depCount = fileRel.dependencies?.length || 0;
    const dependendCount = fileRel.dependents?.length || 0;
    
    // Normalize based on total connections
    const totalConnections = depCount + dependendCount;
    
    if (totalConnections === 0) return 0;
    
    // Higher strength for files with more connections
    return Math.min(1.0, totalConnections / 10);
  }

  private detectCircularDependencies(nodes: Map<string, FileRelationship>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const dfs = (node: string, path: string[]): void => {
      if (recursionStack.has(node)) {
        // Found a cycle
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart);
        cycles.push([...cycle, node]);
        return;
      }
      
      if (visited.has(node)) {
        return;
      }
      
      visited.add(node);
      recursionStack.add(node);
      
      const fileRel = nodes.get(node);
      if (fileRel) {
        for (const dep of fileRel.dependencies) {
          dfs(dep, [...path, node]);
        }
      }
      
      recursionStack.delete(node);
    };
    
    for (const node of nodes.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }
    
    return cycles;
  }

  private detectClusters(nodes: Map<string, FileRelationship>, edges: DependencyRelationship[]): string[][] {
    const clusters: string[][] = [];
    const visited = new Set<string>();
    
    // Simple clustering based on strong connections
    for (const [filePath, fileRel] of nodes.entries()) {
      if (visited.has(filePath)) continue;
      
      const cluster = new Set<string>([filePath]);
      const queue = [filePath];
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        visited.add(current);
        
        const currentRel = nodes.get(current);
        if (!currentRel) continue;
        
        // Add strongly connected dependencies and dependents
        for (const dep of currentRel.dependencies) {
          if (!visited.has(dep)) {
            const edge = edges.find(e => e.from === current && e.to === dep);
            if (edge && edge.strength > 0.7) {
              cluster.add(dep);
              queue.push(dep);
            }
          }
        }
        
        for (const dependent of currentRel.dependents) {
          if (!visited.has(dependent)) {
            const edge = edges.find(e => e.from === dependent && e.to === current);
            if (edge && edge.strength > 0.7) {
              cluster.add(dependent);
              queue.push(dependent);
            }
          }
        }
      }
      
      if (cluster.size > 1) {
        clusters.push(Array.from(cluster));
      }
    }
    
    return clusters;
  }

  private calculateMetrics(
    nodes: Map<string, FileRelationship>,
    edges: DependencyRelationship[],
    cyclicDependencies: string[][]
  ): DependencyGraph['metrics'] {
    const totalFiles = nodes.size;
    const totalDependencies = edges.length;
    const averageDependencies = totalFiles > 0 ? totalDependencies / totalFiles : 0;
    
    let maxDependencies = 0;
    for (const fileRel of nodes.values()) {
      maxDependencies = Math.max(maxDependencies, fileRel.dependencies.length);
    }
    
    const cyclicDependencyCount = cyclicDependencies.length;
    
    // Calculate cohesion (how well connected modules within clusters are)
    const cohesion = this.calculateCohesion(nodes, edges);
    
    // Calculate coupling (how much modules depend on each other)
    const coupling = this.calculateCoupling(nodes, edges);
    
    return {
      totalFiles,
      totalDependencies,
      averageDependencies,
      maxDependencies,
      cyclicDependencyCount,
      cohesion,
      coupling
    };
  }

  private calculateCohesion(nodes: Map<string, FileRelationship>, edges: DependencyRelationship[]): number {
    if (nodes.size === 0) return 0;
    
    let totalCohesion = 0;
    let clusterCount = 0;
    
    // Simple cohesion calculation based on internal connections
    for (const fileRel of nodes.values()) {
      const internalConnections = fileRel.dependencies.filter(dep => 
        nodes.has(dep) && nodes.get(dep)!.dependencies.includes(fileRel.filePath)
      ).length;
      
      const totalConnections = fileRel.dependencies.length + fileRel.dependents.length;
      
      if (totalConnections > 0) {
        totalCohesion += internalConnections / totalConnections;
        clusterCount++;
      }
    }
    
    return clusterCount > 0 ? totalCohesion / clusterCount : 0;
  }

  private calculateCoupling(nodes: Map<string, FileRelationship>, edges: DependencyRelationship[]): number {
    if (nodes.size === 0) return 0;
    
    // Calculate average dependencies per file
    const avgDependencies = edges.length / nodes.size;
    
    // Normalize to 0-1 range (assuming 10 dependencies is high coupling)
    return Math.min(1.0, avgDependencies / 10);
  }

  private loadPathAliases(): void {
    // Load path aliases from tsconfig.json or similar
    try {
      const tsconfigPath = path.join(this.rootPath, 'tsconfig.json');
      if (fs.existsSync(tsconfigPath)) {
        const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
        const compilerOptions = tsconfig.compilerOptions;
        
        if (compilerOptions) {
          this.baseUrl = compilerOptions.baseUrl || '';
          
          if (compilerOptions.paths) {
            for (const [alias, paths] of Object.entries(compilerOptions.paths)) {
              if (Array.isArray(paths) && paths.length > 0) {
                const resolvedPath = path.resolve(this.rootPath, this.baseUrl, paths[0].replace('/*', ''));
                this.aliasMap.set(alias.replace('/*', ''), resolvedPath);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading path aliases:', error);
    }
  }

  private shouldExclude(filePath: string, excludePatterns: string[]): boolean {
    return excludePatterns.some(pattern => 
      filePath.includes(pattern) || filePath.includes(path.sep + pattern + path.sep)
    );
  }

  private getDefaultOptions(): DependencyAnalysisOptions {
    return {
      includeExtensions: this.defaultExtensions,
      excludePatterns: this.defaultExcludePatterns,
      followSymlinks: false,
      resolveAliases: true,
      includeNodeModules: false,
      maxDepth: 10,
      detectCircularDependencies: true,
      analyzeTypeImports: true
    };
  }
}