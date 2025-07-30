import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { GDPRService, DataRectificationRequest } from '../index';
import { User } from '../../../models/User';
import { UserProfile } from '../../../models/UserProfile';
import { Consent } from '../../../models/Consent';
import { Commission } from '../../../models/Commission';
import { PayoutRequest } from '../../../models/PayoutRequest';
import { PaymentMethod } from '../../../models/PaymentMethod';
import { ReferralLink } from '../../../models/ReferralLink';
import { ClickEvent } from '../../../models/ClickEvent';
import { ConversionEvent } from '../../../models/ConversionEvent';
import { AuditLog } from '../../../models/AuditLog';
import { DataAccessRequest } from '../../../models/DataAccessRequest';

describe('GDPRService', () => {
  let mongoServer: MongoMemoryServer;
  let testUserId: string;
  let testUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear all collections
    await Promise.all([
      User.deleteMany({}),
      UserProfile.deleteMany({}),
      Consent.deleteMany({}),
      Commission.deleteMany({}),
      PayoutRequest.deleteMany({}),
      PaymentMethod.deleteMany({}),
      ReferralLink.deleteMany({}),
      ClickEvent.deleteMany({}),
      ConversionEvent.deleteMany({}),
      AuditLog.deleteMany({}),
      DataAccessRequest.deleteMany({})
    ]);

    // Create test user
    testUser = new User({
      email: 'test@example.com',
      password: 'hashedpassword',
      firstName: 'John',
      lastName: 'Doe',
      role: 'marketer',
      status: 'active',
      emailVerified: true
    });
    await testUser.save();
    testUserId = testUser._id.toString();

    // Create test profile
    const profile = new UserProfile({
      userId: testUserId,
      firstName: 'John',
      lastName: 'Doe',
      phone: '+1234567890',
      address: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TC',
        postalCode: '12345',
        country: 'US'
      },
      kycStatus: 'approved'
    });
    await profile.save();

    // Create test data in various collections
    await Promise.all([
      new Consent({
        userId: testUserId,
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        consentTypes: {
          necessary: true,
          analytics: false,
          marketing: true,
          preferences: false
        },
        consentMethod: 'registration',
        dataProcessingPurposes: ['marketing', 'analytics']
      }).save(),
      
      new Commission({
        marketerId: testUserId,
        customerId: new mongoose.Types.ObjectId(),
        productId: new mongoose.Types.ObjectId(),
        trackingCode: 'test-tracking-123',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'approved',
        conversionDate: new Date()
      }).save(),
      

      
      new ReferralLink({
        marketerId: testUserId,
        productId: new mongoose.Types.ObjectId(),
        trackingCode: 'ref-123',
        linkUrl: 'https://example.com/ref/123',
        isActive: true
      }).save(),
      
      new ClickEvent({
        trackingCode: 'ref-123',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        sessionId: 'test-session-123',
        timestamp: new Date()
      }).save(),
      
      new ConversionEvent({
        customerId: new mongoose.Types.ObjectId().toString(),
        productId: new mongoose.Types.ObjectId().toString(),
        trackingCode: 'ref-123',
        initialSpendAmount: 1000,
        conversionTimestamp: new Date(),
        attributionMethod: 'cookie',
        commissionEligible: true,
        deduplicationKey: `test-dedup-${Date.now()}`
      }).save()
    ]);
  });

  describe('exportUserData', () => {
    it('should export all user data successfully', async () => {
      const exportData = await GDPRService.exportUserData(testUserId);

      expect(exportData).toBeDefined();
      expect(exportData.user).toBeDefined();
      expect(exportData.user.email).toBe('test@example.com');
      expect(exportData.profile).toBeDefined();
      expect(exportData.profile.firstName).toBe('John');
      expect(exportData.consents).toHaveLength(1);
      expect(exportData.commissions).toHaveLength(1);
      expect(exportData.paymentMethods).toHaveLength(0);
      expect(exportData.referralLinks).toHaveLength(1);
      expect(exportData.clickEvents).toHaveLength(1);
      expect(exportData.conversionEvents).toHaveLength(1);
      expect(exportData.exportedAt).toBeInstanceOf(Date);
      expect(exportData.exportVersion).toBe('1.0');
    });

    it('should throw error for invalid user ID', async () => {
      await expect(GDPRService.exportUserData('invalid-id')).rejects.toThrow('Invalid user ID');
    });

    it('should throw error for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      await expect(GDPRService.exportUserData(nonExistentId)).rejects.toThrow('User not found');
    });

    it('should create audit log for data export', async () => {
      await GDPRService.exportUserData(testUserId);

      const auditLogs = await AuditLog.find({ userId: testUserId, action: 'data_export' });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].details).toBe('User data exported for portability');
    });
  });

  describe('deleteUserData', () => {
    it('should delete all user data successfully', async () => {
      await GDPRService.deleteUserData(testUserId, 'User requested deletion');

      // Verify all data is deleted
      const [
        user,
        profile,
        consents,
        commissions,
        payouts,
        paymentMethods,
        referralLinks,
        clickEvents,
        conversionEvents
      ] = await Promise.all([
        User.findById(testUserId),
        UserProfile.findOne({ userId: testUserId }),
        Consent.find({ userId: testUserId }),
        Commission.find({ marketerId: testUserId }),
        PayoutRequest.find({ marketerId: testUserId }),
        PaymentMethod.find({ userId: testUserId }),
        ReferralLink.find({ marketerId: testUserId }),
        ClickEvent.find({ trackingCode: 'ref-123' }),
        ConversionEvent.find({ trackingCode: 'ref-123' })
      ]);

      expect(user).toBeNull();
      expect(profile).toBeNull();
      expect(consents).toHaveLength(0);
      expect(commissions).toHaveLength(0);
      expect(payouts).toHaveLength(0);
      expect(paymentMethods).toHaveLength(0);
      expect(referralLinks).toHaveLength(0);
      expect(clickEvents).toHaveLength(0);
      expect(conversionEvents).toHaveLength(0);
    });

    it('should throw error for invalid user ID', async () => {
      await expect(GDPRService.deleteUserData('invalid-id')).rejects.toThrow('Invalid user ID');
    });

    it('should throw error for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      await expect(GDPRService.deleteUserData(nonExistentId)).rejects.toThrow('User not found');
    });
  });

  describe('anonymizeUserData', () => {
    it('should anonymize user data successfully', async () => {
      await GDPRService.anonymizeUserData(testUserId, 'Data retention period expired');

      // Verify user data is anonymized
      const user = await User.findById(testUserId);
      const profile = await UserProfile.findOne({ userId: testUserId });
      const clickEvents = await ClickEvent.find({ trackingCode: 'ref-123' });
      const consents = await Consent.find({ userId: testUserId });

      expect(user).toBeDefined();
      expect(user!.email).toMatch(/^anonymized_\d+@deleted\.local$/);
      expect(user!.firstName).toBe('Anonymized User');
      expect(user!.lastName).toBe('');
      expect(user!.status).toBe('revoked');
      expect(user!.emailVerified).toBe(false);
      expect(user!.mfaEnabled).toBe(false);

      expect(profile).toBeDefined();
      expect(profile!.firstName).toBe('Anonymized User');
      expect(profile!.lastName).toBe('');
      expect(profile!.phone).toBe('');
      expect(profile!.address).toBe('');

      expect(clickEvents[0].ipAddress).toBe('0.0.0.0');
      expect(clickEvents[0].userAgent).toBe('Anonymized');

      expect(consents[0].ipAddress).toBe('0.0.0.0');
      expect(consents[0].userAgent).toBe('Anonymized');
    });

    it('should throw error for invalid user ID', async () => {
      await expect(GDPRService.anonymizeUserData('invalid-id')).rejects.toThrow('Invalid user ID');
    });

    it('should throw error for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      await expect(GDPRService.anonymizeUserData(nonExistentId)).rejects.toThrow('User not found');
    });
  });

  describe('rectifyUserData', () => {
    it('should rectify user data successfully', async () => {
      const rectifications: DataRectificationRequest[] = [
        {
          field: 'firstName',
          oldValue: 'John',
          newValue: 'Jane',
          reason: 'Name change'
        },
        {
          field: 'profile.phone',
          oldValue: '+1234567890',
          newValue: '+0987654321',
          reason: 'Phone number update'
        }
      ];

      await GDPRService.rectifyUserData(testUserId, rectifications);

      // Verify rectifications were applied
      const user = await User.findById(testUserId);
      const profile = await UserProfile.findOne({ userId: testUserId });

      expect(user!.firstName).toBe('Jane');
      expect(profile!.phone).toBe('+0987654321');

      // Verify audit logs were created
      const auditLogs = await AuditLog.find({ 
        userId: testUserId, 
        action: 'field_rectification' 
      });
      expect(auditLogs).toHaveLength(2);
    });

    it('should throw error for invalid field', async () => {
      const rectifications: DataRectificationRequest[] = [
        {
          field: 'invalidField',
          oldValue: 'old',
          newValue: 'new'
        }
      ];

      await expect(GDPRService.rectifyUserData(testUserId, rectifications))
        .rejects.toThrow("Field 'invalidField' cannot be rectified");
    });

    it('should throw error for invalid user ID', async () => {
      const rectifications: DataRectificationRequest[] = [
        {
          field: 'firstName',
          oldValue: 'John',
          newValue: 'Jane'
        }
      ];

      await expect(GDPRService.rectifyUserData('invalid-id', rectifications))
        .rejects.toThrow('Invalid user ID');
    });
  });

  describe('getUserDataSummary', () => {
    it('should return user data summary successfully', async () => {
      const summary = await GDPRService.getUserDataSummary(testUserId);

      expect(summary).toBeDefined();
      expect(summary.userId).toBe(testUserId);
      expect(summary.email).toBe('test@example.com');
      expect(summary.dataCategories.profile).toBe(1);
      expect(summary.dataCategories.consents).toBe(1);
      expect(summary.dataCategories.commissions).toBe(1);
      expect(summary.dataCategories.paymentMethods).toBe(0);
      expect(summary.dataCategories.referralLinks).toBe(1);
      expect(summary.dataCategories.clickEvents).toBe(1);
      expect(summary.dataCategories.conversionEvents).toBe(1);
      expect(summary.totalRecords).toBeGreaterThan(0);
      expect(summary.accountStatus).toBe('active');
    });

    it('should throw error for invalid user ID', async () => {
      await expect(GDPRService.getUserDataSummary('invalid-id')).rejects.toThrow('Invalid user ID');
    });

    it('should throw error for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      await expect(GDPRService.getUserDataSummary(nonExistentId)).rejects.toThrow('User not found');
    });
  });

  describe('canDeleteUserData', () => {
    it('should allow deletion when no restrictions exist', async () => {
      const result = await GDPRService.canDeleteUserData(testUserId);
      expect(result.canDelete).toBe(true);
    });

    it('should prevent deletion when pending payouts exist', async () => {
      // Create a pending payout
      await new PayoutRequest({
        marketerId: testUserId,
        paymentMethodId: new mongoose.Types.ObjectId(),
        amount: 100,
        status: 'requested'
      }).save();

      const result = await GDPRService.canDeleteUserData(testUserId);
      expect(result.canDelete).toBe(false);
      expect(result.reason).toBe('Cannot delete user with pending payout requests');
    });

    it('should prevent deletion when recent commissions exist', async () => {
      // Create a recent commission (within 30 days)
      await new Commission({
        marketerId: testUserId,
        customerId: new mongoose.Types.ObjectId(),
        productId: new mongoose.Types.ObjectId(),
        trackingCode: 'recent-123',
        initialSpendAmount: 500,
        commissionRate: 0.05,
        commissionAmount: 25,
        status: 'pending',
        createdAt: new Date() // Current date
      }).save();

      const result = await GDPRService.canDeleteUserData(testUserId);
      expect(result.canDelete).toBe(false);
      expect(result.reason).toBe('Cannot delete user with recent commission activity (within 30 days)');
    });

    it('should return false for invalid user ID', async () => {
      const result = await GDPRService.canDeleteUserData('invalid-id');
      expect(result.canDelete).toBe(false);
      expect(result.reason).toBe('Invalid user ID');
    });

    it('should return false for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const result = await GDPRService.canDeleteUserData(nonExistentId);
      expect(result.canDelete).toBe(false);
      expect(result.reason).toBe('User not found');
    });
  });

  describe('validateDataExportRequest', () => {
    it('should return true for valid user ID', async () => {
      const isValid = await GDPRService.validateDataExportRequest(testUserId);
      expect(isValid).toBe(true);
    });

    it('should return false for invalid user ID', async () => {
      const isValid = await GDPRService.validateDataExportRequest('invalid-id');
      expect(isValid).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const isValid = await GDPRService.validateDataExportRequest(nonExistentId);
      expect(isValid).toBe(false);
    });
  });
});