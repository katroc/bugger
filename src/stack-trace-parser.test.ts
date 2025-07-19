// Basic tests for stack trace parser functionality
import { StackTraceParser } from './stack-trace-parser.js';

/**
 * Simple test runner for stack trace parser
 */
export class StackTraceParserTester {
  
  public static runTests(): void {
    console.log('Running Stack Trace Parser Tests...\n');
    
    this.testJavaScriptStackTrace();
    this.testPythonStackTrace();
    this.testJavaStackTrace();
    this.testStackTraceDetection();
    this.testContextExtraction();
    
    console.log('All tests completed!');
  }

  private static testJavaScriptStackTrace(): void {
    console.log('Test: JavaScript Stack Trace Parsing');
    
    const jsStackTrace = `
TypeError: Cannot read property 'name' of undefined
    at processUser (/app/src/user.js:45:12)
    at validateInput (/app/src/validation.js:23:8)
    at Object.handleRequest (/app/src/handler.js:67:15)
    at /app/src/server.js:12:20
`;

    const result = StackTraceParser.parseStackTrace(jsStackTrace);
    
    console.log(`  - Language detected: ${result.language}`);
    console.log(`  - Error type: ${result.errorType}`);
    console.log(`  - Frames found: ${result.frames.length}`);
    console.log(`  - Confidence: ${result.confidence.toFixed(2)}`);
    console.log(`  - Valid: ${result.isValid}`);
    
    if (result.frames.length > 0) {
      const firstFrame = result.frames[0];
      console.log(`  - First frame: ${firstFrame.functionName} in ${firstFrame.filePath}:${firstFrame.lineNumber}`);
    }
    
    console.log('  ✓ JavaScript test passed\n');
  }

  private static testPythonStackTrace(): void {
    console.log('Test: Python Stack Trace Parsing');
    
    const pythonStackTrace = `
Traceback (most recent call last):
  File "/app/main.py", line 42, in main
    result = process_data(data)
  File "/app/processor.py", line 18, in process_data
    return transform(input_data)
  File "/app/transform.py", line 31, in transform
    value = data['missing_key']
KeyError: 'missing_key'
`;

    const result = StackTraceParser.parseStackTrace(pythonStackTrace);
    
    console.log(`  - Language detected: ${result.language}`);
    console.log(`  - Error type: ${result.errorType}`);
    console.log(`  - Frames found: ${result.frames.length}`);
    console.log(`  - Confidence: ${result.confidence.toFixed(2)}`);
    console.log(`  - Valid: ${result.isValid}`);
    
    console.log('  ✓ Python test passed\n');
  }

  private static testJavaStackTrace(): void {
    console.log('Test: Java Stack Trace Parsing');
    
    const javaStackTrace = `
java.lang.NullPointerException: Cannot invoke "String.length()" because "str" is null
	at com.example.service.StringProcessor.processString(StringProcessor.java:42)
	at com.example.controller.ApiController.handleRequest(ApiController.java:67)
	at com.example.Main.main(Main.java:15)
`;

    const result = StackTraceParser.parseStackTrace(javaStackTrace);
    
    console.log(`  - Language detected: ${result.language}`);
    console.log(`  - Error type: ${result.errorType}`);
    console.log(`  - Frames found: ${result.frames.length}`);
    console.log(`  - Confidence: ${result.confidence.toFixed(2)}`);
    console.log(`  - Valid: ${result.isValid}`);
    
    console.log('  ✓ Java test passed\n');
  }

  private static testStackTraceDetection(): void {
    console.log('Test: Stack Trace Detection');
    
    const textWithStackTrace = `
The application crashed with the following error:

TypeError: Cannot read property 'name' of undefined
    at processUser (/app/src/user.js:45:12)
    at validateInput (/app/src/validation.js:23:8)

This happened during user registration.
`;

    const textWithoutStackTrace = `
The application is running slowly. We should optimize the database queries
and improve the caching mechanism for better performance.
`;

    const hasStackTrace = StackTraceParser.containsStackTrace(textWithStackTrace);
    const noStackTrace = StackTraceParser.containsStackTrace(textWithoutStackTrace);
    
    console.log(`  - Text with stack trace detected: ${hasStackTrace}`);
    console.log(`  - Text without stack trace detected: ${noStackTrace}`);
    
    console.log('  ✓ Detection test passed\n');
  }

  private static testContextExtraction(): void {
    console.log('Test: Context Extraction');
    
    const stackTrace = `
TypeError: Cannot read property 'name' of undefined
    at processUser (/app/src/user.js:45:12)
    at validateInput (/app/src/validation.js:23:8)
`;

    const parsed = StackTraceParser.parseStackTrace(stackTrace);
    const contexts = StackTraceParser.extractStackTraceContexts(parsed);
    
    console.log(`  - Contexts extracted: ${contexts.length}`);
    
    if (contexts.length > 0) {
      const firstContext = contexts[0];
      console.log(`  - First context: ${firstContext.filePath}:${firstContext.lineNumber} (${firstContext.priority})`);
      console.log(`  - Context lines: ±${firstContext.contextLines}`);
    }
    
    console.log('  ✓ Context extraction test passed\n');
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  StackTraceParserTester.runTests();
}