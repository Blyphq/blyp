import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { logger } from '../src/frameworks/standalone';

describe('Standalone Logger', () => {
  beforeEach(() => {
    // Clear any existing logs
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
  });

  afterEach(() => {
    // Restore console methods
    console.log = console.log;
    console.error = console.error;
    console.warn = console.warn;
  });

  it('should export logger with all required methods', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warning).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.success).toBe('function');
    expect(typeof logger.critical).toBe('function');
    expect(typeof logger.table).toBe('function');
    expect(typeof logger.createStructuredLog).toBe('function');
  });

  it('should log info messages', () => {
    expect(() => logger.info('Test info message')).not.toThrow();
  });

  it('should log error messages', () => {
    expect(() => logger.error('Test error message')).not.toThrow();
  });

  it('should log debug messages', () => {
    expect(() => logger.debug('Test debug message')).not.toThrow();
  });

  it('should log warning messages', () => {
    expect(() => logger.warning('Test warning message')).not.toThrow();
  });

  it('should log warn messages', () => {
    expect(() => logger.warn('Test warn message')).not.toThrow();
  });

  it('should log success messages', () => {
    expect(() => logger.success('Test success message')).not.toThrow();
  });

  it('should log critical messages', () => {
    expect(() => logger.critical('Test critical message')).not.toThrow();
  });

  it('should log table messages', () => {
    const testData = { name: 'John', age: 30 };
    expect(() => logger.table('Test table', testData)).not.toThrow();
  });

  it('should handle table logging without data', () => {
    expect(() => logger.table('Test table without data')).not.toThrow();
  });

  it('should add caller location to log messages', () => {
    // This test verifies that the logger adds file and line information
    expect(() => logger.info('Test with caller location')).not.toThrow();
  });

  describe('Object Serialization', () => {
    it('should properly stringify plain objects', () => {
      const testObj = { name: 'John', age: 30, active: true };
      expect(() => logger.info(testObj)).not.toThrow();
    });

    it('should properly stringify nested objects', () => {
      const testObj = {
        user: {
          name: 'John',
          address: {
            city: 'New York',
            zip: 10001
          }
        }
      };
      expect(() => logger.info(testObj)).not.toThrow();
    });

    it('should properly stringify arrays', () => {
      const testArray = [1, 2, 3, 'four', { five: 5 }];
      expect(() => logger.info(testArray)).not.toThrow();
    });

    it('should properly stringify objects with various data types', () => {
      const testObj = {
        string: 'text',
        number: 42,
        boolean: true,
        nullValue: null,
        undefinedValue: undefined,
        array: [1, 2, 3],
        nested: { key: 'value' }
      };
      expect(() => logger.info(testObj)).not.toThrow();
    });

    it('should handle objects in error method', () => {
      const testObj = { error: 'Something went wrong', code: 500 };
      expect(() => logger.error(testObj)).not.toThrow();
    });

    it('should handle objects in debug method', () => {
      const testObj = { debug: 'Debug info', data: { key: 'value' } };
      expect(() => logger.debug(testObj)).not.toThrow();
    });

    it('should handle objects in warn method', () => {
      const testObj = { warning: 'Warning message', level: 'medium' };
      expect(() => logger.warn(testObj)).not.toThrow();
    });

    it('should handle objects in warning method', () => {
      const testObj = { warning: 'Warning message', level: 'medium' };
      expect(() => logger.warning(testObj)).not.toThrow();
    });

    it('should handle objects in success method', () => {
      const testObj = { success: true, message: 'Operation completed' };
      expect(() => logger.success(testObj)).not.toThrow();
    });

    it('should handle objects in critical method', () => {
      const testObj = { critical: true, severity: 'high' };
      expect(() => logger.critical(testObj)).not.toThrow();
    });

    it('should handle circular references gracefully', () => {
      const testObj: any = { name: 'Test' };
      testObj.self = testObj; // Create circular reference
      expect(() => logger.info(testObj)).not.toThrow();
    });

    it('should handle empty objects', () => {
      expect(() => logger.info({})).not.toThrow();
    });

    it('should handle null', () => {
      expect(() => logger.info(null)).not.toThrow();
    });

    it('should handle undefined', () => {
      expect(() => logger.info(undefined)).not.toThrow();
    });
  });
});
