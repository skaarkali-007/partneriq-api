import mongoose from 'mongoose';
import { DataRetentionJobs } from '../dataRetentionJobs';
import { DataRetentionService } from '../../services/dataRetention';
import { ClickEvent } from '../../models/ClickEvent';
import { ConversionEvent } from '../../models/ConversionEvent';
import { AuditLog } from '../../models/AuditLog';
import { User } from '../../models/User';

// Mock logger to avoid console output during tests
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock DataRetentionService methods
jest.mock('../../services/dataRetention');

describe('DataRetentionJobs', () => {
  beforeAll(async () => {
    // Connect to test database
    const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/affiliate_platform_test';
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    // Clean up and close connection
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Clear all collections before each test
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
    
    // Reset mocks
    jest.clearAllMocks();
  });

  describe('executeRetentionPolicies', () => {
    it('should execute retention policies and log results', async () => {
      const mockReports = [
        {
          policyName: 'user_tracking_data',
          executedAt: new Date(),
          recordsProcessed: 100,
          recordsAnonymized: 50,
          recordsDeleted: 25,
          errors: [],
          duration: 1000
        },
        {
          policyName: 'user_profile_data',
          executedAt: new Date(),
          recordsProcessed: 20,
          recordsAnonymized: 10,
          recordsDeleted: 0,
          errors: ['Minor error'],
          duration: 500
        }
      ];

      (DataRetentionService.executeRetentionPolicies as jest.Mock).mockResolvedValue(mockReports);

      await DataRetentionJobs.executeRetentionPolicies();

      expect(DataRetentionService.executeRetentionPolicies).toHaveBeenCalledTimes(1);
      
      // Verify logger was called with summary information
      const { logger } = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith(
        'Starting scheduled data retention policy execution'
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Data retention policy execution completed',
        expect.objectContaining({
          summary: expect.objectContaining({
            totalPolicies: 2,
            totalRecordsProcessed: 120,
            totalRecordsAnonymized: 60,
            totalRecordsDeleted: 25,
            totalErrors: 1
          })
        })
      );
    });

    it('should handle and log errors during execution', async () => {
      const error = new Error('Database connection failed');
      (DataRetentionService.executeRetentionPolicies as jest.Mock).mockRejectedValue(error);

      await expect(DataRetentionJobs.executeRetentionPolicies()).rejects.toThrow('Database connection failed');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Data retention policy execution failed',
        expect.objectContaining({
          error: 'Database connection failed'
        })
      );
    });

    it('should log warnings when policies have errors', async () => {
      const mockReports = [
        {
          policyName: 'test_policy',
          executedAt: new Date(),
          recordsProcessed: 10,
          recordsAnonymized: 5,
          recordsDeleted: 0,
          errors: ['Error 1', 'Error 2'],
          duration: 100
        }
      ];

      (DataRetentionService.executeRetentionPolicies as jest.Mock).mockResolvedValue(mockReports);

      await DataRetentionJobs.executeRetentionPolicies();

      const { logger } = require('../../utils/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        'Errors occurred during data retention execution',
        expect.objectContaining({
          errorCount: 2,
          errors: ['Error 1', 'Error 2']
        })
      );
    });
  });

  describe('generateRetentionStatusReport', () => {
    it('should generate and return status report', async () => {
      const mockStatus = {
        policies: [
          { name: 'policy1', isActive: true },
          { name: 'policy2', isActive: false },
          { name: 'policy3', isActive: true }
        ],
        lastExecution: new Date('2024-01-01'),
        recordsEligibleForProcessing: {
          policy1: 100,
          policy2: 0,
          policy3: 50
        }
      };

      (DataRetentionService.getRetentionStatus as jest.Mock).mockResolvedValue(mockStatus);

      const result = await DataRetentionJobs.generateRetentionStatusReport();

      expect(result).toBeDefined();
      expect(result.status).toEqual(mockStatus);
      expect(result.summary).toEqual({
        activePolicies: 2,
        totalRecordsEligible: 150,
        lastExecution: new Date('2024-01-01')
      });

      expect(DataRetentionService.getRetentionStatus).toHaveBeenCalledTimes(1);
    });

    it('should handle errors during status report generation', async () => {
      const error = new Error('Status retrieval failed');
      (DataRetentionService.getRetentionStatus as jest.Mock).mockRejectedValue(error);

      await expect(DataRetentionJobs.generateRetentionStatusReport()).rejects.toThrow('Status retrieval failed');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to generate data retention status report',
        expect.objectContaining({
          error: 'Status retrieval failed'
        })
      );
    });
  });

  describe('emergencyCleanup', () => {
    it('should perform emergency cleanup with dry run', async () => {
      const mockResult = {
        success: true,
        recordsProcessed: 500,
        errors: []
      };

      (DataRetentionService.manualAnonymization as jest.Mock).mockResolvedValue(mockResult);

      await DataRetentionJobs.emergencyCleanup('click_events', 30, true);

      expect(DataRetentionService.manualAnonymization).toHaveBeenCalledWith('click_events', 30, true);

      const { logger } = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith(
        'Starting emergency cleanup for click_events',
        expect.objectContaining({
          dataType: 'click_events',
          olderThanDays: 30,
          dryRun: true
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Emergency cleanup simulation completed',
        expect.objectContaining({
          dataType: 'click_events',
          recordsProcessed: 500,
          dryRun: true
        })
      );
    });

    it('should perform actual emergency cleanup', async () => {
      const mockResult = {
        success: true,
        recordsProcessed: 200,
        errors: []
      };

      (DataRetentionService.manualAnonymization as jest.Mock).mockResolvedValue(mockResult);

      await DataRetentionJobs.emergencyCleanup('conversion_events', 60, false);

      expect(DataRetentionService.manualAnonymization).toHaveBeenCalledWith('conversion_events', 60, false);

      const { logger } = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith(
        'Emergency cleanup execution completed',
        expect.objectContaining({
          dataType: 'conversion_events',
          recordsProcessed: 200,
          dryRun: false
        })
      );
    });

    it('should handle emergency cleanup failures', async () => {
      const mockResult = {
        success: false,
        recordsProcessed: 0,
        errors: ['Database error', 'Permission denied']
      };

      (DataRetentionService.manualAnonymization as jest.Mock).mockResolvedValue(mockResult);

      await expect(DataRetentionJobs.emergencyCleanup('audit_logs', 90, false))
        .rejects.toThrow('Emergency cleanup failed: Database error, Permission denied');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Emergency cleanup failed',
        expect.objectContaining({
          dataType: 'audit_logs',
          errors: ['Database error', 'Permission denied']
        })
      );
    });
  });

  describe('validateRetentionPolicies', () => {
    it('should validate all policies successfully', async () => {
      const mockStatus = {
        policies: [
          { name: 'policy1', description: 'Test 1', retentionPeriodDays: 90, dataTypes: ['clicks'], isActive: true },
          { name: 'policy2', description: 'Test 2', retentionPeriodDays: 180, dataTypes: ['users'], isActive: true }
        ]
      };

      (DataRetentionService.getRetentionStatus as jest.Mock).mockResolvedValue(mockStatus);
      (DataRetentionService.validateRetentionPolicy as jest.Mock)
        .mockReturnValueOnce({ isValid: true, errors: [] })
        .mockReturnValueOnce({ isValid: true, errors: [] });

      const result = await DataRetentionJobs.validateRetentionPolicies();

      expect(result.isValid).toBe(true);
      expect(result.policyValidation).toHaveLength(2);
      expect(result.policyValidation[0]).toEqual({
        policyName: 'policy1',
        isValid: true,
        errors: []
      });
    });

    it('should detect invalid policies', async () => {
      const mockStatus = {
        policies: [
          { name: '', description: '', retentionPeriodDays: -1, dataTypes: [], isActive: true }
        ]
      };

      (DataRetentionService.getRetentionStatus as jest.Mock).mockResolvedValue(mockStatus);
      (DataRetentionService.validateRetentionPolicy as jest.Mock)
        .mockReturnValue({ 
          isValid: false, 
          errors: ['Policy name is required', 'Invalid retention period'] 
        });

      const result = await DataRetentionJobs.validateRetentionPolicies();

      expect(result.isValid).toBe(false);
      expect(result.policyValidation[0].isValid).toBe(false);
      expect(result.policyValidation[0].errors).toContain('Policy name is required');
    });
  });

  describe('runComplianceCheck', () => {
    it('should run compliance check and return results', async () => {
      const mockComplianceResult = {
        compliant: false,
        issues: [
          {
            severity: 'high' as const,
            category: 'Data Anonymization',
            description: 'Old click events not anonymized',
            affectedRecords: 100,
            recommendation: 'Run anonymization process'
          }
        ],
        summary: {
          totalIssues: 1,
          highSeverityIssues: 1,
          recordsRequiringAttention: 100
        }
      };

      (DataRetentionService.performComplianceCheck as jest.Mock).mockResolvedValue(mockComplianceResult);

      const result = await DataRetentionJobs.runComplianceCheck();

      expect(result).toEqual(mockComplianceResult);
      expect(DataRetentionService.performComplianceCheck).toHaveBeenCalledTimes(1);

      const { logger } = require('../../utils/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        'Compliance issues detected',
        expect.objectContaining({
          totalIssues: 1,
          highSeverityIssues: 1
        })
      );
    });

    it('should log success when compliant', async () => {
      const mockComplianceResult = {
        compliant: true,
        issues: [],
        summary: {
          totalIssues: 0,
          highSeverityIssues: 0,
          recordsRequiringAttention: 0
        }
      };

      (DataRetentionService.performComplianceCheck as jest.Mock).mockResolvedValue(mockComplianceResult);

      const result = await DataRetentionJobs.runComplianceCheck();

      expect(result.compliant).toBe(true);

      const { logger } = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith('Compliance check passed - no issues detected');
    });

    it('should handle compliance check errors', async () => {
      const error = new Error('Compliance check failed');
      (DataRetentionService.performComplianceCheck as jest.Mock).mockRejectedValue(error);

      await expect(DataRetentionJobs.runComplianceCheck()).rejects.toThrow('Compliance check failed');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Compliance check failed',
        expect.objectContaining({
          error: 'Compliance check failed'
        })
      );
    });
  });

  describe('performBulkAnonymization', () => {
    it('should perform bulk anonymization successfully', async () => {
      const mockResult = {
        success: true,
        totalProcessed: 1000,
        totalAnonymized: 800,
        errors: [],
        progress: [
          { batch: 1, processed: 500, anonymized: 400 },
          { batch: 2, processed: 500, anonymized: 400 }
        ]
      };

      (DataRetentionService.bulkAnonymization as jest.Mock).mockResolvedValue(mockResult);

      const result = await DataRetentionJobs.performBulkAnonymization(
        'click_events',
        { timestamp: { $lt: new Date() } },
        100,
        false
      );

      expect(result).toEqual(mockResult);
      expect(DataRetentionService.bulkAnonymization).toHaveBeenCalledWith(
        'click_events',
        { timestamp: { $lt: expect.any(Date) } },
        100
      );

      const { logger } = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith(
        'Bulk anonymization job completed successfully',
        expect.objectContaining({
          dataType: 'click_events',
          totalProcessed: 1000,
          totalAnonymized: 800
        })
      );
    });

    it('should handle bulk anonymization failures', async () => {
      const mockResult = {
        success: false,
        totalProcessed: 100,
        totalAnonymized: 0,
        errors: ['Database connection failed', 'Permission denied'],
        progress: []
      };

      (DataRetentionService.bulkAnonymization as jest.Mock).mockResolvedValue(mockResult);

      const result = await DataRetentionJobs.performBulkAnonymization(
        'conversion_events',
        {},
        50,
        true
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(2);

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Bulk anonymization job failed',
        expect.objectContaining({
          dataType: 'conversion_events',
          errors: ['Database connection failed', 'Permission denied']
        })
      );
    });
  });

  describe('performFieldLevelAnonymization', () => {
    it('should perform field-level anonymization successfully', async () => {
      const mockAnonymizationResult = {
        success: true,
        errors: []
      };

      (DataRetentionService.anonymizeDataFields as jest.Mock).mockResolvedValue(mockAnonymizationResult);

      const result = await DataRetentionJobs.performFieldLevelAnonymization(
        'users',
        ['user1', 'user2', 'user3'],
        ['email', 'firstName'],
        'GDPR request'
      );

      expect(result.success).toBe(true);
      expect(result.processedDocuments).toBe(3);
      expect(result.errors.length).toBe(0);

      expect(DataRetentionService.anonymizeDataFields).toHaveBeenCalledTimes(3);
      expect(DataRetentionService.anonymizeDataFields).toHaveBeenCalledWith(
        'users',
        'user1',
        ['email', 'firstName'],
        'GDPR request'
      );
    });

    it('should handle partial failures in field-level anonymization', async () => {
      (DataRetentionService.anonymizeDataFields as jest.Mock)
        .mockResolvedValueOnce({ success: true, errors: [] })
        .mockResolvedValueOnce({ success: false, errors: ['Document not found'] })
        .mockResolvedValueOnce({ success: true, errors: [] });

      const result = await DataRetentionJobs.performFieldLevelAnonymization(
        'clickevents',
        ['event1', 'event2', 'event3'],
        ['ipAddress'],
        'Privacy cleanup'
      );

      expect(result.success).toBe(false);
      expect(result.processedDocuments).toBe(2);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toBe('Document not found');
    });

    it('should handle exceptions during field-level anonymization', async () => {
      (DataRetentionService.anonymizeDataFields as jest.Mock)
        .mockResolvedValueOnce({ success: true, errors: [] })
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({ success: true, errors: [] });

      const result = await DataRetentionJobs.performFieldLevelAnonymization(
        'auditlogs',
        ['log1', 'log2', 'log3'],
        ['ipAddress', 'userAgent'],
        'Audit cleanup'
      );

      expect(result.success).toBe(false);
      expect(result.processedDocuments).toBe(2);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('Failed to anonymize auditlogs:log2');
    });
  });

  describe('enforceRetentionPolicies', () => {
    it('should enforce retention policies successfully', async () => {
      const mockValidation = {
        isValid: true,
        policyValidation: [
          { policyName: 'policy1', isValid: true, errors: [] },
          { policyName: 'policy2', isValid: true, errors: [] }
        ]
      };

      const mockReports = [
        {
          policyName: 'policy1',
          executedAt: new Date(),
          recordsProcessed: 100,
          recordsAnonymized: 50,
          recordsDeleted: 25,
          errors: [],
          duration: 1000
        },
        {
          policyName: 'policy2',
          executedAt: new Date(),
          recordsProcessed: 200,
          recordsAnonymized: 100,
          recordsDeleted: 50,
          errors: [],
          duration: 1500
        }
      ];

      const validateSpy = jest.spyOn(DataRetentionJobs, 'validateRetentionPolicies').mockResolvedValue(mockValidation);
      (DataRetentionService.executeRetentionPolicies as jest.Mock).mockResolvedValue(mockReports);

      const result = await DataRetentionJobs.enforceRetentionPolicies();

      expect(result.policiesEnforced).toBe(2);
      expect(result.policiesWithIssues).toBe(0);
      expect(result.totalRecordsProcessed).toBe(300);
      expect(result.issues.length).toBe(0);

      const { logger } = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith(
        'Data retention policy enforcement completed',
        expect.objectContaining({
          policiesEnforced: 2,
          totalRecordsProcessed: 300
        })
      );

      validateSpy.mockRestore();
    });

    it('should handle policy validation failures', async () => {
      const mockValidation = {
        isValid: false,
        policyValidation: [
          { policyName: 'policy1', isValid: false, errors: ['Invalid configuration'] },
          { policyName: 'policy2', isValid: true, errors: [] }
        ]
      };

      const validateSpy = jest.spyOn(DataRetentionJobs, 'validateRetentionPolicies').mockResolvedValue(mockValidation);

      const result = await DataRetentionJobs.enforceRetentionPolicies();

      expect(result.policiesEnforced).toBe(0);
      expect(result.policiesWithIssues).toBe(1);
      expect(result.totalRecordsProcessed).toBe(0);
      expect(result.issues).toContain('Invalid configuration');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Policy validation failed - cannot enforce policies',
        expect.objectContaining({
          invalidPolicies: 1
        })
      );

      validateSpy.mockRestore();
    });

    it('should handle policy execution errors', async () => {
      const mockValidation = {
        isValid: true,
        policyValidation: [
          { policyName: 'policy1', isValid: true, errors: [] }
        ]
      };

      const mockReports = [
        {
          policyName: 'policy1',
          executedAt: new Date(),
          recordsProcessed: 50,
          recordsAnonymized: 25,
          recordsDeleted: 0,
          errors: ['Database timeout', 'Permission error'],
          duration: 2000
        }
      ];

      const validateSpy = jest.spyOn(DataRetentionJobs, 'validateRetentionPolicies').mockResolvedValue(mockValidation);
      (DataRetentionService.executeRetentionPolicies as jest.Mock).mockResolvedValue(mockReports);

      const result = await DataRetentionJobs.enforceRetentionPolicies();

      expect(result.policiesEnforced).toBe(0);
      expect(result.policiesWithIssues).toBe(1);
      expect(result.totalRecordsProcessed).toBe(50);
      expect(result.issues).toEqual(['Database timeout', 'Permission error']);

      validateSpy.mockRestore();
    });
  });

  describe('enforceAutomatedRetention', () => {
    it('should enforce automated retention successfully', async () => {
      const mockResult = {
        success: true,
        policiesExecuted: 3,
        totalRecordsProcessed: 500,
        errors: [],
        nextScheduledExecution: new Date(Date.now() + 24 * 60 * 60 * 1000)
      };

      (DataRetentionService.enforceAutomatedRetention as jest.Mock).mockResolvedValue(mockResult);

      const result = await DataRetentionJobs.enforceAutomatedRetention();

      expect(result).toEqual(mockResult);
      expect(DataRetentionService.enforceAutomatedRetention).toHaveBeenCalledTimes(1);

      const { logger } = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith(
        'Enhanced automated data retention enforcement completed successfully',
        expect.objectContaining({
          policiesExecuted: 3,
          totalRecordsProcessed: 500
        })
      );
    });

    it('should handle automated retention failures', async () => {
      const mockResult = {
        success: false,
        policiesExecuted: 2,
        totalRecordsProcessed: 100,
        errors: ['Database timeout', 'Permission error'],
        nextScheduledExecution: new Date()
      };

      (DataRetentionService.enforceAutomatedRetention as jest.Mock).mockResolvedValue(mockResult);

      const result = await DataRetentionJobs.enforceAutomatedRetention();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(2);

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Enhanced automated data retention enforcement completed with errors',
        expect.objectContaining({
          errorCount: 2,
          errors: ['Database timeout', 'Permission error']
        })
      );
    });

    it('should handle exceptions during automated retention', async () => {
      const error = new Error('Service unavailable');
      (DataRetentionService.enforceAutomatedRetention as jest.Mock).mockRejectedValue(error);

      await expect(DataRetentionJobs.enforceAutomatedRetention()).rejects.toThrow('Service unavailable');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Enhanced automated data retention enforcement failed',
        expect.objectContaining({
          error: 'Service unavailable'
        })
      );
    });
  });

  describe('performAdvancedAnonymization', () => {
    it('should perform advanced anonymization successfully', async () => {
      const mockResult = {
        success: true,
        recordsProcessed: 250,
        anonymizationMethod: 'full',
        preservedFields: [],
        errors: []
      };

      (DataRetentionService.advancedAnonymization as jest.Mock).mockResolvedValue(mockResult);

      const result = await DataRetentionJobs.performAdvancedAnonymization(
        'click_events',
        'full',
        { timestamp: { $lt: new Date() } },
        { batchSize: 100, auditTrail: true }
      );

      expect(result).toEqual(mockResult);
      expect(DataRetentionService.advancedAnonymization).toHaveBeenCalledWith(
        'click_events',
        'full',
        { timestamp: { $lt: expect.any(Date) } },
        { batchSize: 100, auditTrail: true }
      );

      const { logger } = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith(
        'Advanced anonymization job completed successfully',
        expect.objectContaining({
          dataType: 'click_events',
          strategy: 'full',
          recordsProcessed: 250
        })
      );
    });

    it('should handle advanced anonymization with preserved fields', async () => {
      const mockResult = {
        success: true,
        recordsProcessed: 150,
        anonymizationMethod: 'partial',
        preservedFields: ['fingerprint', 'sessionId'],
        errors: []
      };

      (DataRetentionService.advancedAnonymization as jest.Mock).mockResolvedValue(mockResult);

      const result = await DataRetentionJobs.performAdvancedAnonymization(
        'click_events',
        'partial',
        {},
        { preserveAnalytics: true }
      );

      expect(result.success).toBe(true);
      expect(result.preservedFields.length).toBe(2);

      const { logger } = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith(
        'Advanced anonymization job completed successfully',
        expect.objectContaining({
          preservedFields: 2
        })
      );
    });

    it('should handle advanced anonymization failures', async () => {
      const mockResult = {
        success: false,
        recordsProcessed: 50,
        anonymizationMethod: 'pseudonymization',
        preservedFields: [],
        errors: ['Invalid criteria', 'Database error']
      };

      (DataRetentionService.advancedAnonymization as jest.Mock).mockResolvedValue(mockResult);

      const result = await DataRetentionJobs.performAdvancedAnonymization(
        'conversion_events',
        'pseudonymization',
        { invalid: 'criteria' }
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(2);

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Advanced anonymization job completed with errors',
        expect.objectContaining({
          errorCount: 2,
          errors: ['Invalid criteria', 'Database error']
        })
      );
    });

    it('should handle exceptions during advanced anonymization', async () => {
      const error = new Error('Anonymization service failed');
      (DataRetentionService.advancedAnonymization as jest.Mock).mockRejectedValue(error);

      await expect(DataRetentionJobs.performAdvancedAnonymization(
        'click_events',
        'full',
        {}
      )).rejects.toThrow('Anonymization service failed');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Advanced anonymization job failed',
        expect.objectContaining({
          error: 'Anonymization service failed',
          dataType: 'click_events',
          strategy: 'full'
        })
      );
    });
  });

  describe('performComprehensiveAudit', () => {
    it('should perform comprehensive audit successfully', async () => {
      const mockRetentionStatus = {
        policies: [
          { name: 'policy1', isActive: true },
          { name: 'policy2', isActive: true },
          { name: 'policy3', isActive: false }
        ],
        recordsEligibleForProcessing: {
          policy1: 500,
          policy2: 200,
          policy3: 0
        }
      };

      const mockComplianceResult = {
        compliant: true,
        issues: [],
        summary: {
          totalIssues: 0,
          highSeverityIssues: 0,
          recordsRequiringAttention: 0
        }
      };

      const mockPolicyValidation = {
        isValid: true,
        policyValidation: [
          { policyName: 'policy1', isValid: true, errors: [] },
          { policyName: 'policy2', isValid: true, errors: [] },
          { policyName: 'policy3', isValid: true, errors: [] }
        ]
      };

      (DataRetentionService.getRetentionStatus as jest.Mock).mockResolvedValue(mockRetentionStatus);
      (DataRetentionService.performComplianceCheck as jest.Mock).mockResolvedValue(mockComplianceResult);
      const validateSpy = jest.spyOn(DataRetentionJobs, 'validateRetentionPolicies').mockResolvedValue(mockPolicyValidation);

      const result = await DataRetentionJobs.performComprehensiveAudit();

      expect(result.auditPassed).toBe(true);
      expect(result.policyCompliance).toBeDefined();
      expect(result.overallCompliance).toEqual(mockComplianceResult);
      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);

      // Check policy compliance structure
      expect(result.policyCompliance.policy1).toBeDefined();
      expect(result.policyCompliance.policy1.compliant).toBe(true);
      expect(result.policyCompliance.policy1.recordsRequiringAttention).toBe(500);

      validateSpy.mockRestore();
    });

    it('should detect audit failures and generate recommendations', async () => {
      const mockRetentionStatus = {
        policies: [
          { name: 'policy1', isActive: true }
        ],
        recordsEligibleForProcessing: {
          policy1: 15000 // High number requiring attention
        }
      };

      const mockComplianceResult = {
        compliant: false,
        issues: [
          {
            severity: 'high' as const,
            category: 'Data Anonymization',
            description: 'Old data not anonymized',
            affectedRecords: 1000,
            recommendation: 'Run anonymization'
          }
        ],
        summary: {
          totalIssues: 1,
          highSeverityIssues: 1,
          recordsRequiringAttention: 1000
        }
      };

      const mockPolicyValidation = {
        isValid: false,
        policyValidation: [
          { policyName: 'policy1', isValid: false, errors: ['Invalid configuration'] }
        ]
      };

      (DataRetentionService.getRetentionStatus as jest.Mock).mockResolvedValue(mockRetentionStatus);
      (DataRetentionService.performComplianceCheck as jest.Mock).mockResolvedValue(mockComplianceResult);
      const validateSpy = jest.spyOn(DataRetentionJobs, 'validateRetentionPolicies').mockResolvedValue(mockPolicyValidation);

      const result = await DataRetentionJobs.performComprehensiveAudit();

      expect(result.auditPassed).toBe(false);
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations).toContain('Fix invalid retention policy configurations');
      expect(result.recommendations).toContain('Address high severity compliance issues immediately');
      expect(result.recommendations.some(r => r.includes('15000 records requiring attention'))).toBe(true);

      validateSpy.mockRestore();
    });

    it('should handle audit errors', async () => {
      const error = new Error('Audit service failed');
      (DataRetentionService.getRetentionStatus as jest.Mock).mockRejectedValue(error);

      await expect(DataRetentionJobs.performComprehensiveAudit()).rejects.toThrow('Audit service failed');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Comprehensive data retention audit failed',
        expect.objectContaining({
          error: 'Audit service failed'
        })
      );
    });
  });

  describe('optimizeRetentionPolicies', () => {
    it('should generate optimization suggestions', async () => {
      const mockDataGrowthMetrics = {
        dataGrowthMetrics: {
          clickEvents: {
            totalRecords: 10000,
            recordsOlderThan30Days: 8000,
            recordsOlderThan90Days: 6000,
            recordsOlderThan365Days: 4000,
            anonymizedRecords: 2000
          },
          users: {
            totalRecords: 1000,
            recordsOlderThan30Days: 800,
            recordsOlderThan90Days: 600,
            recordsOlderThan365Days: 400,
            anonymizedRecords: 100
          }
        },
        recommendations: []
      };

      const mockRetentionStatus = {
        policies: [
          {
            name: 'user_tracking_data',
            anonymizeAfterDays: 90,
            deleteAfterDays: 365,
            isActive: true
          },
          {
            name: 'user_profile_data',
            anonymizeAfterDays: 1095,
            deleteAfterDays: 2555,
            isActive: true
          }
        ],
        recordsEligibleForProcessing: {
          user_tracking_data: 8000, // High number
          user_profile_data: 500
        }
      };

      const monitorSpy = jest.spyOn(DataRetentionJobs, 'monitorDataGrowth').mockResolvedValue(mockDataGrowthMetrics);
      (DataRetentionService.getRetentionStatus as jest.Mock).mockResolvedValue(mockRetentionStatus);

      const result = await DataRetentionJobs.optimizeRetentionPolicies();

      expect(result).toBeDefined();
      expect(result.currentEfficiency).toBeDefined();
      expect(result.optimizationSuggestions).toBeDefined();
      expect(result.estimatedImprovements).toBeDefined();

      // Should have suggestions due to high eligible records
      expect(result.optimizationSuggestions.length).toBeGreaterThan(0);
      
      // Check for tracking data optimization
      const trackingOptimization = result.optimizationSuggestions.find(s => s.policyName === 'user_tracking_data');
      expect(trackingOptimization).toBeDefined();
      expect(trackingOptimization?.suggestedSettings.anonymizeAfterDays).toBe(60);
      expect(trackingOptimization?.suggestedSettings.deleteAfterDays).toBe(180);

      // Check efficiency calculation
      expect(result.currentEfficiency).toBeCloseTo((2100 / 11000) * 100, 1); // (2000+100)/(10000+1000) * 100

      monitorSpy.mockRestore();
    });

    it('should handle optimization when no suggestions needed', async () => {
      const mockDataGrowthMetrics = {
        dataGrowthMetrics: {
          clickEvents: {
            totalRecords: 1000,
            anonymizedRecords: 900 // High efficiency
          }
        },
        recommendations: []
      };

      const mockRetentionStatus = {
        policies: [
          {
            name: 'test_policy',
            anonymizeAfterDays: 30,
            deleteAfterDays: 90,
            isActive: true
          }
        ],
        recordsEligibleForProcessing: {
          test_policy: 50 // Low number, no optimization needed
        }
      };

      const monitorSpy = jest.spyOn(DataRetentionJobs, 'monitorDataGrowth').mockResolvedValue(mockDataGrowthMetrics);
      (DataRetentionService.getRetentionStatus as jest.Mock).mockResolvedValue(mockRetentionStatus);

      const result = await DataRetentionJobs.optimizeRetentionPolicies();

      expect(result.optimizationSuggestions.length).toBe(0);
      expect(result.currentEfficiency).toBe(90); // 900/1000 * 100

      monitorSpy.mockRestore();
    });

    it('should handle optimization errors', async () => {
      const error = new Error('Optimization failed');
      const monitorSpy = jest.spyOn(DataRetentionJobs, 'monitorDataGrowth').mockRejectedValue(error);

      await expect(DataRetentionJobs.optimizeRetentionPolicies()).rejects.toThrow('Optimization failed');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Data retention policy optimization failed',
        expect.objectContaining({
          error: 'Optimization failed'
        })
      );

      monitorSpy.mockRestore();
    });
  });

  describe('monitorDataGrowth', () => {
    beforeEach(async () => {
      // Create test data for monitoring
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      // Create click events
      await ClickEvent.create([
        {
          trackingCode: 'recent',
          ipAddress: '192.168.1.1',
          userAgent: 'Browser',
          timestamp: new Date(),
          sessionId: 'session1',
          fingerprint: 'fp1'
        },
        {
          trackingCode: 'old',
          ipAddress: '0.0.0.0', // Anonymized
          userAgent: 'Anonymized',
          timestamp: ninetyDaysAgo,
          sessionId: 'session2',
          fingerprint: 'anonymized'
        },
        {
          trackingCode: 'very_old',
          ipAddress: '192.168.1.3',
          userAgent: 'Old Browser',
          timestamp: oneYearAgo,
          sessionId: 'session3',
          fingerprint: 'fp3'
        }
      ]);

      // Create users
      await User.create([
        {
          email: 'recent@test.com',
          password: 'password123',
          firstName: 'Recent',
          lastName: 'User',
          role: 'marketer',
          status: 'active',
          emailVerified: true,
          mfaEnabled: false,
          mfaSetupCompleted: false
        },
        {
          email: 'anonymized@deleted.local',
          password: 'password123',
          firstName: 'Anonymized User',
          lastName: 'User',
          role: 'marketer',
          status: 'revoked',
          emailVerified: true,
          mfaEnabled: false,
          mfaSetupCompleted: false,
          createdAt: oneYearAgo
        }
      ]);
    });

    it('should generate comprehensive data growth metrics', async () => {
      const result = await DataRetentionJobs.monitorDataGrowth();

      expect(result).toBeDefined();
      expect(result.dataGrowthMetrics).toBeDefined();
      expect(result.recommendations).toBeDefined();

      // Check click events metrics
      expect(result.dataGrowthMetrics.clickEvents).toBeDefined();
      expect(result.dataGrowthMetrics.clickEvents.totalRecords).toBe(3);
      expect(result.dataGrowthMetrics.clickEvents.anonymizedRecords).toBe(1);

      // Check users metrics
      expect(result.dataGrowthMetrics.users).toBeDefined();
      expect(result.dataGrowthMetrics.users.totalRecords).toBe(2);
      expect(result.dataGrowthMetrics.users.anonymizedRecords).toBe(1);

      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it('should generate appropriate recommendations', async () => {
      // Create many old click events to trigger recommendation
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const clickEvents = Array.from({ length: 15000 }, (_, i) => ({
        trackingCode: `old_${i}`,
        ipAddress: '192.168.1.1',
        userAgent: 'Browser',
        timestamp: oldDate,
        sessionId: `session_${i}`,
        fingerprint: `fp_${i}`
      }));

      await ClickEvent.insertMany(clickEvents);

      const result = await DataRetentionJobs.monitorDataGrowth();

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some(r => 
        r.includes('Consider more aggressive cleanup of click events')
      )).toBe(true);
    });

    it('should handle errors during monitoring', async () => {
      // Mock a database error
      const originalCountDocuments = ClickEvent.countDocuments;
      ClickEvent.countDocuments = jest.fn().mockRejectedValue(new Error('Database error'));

      await expect(DataRetentionJobs.monitorDataGrowth()).rejects.toThrow('Database error');

      const { logger } = require('../../utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Data growth monitoring failed',
        expect.objectContaining({
          error: 'Database error'
        })
      );

      // Restore original method
      ClickEvent.countDocuments = originalCountDocuments;
    });
  });
});