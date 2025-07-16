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

function getStatusColor(status: string): (text: string) => string {
  switch (status.toLowerCase()) {
    case 'open':
    case 'proposed':
      return colors.blue;
    case 'in progress':
    case 'in development':
    case 'in discussion':
      return colors.yellow;
    case 'fixed':
    case 'completed':
    case 'approved':
      return colors.green;
    case 'closed':
    case 'rejected':
      return colors.red;
    case 'temporarily resolved':
    case 'research phase':
    case 'partially implemented':
      return colors.orange;
    case 'completed (awaiting human verification)':
      return colors.purple;
    default:
      return colors.info;
  }
}

function getPriorityColor(priority: string): (text: string) => string {
  switch (priority.toLowerCase()) {
    case 'critical':
      return colors.critical;
    case 'high':
      return colors.high;
    case 'medium':
      return colors.medium;
    case 'low':
      return colors.low;
    default:
      return colors.info;
  }
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
    if (bugs.length === 0) {
      return "No bugs found.";
    }
  
    return bugs.map(bug => {
      const statusColor = getStatusColor(bug.status);
      const priorityColor = getPriorityColor(bug.priority);
      
      return `
  **${bug.id}: ${bug.title}**
  *Status*: ${statusColor(bug.status)} | *Priority*: ${priorityColor(bug.priority)} | *Component*: ${bug.component}
  *Reported*: ${bug.dateReported}
  
  *Description*:
  ${bug.description}
  
  *Actual Behavior*:
  ${bug.actualBehavior}
  
  *Expected Behavior*:
  ${bug.expectedBehavior}
      `.trim();
    }).join('\n\n---\n\n');
  }
  
  export function formatFeatureRequests(features: FeatureRequest[]): string {
    if (features.length === 0) {
      return "No feature requests found.";
    }
  
    return features.map(feature => {
      const statusColor = getStatusColor(feature.status);
      const priorityColor = getPriorityColor(feature.priority);
      
      return `
  **${feature.id}: ${feature.title}**
  *Status*: ${statusColor(feature.status)} | *Priority*: ${priorityColor(feature.priority)} | *Category*: ${feature.category}
  *Requested*: ${feature.dateRequested}
  
  *User Story*:
  ${feature.userStory}
  
  *Current Behavior*:
  ${feature.currentBehavior}
  
  *Expected Behavior*:
  ${feature.expectedBehavior}
      `.trim();
    }).join('\n\n---\n\n');
  }
  
  export function formatImprovements(improvements: Improvement[]): string {
    if (improvements.length === 0) {
      return "No improvements found.";
    }
  
    return improvements.map(improvement => {
      const statusColor = getStatusColor(improvement.status);
      const priorityColor = getPriorityColor(improvement.priority);
      
      return `
  **${improvement.id}: ${improvement.title}**
  *Status*: ${statusColor(improvement.status)} | *Priority*: ${priorityColor(improvement.priority)} | *Category*: ${improvement.category}
  *Requested*: ${improvement.dateRequested}
  
  *Current State*:
  ${improvement.currentState}
  
  *Desired State*:
  ${improvement.desiredState}
      `.trim();
    }).join('\n\n---\n\n');
  }
  
  export function formatSearchResults(results: any[], metadata?: any): string {
    if (results.length === 0) {
      return "No items found.";
    }
  
    let output = '';
    
    // Add metadata header if provided
    if (metadata) {
      output += `**Search Results** (${metadata.showing} of ${metadata.total} total)\n`;
      if (metadata.offset > 0) {
        output += `*Showing results ${metadata.offset + 1}-${metadata.offset + metadata.showing}*\n`;
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
    }).join('\n\n---\n\n');
    
    return output + formattedResults;
  }
  
  export function formatStatistics(stats: any): string {
    let output = '**Project Statistics**\n';
  
    if (stats.bugs) {
      output += '\n**Bugs** (' + stats.bugs.total + ' total)\n';
      output += formatStatusAndPriority(stats.bugs);
    }
  
    if (stats.features) {
      output += '\n**Feature Requests** (' + stats.features.total + ' total)\n';
      output += formatStatusAndPriority(stats.features);
    }
  
    if (stats.improvements) {
      output += '\n**Improvements** (' + stats.improvements.total + ' total)\n';
      output += formatStatusAndPriority(stats.improvements);
    }
  
    return output;
  }
  
  function formatStatusAndPriority(category: any): string {
    let output = '';
    if (category.byStatus) {
      output += '*By Status*:\n';
      for (const [status, count] of Object.entries(category.byStatus)) {
        const statusColor = getStatusColor(status);
        output += '  - ' + statusColor(status) + ': ' + count + '\n';
      }
    }
    if (category.byPriority) {
      output += '*By Priority*:\n';
      for (const [priority, count] of Object.entries(category.byPriority)) {
        const priorityColor = getPriorityColor(priority);
        output += '  - ' + priorityColor(priority) + ': ' + count + '\n';
      }
    }
    return output;
  }