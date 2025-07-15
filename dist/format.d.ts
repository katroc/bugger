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
export declare function formatBugs(bugs: Bug[]): string;
export declare function formatFeatureRequests(features: FeatureRequest[]): string;
export declare function formatImprovements(improvements: Improvement[]): string;
export declare function formatSearchResults(results: any[]): string;
export declare function formatStatistics(stats: any): string;
export {};
//# sourceMappingURL=format.d.ts.map