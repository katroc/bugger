// Color and formatting utilities for MCP output
const colors = {
  // Status colors
  red: (text: string) => `🔴 ${text}`,
  green: (text: string) => `🟢 ${text}`,
  yellow: (text: string) => `🟡 ${text}`,
  blue: (text: string) => `🔵 ${text}`,
  orange: (text: string) => `🟠 ${text}`,
  purple: (text: string) => `🟣 ${text}`,
  
  // Priority colors
  critical: (text: string) => `🚨 ${text}`,
  high: (text: string) => `⚠️ ${text}`,
  medium: (text: string) => `📋 ${text}`,
  low: (text: string) => `📝 ${text}`,
  
  // General formatting
  highlight: (text: string) => `✨ ${text}`,
  success: (text: string) => `✅ ${text}`,
  info: (text: string) => `ℹ️ ${text}`,
  warning: (text: string) => `⚠️ ${text}`,
  error: (text: string) => `❌ ${text}`
};


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
    if (bugs.length === 0) {
      return "No bugs found.";
    }
  
    // Calculate column widths
    const longestId = Math.max(...bugs.map(b => b.id.length));
    const longestStatus = Math.max(...bugs.map(b => b.status.length));
    const longestPriority = Math.max(...bugs.map(b => b.priority.length));
    const longestComponent = Math.max(...bugs.map(b => b.component.length));
    const longestTitle = Math.max(...bugs.map(b => b.title.length));
    
    let output = '';
    
    bugs.forEach(bug => {
      output += `${bug.id.padEnd(longestId)}  |  ${bug.status.padEnd(longestStatus)}  |  ${bug.priority.padEnd(longestPriority)}  |  ${bug.component.padEnd(longestComponent)}  |  ${bug.dateReported}  |  ${bug.title}\n`;
    });
    
    return output;
  }
  
  export function formatFeatureRequests(features: FeatureRequest[]): string {
    if (features.length === 0) {
      return "No feature requests found.";
    }
  
    // Calculate column widths
    const longestId = Math.max(...features.map(f => f.id.length));
    const longestStatus = Math.max(...features.map(f => f.status.length));
    const longestPriority = Math.max(...features.map(f => f.priority.length));
    const longestCategory = Math.max(...features.map(f => f.category.length));
    const longestTitle = Math.max(...features.map(f => f.title.length));
    
    let output = '';
    
    features.forEach(feature => {
      output += `${feature.id.padEnd(longestId)}  |  ${feature.status.padEnd(longestStatus)}  |  ${feature.priority.padEnd(longestPriority)}  |  ${feature.category.padEnd(longestCategory)}  |  ${feature.dateRequested}  |  ${feature.title}\n`;
    });
    
    return output;
  }
  
  export function formatImprovements(improvements: Improvement[]): string {
    if (improvements.length === 0) {
      return "No improvements found.";
    }
  
    // Calculate column widths
    const longestId = Math.max(...improvements.map(i => i.id.length));
    const longestStatus = Math.max(...improvements.map(i => i.status.length));
    const longestPriority = Math.max(...improvements.map(i => i.priority.length));
    const longestCategory = Math.max(...improvements.map(i => i.category.length));
    const longestTitle = Math.max(...improvements.map(i => i.title.length));
    
    let output = '';
    
    improvements.forEach(improvement => {
      output += `${improvement.id.padEnd(longestId)}  |  ${improvement.status.padEnd(longestStatus)}  |  ${improvement.priority.padEnd(longestPriority)}  |  ${improvement.category.padEnd(longestCategory)}  |  ${improvement.dateRequested}  |  ${improvement.title}\n`;
    });
    
    return output;
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