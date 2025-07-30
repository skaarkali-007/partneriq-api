import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ConsentService } from '../index';
import { Consent } from '../../../models/Consent';
import { DataAccessRequest } from '../../../models/DataAccessRequest';
import { User } from '../../../models/User';

describe('ConsentService', () => {
  let mongoServer: MongoMemoryServer;

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
    await User.deleteMany({});
    await Consent.deleteMany({});
    await DataAccessRequest.deleteMany({});
  });

  describe('recordConsent', () => {
    it('should record consent for authenticated user', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      const consentOptions = {
        userId: user._id.toString(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: true,
          marketing: false,
          preferences: true
        },
        consentMethod: 'banner' as const,
        dataProcessingPurposes: ['account_management', 'analytics']
      };

      const consent = await ConsentService.recordConsent(consentOptions);

      expect(consent).toBeDefined();
      expect(consent.userId).toBe(user._id.toString());
      expect(consent.consentTypes.necessary).toBe(true);
      expect(consent.consentTypes.analytics).toBe(true);
      expect(consent.consentTypes.marketing).toBe(false);
      expect(consent.consentTypes.preferences).toBe(true);
      expect(consent.dataProcessingPurposes).toEqual(['account_management', 'analytics']);
    });

    it('should record consent for anonymous user with session ID', async () => {
      const sessionId = ConsentService.generateSessionId();
      
      const consentOptions = {
        sessionId,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: false,
          marketing: false,
          preferences: false
        },
        consentMethod: 'banner' as const,
        dataProcessingPurposes: ['service_provision']
      };

      const consent = await ConsentService.recordConsent(consentOptions);

      expect(consent).toBeDefined();
      expect(consent.sessionId).toBe(sessionId);
      expect(consent.userId).toBeUndefined();
      expect(consent.consentTypes.necessary).toBe(true);
      expect(consent.consentTypes.analytics).toBe(false);
    });

    it('should update existing consent for authenticated user', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      // Record initial consent
      const initialOptions = {
        userId: user._id.toString(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: false,
          marketing: false,
          preferences: false
        },
        consentMethod: 'banner' as const,
        dataProcessingPurposes: ['account_management']
      };

      await ConsentService.recordConsent(initialOptions);

      // Update consent
      const updatedOptions = {
        userId: user._id.toString(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: true,
          marketing: true,
          preferences: true
        },
        consentMethod: 'settings' as const,
        dataProcessingPurposes: ['account_management', 'analytics', 'marketing']
      };

      const updatedConsent = await ConsentService.recordConsent(updatedOptions);

      expect(updatedConsent.consentTypes.analytics).toBe(true);
      expect(updatedConsent.consentTypes.marketing).toBe(true);
      expect(updatedConsent.consentMethod).toBe('settings');
      expect(updatedConsent.dataProcessingPurposes).toEqual(['account_management', 'analytics', 'marketing']);
    });
  });

  describe('getCurrentConsent', () => {
    it('should get current consent for authenticated user', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      // Record consent
      const consentOptions = {
        userId: user._id.toString(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: true,
          marketing: false,
          preferences: true
        },
        consentMethod: 'banner' as const,
        dataProcessingPurposes: ['account_management', 'analytics']
      };

      await ConsentService.recordConsent(consentOptions);

      const currentConsent = await ConsentService.getCurrentConsent(user._id.toString());

      expect(currentConsent).toBeDefined();
      expect(currentConsent!.userId).toBe(user._id.toString());
      expect(currentConsent!.consentTypes.analytics).toBe(true);
    });

    it('should get current consent for anonymous user by session ID', async () => {
      const sessionId = ConsentService.generateSessionId();
      
      const consentOptions = {
        sessionId,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: false,
          marketing: false,
          preferences: false
        },
        consentMethod: 'banner' as const,
        dataProcessingPurposes: ['service_provision']
      };

      await ConsentService.recordConsent(consentOptions);

      const currentConsent = await ConsentService.getCurrentConsent(undefined, sessionId);

      expect(currentConsent).toBeDefined();
      expect(currentConsent!.sessionId).toBe(sessionId);
      expect(currentConsent!.consentTypes.necessary).toBe(true);
    });

    it('should return null when no consent found', async () => {
      const currentConsent = await ConsentService.getCurrentConsent('nonexistent-user-id');
      expect(currentConsent).toBeNull();
    });
  });

  describe('withdrawConsent', () => {
    it('should withdraw consent for user', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      // Record consent
      const consentOptions = {
        userId: user._id.toString(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: true,
          marketing: true,
          preferences: true
        },
        consentMethod: 'banner' as const,
        dataProcessingPurposes: ['account_management', 'analytics', 'marketing']
      };

      await ConsentService.recordConsent(consentOptions);

      // Withdraw consent
      await ConsentService.withdrawConsent(user._id.toString(), 'User requested withdrawal');

      // Check that consent is withdrawn
      const withdrawnConsent = await Consent.findOne({ userId: user._id.toString() });
      expect(withdrawnConsent!.isWithdrawn).toBe(true);
      expect(withdrawnConsent!.withdrawalTimestamp).toBeDefined();

      // Check that getCurrentConsent returns null for withdrawn consent
      const currentConsent = await ConsentService.getCurrentConsent(user._id.toString());
      expect(currentConsent).toBeNull();
    });
  });

  describe('hasConsentForPurpose', () => {
    it('should return true when user has consent for purpose', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      // Record consent
      const consentOptions = {
        userId: user._id.toString(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: true,
          marketing: false,
          preferences: true
        },
        consentMethod: 'banner' as const,
        dataProcessingPurposes: ['account_management', 'analytics']
      };

      await ConsentService.recordConsent(consentOptions);

      const hasAnalyticsConsent = await ConsentService.hasConsentForPurpose(user._id.toString(), 'analytics');
      const hasMarketingConsent = await ConsentService.hasConsentForPurpose(user._id.toString(), 'marketing');

      expect(hasAnalyticsConsent).toBe(true);
      expect(hasMarketingConsent).toBe(false);
    });

    it('should return false when user has no consent record', async () => {
      const hasConsent = await ConsentService.hasConsentForPurpose('nonexistent-user-id', 'analytics');
      expect(hasConsent).toBe(false);
    });
  });

  describe('getConsentHistory', () => {
    it('should return consent history for user', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      // Record first consent
      const consent1Options = {
        userId: user._id.toString(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: false,
          marketing: false,
          preferences: false
        },
        consentMethod: 'banner' as const,
        dataProcessingPurposes: ['account_management']
      };

      const consent1 = new Consent(consent1Options);
      await consent1.save();

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      // Record second consent
      const consent2Options = {
        userId: user._id.toString(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        consentTypes: {
          necessary: true,
          analytics: true,
          marketing: true,
          preferences: true
        },
        consentMethod: 'settings' as const,
        dataProcessingPurposes: ['account_management', 'analytics', 'marketing']
      };

      const consent2 = new Consent(consent2Options);
      await consent2.save();

      const history = await ConsentService.getConsentHistory(user._id.toString());

      expect(history).toHaveLength(2);
      expect(history[0].consentMethod).toBe('settings'); // Most recent first
      expect(history[1].consentMethod).toBe('banner');
    });
  });

  describe('createDataAccessRequest', () => {
    it('should create data access request for valid user', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      const request = await ConsentService.createDataAccessRequest(
        user._id.toString(),
        'access',
        'I want to access all my personal data',
        ['profile_data', 'commission_data']
      );

      expect(request).toBeDefined();
      expect(request.userId).toBe(user._id.toString());
      expect(request.requestType).toBe('access');
      expect(request.requestDetails).toBe('I want to access all my personal data');
      expect(request.requestedData).toEqual(['profile_data', 'commission_data']);
      expect(request.status).toBe('pending');
      expect(request.isVerified).toBe(false);
    });

    it('should throw error for non-existent user', async () => {
      await expect(
        ConsentService.createDataAccessRequest(
          'nonexistent-user-id',
          'access',
          'Test request'
        )
      ).rejects.toThrow('User not found');
    });

    it('should throw error for duplicate pending request', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      // Create first request
      await ConsentService.createDataAccessRequest(
        user._id.toString(),
        'access',
        'First request'
      );

      // Try to create duplicate request
      await expect(
        ConsentService.createDataAccessRequest(
          user._id.toString(),
          'access',
          'Second request'
        )
      ).rejects.toThrow('You already have a pending access request');
    });
  });

  describe('verifyDataAccessRequest', () => {
    it('should verify data access request with valid token', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      // Create request
      const request = await ConsentService.createDataAccessRequest(
        user._id.toString(),
        'access',
        'Test request'
      );

      // Get the verification token (this would normally be sent via email)
      const requestDoc = await DataAccessRequest.findById(request._id).select('+verificationToken');
      const hashedToken = requestDoc!.verificationToken!;
      
      // Find the original token by creating a new one and comparing hashes
      // In a real scenario, the token would be sent via email
      const crypto = require('crypto');
      let originalToken = '';
      for (let i = 0; i < 1000; i++) {
        const testToken = crypto.randomBytes(32).toString('hex');
        const testHash = crypto.createHash('sha256').update(testToken).digest('hex');
        if (testHash === hashedToken) {
          originalToken = testToken;
          break;
        }
      }

      // For testing, we'll create a new token and update the request
      const newToken = crypto.randomBytes(32).toString('hex');
      const newHashedToken = crypto.createHash('sha256').update(newToken).digest('hex');
      
      await DataAccessRequest.findByIdAndUpdate(request._id, {
        verificationToken: newHashedToken,
        verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });

      const verifiedRequest = await ConsentService.verifyDataAccessRequest(newToken);

      expect(verifiedRequest).toBeDefined();
      expect(verifiedRequest.isVerified).toBe(true);
      expect(verifiedRequest.verificationToken).toBeUndefined();
    });

    it('should throw error for invalid token', async () => {
      await expect(
        ConsentService.verifyDataAccessRequest('invalid-token')
      ).rejects.toThrow('Invalid or expired verification token');
    });
  });

  describe('getDataAccessRequests', () => {
    it('should return data access requests for user', async () => {
      // Create a test user
      const user = new User({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'marketer'
      });
      await user.save();

      // Create multiple requests
      await ConsentService.createDataAccessRequest(
        user._id.toString(),
        'access',
        'First request'
      );

      await ConsentService.createDataAccessRequest(
        user._id.toString(),
        'erasure',
        'Second request'
      );

      const requests = await ConsentService.getDataAccessRequests(user._id.toString());

      expect(requests).toHaveLength(2);
      expect(requests[0].requestType).toBe('erasure'); // Most recent first
      expect(requests[1].requestType).toBe('access');
    });
  });

  describe('extractRequestInfo', () => {
    it('should extract IP address and user agent from request', async () => {
      const mockReq = {
        headers: {
          'x-forwarded-for': '192.168.1.1, 10.0.0.1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        connection: {},
        socket: {}
      } as any;

      const { ipAddress, userAgent } = ConsentService.extractRequestInfo(mockReq);

      expect(ipAddress).toBe('192.168.1.1');
      expect(userAgent).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    });

    it('should handle missing headers gracefully', async () => {
      const mockReq = {
        headers: {},
        connection: { remoteAddress: '127.0.0.1' },
        socket: {}
      } as any;

      const { ipAddress, userAgent } = ConsentService.extractRequestInfo(mockReq);

      expect(ipAddress).toBe('127.0.0.1');
      expect(userAgent).toBe('Unknown');
    });
  });

  describe('generateSessionId', () => {
    it('should generate unique session IDs', async () => {
      const sessionId1 = ConsentService.generateSessionId();
      const sessionId2 = ConsentService.generateSessionId();

      expect(sessionId1).toBeDefined();
      expect(sessionId2).toBeDefined();
      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).toHaveLength(64); // 32 bytes * 2 (hex)
    });
  });
});