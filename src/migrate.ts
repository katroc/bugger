#!/usr/bin/env node

/**
 * Migration script to parse existing markdown files and convert to JSON format
 * for the Project Management MCP Server
 */

import fs from 'fs/promises';
import path from 'path';

interface Bug {
  id: string;
  status: string;
  priority: string;
  dateReported: string;
  component: string;
  title: string;
  description: string;
  expectedBehavior: string;
  actualBehavior: string;
  potentialRootCause?: string;
  filesLikelyInvolved?: string[];
  stepsToReproduce?: string[];
  humanVerified?: boolean;
}

interface FeatureRequest {
  id: string;
  status: string;
  priority: string;
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
  effortEstimate?: string;
}

interface Improvement {
  id: string;
  status: string;
  priority: string;
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
  effortEstimate?: string;
  benefits?: string[];
}

class MarkdownMigrator {
  private baseDir: string;

  constructor(baseDir: string = './') {
    this.baseDir = baseDir;
  }

  async migrate() {
    console.log('Starting migration from markdown files...');
    
    try {
      // Parse each markdown file
      console.log('\n📄 Parsing bugs.md...');
      const bugs = await this.parseBugsMarkdown();
      
      console.log('\n📄 Parsing feature-requests.md...');
      const features = await this.parseFeaturesMarkdown();
      
      console.log('\n📄 Parsing improvements.md...');
      const improvements = await this.parseImprovementsMarkdown();

      console.log('\n💾 Saving to JSON files...');

      // Ensure data directory exists
      const dataDir = path.join(this.baseDir, 'data');
      await fs.mkdir(dataDir, { recursive: true });

      // Save to JSON files
      await fs.writeFile(path.join(dataDir, 'bugs.json'), JSON.stringify(bugs, null, 2));
      console.log(`✅ Saved ${bugs.length} bugs to bugs.json`);
      
      await fs.writeFile(path.join(dataDir, 'features.json'), JSON.stringify(features, null, 2));
      console.log(`✅ Saved ${features.length} features to features.json`);
      
      await fs.writeFile(path.join(dataDir, 'improvements.json'), JSON.stringify(improvements, null, 2));
      console.log(`✅ Saved ${improvements.length} improvements to improvements.json`);

      console.log(`\n🎉 Migration completed successfully!`);
      console.log(`- Migrated ${bugs.length} bugs`);
      console.log(`- Migrated ${features.length} feature requests`);
      console.log(`- Migrated ${improvements.length} improvements`);

    } catch (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  }

  private async parseBugsMarkdown(): Promise<Bug[]> {
    const filePath = path.join(this.baseDir, 'bugs.md');
    
    console.log(`🔍 Looking for bugs.md at: ${filePath}`);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      console.log(`✅ Successfully read bugs.md (${content.length} characters)`);
      return this.extractBugsFromMarkdown(content);
    } catch (error) {
      console.warn('Could not read bugs.md, creating empty bugs array');
      console.warn('Error:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private async parseFeaturesMarkdown(): Promise<FeatureRequest[]> {
    const filePath = path.join(this.baseDir, 'feature-requests.md');
    
    console.log(`🔍 Looking for feature-requests.md at: ${filePath}`);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      console.log(`✅ Successfully read feature-requests.md (${content.length} characters)`);
      return this.extractFeaturesFromMarkdown(content);
    } catch (error) {
      console.warn('Could not read feature-requests.md, creating empty features array');
      console.warn('Error:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private async parseImprovementsMarkdown(): Promise<Improvement[]> {
    const filePath = path.join(this.baseDir, 'improvements.md');
    
    console.log(`🔍 Looking for improvements.md at: ${filePath}`);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      console.log(`✅ Successfully read improvements.md (${content.length} characters)`);
      return this.extractImprovementsFromMarkdown(content);
    } catch (error) {
      console.warn('Could not read improvements.md, creating empty improvements array');
      console.warn('Error:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private extractBugsFromMarkdown(content: string): Bug[] {
    const bugs: Bug[] = [];
    
    console.log('🔍 Starting bug extraction...');
    
    // Find all bug sections (### Bug #XXX:)
    const bugMatches = content.match(/### Bug #\d{3}:.*?(?=###|$)/gs);
    
    console.log(`📋 Found ${bugMatches?.length || 0} bug sections`);
    
    if (!bugMatches) return bugs;

    for (const bugSection of bugMatches) {
      try {
        console.log('\n🔧 Parsing bug section...');
        const bug = this.parseBugSection(bugSection);
        if (bug) {
          bugs.push(bug);
          console.log(`✅ Successfully added: ${bug.id}`);
        } else {
          console.log('❌ Failed to parse bug section');
        }
      } catch (error) {
        console.warn('Failed to parse bug section:', error);
      }
    }

    console.log(`🎯 Total bugs extracted: ${bugs.length}`);
    return bugs;
  }

  private extractFeaturesFromMarkdown(content: string): FeatureRequest[] {
    const features: FeatureRequest[] = [];
    
    console.log('🔍 Starting feature extraction...');
    
    // Find all feature sections (### FR-XXX:)
    const featureMatches = content.match(/### FR-\d{3}:.*?(?=###|$)/gs);
    
    console.log(`📋 Found ${featureMatches?.length || 0} feature sections`);
    
    if (!featureMatches) return features;

    for (const featureSection of featureMatches) {
      try {
        console.log('\n🔧 Parsing feature section...');
        const feature = this.parseFeatureSection(featureSection);
        if (feature) {
          features.push(feature);
          console.log(`✅ Successfully added: ${feature.id}`);
        } else {
          console.log('❌ Failed to parse feature section');
        }
      } catch (error) {
        console.warn('Failed to parse feature section:', error);
      }
    }

    console.log(`🎯 Total features extracted: ${features.length}`);
    return features;
  }

  private extractImprovementsFromMarkdown(content: string): Improvement[] {
    const improvements: Improvement[] = [];
    
    console.log('🔍 Starting improvement extraction...');
    
    // Find all improvement sections (### IMP-XXX:)
    const improvementMatches = content.match(/### IMP-\d{3}:.*?(?=###|$)/gs);
    
    console.log(`📋 Found ${improvementMatches?.length || 0} improvement sections`);
    
    if (!improvementMatches) return improvements;

    for (const improvementSection of improvementMatches) {
      try {
        console.log('\n🔧 Parsing improvement section...');
        const improvement = this.parseImprovementSection(improvementSection);
        if (improvement) {
          improvements.push(improvement);
          console.log(`✅ Successfully added: ${improvement.id}`);
        } else {
          console.log('❌ Failed to parse improvement section');
        }
      } catch (error) {
        console.warn('Failed to parse improvement section:', error);
      }
    }

    console.log(`🎯 Total improvements extracted: ${improvements.length}`);
    return improvements;
  }

  private parseBugSection(section: string): Bug | null {
    const lines = section.split('\n');
    
    // Extract bug ID and title from header
    const header = lines[0];
    const idMatch = header.match(/### (Bug #\d{3}):/);
    const titleMatch = header.match(/### Bug #\d{3}: (.+)/);
    
    if (!idMatch || !titleMatch) {
      console.warn('Could not parse bug header:', header);
      return null;
    }

    const bug: Partial<Bug> = {
      id: idMatch[1],
      title: titleMatch[1].trim()
    };

    // Parse metadata fields
    for (const line of lines) {
      if (line.startsWith('**Status:**')) {
        bug.status = this.extractFieldValue(line);
      } else if (line.startsWith('**Priority:**')) {
        bug.priority = this.extractFieldValue(line);
      } else if (line.startsWith('**Date Reported:**')) {
        bug.dateReported = this.extractFieldValue(line);
      } else if (line.startsWith('**Component:**')) {
        bug.component = this.extractFieldValue(line);
      }
    }

    // Extract description (first paragraph after metadata)
    const descriptionMatch = section.match(/\*\*Description:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (descriptionMatch) {
      bug.description = descriptionMatch[1].trim();
    }

    // Extract expected behavior
    const expectedMatch = section.match(/\*\*Expected Behavior:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (expectedMatch) {
      bug.expectedBehavior = expectedMatch[1].trim();
    }

    // Extract actual behavior
    const actualMatch = section.match(/\*\*Actual Behavior:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (actualMatch) {
      bug.actualBehavior = actualMatch[1].trim();
    }

    // Extract potential root cause
    const rootCauseMatch = section.match(/\*\*Potential Root Cause:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (rootCauseMatch) {
      bug.potentialRootCause = rootCauseMatch[1].trim();
    }

    // Set defaults for required fields
    bug.status = bug.status || 'Open';
    bug.priority = bug.priority || 'Medium';
    bug.dateReported = bug.dateReported || new Date().toISOString().split('T')[0];
    bug.component = bug.component || 'Unknown';
    bug.description = bug.description || '';
    bug.expectedBehavior = bug.expectedBehavior || '';
    bug.actualBehavior = bug.actualBehavior || '';
    bug.humanVerified = false;

    // Debug output
    console.log(`✅ Parsed bug: ${bug.id} - ${bug.title}`);
    console.log(`   Status: "${bug.status}", Priority: "${bug.priority}"`);

    return bug as Bug;
  }

  private parseFeatureSection(section: string): FeatureRequest | null {
    const lines = section.split('\n');
    
    // Extract feature ID and title from header
    const header = lines[0];
    const idMatch = header.match(/### (FR-\d{3}):/);
    const titleMatch = header.match(/### FR-\d{3}: (.+)/);
    
    if (!idMatch || !titleMatch) {
      console.warn('Could not parse feature header:', header);
      return null;
    }

    const feature: Partial<FeatureRequest> = {
      id: idMatch[1],
      title: titleMatch[1].trim()
    };

    // Parse metadata fields
    for (const line of lines) {
      if (line.startsWith('**Status:**')) {
        feature.status = this.extractFieldValue(line);
      } else if (line.startsWith('**Priority:**')) {
        feature.priority = this.extractFieldValue(line);
      } else if (line.startsWith('**Date Requested:**')) {
        feature.dateRequested = this.extractFieldValue(line);
      } else if (line.startsWith('**Category:**')) {
        feature.category = this.extractFieldValue(line);
      } else if (line.startsWith('**Requested By:**')) {
        feature.requestedBy = this.extractFieldValue(line);
      }
    }

    // Extract description
    const descriptionMatch = section.match(/\*\*Description:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (descriptionMatch) {
      feature.description = descriptionMatch[1].trim();
    }

    // Extract user story
    const userStoryMatch = section.match(/\*\*User Story:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (userStoryMatch) {
      feature.userStory = userStoryMatch[1].trim();
    }

    // Extract current behavior
    const currentMatch = section.match(/\*\*Current Behavior:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (currentMatch) {
      feature.currentBehavior = currentMatch[1].trim();
    }

    // Extract expected behavior
    const expectedMatch = section.match(/\*\*Expected Behavior:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (expectedMatch) {
      feature.expectedBehavior = expectedMatch[1].trim();
    }

    // Extract acceptance criteria (checkbox list)
    const criteriaMatch = section.match(/\*\*Acceptance Criteria:\*\*\s*\n((?:- \[[ x]\].*\n?)*)/s);
    if (criteriaMatch) {
      feature.acceptanceCriteria = criteriaMatch[1]
        .split('\n')
        .filter(line => line.trim().startsWith('- ['))
        .map(line => line.replace(/^- \[[ x]\] /, '').trim())
        .filter(Boolean);
    }

    // Set defaults for required fields
    feature.status = feature.status || 'Proposed';
    feature.priority = feature.priority || 'Medium';
    feature.dateRequested = feature.dateRequested || new Date().toISOString().split('T')[0];
    feature.category = feature.category || 'General';
    feature.description = feature.description || '';
    feature.userStory = feature.userStory || '';
    feature.currentBehavior = feature.currentBehavior || '';
    feature.expectedBehavior = feature.expectedBehavior || '';
    feature.acceptanceCriteria = feature.acceptanceCriteria || [];

    // Debug output
    console.log(`✅ Parsed feature: ${feature.id} - ${feature.title}`);
    console.log(`   Status: "${feature.status}", Priority: "${feature.priority}"`);

    return feature as FeatureRequest;
  }

  private parseImprovementSection(section: string): Improvement | null {
    const lines = section.split('\n');
    
    // Extract improvement ID and title from header
    const header = lines[0];
    const idMatch = header.match(/### (IMP-\d{3}):/);
    const titleMatch = header.match(/### IMP-\d{3}: (.+)/);
    
    if (!idMatch || !titleMatch) {
      console.warn('Could not parse improvement header:', header);
      return null;
    }

    const improvement: Partial<Improvement> = {
      id: idMatch[1],
      title: titleMatch[1].trim()
    };

    // Parse metadata fields
    for (const line of lines) {
      if (line.startsWith('**Status:**')) {
        improvement.status = this.extractFieldValue(line);
      } else if (line.startsWith('**Priority:**')) {
        improvement.priority = this.extractFieldValue(line);
      } else if (line.startsWith('**Date Requested:**')) {
        improvement.dateRequested = this.extractFieldValue(line);
      } else if (line.startsWith('**Date Completed:**')) {
        improvement.dateCompleted = this.extractFieldValue(line);
      } else if (line.startsWith('**Category:**')) {
        improvement.category = this.extractFieldValue(line);
      } else if (line.startsWith('**Requested By:**')) {
        improvement.requestedBy = this.extractFieldValue(line);
      }
    }

    // Extract description
    const descriptionMatch = section.match(/\*\*Description:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (descriptionMatch) {
      improvement.description = descriptionMatch[1].trim();
    }

    // Extract current state
    const currentMatch = section.match(/\*\*Current State:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (currentMatch) {
      improvement.currentState = currentMatch[1].trim();
    }

    // Extract desired state
    const desiredMatch = section.match(/\*\*Desired State:\*\*\s*\n(.*?)(?=\n\*\*|$)/s);
    if (desiredMatch) {
      improvement.desiredState = desiredMatch[1].trim();
    }

    // Extract acceptance criteria
    const criteriaMatch = section.match(/\*\*Acceptance Criteria:\*\*\s*\n((?:- \[[ x]\].*\n?)*)/s);
    if (criteriaMatch) {
      improvement.acceptanceCriteria = criteriaMatch[1]
        .split('\n')
        .filter(line => line.trim().startsWith('- ['))
        .map(line => line.replace(/^- \[[ x]\] /, '').trim())
        .filter(Boolean);
    }

    // Set defaults for required fields
    improvement.status = improvement.status || 'Proposed';
    improvement.priority = improvement.priority || 'Medium';
    improvement.dateRequested = improvement.dateRequested || new Date().toISOString().split('T')[0];
    improvement.category = improvement.category || 'General';
    improvement.description = improvement.description || '';
    improvement.currentState = improvement.currentState || '';
    improvement.desiredState = improvement.desiredState || '';
    improvement.acceptanceCriteria = improvement.acceptanceCriteria || [];

    // Debug output
    console.log(`✅ Parsed improvement: ${improvement.id} - ${improvement.title}`);
    console.log(`   Status: "${improvement.status}", Priority: "${improvement.priority}"`);

    return improvement as Improvement;
  }

  private extractFieldValue(line: string): string {
    const match = line.match(/\*\*.*?\*\*\s*(.+)/);
    return match ? match[1].trim() : '';
  }
}

// Run migration if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const baseDir = process.argv[2] || './';
  const migrator = new MarkdownMigrator(baseDir);
  migrator.migrate();
}