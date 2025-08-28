import { z } from 'zod';

// Common enums
export const ItemType = z.enum(['bug', 'improvement']);
export const Priority = z.enum(['Low', 'Medium', 'High', 'Critical']);
export const EffortEstimate = z.enum(['Small', 'Medium', 'Large', 'XL']);

// Base schema for all items
const BaseItemSchema = z.object({
  type: ItemType,
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  priority: Priority,
  category: z.string().optional(),
  requestedBy: z.string().optional(),
  filesLikelyInvolved: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  effortEstimate: EffortEstimate.optional(),
});

// Bug-specific schema
const BugSchema = BaseItemSchema.extend({
  type: z.literal('bug'),
  component: z.string().min(1, 'Component is required for bugs'),
  expectedBehavior: z.string().min(1, 'Expected behavior is required for bugs'),
  actualBehavior: z.string().min(1, 'Actual behavior is required for bugs'),
  potentialRootCause: z.string().optional(),
  stepsToReproduce: z.array(z.string()).optional(),
});

// Feature requests removed

// Improvement-specific schema
const ImprovementSchema = BaseItemSchema.extend({
  type: z.literal('improvement'),
  currentState: z.string().min(1, 'Current state is required for improvements'),
  desiredState: z.string().min(1, 'Desired state is required for improvements'),
});

// Union schema for create_item
export const CreateItemSchema = z.discriminatedUnion('type', [BugSchema, ImprovementSchema]);

// Validation helper function
export function validateCreateItem(args: unknown): z.infer<typeof CreateItemSchema> {
  try {
    return CreateItemSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => 
        `${issue.path.join('.')}: ${issue.message}`
      ).join(', ');
      throw new Error(`Validation failed: ${issues}`);
    }
    throw error;
  }
}

// Status enums for updates
export const BugStatus = z.enum(['Open', 'In Progress', 'Fixed', 'Closed', 'Temporarily Resolved']);
// FeatureStatus removed
export const ImprovementStatus = z.enum([
  'Proposed', 'In Discussion', 'Approved', 'In Development', 
  'Completed (Awaiting Human Verification)', 'Completed', 'Rejected'
]);

export const UpdateItemStatusSchema = z.object({
  itemId: z.string().min(1, 'Item ID is required'),
  status: z.union([BugStatus, ImprovementStatus]),
  humanVerified: z.boolean().optional(),
  dateCompleted: z.string().optional(),
});

export function validateUpdateItemStatus(args: unknown): z.infer<typeof UpdateItemStatusSchema> {
  try {
    return UpdateItemStatusSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => 
        `${issue.path.join('.')}: ${issue.message}`
      ).join(', ');
      throw new Error(`Validation failed: ${issues}`);
    }
    throw error;
  }
}
