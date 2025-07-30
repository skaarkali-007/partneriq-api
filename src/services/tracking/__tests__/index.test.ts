import { TrackingService } from '../index';
import { ReferralLink } from '../../../models/ReferralLink';
import { User } from '../../../models/User';
import { Product } from '../../../models/Product';
import { connectDatabase } from '../../../config/database';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

describe('TrackingService', () => {
  let mongoServer: MongoMemoryServer;
  let testMarketer: any;
  let testProduct: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    process.env.MONGODB_URI = mongoUri;
    await connectDatabase();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean up collections
    await User.deleteMany({});
    await Product.deleteMany({});
    await ReferralLink.deleteMany({});

    // Create test marketer
    testMarketer = await User.create({
      email: 'marketer@test.com',
      password: 'password123',
      role: 'marketer',
      status: 'active',
      emailVerified: true
    });

    // Create test product
    testProduct = await Product.create({
      name: 'Test Investment Product',
      description: 'A test investment product',
      category: 'investment',
      commissionType: 'percentage',
      commissionRate: 0.05,
      minInitialSpend: 1000,
      status: 'active',
      landingPageUrl: 'https://example.com/invest'
    });
  });

  describe('createReferralLink', () => {
    it('should create a new referral link successfully', async () => {
      const linkData = {
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString()
      };

      const referralLink = await TrackingService.createReferralLink(linkData);

      expect(referralLink).toBeDefined();
      expect(referralLink.marketerId).toBe(linkData.marketerId);
      expect(referralLink.productId).toBe(linkData.productId);
      expect(referralLink.trackingCode).toBeDefined();
      expect(referralLink.linkUrl).toContain(referralLink.trackingCode);
      expect(referralLink.isActive).toBe(true);
      expect(referralLink.clickCount).toBe(0);
      expect(referralLink.conversionCount).toBe(0);
    });

    it('should create a referral link with expiration date', async () => {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      const linkData = {
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString(),
        expiresAt
      };

      const referralLink = await TrackingService.createReferralLink(linkData);

      expect(referralLink.expiresAt).toEqual(expiresAt);
    });

    it('should return existing active link if one exists', async () => {
      const linkData = {
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString()
      };

      // Create first link
      const firstLink = await TrackingService.createReferralLink(linkData);
      
      // Try to create second link
      const secondLink = await TrackingService.createReferralLink(linkData);

      expect(firstLink._id.toString()).toBe(secondLink._id.toString());
      expect(firstLink.trackingCode).toBe(secondLink.trackingCode);
    });

    it('should throw error if marketer not found', async () => {
      const linkData = {
        marketerId: new mongoose.Types.ObjectId().toString(),
        productId: testProduct._id.toString()
      };

      await expect(TrackingService.createReferralLink(linkData))
        .rejects.toThrow('Marketer not found');
    });

    it('should throw error if marketer is not active', async () => {
      testMarketer.status = 'suspended';
      await testMarketer.save();

      const linkData = {
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString()
      };

      await expect(TrackingService.createReferralLink(linkData))
        .rejects.toThrow('Marketer account is not active');
    });

    it('should throw error if user is not a marketer', async () => {
      testMarketer.role = 'admin';
      await testMarketer.save();

      const linkData = {
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString()
      };

      await expect(TrackingService.createReferralLink(linkData))
        .rejects.toThrow('User is not a marketer');
    });

    it('should throw error if product not found', async () => {
      const linkData = {
        marketerId: testMarketer._id.toString(),
        productId: new mongoose.Types.ObjectId().toString()
      };

      await expect(TrackingService.createReferralLink(linkData))
        .rejects.toThrow('Product not found');
    });

    it('should throw error if product is not active', async () => {
      testProduct.status = 'inactive';
      await testProduct.save();

      const linkData = {
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString()
      };

      await expect(TrackingService.createReferralLink(linkData))
        .rejects.toThrow('Product is not active');
    });
  });

  describe('getMarketerReferralLinks', () => {
    beforeEach(async () => {
      // Create multiple referral links for testing
      await ReferralLink.create([
        {
          marketerId: testMarketer._id.toString(),
          productId: testProduct._id.toString(),
          trackingCode: 'TEST001',
          linkUrl: 'http://test.com/track/TEST001',
          isActive: true
        },
        {
          marketerId: testMarketer._id.toString(),
          productId: testProduct._id.toString(),
          trackingCode: 'TEST002',
          linkUrl: 'http://test.com/track/TEST002',
          isActive: false
        },
        {
          marketerId: testMarketer._id.toString(),
          productId: testProduct._id.toString(),
          trackingCode: 'TEST003',
          linkUrl: 'http://test.com/track/TEST003',
          isActive: true,
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Expired
        }
      ]);
    });

    it('should return active links by default', async () => {
      const result = await TrackingService.getMarketerReferralLinks(testMarketer._id.toString());

      expect(result.links).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.links[0].trackingCode).toBe('TEST001');
    });

    it('should return all links when includeInactive is true', async () => {
      const result = await TrackingService.getMarketerReferralLinks(
        testMarketer._id.toString(),
        { includeInactive: true }
      );

      expect(result.links).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('should respect limit and offset parameters', async () => {
      const result = await TrackingService.getMarketerReferralLinks(
        testMarketer._id.toString(),
        { includeInactive: true, limit: 2, offset: 1 }
      );

      expect(result.links).toHaveLength(2);
      expect(result.total).toBe(3);
    });
  });

  describe('getReferralLinkByTrackingCode', () => {
    let testLink: any;

    beforeEach(async () => {
      testLink = await ReferralLink.create({
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString(),
        trackingCode: 'TESTCODE123',
        linkUrl: 'http://test.com/track/TESTCODE123',
        isActive: true
      });
    });

    it('should return referral link by tracking code', async () => {
      const link = await TrackingService.getReferralLinkByTrackingCode('TESTCODE123');

      expect(link).toBeDefined();
      expect(link!.trackingCode).toBe('TESTCODE123');
      expect(link!.marketerId).toBeDefined();
      expect(link!.productId).toBeDefined();
    });

    it('should return null for non-existent tracking code', async () => {
      const link = await TrackingService.getReferralLinkByTrackingCode('NONEXISTENT');

      expect(link).toBeNull();
    });
  });

  describe('deactivateReferralLink', () => {
    let testLink: any;

    beforeEach(async () => {
      testLink = await ReferralLink.create({
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString(),
        trackingCode: 'TESTCODE123',
        linkUrl: 'http://test.com/track/TESTCODE123',
        isActive: true
      });
    });

    it('should deactivate referral link successfully', async () => {
      const deactivatedLink = await TrackingService.deactivateReferralLink(
        testLink._id.toString(),
        testMarketer._id.toString()
      );

      expect(deactivatedLink.isActive).toBe(false);
    });

    it('should throw error for non-existent link', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      await expect(TrackingService.deactivateReferralLink(
        nonExistentId,
        testMarketer._id.toString()
      )).rejects.toThrow('Referral link not found or access denied');
    });

    it('should throw error for wrong marketer', async () => {
      const otherMarketer = await User.create({
        email: 'other@test.com',
        password: 'password123',
        role: 'marketer',
        status: 'active',
        emailVerified: true
      });

      await expect(TrackingService.deactivateReferralLink(
        testLink._id.toString(),
        otherMarketer._id.toString()
      )).rejects.toThrow('Referral link not found or access denied');
    });
  });

  describe('updateReferralLinkExpiration', () => {
    let testLink: any;

    beforeEach(async () => {
      testLink = await ReferralLink.create({
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString(),
        trackingCode: 'TESTCODE123',
        linkUrl: 'http://test.com/track/TESTCODE123',
        isActive: true
      });
    });

    it('should update expiration date successfully', async () => {
      const newExpiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      
      const updatedLink = await TrackingService.updateReferralLinkExpiration(
        testLink._id.toString(),
        testMarketer._id.toString(),
        newExpiration
      );

      expect(updatedLink.expiresAt).toEqual(newExpiration);
    });

    it('should set expiration to null', async () => {
      const updatedLink = await TrackingService.updateReferralLinkExpiration(
        testLink._id.toString(),
        testMarketer._id.toString(),
        null
      );

      expect(updatedLink.expiresAt).toBeUndefined();
    });
  });

  describe('getMarketerReferralStats', () => {
    beforeEach(async () => {
      await ReferralLink.create([
        {
          marketerId: testMarketer._id.toString(),
          productId: testProduct._id.toString(),
          trackingCode: 'STATS001',
          linkUrl: 'http://test.com/track/STATS001',
          isActive: true,
          clickCount: 10,
          conversionCount: 2
        },
        {
          marketerId: testMarketer._id.toString(),
          productId: testProduct._id.toString(),
          trackingCode: 'STATS002',
          linkUrl: 'http://test.com/track/STATS002',
          isActive: false,
          clickCount: 5,
          conversionCount: 1
        },
        {
          marketerId: testMarketer._id.toString(),
          productId: testProduct._id.toString(),
          trackingCode: 'STATS003',
          linkUrl: 'http://test.com/track/STATS003',
          isActive: true,
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired
          clickCount: 3,
          conversionCount: 0
        }
      ]);
    });

    it('should return correct statistics', async () => {
      const stats = await TrackingService.getMarketerReferralStats(testMarketer._id.toString());

      expect(stats.totalLinks).toBe(3);
      expect(stats.activeLinks).toBe(1); // Only non-expired active links
      expect(stats.expiredLinks).toBe(1);
      expect(stats.totalClicks).toBe(18);
      expect(stats.totalConversions).toBe(3);
      expect(stats.conversionRate).toBeCloseTo(16.67, 2); // 3/18 * 100
    });

    it('should return zero stats for marketer with no links', async () => {
      const otherMarketer = await User.create({
        email: 'other@test.com',
        password: 'password123',
        role: 'marketer',
        status: 'active',
        emailVerified: true
      });

      const stats = await TrackingService.getMarketerReferralStats(otherMarketer._id.toString());

      expect(stats.totalLinks).toBe(0);
      expect(stats.activeLinks).toBe(0);
      expect(stats.expiredLinks).toBe(0);
      expect(stats.totalClicks).toBe(0);
      expect(stats.totalConversions).toBe(0);
      expect(stats.conversionRate).toBe(0);
    });
  });

  describe('cleanupExpiredLinks', () => {
    beforeEach(async () => {
      await ReferralLink.create([
        {
          marketerId: testMarketer._id.toString(),
          productId: testProduct._id.toString(),
          trackingCode: 'CLEANUP001',
          linkUrl: 'http://test.com/track/CLEANUP001',
          isActive: true,
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Expired
        },
        {
          marketerId: testMarketer._id.toString(),
          productId: testProduct._id.toString(),
          trackingCode: 'CLEANUP002',
          linkUrl: 'http://test.com/track/CLEANUP002',
          isActive: true,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // Not expired
        },
        {
          marketerId: testMarketer._id.toString(),
          productId: testProduct._id.toString(),
          trackingCode: 'CLEANUP003',
          linkUrl: 'http://test.com/track/CLEANUP003',
          isActive: true // No expiration
        }
      ]);
    });

    it('should deactivate expired links', async () => {
      const deactivatedCount = await TrackingService.cleanupExpiredLinks();

      expect(deactivatedCount).toBe(1);

      const expiredLink = await ReferralLink.findOne({ trackingCode: 'CLEANUP001' });
      expect(expiredLink!.isActive).toBe(false);

      const activeLink = await ReferralLink.findOne({ trackingCode: 'CLEANUP002' });
      expect(activeLink!.isActive).toBe(true);
    });
  });

  describe('validateTrackingCode', () => {
    it('should validate correct tracking code format', () => {
      const validCode = 'ABC123_MARK_PROD_1234567890ABCDEF';
      expect(TrackingService.validateTrackingCode(validCode)).toBe(true);
    });

    it('should reject invalid tracking code formats', () => {
      const invalidCodes = [
        'invalid',
        'ABC_MARK_PROD_123', // Too short
        'abc123_mark_prod_1234567890abcdef', // Lowercase
        'ABC123_MARK_PROD', // Missing random part
        'ABC123_MARK_PROD_1234567890ABCDEFG' // Too long random part
      ];

      invalidCodes.forEach(code => {
        expect(TrackingService.validateTrackingCode(code)).toBe(false);
      });
    });
  });

  describe('ReferralLink model methods', () => {
    let testLink: any;

    beforeEach(async () => {
      testLink = new ReferralLink({
        marketerId: testMarketer._id.toString(),
        productId: testProduct._id.toString(),
        linkUrl: 'http://test.com/track/TEST'
      });
    });

    it('should generate tracking code automatically', async () => {
      await testLink.save();
      
      expect(testLink.trackingCode).toBeDefined();
      expect(testLink.trackingCode).toMatch(/^[A-Z0-9]+_[A-Z0-9]{4}_[A-Z0-9]{4}_[A-Z0-9]{16}$/);
    });

    it('should check if link is expired', async () => {
      testLink.expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(testLink.isExpired()).toBe(true);

      testLink.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      expect(testLink.isExpired()).toBe(false);

      testLink.expiresAt = null;
      expect(testLink.isExpired()).toBe(false);
    });

    it('should increment click count', async () => {
      await testLink.save();
      
      expect(testLink.clickCount).toBe(0);
      await testLink.incrementClickCount();
      expect(testLink.clickCount).toBe(1);
    });

    it('should increment conversion count', async () => {
      await testLink.save();
      
      expect(testLink.conversionCount).toBe(0);
      await testLink.incrementConversionCount();
      expect(testLink.conversionCount).toBe(1);
    });
  });
});