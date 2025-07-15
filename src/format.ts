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
      return `
  **${bug.id}: ${bug.title}**
  *Status*: ${bug.status} | *Priority*: ${bug.priority} | *Component*: ${bug.component}
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
      return `
  **${feature.id}: ${feature.title}**
  *Status*: ${feature.status} | *Priority*: ${feature.priority} | *Category*: ${feature.category}
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
      return `
  **${improvement.id}: ${improvement.title}**
  *Status*: ${improvement.status} | *Priority*: ${improvement.priority} | *Category*: ${improvement.category}
  *Requested*: ${improvement.dateRequested}
  
  *Current State*:
  ${improvement.currentState}
  
  *Desired State*:
  ${improvement.desiredState}
      `.trim();
    }).join('\n\n---\n\n');
  }
  
  export function formatSearchResults(results: any[]): string {
    if (results.length === 0) {
      return "No items found.";
    }
  
    return results.map(item => {
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
        output += '  - ' + status + ': ' + count + '\n';
      }
    }
    if (category.byPriority) {
      output += '*By Priority*:\n';
      for (const [priority, count] of Object.entries(category.byPriority)) {
        output += '  - ' + priority + ': ' + count + '\n';
      }
    }
    return output;
  }