#!/usr/bin/env node
import { validateCreateItem } from './validation.js';

console.log('🧪 Testing validation...\n');

// Test 1: Valid improvement (should pass)
console.log('Test 1: Valid improvement');
try {
  const valid = validateCreateItem({
    type: 'improvement',
    title: 'Test improvement',
    description: 'Test description',
    priority: 'Medium',
    currentState: 'Current state',
    desiredState: 'Desired state'
  });
  console.log('✅ Valid input passed validation');
} catch (error) {
  console.log('❌ Valid input failed:', error instanceof Error ? error.message : String(error));
}

// Test 2: Invalid type (should fail)
console.log('\nTest 2: Invalid type (uppercase)');
try {
  const invalid = validateCreateItem({
    type: 'Improvement', // Wrong case
    title: 'Test improvement',
    description: 'Test description',
    priority: 'Medium',
    currentState: 'Current state',
    desiredState: 'Desired state'
  });
  console.log('❌ Invalid input passed validation - this should not happen');
} catch (error) {
  console.log('✅ Invalid input correctly rejected:', error instanceof Error ? error.message : String(error));
}

// Test 3: Invalid effort estimate (should fail)
console.log('\nTest 3: Invalid effort estimate');
try {
  const invalid = validateCreateItem({
    type: 'improvement',
    title: 'Test improvement',
    description: 'Test description',
    priority: 'Medium',
    currentState: 'Current state',
    desiredState: 'Desired state',
    effortEstimate: 'M' // Should be 'Medium'
  });
  console.log('❌ Invalid effort estimate passed validation - this should not happen');
} catch (error) {
  console.log('✅ Invalid effort estimate correctly rejected:', error instanceof Error ? error.message : String(error));
}

// Test 4: Missing required field for improvement (should fail)
console.log('\nTest 4: Missing required field for improvement');
try {
  const invalid = validateCreateItem({
    type: 'improvement',
    title: 'Test improvement',
    description: 'Test description',
    priority: 'Medium',
    // Missing currentState and desiredState
  });
  console.log('❌ Missing required fields passed validation - this should not happen');
} catch (error) {
  console.log('✅ Missing required fields correctly rejected:', error instanceof Error ? error.message : String(error));
}

console.log('\n🎉 Validation tests completed!');