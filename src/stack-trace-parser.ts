// Stack trace parser for automated context collection
// Supports multiple programming languages and integrates with existing context collection engine

export interface StackTraceFrame {
  functionName?: string | undefined;
  filePath?: string | undefined;
  lineNumber?: number | undefined;
  columnNumber?: number | undefined;
  className?: string | undefined;
  methodName?: string | undefined;
  language: string;
  rawLine: string;
}

export interface ParsedStackTrace {
  language: string;
  errorType?: string | undefined;
  errorMessage?: string | undefined;
  frames: StackTraceFrame[];
  isValid: boolean;
  confidence: number; // 0-1 score for parsing confidence
}

export interface StackTraceContext {
  filePath: string;
  functionName?: string | undefined;
  lineNumber: number;
  contextLines: number; // How many lines around the error to collect
  priority: 'high' | 'medium' | 'low';
}

/**
 * Enhanced stack trace parser that can handle multiple programming languages
 * and extract code context information for automated bug analysis
 */
export class StackTraceParser {
  private static readonly LANGUAGE_PATTERNS = {
    javascript: {
      // JavaScript/Node.js patterns
      patterns: [
        // Standard V8 stack trace: "at functionName (file.js:line:col)"
        /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/,
        // Browser stack trace: "functionName@file.js:line:col"
        /^\s*(.+?)@(.+?):(\d+):(\d+)$/,
        // Webpack/bundled: "at Object.functionName (webpack:///./src/file.js:line:col)"
        /^\s*at\s+(?:Object\.)?(.+?)\s+\(webpack:\/\/\/\.\/(.+?):(\d+):(\d+)\)/,
        // Simple format: "file.js:line:col"
        /^\s*(.+?):(\d+):(\d+)$/
      ],
      errorPattern: /^(\w+(?:Error|Exception)?):\s*(.+)$/,
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs'],
      confidence: 0.9
    },
    
    python: {
      // Python traceback patterns
      patterns: [
        // "  File "/path/to/file.py", line 123, in function_name"
        /^\s*File\s+"(.+?)",\s+line\s+(\d+),\s+in\s+(.+)$/,
        // Alternative format: "File "file.py", line 123"
        /^\s*File\s+"(.+?)",\s+line\s+(\d+)$/
      ],
      errorPattern: /^(\w+(?:Error|Exception)):\s*(.+)$/,
      extensions: ['.py', '.pyw'],
      confidence: 0.95
    },
    
    java: {
      // Java stack trace patterns
      patterns: [
        // "at com.example.Class.method(File.java:123)"
        /^\s*at\s+([a-zA-Z_$][a-zA-Z0-9_$.]*?)\.([a-zA-Z_$][a-zA-Z0-9_$]*?)\((.+?):(\d+)\)$/,
        // "at com.example.Class.method(Unknown Source)"
        /^\s*at\s+([a-zA-Z_$][a-zA-Z0-9_$.]*?)\.([a-zA-Z_$][a-zA-Z0-9_$]*?)\(Unknown Source\)$/,
        // "at com.example.Class.method(Native Method)"
        /^\s*at\s+([a-zA-Z_$][a-zA-Z0-9_$.]*?)\.([a-zA-Z_$][a-zA-Z0-9_$]*?)\(Native Method\)$/
      ],
      errorPattern: /^(\w+(?:Exception|Error)):\s*(.+)$/,
      extensions: ['.java'],
      confidence: 0.9
    },
    
    csharp: {
      // C# stack trace patterns
      patterns: [
        // "at Namespace.Class.Method() in C:\path\to\File.cs:line 123"
        /^\s*at\s+([a-zA-Z_][a-zA-Z0-9_.]*?)\.([a-zA-Z_][a-zA-Z0-9_]*?)\([^)]*\)\s+in\s+(.+?):line\s+(\d+)$/,
        // "at Namespace.Class.Method()"
        /^\s*at\s+([a-zA-Z_][a-zA-Z0-9_.]*?)\.([a-zA-Z_][a-zA-Z0-9_]*?)\([^)]*\)$/
      ],
      errorPattern: /^(System\.\w+(?:Exception)?|\w+(?:Exception|Error)):\s*(.+)$/,
      extensions: ['.cs'],
      confidence: 0.85
    },
    
    go: {
      // Go panic stack trace patterns
      patterns: [
        // "main.functionName() /path/to/file.go:123 +0x456"
        /^\s*(.+?)\(\)\s+(.+?):(\d+)\s+\+0x[0-9a-f]+$/,
        // "github.com/user/repo/package.functionName() /path/to/file.go:123"
        /^\s*(.+?)\.(.+?)\(\)\s+(.+?):(\d+)$/
      ],
      errorPattern: /^panic:\s*(.+)$/,
      extensions: ['.go'],
      confidence: 0.8
    },
    
    rust: {
      // Rust panic stack trace patterns
      patterns: [
        // "at crate_name::module::function (/path/to/file.rs:123:45)"
        /^\s*at\s+(.+?)::(.+?)\s+\((.+?):(\d+):(\d+)\)$/,
        // "crate_name::module::function at /path/to/file.rs:123:45"
        /^\s*(.+?)::(.+?)\s+at\s+(.+?):(\d+):(\d+)$/
      ],
      errorPattern: /^thread\s+'[^']+'\s+panicked\s+at\s+'(.+)',\s+(.+?):(\d+):(\d+)$/,
      extensions: ['.rs'],
      confidence: 0.8
    }
  };

  /**
   * Parse a stack trace from text and extract structured information
   */
  public static parseStackTrace(stackTraceText: string): ParsedStackTrace {
    if (!stackTraceText || typeof stackTraceText !== 'string') {
      return {
        language: 'unknown',
        frames: [],
        isValid: false,
        confidence: 0
      };
    }

    const lines = stackTraceText.split('\n').map(line => line.trim()).filter(Boolean);
    
    // Try to detect the language and parse accordingly
    for (const [language, config] of Object.entries(this.LANGUAGE_PATTERNS)) {
      const result = this.parseWithLanguageConfig(lines, language, config);
      if (result.isValid && result.frames.length > 0) {
        return result;
      }
    }

    // Fallback: try to extract any file references
    const fallbackFrames = this.extractFallbackFrames(lines);
    
    return {
      language: 'unknown',
      frames: fallbackFrames,
      isValid: fallbackFrames.length > 0,
      confidence: fallbackFrames.length > 0 ? 0.3 : 0
    };
  }

  /**
   * Extract context information from parsed stack trace for code collection
   */
  public static extractStackTraceContexts(parsedTrace: ParsedStackTrace): StackTraceContext[] {
    if (!parsedTrace.isValid || parsedTrace.frames.length === 0) {
      return [];
    }

    const contexts: StackTraceContext[] = [];
    
    for (let i = 0; i < parsedTrace.frames.length; i++) {
      const frame = parsedTrace.frames[i];
      
      if (frame.filePath && frame.lineNumber) {
        // Skip system/library files for most languages
        if (this.isSystemFile(frame.filePath, parsedTrace.language)) {
          continue;
        }

        const priority = this.determinePriority(i, parsedTrace.frames.length);
        const contextLines = this.determineContextLines(priority);

        contexts.push({
          filePath: frame.filePath,
          functionName: frame.functionName || frame.methodName || undefined,
          lineNumber: frame.lineNumber,
          contextLines,
          priority
        });
      }
    }

    return contexts;
  }

  /**
   * Check if the given text contains a potential stack trace
   */
  public static containsStackTrace(text: string): boolean {
    if (!text || typeof text !== 'string') {
      return false;
    }

    const lines = text.split('\n');
    let stackTraceLines = 0;

    for (const line of lines) {
      // Check for common stack trace indicators
      if (this.looksLikeStackTraceLine(line)) {
        stackTraceLines++;
        if (stackTraceLines >= 2) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract all stack traces from a larger text block
   */
  public static extractStackTraces(text: string): ParsedStackTrace[] {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const stackTraces: ParsedStackTrace[] = [];
    const lines = text.split('\n');
    let currentStackTrace: string[] = [];
    let inStackTrace = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (this.looksLikeStackTraceLine(line)) {
        if (!inStackTrace) {
          // Starting a new stack trace, include potential error message from previous lines
          const errorContext = this.findErrorContext(lines, i);
          currentStackTrace = errorContext;
          inStackTrace = true;
        }
        currentStackTrace.push(line);
      } else if (inStackTrace) {
        // Check if this might be a continuation (like error message)
        if (line.trim() && !this.looksLikeRegularCode(line)) {
          currentStackTrace.push(line);
        } else {
          // End of current stack trace
          if (currentStackTrace.length >= 2) {
            const parsed = this.parseStackTrace(currentStackTrace.join('\n'));
            if (parsed.isValid) {
              stackTraces.push(parsed);
            }
          }
          currentStackTrace = [];
          inStackTrace = false;
        }
      }
    }

    // Handle case where stack trace goes to end of text
    if (currentStackTrace.length >= 2) {
      const parsed = this.parseStackTrace(currentStackTrace.join('\n'));
      if (parsed.isValid) {
        stackTraces.push(parsed);
      }
    }

    return stackTraces;
  }

  // Private helper methods

  private static parseWithLanguageConfig(
    lines: string[], 
    language: string, 
    config: any
  ): ParsedStackTrace {
    const frames: StackTraceFrame[] = [];
    let errorType: string | undefined;
    let errorMessage: string | undefined;
    let confidence = 0;

    for (const line of lines) {
      // Try to match error pattern first
      if (!errorType && config.errorPattern) {
        const errorMatch = line.match(config.errorPattern);
        if (errorMatch) {
          errorType = errorMatch[1];
          errorMessage = errorMatch[2];
          confidence += 0.3;
          continue;
        }
      }

      // Try to match stack trace patterns
      for (const pattern of config.patterns) {
        const match = line.match(pattern);
        if (match) {
          const frame = this.createFrameFromMatch(match, language, line, pattern);
          if (frame) {
            frames.push(frame);
            confidence += 0.1;
            break;
          }
        }
      }
    }

    const isValid = frames.length > 0 && confidence > 0.3;
    const finalConfidence = Math.min(1.0, confidence * config.confidence);

    return {
      language,
      errorType,
      errorMessage,
      frames,
      isValid,
      confidence: finalConfidence
    };
  }

  private static createFrameFromMatch(
    match: RegExpMatchArray, 
    language: string, 
    rawLine: string, 
    pattern: RegExp
  ): StackTraceFrame | null {
    // Different patterns have different group arrangements
    // This is a simplified approach - in practice, you'd want more specific handling per pattern
    
    const frame: StackTraceFrame = {
      language,
      rawLine
    };

    // Extract information based on what's available in the match
    const groups = match.slice(1); // Remove full match
    
    switch (language) {
      case 'javascript':
        if (groups.length >= 3) {
          frame.functionName = groups[0] || undefined;
          frame.filePath = groups[1] || undefined;
          frame.lineNumber = groups[2] ? parseInt(groups[2]) : undefined;
          frame.columnNumber = groups[3] ? parseInt(groups[3]) : undefined;
        }
        break;
        
      case 'python':
        if (groups.length >= 2) {
          frame.filePath = groups[0] || undefined;
          frame.lineNumber = groups[1] ? parseInt(groups[1]) : undefined;
          frame.functionName = groups[2] || undefined;
        }
        break;
        
      case 'java':
        if (groups.length >= 3) {
          frame.className = groups[0] || undefined;
          frame.methodName = groups[1] || undefined;
          frame.filePath = groups[2] || undefined;
          frame.lineNumber = groups[3] ? parseInt(groups[3]) : undefined;
        }
        break;
        
      case 'csharp':
        if (groups.length >= 2) {
          frame.className = groups[0] || undefined;
          frame.methodName = groups[1] || undefined;
          frame.filePath = groups[2] || undefined;
          frame.lineNumber = groups[3] ? parseInt(groups[3]) : undefined;
        }
        break;
        
      case 'go':
        if (groups.length >= 3) {
          frame.functionName = groups[0] || groups[1] || undefined;
          frame.filePath = groups[2] || groups[3] || undefined;
          frame.lineNumber = groups[3] || groups[4] ? parseInt(groups[3] || groups[4]) : undefined;
        }
        break;
        
      case 'rust':
        if (groups.length >= 4) {
          frame.functionName = groups[0] && groups[1] ? `${groups[0]}::${groups[1]}` : undefined;
          frame.filePath = groups[2] || undefined;
          frame.lineNumber = groups[3] ? parseInt(groups[3]) : undefined;
          frame.columnNumber = groups[4] ? parseInt(groups[4]) : undefined;
        }
        break;
    }

    // Validate that we extracted at least a file path
    return frame.filePath ? frame : null;
  }

  private static extractFallbackFrames(lines: string[]): StackTraceFrame[] {
    const frames: StackTraceFrame[] = [];
    
    for (const line of lines) {
      // Look for any file:line patterns
      const fileLineMatch = line.match(/([a-zA-Z0-9_\-/.\\]+\.(js|ts|py|java|cs|go|rs|jsx|tsx)):(\d+)/);
      if (fileLineMatch) {
        frames.push({
          filePath: fileLineMatch[1],
          lineNumber: parseInt(fileLineMatch[3]),
          language: 'unknown',
          rawLine: line
        });
      }
    }
    
    return frames;
  }

  private static looksLikeStackTraceLine(line: string): boolean {
    const trimmed = line.trim();
    
    // Common stack trace indicators
    const indicators = [
      /^\s*at\s+/,           // JavaScript "at"
      /^\s*File\s+"/,        // Python "File"
      /^\s*\w+\.\w+\(/,      // Java class.method(
      /\.(js|ts|py|java|cs|go|rs|jsx|tsx):\d+/,  // file.ext:line
      /^\s*\d+\.\s+/,        // Numbered stack trace
      /^thread\s+'[^']+'\s+panicked/,  // Rust panic
    ];
    
    return indicators.some(pattern => pattern.test(trimmed));
  }

  private static findErrorContext(lines: string[], stackTraceStartIndex: number): string[] {
    const context: string[] = [];
    
    // Look backwards for error message
    for (let i = Math.max(0, stackTraceStartIndex - 3); i < stackTraceStartIndex; i++) {
      const line = lines[i].trim();
      if (line && (line.includes('Error') || line.includes('Exception') || line.includes('panic'))) {
        context.push(lines[i]);
      }
    }
    
    return context;
  }

  private static looksLikeRegularCode(line: string): boolean {
    const trimmed = line.trim();
    
    // Indicators that this is regular code, not part of a stack trace
    const codeIndicators = [
      /^(function|class|def|public|private|if|for|while|return)/,
      /^(import|from|#include|using)/,
      /^\s*\/\/|^\s*\/\*|^\s*#/,  // Comments
      /^\s*[{}]\s*$/,             // Braces alone
      /^\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*[=:]/,  // Variable assignments
    ];
    
    return codeIndicators.some(pattern => pattern.test(trimmed));
  }

  private static isSystemFile(filePath: string, language: string): boolean {
    const systemPatterns: Record<string, RegExp[]> = {
      javascript: [
        /node_modules/,
        /internal\/.*\.js$/,
        /^node:/
      ],
      python: [
        /\/usr\/lib\/python/,
        /site-packages/,
        /<frozen /
      ],
      java: [
        /^java\./,
        /^javax\./,
        /^sun\./,
        /^com\.sun\./
      ],
      csharp: [
        /^System\./,
        /^Microsoft\./
      ]
    };

    const patterns = systemPatterns[language] || [];
    return patterns.some(pattern => pattern.test(filePath));
  }

  private static determinePriority(frameIndex: number, totalFrames: number): 'high' | 'medium' | 'low' {
    // First few frames are usually most relevant
    if (frameIndex < 2) return 'high';
    if (frameIndex < Math.ceil(totalFrames / 2)) return 'medium';
    return 'low';
  }

  private static determineContextLines(priority: 'high' | 'medium' | 'low'): number {
    switch (priority) {
      case 'high': return 10;   // ±10 lines around the error
      case 'medium': return 5;  // ±5 lines around the error
      case 'low': return 3;     // ±3 lines around the error
    }
  }
}