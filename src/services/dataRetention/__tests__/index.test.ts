import mongoose from 'mongoose';
import { DataRetentionService } from '../index';
import { User } from '../../../models/User';
import { UserProfile } from '../../../models/UserProfile';
import { ClickEvent } from '../../../models/ClickEvent';
import { ConversionEvent } from '../../../models/ConversionEvent';
import { AuditLog } from '../../../models/AuditLog';
import { Commission } from '../../../models/Commission';
import { PayoutRequest } from '../../../models/PayoutRequest';
import { PaymentMethod } from '../../../models/PaymentMethod';
import { Consent } from '../../../models/Consent';

// Mock logger to avoid console output during tests
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('DataRetentionService', () => {
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
  });

  describe('executeRetentionPolicies', () => {
    it('should execute all active retention policies', async () => {
      // Create test data that should be processed
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      
      await ClickEvent.create({
        trackingCode: 'test_code_1',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        timestamp: oldDate,
        sessionId: 'session_1',
        fingerprint: 'fingerprint_1'
      });

      await ConversionEvent.create({
        trackingCode: 'test_code_1',
        customerId: 'customer_1',
        productId: 'product_1',
        initialSpendAmount: 1000,
        conversionTimestamp: oldDate,
        attributionMethod: 'cookie',
        deduplicationKey: 'dedup_1'
      });

      const reports = await DataRetentionService.executeRetentionPolicies();

      expect(reports).toBeDefined();
      expect(reports.length).toBeGreaterThan(0);
      
      // Check that at least one policy was executed
      const trackingDataReport = reports.find(r => r.policyName === 'user_tracking_data');
      expect(trackingDataReport).toBeDefined();
      expect(trackingDataReport!.recordsProcessed).toBeGreaterThan(0);
    });

    it('should handle errors gracefully during policy execution', async () => {
      // Mock a database error
      const originalFind = ClickEvent.find;
      ClickEvent.find = jest.fn().mockRejectedValue(new Error('Database error'));

      const reports = await DataRetentionService.executeRetentionPolicies();

      expect(reports).toBeDefined();
      const trackingDataReport = reports.find(r => r.policyName === 'user_tracking_data');
      expect(trackingDataReport?.errors.length).toBeGreaterThan(0);

      // Restore original method
      ClickEvent.find = originalFind;
    });
  });

  describe('Click Events Processing', () => {
    it('should anonymize old click events', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      // Create old and recent click events
      await ClickEvent.create([
        {
          trackingCode: 'old_code',
          ipAddress: '192.168.1.1',
          userAgent: 'Old Browser',
          timestamp: oldDate,
          sessionId: 'old_session',
          fingerprint: 'old_fingerprint'
        },
        {
          trackingCode: 'recent_code',
          ipAddress: '192.168.1.2',
          userAgent: 'Recent Browser',
          timestamp: recentDate,
          sessionId: 'recent_session',
          fingerprint: 'recent_fingerprint'
        }
      ]);

      await DataRetentionService.executeRetentionPolicies();

      // Check that old event was anonymized
      const oldEvent = await ClickEvent.findOne({ trackingCode: 'old_code' });
      expect(oldEvent?.ipAddress).toBe('0.0.0.0');
      expect(oldEvent?.userAgent).toBe('Anonymized');

      // Check that recent event was not anonymized
      const recentEvent = await ClickEvent.findOne({ trackingCode: 'recent_code' });
      expect(recentEvent?.ipAddress).toBe('192.168.1.2');
      expect(recentEvent?.userAgent).toBe('Recent Browser');
    });

    it('should not re-anonymize already anonymized click events', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

      await ClickEvent.create({
        trackingCode: 'already_anon',
        ipAddress: '0.0.0.0', // Already anonymized
        userAgent: 'Anonymized',
        timestamp: oldDate,
        sessionId: 'session',
        fingerprint: 'anonymized'
      });

      const reports = await DataRetentionService.executeRetentionPolicies();
      const trackingReport = reports.find(r => r.policyName === 'user_tracking_data');
      
      // Should not count already anonymized records
      expect(trackingReport?.recordsAnonymized).toBe(0);
    });
  });

  describe('Conversion Events Processing', () => {
    it('should anonymize old conversion events', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

      await ConversionEvent.create({
        trackingCode: 'old_conversion',
        customerId: 'customer_1',
        productId: 'product_1',
        initialSpendAmount: 1000,
        conversionTimestamp: oldDate,
        attributionMethod: 'cookie',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        deduplicationKey: 'dedup_old'
      });

      await DataRetentionService.executeRetentionPolicies();

      const event = await ConversionEvent.findOne({ trackingCode: 'old_conversion' });
      expect(event?.ipAddress).toBe('0.0.0.0');
      expect(event?.userAgent).toBe('Anonymized');
    });
  });

  describe('User Profile Processing', () => {
    it('should anonymize inactive user profiles', async () => {
      const oldDate = new Date(Date.now() - 1200 * 24 * 60 * 60 * 1000); // Over 3 years ago

      // Create user and profile
      const user = await User.create({
        email: 'inactive@test.com',
        password: 'password123',
        firstName: 'Inactive',
        lastName: 'User',
        role: 'marketer',
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        mfaSetupCompleted: false,
        lastLogin: oldDate
      });

      await UserProfile.create({
        userId: user._id,
        firstName: 'Inactive',
        lastName: 'User',
        phone: '+1234567890',
        kycStatus: 'approved',
        complianceQuizPassed: true,
        updatedAt: oldDate
      });

      await DataRetentionService.executeRetentionPolicies();

      const profile = await UserProfile.findOne({ userId: user._id });
      expect(profile?.firstName).toBe('Anonymized User');
      expect(profile?.lastName).toBe('');
      expect(profile?.phone).toBe('');
    });

    it('should not anonymize profiles of active users', async () => {
      const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      const user = await User.create({
        email: 'active@test.com',
        password: 'password123',
        firstName: 'Active',
        lastName: 'User',
        role: 'marketer',
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        mfaSetupCompleted: false,
        lastLogin: recentDate
      });

      await UserProfile.create({
        userId: user._id,
        firstName: 'Active',
        lastName: 'User',
        phone: '+1234567890',
        kycStatus: 'approved',
        complianceQuizPassed: true
      });

      await DataRetentionService.executeRetentionPolicies();

      const profile = await UserProfile.findOne({ userId: user._id });
      expect(profile?.firstName).toBe('Active');
      expect(profile?.lastName).toBe('User');
    });
  });

  describe('Commission Processing', () => {
    it('should anonymize customer data in old paid commissions', async () => {
      const oldDate = new Date(Date.now() - 2000 * 24 * 60 * 60 * 1000); // Over 5 years ago

      const commission = await Commission.create({
        marketerId: 'marketer_1',
        customerId: 'customer_123',
        productId: 'product_1',
        trackingCode: 'track_123',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'paid',
        conversionDate: oldDate,
        clearancePeriodDays: 30,
        createdAt: oldDate
      });

      await DataRetentionService.executeRetentionPolicies();

      const updatedCommission = await Commission.findById(commission._id);
      expect(updatedCommission?.customerId).toMatch(/^anon_/);
      expect(updatedCommission?.customerId).not.toBe('customer_123');
    });

    it('should not anonymize pending or recent commissions', async () => {
      const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const commission = await Commission.create({
        marketerId: 'marketer_1',
        customerId: 'customer_456',
        productId: 'product_1',
        trackingCode: 'track_456',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: recentDate,
        clearancePeriodDays: 30
      });

      await DataRetentionService.executeRetentionPolicies();

      const updatedCommission = await Commission.findById(commission._id);
      expect(updatedCommission?.customerId).toBe('customer_456');
    });
  });

  describe('Audit Log Processing', () => {
    it('should anonymize old audit logs', async () => {
      const oldDate = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000); // Over 2 years ago

      await AuditLog.create({
        adminId: 'admin_1',
        action: 'user_status_changed',
        resource: 'user',
        resourceId: 'user_123',
        details: { reason: 'Test action' },
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        timestamp: oldDate
      });

      await DataRetentionService.executeRetentionPolicies();

      const log = await AuditLog.findOne({ adminId: 'admin_1' });
      expect(log?.ipAddress).toBe('0.0.0.0');
      expect(log?.userAgent).toBe('Anonymized');
    });

    it('should delete very old non-critical audit logs', async () => {
      const veryOldDate = new Date(Date.now() - 1200 * 24 * 60 * 60 * 1000); // Over 3 years ago

      await AuditLog.create({
        adminId: 'admin_1',
        action: 'user_login', // Non-critical action
        resource: 'user',
        details: { reason: 'Regular login' },
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        timestamp: veryOldDate
      });

      const countBefore = await AuditLog.countDocuments();
      await DataRetentionService.executeRetentionPolicies();
      const countAfter = await AuditLog.countDocuments();

      expect(countAfter).toBeLessThan(countBefore);
    });

    it('should preserve critical audit logs', async () => {
      const veryOldDate = new Date(Date.now() - 1200 * 24 * 60 * 60 * 1000);

      await AuditLog.create({
        adminId: 'admin_1',
        action: 'data_deletion', // Critical action
        resource: 'system',
        details: { reason: 'GDPR deletion request' },
        ipAddress: '192.168.1.1',
        userAgent: 'GDPR Service',
        timestamp: veryOldDate
      });

      const logBefore = await AuditLog.findOne({ action: 'data_deletion' });
      await DataRetentionService.executeRetentionPolicies();
      const logAfter = await AuditLog.findOne({ action: 'data_deletion' });

      expect(logBefore).toBeDefined();
      expect(logAfter).toBeDefined();
      expect(logAfter?._id.toString()).toBe(logBefore?._id.toString());
    });
  });

  describe('Inactive Users Processing', () => {
    it('should anonymize truly inactive users', async () => {
      const oldDate = new Date(Date.now() - 1200 * 24 * 60 * 60 * 1000); // Over 3 years ago

      const user = await User.create({
        email: 'inactive@test.com',
        password: 'password123',
        firstName: 'Inactive',
        lastName: 'User',
        role: 'marketer',
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        mfaSetupCompleted: false,
        lastLogin: oldDate
      });

      await DataRetentionService.executeRetentionPolicies();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser?.firstName).toBe('Anonymized User');
      expect(updatedUser?.lastName).toBe('');
      expect(updatedUser?.status).toBe('revoked');
      expect(updatedUser?.email).toMatch(/^anonymized_.*@deleted\.local$/);
    });

    it('should not anonymize users with recent financial activity', async () => {
      const oldDate = new Date(Date.now() - 1200 * 24 * 60 * 60 * 1000);
      const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      const user = await User.create({
        email: 'active@test.com',
        password: 'password123',
        firstName: 'Active',
        lastName: 'User',
        role: 'marketer',
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        mfaSetupCompleted: false,
        lastLogin: oldDate // Old login
      });

      // But has recent commission activity
      await Commission.create({
        marketerId: user._id.toString(),
        customerId: 'customer_1',
        productId: 'product_1',
        trackingCode: 'track_1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: recentDate,
        clearancePeriodDays: 30
      });

      await DataRetentionService.executeRetentionPolicies();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser?.firstName).toBe('Active'); // Should not be anonymized
      expect(updatedUser?.email).toBe('active@test.com');
    });
  });

  describe('getRetentionStatus', () => {
    it('should return current retention status', async () => {
      const status = await DataRetentionService.getRetentionStatus();

      expect(status).toBeDefined();
      expect(status.policies).toBeDefined();
      expect(status.policies.length).toBeGreaterThan(0);
      expect(status.recordsEligibleForProcessing).toBeDefined();
      expect(typeof status.recordsEligibleForProcessing).toBe('object');
    });

    it('should count eligible records correctly', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

      // Create some old data
      await ClickEvent.create({
        trackingCode: 'test_code',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        timestamp: oldDate,
        sessionId: 'session_1',
        fingerprint: 'fingerprint_1'
      });

      const status = await DataRetentionService.getRetentionStatus();
      
      expect(status.recordsEligibleForProcessing.user_tracking_data).toBeGreaterThan(0);
    });
  });

  describe('manualAnonymization', () => {
    it('should perform dry run anonymization', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

      await ClickEvent.create({
        trackingCode: 'test_code',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        timestamp: oldDate,
        sessionId: 'session_1',
        fingerprint: 'fingerprint_1'
      });

      const result = await DataRetentionService.manualAnonymization('click_events', 90, true);

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(1);

      // Verify data was not actually changed (dry run)
      const event = await ClickEvent.findOne({ trackingCode: 'test_code' });
      expect(event?.ipAddress).toBe('192.168.1.1');
    });

    it('should perform actual anonymization when not dry run', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

      await ClickEvent.create({
        trackingCode: 'test_code',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        timestamp: oldDate,
        sessionId: 'session_1',
        fingerprint: 'fingerprint_1'
      });

      const result = await DataRetentionService.manualAnonymization('click_events', 90, false);

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(1);

      // Verify data was actually changed
      const event = await ClickEvent.findOne({ trackingCode: 'test_code' });
      expect(event?.ipAddress).toBe('0.0.0.0');
      expect(event?.userAgent).toBe('Anonymized');
    });

    it('should handle unsupported data types', async () => {
      const result = await DataRetentionService.manualAnonymization('unsupported_type', 90, true);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Unsupported data type');
    });
  });

  describe('validateRetentionPolicy', () => {
    it('should validate correct policy', async () => {
      const validPolicy = {
        name: 'test_policy',
        description: 'Test policy description',
        retentionPeriodDays: 90,
        dataTypes: ['click_events'],
        anonymizeAfterDays: 30,
        deleteAfterDays: 90,
        isActive: true
      };

      const result = DataRetentionService.validateRetentionPolicy(validPolicy);

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect invalid policy configurations', async () => {
      const invalidPolicy = {
        name: '',
        description: '',
        retentionPeriodDays: -1,
        dataTypes: [],
        anonymizeAfterDays: 100, // Greater than deleteAfterDays
        deleteAfterDays: 50,
        isActive: true
      };

      const result = DataRetentionService.validateRetentionPolicy(invalidPolicy);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors).toContain('Policy name is required');
      expect(result.errors).toContain('Policy description is required');
      expect(result.errors).toContain('Retention period must be a positive number');
      expect(result.errors).toContain('At least one data type must be specified');
      expect(result.errors).toContain('Anonymization period must be less than deletion period');
    });
  });

  describe('createRetentionPolicy', () => {
    it('should create valid retention policy', async () => {
      const validPolicy = {
        name: 'test_custom_policy',
        description: 'Custom test policy',
        retentionPeriodDays: 180,
        dataTypes: ['click_events', 'conversion_events'],
        anonymizeAfterDays: 90,
        deleteAfterDays: 180,
        isActive: true
      };

      const result = await DataRetentionService.createRetentionPolicy(validPolicy);

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);

      // Verify audit log was created
      const auditLog = await AuditLog.findOne({ action: 'retention_policy_created' });
      expect(auditLog).toBeDefined();
      // Debug: log the actual structure
      console.log('Audit log details:', JSON.stringify(auditLog?.details, null, 2));
      expect(auditLog?.details.reason).toContain('test_custom_policy');
    });

    it('should reject invalid retention policy', async () => {
      const invalidPolicy = {
        name: '',
        description: 'Invalid policy',
        retentionPeriodDays: -1,
        dataTypes: [],
        isActive: true
      };

      const result = await DataRetentionService.createRetentionPolicy(invalidPolicy);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('anonymizeDataFields', () => {
    it('should anonymize specific fields in click events', async () => {
      const clickEvent = await ClickEvent.create({
        trackingCode: 'test_field_anon',
        ipAddress: '192.168.1.100',
        userAgent: 'Test Browser Agent',
        timestamp: new Date(),
        sessionId: 'session_field_test',
        fingerprint: 'test_fingerprint'
      });

      const result = await DataRetentionService.anonymizeDataFields(
        'clickevents',
        clickEvent._id.toString(),
        ['ipAddress', 'userAgent', 'fingerprint'],
        'Test field anonymization'
      );

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);

      // Verify fields were anonymized
      const updatedEvent = await ClickEvent.findById(clickEvent._id);
      expect(updatedEvent?.ipAddress).toBe('0.0.0.0');
      expect(updatedEvent?.userAgent).toBe('Anonymized');
      expect(updatedEvent?.fingerprint).toBe('anonymized');

      // Verify audit log was created
      const auditLog = await AuditLog.findOne({ action: 'field_rectification' });
      expect(auditLog).toBeDefined();
    });

    it('should anonymize user fields', async () => {
      const user = await User.create({
        email: 'field.test@example.com',
        password: 'password123',
        firstName: 'Field',
        lastName: 'Test',
        role: 'marketer',
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        mfaSetupCompleted: false
      });

      const result = await DataRetentionService.anonymizeDataFields(
        'users',
        user._id.toString(),
        ['email', 'firstName', 'lastName'],
        'User data anonymization test'
      );

      expect(result.success).toBe(true);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser?.email).toMatch(/^anonymized_.*@deleted\.local$/);
      expect(updatedUser?.firstName).toBe('Anonymized User');
      expect(updatedUser?.lastName).toBe('');
    });

    it('should handle unsupported collection types', async () => {
      const result = await DataRetentionService.anonymizeDataFields(
        'unsupported_collection',
        'test_id',
        ['field1'],
        'Test unsupported collection'
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Unsupported collection');
    });

    it('should handle non-existent documents', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      
      const result = await DataRetentionService.anonymizeDataFields(
        'users',
        fakeId,
        ['email'],
        'Test non-existent document'
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Document not found');
    });
  });

  describe('bulkAnonymization', () => {
    it('should perform bulk anonymization of click events', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      
      // Create multiple click events
      const clickEvents = await ClickEvent.insertMany([
        {
          trackingCode: 'bulk_test_1',
          ipAddress: '192.168.1.1',
          userAgent: 'Browser 1',
          timestamp: oldDate,
          sessionId: 'session_1',
          fingerprint: 'fp_1'
        },
        {
          trackingCode: 'bulk_test_2',
          ipAddress: '192.168.1.2',
          userAgent: 'Browser 2',
          timestamp: oldDate,
          sessionId: 'session_2',
          fingerprint: 'fp_2'
        },
        {
          trackingCode: 'bulk_test_3',
          ipAddress: '0.0.0.0', // Already anonymized
          userAgent: 'Anonymized',
          timestamp: oldDate,
          sessionId: 'session_3',
          fingerprint: 'anonymized'
        }
      ]);

      const criteria = { timestamp: { $lt: oldDate } };
      const result = await DataRetentionService.bulkAnonymization('click_events', criteria, 2);

      expect(result.success).toBe(true);
      expect(result.totalProcessed).toBe(3);
      expect(result.totalAnonymized).toBe(2); // Only 2 needed anonymization
      expect(result.progress.length).toBeGreaterThan(0);

      // Verify anonymization
      const anonymizedEvents = await ClickEvent.find({ ipAddress: '0.0.0.0' });
      expect(anonymizedEvents.length).toBe(3); // All should be anonymized now
    });

    it('should handle bulk anonymization with batching', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      
      // Create 5 events to test batching with batch size 2
      const events = Array.from({ length: 5 }, (_, i) => ({
        trackingCode: `batch_test_${i}`,
        ipAddress: `192.168.1.${i + 1}`,
        userAgent: `Browser ${i + 1}`,
        timestamp: oldDate,
        sessionId: `session_${i}`,
        fingerprint: `fp_${i}`
      }));

      await ClickEvent.insertMany(events);

      const criteria = { timestamp: { $lt: oldDate } };
      const result = await DataRetentionService.bulkAnonymization('click_events', criteria, 2);

      expect(result.success).toBe(true);
      expect(result.totalProcessed).toBe(5);
      expect(result.totalAnonymized).toBe(5);
      expect(result.progress.length).toBe(3); // 3 batches (2+2+1)
    });

    it('should handle unsupported data types in bulk anonymization', async () => {
      const result = await DataRetentionService.bulkAnonymization('unsupported_type', {}, 10);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Unsupported data type');
    });
  });

  describe('enforceAutomatedRetention', () => {
    it('should enforce automated retention policies successfully', async () => {
      // Create test data
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      
      await ClickEvent.create({
        trackingCode: 'auto_retention_test',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        timestamp: oldDate,
        sessionId: 'session_auto',
        fingerprint: 'fp_auto'
      });

      const result = await DataRetentionService.enforceAutomatedRetention();

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.policiesExecuted).toBeGreaterThan(0);
      expect(result.totalRecordsProcessed).toBeGreaterThan(0);
      expect(result.nextScheduledExecution).toBeDefined();
      expect(result.nextScheduledExecution).toBeInstanceOf(Date);
    });

    it('should handle errors during automated retention enforcement', async () => {
      // Mock a database error
      const originalFind = ClickEvent.find;
      ClickEvent.find = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      const result = await DataRetentionService.enforceAutomatedRetention();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      // Restore original method
      ClickEvent.find = originalFind;
    });

    it('should validate policies before execution', async () => {
      // This test ensures that invalid policies are caught before execution
      const result = await DataRetentionService.enforceAutomatedRetention();
      
      // Should still succeed with default valid policies
      expect(result.success).toBe(true);
      expect(result.policiesExecuted).toBeGreaterThan(0);
    });

    it('should calculate next scheduled execution correctly', async () => {
      const beforeTime = new Date();
      const result = await DataRetentionService.enforceAutomatedRetention();
      const afterTime = new Date();

      expect(result.nextScheduledExecution).toBeDefined();
      expect(result.nextScheduledExecution!.getTime()).toBeGreaterThan(beforeTime.getTime() + 23 * 60 * 60 * 1000); // At least 23 hours from now
      expect(result.nextScheduledExecution!.getTime()).toBeLessThan(afterTime.getTime() + 25 * 60 * 60 * 1000); // Less than 25 hours from now
    });
  });

  describe('performComplianceCheck', () => {
    it('should identify compliance issues with old data', async () => {
      const veryOldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      
      // Create old data that should trigger compliance issues
      await ClickEvent.create({
        trackingCode: 'compliance_test',
        ipAddress: '192.168.1.100', // Not anonymized
        userAgent: 'Test Browser',
        timestamp: veryOldDate,
        sessionId: 'session_compliance',
        fingerprint: 'fp_compliance'
      });

      await ConversionEvent.create({
        trackingCode: 'compliance_conversion',
        customerId: 'customer_compliance',
        productId: 'product_1',
        initialSpendAmount: 1000,
        conversionTimestamp: veryOldDate,
        attributionMethod: 'cookie',
        ipAddress: '192.168.1.101', // Not anonymized
        userAgent: 'Test Browser',
        deduplicationKey: 'dedup_compliance'
      });

      const result = await DataRetentionService.performComplianceCheck();

      expect(result).toBeDefined();
      expect(result.compliant).toBe(false); // Should not be compliant due to old data
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.summary.highSeverityIssues).toBeGreaterThan(0);
      expect(result.summary.recordsRequiringAttention).toBeGreaterThan(0);

      // Check for specific issue types
      const clickEventIssue = result.issues.find(i => i.category === 'Data Anonymization' && i.description.includes('Click events'));
      expect(clickEventIssue).toBeDefined();
      expect(clickEventIssue!.severity).toBe('high');
    });

    it('should pass compliance check with properly anonymized data', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      
      // Create old but properly anonymized data
      await ClickEvent.create({
        trackingCode: 'compliant_test',
        ipAddress: '0.0.0.0', // Already anonymized
        userAgent: 'Anonymized',
        timestamp: oldDate,
        sessionId: 'anonymized',
        fingerprint: 'anonymized'
      });

      const result = await DataRetentionService.performComplianceCheck();

      expect(result).toBeDefined();
      expect(result.compliant).toBe(true);
      expect(result.summary.highSeverityIssues).toBe(0);
    });

    it('should identify inactive users requiring anonymization', async () => {
      const veryOldDate = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000); // 4 years ago

      await User.create({
        email: 'inactive.compliance@test.com',
        password: 'password123',
        firstName: 'Inactive', // Not anonymized
        lastName: 'User',
        role: 'marketer',
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        mfaSetupCompleted: false,
        lastLogin: veryOldDate
      });

      const result = await DataRetentionService.performComplianceCheck();

      expect(result.issues.some(i => i.category === 'User Data Retention')).toBe(true);
    });

    it('should create audit log for compliance check', async () => {
      await DataRetentionService.performComplianceCheck();

      const auditLog = await AuditLog.findOne({ action: 'data_retention_check' });
      expect(auditLog).toBeDefined();
      expect(auditLog!.details.reason).toContain('compliance check');
    });
  });

  describe('advancedAnonymization', () => {
    beforeEach(async () => {
      // Create test data for advanced anonymization
      const testDate = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);
      
      await ClickEvent.create([
        {
          trackingCode: 'advanced_test_1',
          ipAddress: '192.168.1.100',
          userAgent: 'Advanced Test Browser 1',
          timestamp: testDate,
          sessionId: 'advanced_session_1',
          fingerprint: 'advanced_fp_1'
        },
        {
          trackingCode: 'advanced_test_2',
          ipAddress: '192.168.1.101',
          userAgent: 'Advanced Test Browser 2',
          timestamp: testDate,
          sessionId: 'advanced_session_2',
          fingerprint: 'advanced_fp_2'
        }
      ]);

      await ConversionEvent.create([
        {
          trackingCode: 'advanced_conversion_1',
          customerId: 'customer_advanced_1',
          productId: 'product_1',
          initialSpendAmount: 1000,
          conversionTimestamp: testDate,
          attributionMethod: 'cookie',
          ipAddress: '192.168.1.200',
          userAgent: 'Conversion Browser 1',
          deduplicationKey: 'dedup_advanced_1'
        },
        {
          trackingCode: 'advanced_conversion_2',
          customerId: 'customer_advanced_2',
          productId: 'product_2',
          initialSpendAmount: 2000,
          conversionTimestamp: testDate,
          attributionMethod: 'portal',
          ipAddress: '192.168.1.201',
          userAgent: 'Conversion Browser 2',
          deduplicationKey: 'dedup_advanced_2'
        }
      ]);
    });

    it('should perform full anonymization of click events', async () => {
      const criteria = { trackingCode: { $regex: /^advanced_test/ } };
      
      const result = await DataRetentionService.advancedAnonymization(
        'click_events',
        'full',
        criteria,
        { auditTrail: true }
      );

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(2);
      expect(result.anonymizationMethod).toBe('full');
      expect(result.errors.length).toBe(0);

      // Verify full anonymization
      const anonymizedEvents = await ClickEvent.find({ trackingCode: { $regex: /^advanced_test/ } });
      for (const event of anonymizedEvents) {
        expect(event.ipAddress).toBe('0.0.0.0');
        expect(event.userAgent).toBe('Anonymized');
        expect(event.fingerprint).toBe('anonymized');
        expect(event.sessionId).toBe('anonymized');
      }

      // Verify audit trail was created
      const auditLogs = await AuditLog.find({ action: 'data_anonymization' });
      expect(auditLogs.length).toBeGreaterThan(0);
    });

    it('should perform partial anonymization with analytics preservation', async () => {
      const criteria = { trackingCode: { $regex: /^advanced_test/ } };
      
      const result = await DataRetentionService.advancedAnonymization(
        'click_events',
        'partial',
        criteria,
        { preserveAnalytics: true, auditTrail: false }
      );

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(2);
      expect(result.anonymizationMethod).toBe('partial');
      expect(result.preservedFields).toContain('fingerprint');
      expect(result.preservedFields).toContain('sessionId');

      // Verify partial anonymization
      const events = await ClickEvent.find({ trackingCode: { $regex: /^advanced_test/ } });
      for (const event of events) {
        expect(event.ipAddress).toBe('0.0.0.0');
        expect(event.userAgent).toBe('Anonymized');
        // These should be preserved for analytics
        expect(event.fingerprint).not.toBe('anonymized');
        expect(event.sessionId).not.toBe('anonymized');
      }
    });

    it('should perform pseudonymization', async () => {
      const criteria = { trackingCode: { $regex: /^advanced_test/ } };
      
      const result = await DataRetentionService.advancedAnonymization(
        'click_events',
        'pseudonymization',
        criteria
      );

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(2);
      expect(result.anonymizationMethod).toBe('pseudonymization');

      // Verify pseudonymization
      const events = await ClickEvent.find({ trackingCode: { $regex: /^advanced_test/ } });
      for (const event of events) {
        expect(event.ipAddress).not.toBe('192.168.1.100');
        expect(event.ipAddress).not.toBe('192.168.1.101');
        expect(event.ipAddress).not.toBe('0.0.0.0');
        expect(event.userAgent).toBe('Pseudonymized');
        expect(event.fingerprint).not.toBe('advanced_fp_1');
        expect(event.fingerprint).not.toBe('advanced_fp_2');
        expect(event.fingerprint).not.toBe('anonymized');
      }
    });

    it('should perform advanced anonymization on conversion events', async () => {
      const criteria = { trackingCode: { $regex: /^advanced_conversion/ } };
      
      const result = await DataRetentionService.advancedAnonymization(
        'conversion_events',
        'full',
        criteria,
        { preserveAnalytics: false }
      );

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(2);

      // Verify anonymization
      const events = await ConversionEvent.find({ trackingCode: { $regex: /^advanced_conversion/ } });
      for (const event of events) {
        expect(event.ipAddress).toBe('0.0.0.0');
        expect(event.userAgent).toBe('Anonymized');
        expect(event.fingerprint).toBe('anonymized');
        expect(event.customerId).toMatch(/^anon_/);
      }
    });

    it('should preserve customer ID in conversion events when preserveAnalytics is true', async () => {
      const criteria = { trackingCode: { $regex: /^advanced_conversion/ } };
      
      const result = await DataRetentionService.advancedAnonymization(
        'conversion_events',
        'partial',
        criteria,
        { preserveAnalytics: true }
      );

      expect(result.success).toBe(true);
      expect(result.preservedFields).toContain('customerId');

      // Verify customer ID preservation
      const events = await ConversionEvent.find({ trackingCode: { $regex: /^advanced_conversion/ } });
      const originalCustomerIds = ['customer_advanced_1', 'customer_advanced_2'];
      
      for (const event of events) {
        expect(event.ipAddress).toBe('0.0.0.0');
        expect(event.userAgent).toBe('Anonymized');
        expect(originalCustomerIds).toContain(event.customerId); // Should be preserved
      }
    });

    it('should handle unsupported data types', async () => {
      const result = await DataRetentionService.advancedAnonymization(
        'unsupported_type',
        'full',
        {},
        {}
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Unsupported data type');
    });

    it('should handle errors during anonymization gracefully', async () => {
      // Create invalid criteria that will cause an error
      const criteria = { $invalidOperator: 'test' };
      
      const result = await DataRetentionService.advancedAnonymization(
        'click_events',
        'full',
        criteria,
        {}
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('performComplianceCheck', () => {
    it('should detect compliance issues', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      const veryOldDate = new Date(Date.now() - 1200 * 24 * 60 * 60 * 1000); // Over 3 years ago

      // Create data that should trigger compliance issues
      await ClickEvent.create({
        trackingCode: 'compliance_test',
        ipAddress: '192.168.1.1', // Not anonymized
        userAgent: 'Test Browser',
        timestamp: oldDate, // Older than 90 days
        sessionId: 'session_compliance',
        fingerprint: 'fp_compliance'
      });

      await User.create({
        email: 'inactive.compliance@test.com',
        password: 'password123',
        firstName: 'Inactive',
        lastName: 'Compliance',
        role: 'marketer',
        status: 'active', // Still active but very old
        emailVerified: true,
        mfaEnabled: false,
        mfaSetupCompleted: false,
        lastLogin: veryOldDate,
        createdAt: veryOldDate
      });

      const result = await DataRetentionService.performComplianceCheck();

      expect(result.compliant).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.summary.highSeverityIssues).toBeGreaterThan(0);

      // Check for specific issue types
      const clickEventIssue = result.issues.find(i => i.category === 'Data Anonymization' && i.description.includes('Click events'));
      expect(clickEventIssue).toBeDefined();
      expect(clickEventIssue?.severity).toBe('high');

      // Verify audit log was created
      const auditLog = await AuditLog.findOne({ action: 'data_retention_check' });
      expect(auditLog).toBeDefined();
    });

    it('should pass compliance check when no issues exist', async () => {
      // Create only compliant data
      await ClickEvent.create({
        trackingCode: 'compliant_test',
        ipAddress: '0.0.0.0', // Already anonymized
        userAgent: 'Anonymized',
        timestamp: new Date(), // Recent
        sessionId: 'session_compliant',
        fingerprint: 'anonymized'
      });

      const result = await DataRetentionService.performComplianceCheck();

      expect(result.compliant).toBe(true);
      expect(result.summary.highSeverityIssues).toBe(0);
    });

    it('should categorize issues by severity correctly', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const veryOldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

      // Create high severity issue (old click events not anonymized)
      await ClickEvent.create({
        trackingCode: 'high_severity',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        timestamp: oldDate,
        sessionId: 'session_high',
        fingerprint: 'fp_high'
      });

      // Create many old audit logs for low severity issue
      const auditLogs = Array.from({ length: 1500 }, (_, i) => ({
        adminId: 'admin_test',
        action: 'user_login',
        resource: 'user',
        details: { reason: `Login ${i}` },
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        timestamp: veryOldDate
      }));
      await AuditLog.insertMany(auditLogs);

      const result = await DataRetentionService.performComplianceCheck();

      expect(result.issues.some(i => i.severity === 'high')).toBe(true);
      expect(result.issues.some(i => i.severity === 'low')).toBe(true);
      expect(result.summary.highSeverityIssues).toBeGreaterThan(0);
    });
  });
});

  describe('Enhanced Data Retention and Cleanup Tests', () => {
    describe('performComplianceCheck', () => {
      it('should identify compliance issues with old data', async () => {
        const veryOldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
        
        // Create old data that should trigger compliance issues
        await ClickEvent.create({
          trackingCode: 'compliance_test',
          ipAddress: '192.168.1.100', // Not anonymized
          userAgent: 'Test Browser',
          timestamp: veryOldDate,
          sessionId: 'session_compliance',
          fingerprint: 'fp_compliance'
        });

        await ConversionEvent.create({
          trackingCode: 'compliance_conversion',
          customerId: 'customer_compliance',
          productId: 'product_1',
          initialSpendAmount: 1000,
          conversionTimestamp: veryOldDate,
          attributionMethod: 'cookie',
          ipAddress: '192.168.1.101', // Not anonymized
          userAgent: 'Test Browser',
          deduplicationKey: 'dedup_compliance'
        });

        const result = await DataRetentionService.performComplianceCheck();

        expect(result).toBeDefined();
        expect(result.compliant).toBe(false); // Should not be compliant due to old data
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.summary.highSeverityIssues).toBeGreaterThan(0);
        expect(result.summary.recordsRequiringAttention).toBeGreaterThan(0);

        // Check for specific issue types
        const clickEventIssue = result.issues.find(i => i.category === 'Data Anonymization' && i.description.includes('Click events'));
        expect(clickEventIssue).toBeDefined();
        expect(clickEventIssue!.severity).toBe('high');
      });

      it('should pass compliance check with properly anonymized data', async () => {
        const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        
        // Create old but properly anonymized data
        await ClickEvent.create({
          trackingCode: 'compliant_test',
          ipAddress: '0.0.0.0', // Already anonymized
          userAgent: 'Anonymized',
          timestamp: oldDate,
          sessionId: 'anonymized',
          fingerprint: 'anonymized'
        });

        const result = await DataRetentionService.performComplianceCheck();

        expect(result).toBeDefined();
        expect(result.compliant).toBe(true);
        expect(result.summary.highSeverityIssues).toBe(0);
      });

      it('should identify inactive users requiring anonymization', async () => {
        const veryOldDate = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000); // 4 years ago

        await User.create({
          email: 'inactive.compliance@test.com',
          password: 'password123',
          firstName: 'Inactive', // Not anonymized
          lastName: 'User',
          role: 'marketer',
          status: 'active',
          emailVerified: true,
          mfaEnabled: false,
          mfaSetupCompleted: false,
          lastLogin: veryOldDate
        });

        const result = await DataRetentionService.performComplianceCheck();

        expect(result.issues.some(i => i.category === 'User Data Retention')).toBe(true);
      });

      it('should create audit log for compliance check', async () => {
        await DataRetentionService.performComplianceCheck();

        const auditLog = await AuditLog.findOne({ action: 'data_retention_check' });
        expect(auditLog).toBeDefined();
        expect(auditLog!.details.reason).toContain('compliance check');
      });
    });

    describe('advancedAnonymization', () => {
      beforeEach(async () => {
        // Create test data for advanced anonymization
        const testDate = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);
        
        await ClickEvent.create([
          {
            trackingCode: 'advanced_test_1',
            ipAddress: '192.168.1.100',
            userAgent: 'Advanced Test Browser 1',
            timestamp: testDate,
            sessionId: 'advanced_session_1',
            fingerprint: 'advanced_fp_1'
          },
          {
            trackingCode: 'advanced_test_2',
            ipAddress: '192.168.1.101',
            userAgent: 'Advanced Test Browser 2',
            timestamp: testDate,
            sessionId: 'advanced_session_2',
            fingerprint: 'advanced_fp_2'
          }
        ]);

        await ConversionEvent.create([
          {
            trackingCode: 'advanced_conversion_1',
            customerId: 'customer_advanced_1',
            productId: 'product_1',
            initialSpendAmount: 1000,
            conversionTimestamp: testDate,
            attributionMethod: 'cookie',
            ipAddress: '192.168.1.200',
            userAgent: 'Conversion Browser 1',
            deduplicationKey: 'dedup_advanced_1'
          },
          {
            trackingCode: 'advanced_conversion_2',
            customerId: 'customer_advanced_2',
            productId: 'product_2',
            initialSpendAmount: 2000,
            conversionTimestamp: testDate,
            attributionMethod: 'portal',
            ipAddress: '192.168.1.201',
            userAgent: 'Conversion Browser 2',
            deduplicationKey: 'dedup_advanced_2'
          }
        ]);
      });

      it('should perform full anonymization of click events', async () => {
        const criteria = { trackingCode: { $regex: /^advanced_test/ } };
        
        const result = await DataRetentionService.advancedAnonymization(
          'click_events',
          'full',
          criteria,
          { auditTrail: true }
        );

        expect(result.success).toBe(true);
        expect(result.recordsProcessed).toBe(2);
        expect(result.anonymizationMethod).toBe('full');
        expect(result.errors.length).toBe(0);

        // Verify full anonymization
        const anonymizedEvents = await ClickEvent.find({ trackingCode: { $regex: /^advanced_test/ } });
        for (const event of anonymizedEvents) {
          expect(event.ipAddress).toBe('0.0.0.0');
          expect(event.userAgent).toBe('Anonymized');
          expect(event.fingerprint).toBe('anonymized');
          expect(event.sessionId).toBe('anonymized');
        }

        // Verify audit trail was created
        const auditLogs = await AuditLog.find({ action: 'data_anonymization' });
        expect(auditLogs.length).toBeGreaterThan(0);
      });

      it('should perform partial anonymization preserving analytics data', async () => {
        const criteria = { trackingCode: { $regex: /^advanced_test/ } };
        
        const result = await DataRetentionService.advancedAnonymization(
          'click_events',
          'partial',
          criteria,
          { preserveAnalytics: true, auditTrail: true }
        );

        expect(result.success).toBe(true);
        expect(result.recordsProcessed).toBe(2);
        expect(result.anonymizationMethod).toBe('partial');
        expect(result.preservedFields.length).toBeGreaterThan(0);

        // Verify partial anonymization
        const anonymizedEvents = await ClickEvent.find({ trackingCode: { $regex: /^advanced_test/ } });
        for (const event of anonymizedEvents) {
          expect(event.ipAddress).toBe('0.0.0.0');
          expect(event.userAgent).toBe('Anonymized');
          // Some fields should be preserved for analytics
        }
      });

      it('should perform pseudonymization', async () => {
        const criteria = { trackingCode: { $regex: /^advanced_test/ } };
        
        const result = await DataRetentionService.advancedAnonymization(
          'click_events',
          'pseudonymization',
          criteria,
          { auditTrail: true }
        );

        expect(result.success).toBe(true);
        expect(result.recordsProcessed).toBe(2);
        expect(result.anonymizationMethod).toBe('pseudonymization');

        // Verify pseudonymization
        const pseudonymizedEvents = await ClickEvent.find({ trackingCode: { $regex: /^advanced_test/ } });
        for (const event of pseudonymizedEvents) {
          expect(event.ipAddress).not.toBe('192.168.1.100');
          expect(event.ipAddress).not.toBe('192.168.1.101');
          expect(event.ipAddress).not.toBe('0.0.0.0');
          expect(event.userAgent).toBe('Pseudonymized');
          expect(event.fingerprint).not.toBe('advanced_fp_1');
          expect(event.fingerprint).not.toBe('advanced_fp_2');
        }
      });

      it('should handle conversion events with full anonymization', async () => {
        const criteria = { trackingCode: { $regex: /^advanced_conversion/ } };
        
        const result = await DataRetentionService.advancedAnonymization(
          'conversion_events',
          'full',
          criteria,
          { auditTrail: true }
        );

        expect(result.success).toBe(true);
        expect(result.recordsProcessed).toBe(2);

        // Verify full anonymization of conversion events
        const anonymizedEvents = await ConversionEvent.find({ trackingCode: { $regex: /^advanced_conversion/ } });
        for (const event of anonymizedEvents) {
          expect(event.ipAddress).toBe('0.0.0.0');
          expect(event.userAgent).toBe('Anonymized');
          expect(event.customerId).toMatch(/^anon_/);
        }
      });

      it('should handle user profiles with advanced anonymization', async () => {
        // Create test user profiles
        const user1 = await User.create({
          email: 'advanced.user1@test.com',
          password: 'password123',
          firstName: 'Advanced',
          lastName: 'User1',
          role: 'marketer',
          status: 'active',
          emailVerified: true,
          mfaEnabled: false,
          mfaSetupCompleted: false
        });

        const user2 = await User.create({
          email: 'advanced.user2@test.com',
          password: 'password123',
          firstName: 'Advanced',
          lastName: 'User2',
          role: 'marketer',
          status: 'active',
          emailVerified: true,
          mfaEnabled: false,
          mfaSetupCompleted: false
        });

        await UserProfile.create([
          {
            userId: user1._id,
            firstName: 'Advanced',
            lastName: 'User1',
            phone: '+1234567890',
            kycStatus: 'approved',
            complianceQuizPassed: true
          },
          {
            userId: user2._id,
            firstName: 'Advanced',
            lastName: 'User2',
            phone: '+1234567891',
            kycStatus: 'approved',
            complianceQuizPassed: true
          }
        ]);

        const criteria = { firstName: 'Advanced' };
        
        const result = await DataRetentionService.advancedAnonymization(
          'user_profiles',
          'partial',
          criteria,
          { auditTrail: true }
        );

        expect(result.success).toBe(true);
        expect(result.recordsProcessed).toBe(2);

        // Verify anonymization
        const anonymizedProfiles = await UserProfile.find({ userId: { $in: [user1._id, user2._id] } });
        for (const profile of anonymizedProfiles) {
          expect(profile.firstName).toBe('Anonymized User');
          expect(profile.lastName).toBe('');
          expect(profile.phone).toBe('');
        }
      });

      it('should handle errors gracefully during advanced anonymization', async () => {
        // Mock a database error
        const originalFind = ClickEvent.find;
        ClickEvent.find = jest.fn().mockRejectedValue(new Error('Database error during advanced anonymization'));

        const result = await DataRetentionService.advancedAnonymization(
          'click_events',
          'full',
          {},
          { auditTrail: true }
        );

        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('Database error');

        // Restore original method
        ClickEvent.find = originalFind;
      });

      it('should handle unsupported data types', async () => {
        const result = await DataRetentionService.advancedAnonymization(
          'unsupported_data_type',
          'full',
          {},
          { auditTrail: true }
        );

        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('Unsupported data type');
      });

      it('should disable audit trail when requested', async () => {
        const criteria = { trackingCode: { $regex: /^advanced_test/ } };
        
        const auditLogCountBefore = await AuditLog.countDocuments({ action: 'data_anonymization' });
        
        await DataRetentionService.advancedAnonymization(
          'click_events',
          'full',
          criteria,
          { auditTrail: false }
        );

        const auditLogCountAfter = await AuditLog.countDocuments({ action: 'data_anonymization' });
        
        // Should not create additional audit logs when auditTrail is false
        expect(auditLogCountAfter).toBe(auditLogCountBefore);
      });
    });

    describe('Data Retention Jobs Integration', () => {
      it('should execute complete retention workflow', async () => {
        // Create comprehensive test data
        const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        const veryOldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

        // Create old tracking data
        await ClickEvent.create([
          {
            trackingCode: 'workflow_click_1',
            ipAddress: '192.168.1.10',
            userAgent: 'Workflow Browser 1',
            timestamp: oldDate,
            sessionId: 'workflow_session_1',
            fingerprint: 'workflow_fp_1'
          },
          {
            trackingCode: 'workflow_click_2',
            ipAddress: '192.168.1.11',
            userAgent: 'Workflow Browser 2',
            timestamp: veryOldDate,
            sessionId: 'workflow_session_2',
            fingerprint: 'workflow_fp_2'
          }
        ]);

        await ConversionEvent.create([
          {
            trackingCode: 'workflow_conversion_1',
            customerId: 'workflow_customer_1',
            productId: 'product_1',
            initialSpendAmount: 1000,
            conversionTimestamp: oldDate,
            attributionMethod: 'cookie',
            ipAddress: '192.168.1.20',
            userAgent: 'Workflow Conversion Browser',
            deduplicationKey: 'workflow_dedup_1'
          }
        ]);

        // Create inactive user
        const inactiveUser = await User.create({
          email: 'workflow.inactive@test.com',
          password: 'password123',
          firstName: 'Workflow',
          lastName: 'Inactive',
          role: 'marketer',
          status: 'active',
          emailVerified: true,
          mfaEnabled: false,
          mfaSetupCompleted: false,
          lastLogin: veryOldDate
        });

        // Step 1: Check compliance before retention
        const complianceBefore = await DataRetentionService.performComplianceCheck();
        expect(complianceBefore.compliant).toBe(false);
        expect(complianceBefore.summary.highSeverityIssues).toBeGreaterThan(0);

        // Step 2: Execute retention policies
        const retentionReports = await DataRetentionService.executeRetentionPolicies();
        expect(retentionReports.length).toBeGreaterThan(0);

        const trackingReport = retentionReports.find(r => r.policyName === 'user_tracking_data');
        expect(trackingReport).toBeDefined();
        expect(trackingReport!.recordsProcessed).toBeGreaterThan(0);

        // Step 3: Verify data was anonymized
        const anonymizedClickEvents = await ClickEvent.find({ ipAddress: '0.0.0.0' });
        expect(anonymizedClickEvents.length).toBeGreaterThan(0);

        const anonymizedConversionEvents = await ConversionEvent.find({ ipAddress: '0.0.0.0' });
        expect(anonymizedConversionEvents.length).toBeGreaterThan(0);

        // Step 4: Check compliance after retention
        const complianceAfter = await DataRetentionService.performComplianceCheck();
        expect(complianceAfter.summary.highSeverityIssues).toBeLessThan(complianceBefore.summary.highSeverityIssues);

        // Step 5: Verify audit trail
        const auditLogs = await AuditLog.find({ 
          action: { $in: ['retention_policy_started', 'retention_policy_completed', 'data_anonymization'] }
        });
        expect(auditLogs.length).toBeGreaterThan(0);
      });

      it('should handle mixed data scenarios correctly', async () => {
        const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        
        // Create mix of anonymized and non-anonymized data
        await ClickEvent.create([
          {
            trackingCode: 'mixed_1',
            ipAddress: '192.168.1.50', // Not anonymized
            userAgent: 'Mixed Browser 1',
            timestamp: oldDate,
            sessionId: 'mixed_session_1',
            fingerprint: 'mixed_fp_1'
          },
          {
            trackingCode: 'mixed_2',
            ipAddress: '0.0.0.0', // Already anonymized
            userAgent: 'Anonymized',
            timestamp: oldDate,
            sessionId: 'anonymized',
            fingerprint: 'anonymized'
          }
        ]);

        const reports = await DataRetentionService.executeRetentionPolicies();
        const trackingReport = reports.find(r => r.policyName === 'user_tracking_data');
        
        expect(trackingReport).toBeDefined();
        expect(trackingReport!.recordsProcessed).toBe(2); // Both processed
        expect(trackingReport!.recordsAnonymized).toBe(1); // Only one needed anonymization
      });

      it('should maintain data integrity during retention operations', async () => {
        const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        
        // Create conversion event with commission
        const conversionEvent = await ConversionEvent.create({
          trackingCode: 'integrity_test',
          customerId: 'integrity_customer',
          productId: 'product_1',
          initialSpendAmount: 1000,
          conversionTimestamp: oldDate,
          attributionMethod: 'cookie',
          ipAddress: '192.168.1.100',
          userAgent: 'Integrity Browser',
          deduplicationKey: 'integrity_dedup'
        });

        const commission = await Commission.create({
          marketerId: 'marketer_integrity',
          customerId: 'integrity_customer',
          productId: 'product_1',
          trackingCode: 'integrity_test',
          initialSpendAmount: 1000,
          commissionRate: 0.05,
          commissionAmount: 50,
          status: 'paid',
          conversionDate: new Date(Date.now() - 2000 * 24 * 60 * 60 * 1000), // Very old for commission anonymization
          clearancePeriodDays: 30
        });

        await DataRetentionService.executeRetentionPolicies();

        // Verify conversion event was anonymized
        const updatedConversionEvent = await ConversionEvent.findById(conversionEvent._id);
        expect(updatedConversionEvent?.ipAddress).toBe('0.0.0.0');

        // Verify commission customer ID was anonymized but commission structure preserved
        const updatedCommission = await Commission.findById(commission._id);
        expect(updatedCommission?.customerId).toMatch(/^anon_/);
        expect(updatedCommission?.commissionAmount).toBe(50); // Financial data preserved
        expect(updatedCommission?.status).toBe('paid'); // Status preserved
      });
    });

    describe('Audit Logging for Data Processing', () => {
      it('should log all data processing activities', async () => {
        const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        
        await ClickEvent.create({
          trackingCode: 'audit_test',
          ipAddress: '192.168.1.200',
          userAgent: 'Audit Test Browser',
          timestamp: oldDate,
          sessionId: 'audit_session',
          fingerprint: 'audit_fp'
        });

        // Clear existing audit logs
        await AuditLog.deleteMany({});

        // Execute retention policies
        await DataRetentionService.executeRetentionPolicies();

        // Verify audit logs were created
        const auditLogs = await AuditLog.find({}).sort({ timestamp: 1 });
        expect(auditLogs.length).toBeGreaterThan(0);

        // Check for policy start logs
        const policyStartLogs = auditLogs.filter(log => log.action === 'retention_policy_started');
        expect(policyStartLogs.length).toBeGreaterThan(0);

        // Check for policy completion logs
        const policyCompletionLogs = auditLogs.filter(log => log.action === 'retention_policy_completed');
        expect(policyCompletionLogs.length).toBeGreaterThan(0);

        // Check for anonymization logs
        const anonymizationLogs = auditLogs.filter(log => log.action === 'data_anonymization');
        expect(anonymizationLogs.length).toBeGreaterThan(0);

        // Verify log structure
        for (const log of auditLogs) {
          expect(log.adminId).toBe('system');
          expect(log.resource).toBe('system');
          expect(log.details).toBeDefined();
          expect(log.details.reason).toBeDefined();
          expect(log.timestamp).toBeInstanceOf(Date);
        }
      });

      it('should log field-level anonymization activities', async () => {
        const user = await User.create({
          email: 'field.audit@test.com',
          password: 'password123',
          firstName: 'Field',
          lastName: 'Audit',
          role: 'marketer',
          status: 'active',
          emailVerified: true,
          mfaEnabled: false,
          mfaSetupCompleted: false
        });

        await DataRetentionService.anonymizeDataFields(
          'users',
          user._id.toString(),
          ['firstName', 'lastName'],
          'Test field anonymization audit'
        );

        const auditLog = await AuditLog.findOne({ action: 'field_rectification' });
        expect(auditLog).toBeDefined();
        expect(auditLog!.details.reason).toContain('Field-level anonymization completed');
        expect(auditLog!.details.metadata.collection).toBe('users');
        expect(auditLog!.details.metadata.fieldsAnonymized).toEqual(['firstName', 'lastName']);
        expect(auditLog!.details.metadata.reason).toBe('Test field anonymization audit');
      });

      it('should log compliance check activities', async () => {
        await DataRetentionService.performComplianceCheck();

        const auditLog = await AuditLog.findOne({ action: 'data_retention_check' });
        expect(auditLog).toBeDefined();
        expect(auditLog!.details.reason).toContain('compliance check completed');
        expect(auditLog!.details.metadata.compliant).toBeDefined();
        expect(auditLog!.details.metadata.totalIssues).toBeDefined();
      });

      it('should log bulk anonymization activities', async () => {
        const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        
        await ClickEvent.create([
          {
            trackingCode: 'bulk_audit_1',
            ipAddress: '192.168.1.100',
            userAgent: 'Bulk Browser 1',
            timestamp: oldDate,
            sessionId: 'bulk_session_1',
            fingerprint: 'bulk_fp_1'
          },
          {
            trackingCode: 'bulk_audit_2',
            ipAddress: '192.168.1.101',
            userAgent: 'Bulk Browser 2',
            timestamp: oldDate,
            sessionId: 'bulk_session_2',
            fingerprint: 'bulk_fp_2'
          }
        ]);

        await DataRetentionService.bulkAnonymization(
          'click_events',
          { trackingCode: { $regex: /^bulk_audit/ } },
          2
        );

        const auditLog = await AuditLog.findOne({ 
          action: 'data_anonymization',
          'details.reason': { $regex: /Bulk anonymization completed/ }
        });
        expect(auditLog).toBeDefined();
        expect(auditLog!.details.metadata.dataType).toBe('click_events');
        expect(auditLog!.details.metadata.totalProcessed).toBeGreaterThan(0);
      });

      it('should maintain audit trail integrity', async () => {
        const beforeCount = await AuditLog.countDocuments();
        
        // Perform multiple operations
        await DataRetentionService.performComplianceCheck();
        await DataRetentionService.executeRetentionPolicies();
        
        const afterCount = await AuditLog.countDocuments();
        expect(afterCount).toBeGreaterThan(beforeCount);

        // Verify all audit logs have required fields
        const auditLogs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(10);
        for (const log of auditLogs) {
          expect(log.adminId).toBeDefined();
          expect(log.action).toBeDefined();
          expect(log.resource).toBeDefined();
          expect(log.details).toBeDefined();
          expect(log.timestamp).toBeInstanceOf(Date);
        }
      });
    });

    describe('Error Handling and Recovery', () => {
      it('should handle database connection errors gracefully', async () => {
        // Mock database connection error
        const originalFind = ClickEvent.find;
        ClickEvent.find = jest.fn().mockRejectedValue(new Error('Database connection lost'));

        const result = await DataRetentionService.executeRetentionPolicies();
        
        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
        
        const trackingReport = result.find(r => r.policyName === 'user_tracking_data');
        expect(trackingReport).toBeDefined();
        expect(trackingReport!.errors.length).toBeGreaterThan(0);
        expect(trackingReport!.errors[0]).toContain('Database connection lost');

        // Restore original method
        ClickEvent.find = originalFind;
      });

      it('should continue processing other policies when one fails', async () => {
        // Mock error for click events only
        const originalClickEventFind = ClickEvent.find;
        ClickEvent.find = jest.fn().mockRejectedValue(new Error('Click event processing failed'));

        const result = await DataRetentionService.executeRetentionPolicies();
        
        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
        
        // Should have reports for all policies, even if some failed
        const trackingReport = result.find(r => r.policyName === 'user_tracking_data');
        expect(trackingReport).toBeDefined();
        expect(trackingReport!.errors.length).toBeGreaterThan(0);

        // Other policies should still execute
        const auditReport = result.find(r => r.policyName === 'audit_logs');
        expect(auditReport).toBeDefined();

        // Restore original method
        ClickEvent.find = originalClickEventFind;
      });

      it('should handle partial failures in bulk operations', async () => {
        const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        
        // Create test data
        const events = await ClickEvent.create([
          {
            trackingCode: 'partial_fail_1',
            ipAddress: '192.168.1.100',
            userAgent: 'Browser 1',
            timestamp: oldDate,
            sessionId: 'session_1',
            fingerprint: 'fp_1'
          },
          {
            trackingCode: 'partial_fail_2',
            ipAddress: '192.168.1.101',
            userAgent: 'Browser 2',
            timestamp: oldDate,
            sessionId: 'session_2',
            fingerprint: 'fp_2'
          }
        ]);

        // Mock partial failure
        const originalFindByIdAndUpdate = ClickEvent.findByIdAndUpdate;
        let callCount = 0;
        ClickEvent.findByIdAndUpdate = jest.fn().mockImplementation((id, update) => {
          callCount++;
          if (callCount === 1) {
            throw new Error('First update failed');
          }
          return originalFindByIdAndUpdate.call(ClickEvent, id, update);
        });

        const result = await DataRetentionService.bulkAnonymization(
          'click_events',
          { trackingCode: { $regex: /^partial_fail/ } },
          1
        );

        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.totalProcessed).toBe(2);
        expect(result.totalAnonymized).toBe(1); // Only one succeeded

        // Restore original method
        ClickEvent.findByIdAndUpdate = originalFindByIdAndUpdate;
      });

      it('should validate input parameters', async () => {
        // Test invalid data type
        const result1 = await DataRetentionService.manualAnonymization('invalid_type', 90, true);
        expect(result1.success).toBe(false);
        expect(result1.errors.length).toBeGreaterThan(0);

        // Test invalid field anonymization
        const result2 = await DataRetentionService.anonymizeDataFields(
          'invalid_collection',
          'test_id',
          ['field1'],
          'test'
        );
        expect(result2.success).toBe(false);
        expect(result2.errors.length).toBeGreaterThan(0);

        // Test invalid policy
        const invalidPolicy = {
          name: '',
          description: '',
          retentionPeriodDays: -1,
          dataTypes: [],
          isActive: true
        };
        const result3 = await DataRetentionService.createRetentionPolicy(invalidPolicy);
        expect(result3.success).toBe(false);
        expect(result3.errors.length).toBeGreaterThan(0);
      });
    });
  });
});