import chalk from 'chalk';

// Try to force chalk to use colors, but provide fallback
const FORCE_COLORS = process.env.FORCE_COLOR !== '0';
if (FORCE_COLORS) {
  chalk.level = 3; // Force highest color support level
}

// Fallback visual indicators when colors don't work
const visualIndicators = {
  critical: '🚨',
  high: '⚠️',
  medium: 'ℹ️',
  low: '📝',
  open: '🔴',
  proposed: '🔴',
  progress: '🟡',
  development: '🟡',
  completed: '✅',
  fixed: '✅',
  closed: '⚫',
  rejected: '⚫'
};

// Color and formatting utilities for MCP output
const colors = {
  // Status colors with fallback
  red: (text: string) => {
    const colored = chalk.red(text);
    return colored !== text ? colored : `🔴 ${text}`;
  },
  green: (text: string) => {
    const colored = chalk.green(text);
    return colored !== text ? colored : `🟢 ${text}`;
  },
  yellow: (text: string) => {
    const colored = chalk.yellow(text);
    return colored !== text ? colored : `🟡 ${text}`;
  },
  blue: (text: string) => {
    const colored = chalk.blue(text);
    return colored !== text ? colored : `🔵 ${text}`;
  },
  orange: (text: string) => {
    const colored = chalk.hex('#FFA500')(text);
    return colored !== text ? colored : `🟠 ${text}`;
  },
  purple: (text: string) => {
    const colored = chalk.magenta(text);
    return colored !== text ? colored : `🟣 ${text}`;
  },
  
  // Priority colors with fallback
  critical: (text: string) => {
    const colored = chalk.bold.red(text);
    return colored !== text ? colored : `🚨 ${text}`;
  },
  high: (text: string) => {
    const colored = chalk.bold.yellow(text);
    return colored !== text ? colored : `⚠️ ${text}`;
  },
  medium: (text: string) => {
    const colored = chalk.blue(text);
    return colored !== text ? colored : `ℹ️ ${text}`;
  },
  low: (text: string) => {
    const colored = chalk.gray(text);
    return colored !== text ? colored : `📝 ${text}`;
  },
  
  // General formatting with fallback
  highlight: (text: string) => {
    const colored = chalk.bold.cyan(text);
    return colored !== text ? colored : `✨ ${text}`;
  },
  success: (text: string) => {
    const colored = chalk.green(text);
    return colored !== text ? colored : `✅ ${text}`;
  },
  info: (text: string) => {
    const colored = chalk.cyan(text);
    return colored !== text ? colored : `ℹ️ ${text}`;
  },
  warning: (text: string) => {
    const colored = chalk.yellow(text);
    return colored !== text ? colored : `⚠️ ${text}`;
  },
  error: (text: string) => {
    const colored = chalk.red(text);
    return colored !== text ? colored : `❌ ${text}`;
  }
};

// Unified output formatting interface
interface OutputOptions {
  includeHeaders?: boolean;
  maxContentLength?: number;
  showMetadata?: boolean;
  showTokenUsage?: boolean;
}

interface TableColumn {
  key: string;
  header: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  formatter?: (value: any) => string;
}

/**
 * Unified table formatter for consistent output across all tools
 */
export function formatTable(data: any[], columns: TableColumn[], options: OutputOptions = {}): string {
  if (data.length === 0) {
    return "No items found.";
  }

  const { includeHeaders = true, maxContentLength = 50 } = options;
  
  // Calculate column widths
  const columnWidths = columns.map(col => {
    const headerWidth = col.header.length;
    const contentWidth = Math.max(...data.map(item => {
      const value = col.formatter ? col.formatter(item[col.key]) : String(item[col.key] || '');
      return Math.min(value.length, maxContentLength);
    }));
    return Math.max(headerWidth, contentWidth, col.width || 0);
  });

  let output = '';
  
  // Add headers
  if (includeHeaders) {
    const headerRow = columns.map((col, i) => {
      const padding = columnWidths[i] - col.header.length;
      return col.header + ' '.repeat(Math.max(0, padding));
    }).join('  |  ');
    
    const separator = columns.map((_, i) => '-'.repeat(columnWidths[i])).join('--|--');
    
    output += headerRow + '\n';
    output += separator + '\n';
  }
  
  // Add data rows
  data.forEach(item => {
    const row = columns.map((col, i) => {
      let value = col.formatter ? col.formatter(item[col.key]) : String(item[col.key] || '');
      
      // Truncate long content
      if (value.length > maxContentLength) {
        value = value.substring(0, maxContentLength - 3) + '...';
      }
      
      const padding = columnWidths[i] - value.length;
      const align = col.align || 'left';
      
      switch (align) {
        case 'right':
          return ' '.repeat(Math.max(0, padding)) + value;
        case 'center':
          const leftPad = Math.floor(padding / 2);
          const rightPad = padding - leftPad;
          return ' '.repeat(leftPad) + value + ' '.repeat(rightPad);
        default: // left
          return value + ' '.repeat(Math.max(0, padding));
      }
    }).join('  |  ');
    
    output += row + '\n';
  });
  
  return output;
}

/**
 * Format error message consistently
 */
export function formatError(message: string, context?: string): string {
  let output = colors.error(`Error: ${message}`);
  if (context) {
    output += `\n${colors.info(`Context: ${context}`)}`;
  }
  return output;
}

/**
 * Format success message consistently
 */
export function formatSuccess(message: string, details?: string): string {
  let output = colors.success(message);
  if (details) {
    output += `\n${colors.info(details)}`;
  }
  return output;
}

/**
 * Format metadata consistently
 */
export function formatMetadata(metadata: any): string {
  let output = '';
  
  if (metadata.total !== undefined) {
    output += `Total: ${metadata.total}`;
    if (metadata.showing !== undefined && metadata.showing !== metadata.total) {
      output += ` (showing ${metadata.showing})`;
    }
    output += '\n';
  }
  
  if (metadata.offset !== undefined && metadata.offset > 0) {
    output += `Results ${metadata.offset + 1}-${metadata.offset + (metadata.showing || metadata.total)}\n`;
  }
  
  return output;
}

/**
 * Format token usage consistently
 */
export function formatTokenUsage(usage: { total: number; input: number; output: number }): string {
  return `\nToken usage: ${usage.total} tokens (${usage.input} input, ${usage.output} output)`;
}

/**
 * Get priority formatter
 */
export function getPriorityFormatter(): (priority: string) => string {
  return (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'critical': return colors.critical(priority);
      case 'high': return colors.high(priority);
      case 'medium': return colors.medium(priority);
      case 'low': return colors.low(priority);
      default: return priority || '';
    }
  };
}

/**
 * Get status formatter with colors
 */
export function getStatusFormatter(): (status: string) => string {
  return (status: string) => {
    const statusLower = status?.toLowerCase() || '';
    
    if (statusLower.includes('open') || statusLower === 'proposed') return chalk.red(status);
    else if (statusLower.includes('progress') || statusLower.includes('development')) return chalk.yellow(status);
    else if (statusLower.includes('fixed') || statusLower.includes('completed') || statusLower === 'done') return chalk.green(status);
    else if (statusLower.includes('closed') || statusLower === 'rejected') return chalk.gray(status);
    else if (statusLower.includes('blocked')) return chalk.red.bold(status);
    else if (statusLower.includes('discussion') || statusLower.includes('research')) return chalk.blue(status);
    else if (statusLower.includes('approved')) return chalk.green.bold(status);
    
    return status;
  };
}


interface Bug {
    id: string;
    status: 'Open' | 'In Progress' | 'Fixed' | 'Closed' | 'Temporarily Resolved';
    priority: 'Low' | 'Medium' | 'High' | 'Critical';
    dateReported: string;
    component: string;
    title: string;
    description: string;
    expectedBehavior: string;
    actualBehavior: string;
    potentialRootCause?: string;
    filesLikelyInvolved?: string[];
    stepsToReproduce?: string[];
    verification?: string[];
    humanVerified?: boolean;
  }
  
  interface FeatureRequest {
    id: string;
    status: 'Proposed' | 'In Discussion' | 'Approved' | 'In Development' | 'Research Phase' | 'Partially Implemented' | 'Completed' | 'Rejected';
    priority: 'Low' | 'Medium' | 'High' | 'Critical';
    dateRequested: string;
    category: string;
    requestedBy?: string;
    title: string;
    description: string;
    userStory: string;
    currentBehavior: string;
    expectedBehavior: string;
    acceptanceCriteria: string[];
    potentialImplementation?: string;
    dependencies?: string[];
    effortEstimate?: 'Small' | 'Medium' | 'Large' | 'XL';
  }
  
  interface Improvement {
    id: string;
    status: 'Proposed' | 'In Discussion' | 'Approved' | 'In Development' | 'Completed (Awaiting Human Verification)' | 'Completed' | 'Rejected';
    priority: 'Low' | 'Medium' | 'High';
    dateRequested: string;
    dateCompleted?: string;
    category: string;
    requestedBy?: string;
    title: string;
    description: string;
    currentState: string;
    desiredState: string;
    acceptanceCriteria: string[];
    implementationDetails?: string;
    potentialImplementation?: string;
    filesLikelyInvolved?: string[];
    dependencies?: string[];
    effortEstimate?: 'Small' | 'Medium' | 'Large';
    benefits?: string[];
  }
  
  export function formatBugs(bugs: Bug[]): string {
    const columns: TableColumn[] = [
      { key: 'id', header: 'ID', width: 8 },
      { key: 'status', header: 'Status', formatter: getStatusFormatter() },
      { key: 'priority', header: 'Priority', formatter: getPriorityFormatter() },
      { key: 'component', header: 'Component' },
      { key: 'dateReported', header: 'Date', width: 10 },
      { key: 'title', header: 'Title' }
    ];
    
    return formatTable(bugs, columns);
  }
  
  export function formatFeatureRequests(features: FeatureRequest[]): string {
    const columns: TableColumn[] = [
      { key: 'id', header: 'ID', width: 8 },
      { key: 'status', header: 'Status', formatter: getStatusFormatter() },
      { key: 'priority', header: 'Priority', formatter: getPriorityFormatter() },
      { key: 'category', header: 'Category' },
      { key: 'dateRequested', header: 'Date', width: 10 },
      { key: 'title', header: 'Title' }
    ];
    
    return formatTable(features, columns);
  }
  
  export function formatImprovements(improvements: Improvement[]): string {
    const columns: TableColumn[] = [
      { key: 'id', header: 'ID', width: 8 },
      { key: 'status', header: 'Status', formatter: getStatusFormatter() },
      { key: 'priority', header: 'Priority', formatter: getPriorityFormatter() },
      { key: 'category', header: 'Category' },
      { key: 'dateRequested', header: 'Date', width: 10 },
      { key: 'title', header: 'Title' }
    ];
    
    return formatTable(improvements, columns);
  }
  
  export function formatImprovementsWithContext(improvements: any[]): string {
    if (improvements.length === 0) {
      return "No improvements found.";
    }
    
    let output = formatImprovements(improvements);
    
    // Add code context for each improvement
    improvements.forEach(improvement => {
      if (improvement.codeContext && improvement.codeContext.length > 0) {
        output += `\n${colors.highlight(`Code Context for ${improvement.id} - ${improvement.title}`)}\n`;
        output += `${colors.info('Description:')} ${improvement.description}\n`;
        output += `${colors.info('Current State:')} ${improvement.currentState}\n`;
        output += `${colors.info('Desired State:')} ${improvement.desiredState}\n\n`;
        
        improvement.codeContext.forEach((context: any) => {
          output += `${colors.highlight(`File: ${context.file}`)}\n`;
          
          if (context.error) {
            output += `${colors.error(context.error)}\n\n`;
          } else {
            // Show token-optimized content display
            const contentLength = context.content?.length || 0;
            const estimatedTokens = Math.ceil(contentLength / 4);
            output += `${colors.info(`Content (${contentLength} chars, ~${estimatedTokens} tokens)`)}\n`;
            output += '```\n';
            output += context.content;
            output += '\n```\n\n';
          }
        });
      }
    });
    
    return output;
  }
  
  export function formatSearchResults(results: any[], metadata?: any): string {
    if (results.length === 0) {
      return "No items found.";
    }
  
    let output = '';
    
    // Add metadata header if provided
    if (metadata) {
      output += `Search Results (${metadata.showing} of ${metadata.total} total)\n`;
      if (metadata.offset > 0) {
        output += `Showing results ${metadata.offset + 1}-${metadata.offset + metadata.showing}\n`;
      }
      output += '\n';
    }
    
    const formattedResults = results.map(item => {
      switch (item.type) {
        case 'bug':
          return formatBugs([item]);
        case 'feature':
          return formatFeatureRequests([item]);
        case 'improvement':
          return formatImprovements([item]);
        default:
          return JSON.stringify(item, null, 2);
      }
    }).join('\n\n');
    
    return output + formattedResults;
  }
  
  export function formatBulkUpdateResults(results: any[], type: 'bugs' | 'features' | 'improvements'): string {
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    let output = '';
    
    if (successCount > 0) {
      const successfulResults = results.filter(r => r.status === 'success');
      output += `${successfulResults.length} ${type} updated successfully:\n\n`;
      
      // Create table-like format
      const longestId = Math.max(...successfulResults.map(r => r.bugId?.length || r.featureId?.length || r.improvementId?.length || 0));
      const longestStatus = Math.max(...successfulResults.map(r => r.message?.replace('Updated to ', '').length || 0));
      
      successfulResults.forEach(r => {
        const itemId = r.bugId || r.featureId || r.improvementId || '';
        const status = r.message?.replace('Updated to ', '') || '';
        const date = r.dateCompleted || new Date().toISOString().split('T')[0];
        
        output += `${itemId.padEnd(longestId)}  |  ${status.padEnd(longestStatus)}  |  ${date}\n`;
      });
      
      if (errorCount > 0) {
        output += '\n';
      }
    }
    
    if (errorCount > 0) {
      output += `${errorCount} ${type} failed to update:\n\n`;
      results.filter(r => r.status === 'error').forEach(r => {
        const itemId = r.bugId || r.featureId || r.improvementId || '';
        output += `${itemId}: ${r.message}\n`;
      });
    }
    
    return output;
  }

  export function formatStatistics(stats: any): string {
    let output = 'Project Statistics\n\n';
  
    if (stats.bugs) {
      output += `Bugs (${stats.bugs.total} total)\n`;
      output += formatStatusAndPriority(stats.bugs);
      output += '\n';
    }
  
    if (stats.features) {
      output += `Feature Requests (${stats.features.total} total)\n`;
      output += formatStatusAndPriority(stats.features);
      output += '\n';
    }
  
    if (stats.improvements) {
      output += `Improvements (${stats.improvements.total} total)\n`;
      output += formatStatusAndPriority(stats.improvements);
    }
  
    return output;
  }
  
  function formatStatusAndPriority(category: any): string {
    let output = '';
    if (category.byStatus) {
      output += 'By Status:\n';
      for (const [status, count] of Object.entries(category.byStatus)) {
        output += `  ${status}: ${count}\n`;
      }
    }
    if (category.byPriority) {
      output += 'By Priority:\n';
      for (const [priority, count] of Object.entries(category.byPriority)) {
        output += `  ${priority}: ${count}\n`;
      }
    }
    return output;
  }