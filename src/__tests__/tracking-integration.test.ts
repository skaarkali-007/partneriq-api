import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../index';
import { User } from '../models/User';
import { Product } from '../models/Product';
import { ReferralLink } from '../models/ReferralLink';
import { ClickEvent } from '../models/ClickEvent';
import { ConversionEvent } from '../models/ConversionEvent';
import { TrackingService } from '../services/tracking';
import jwt from 'jsonwebtoken';

describe('Tracking Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let marketerToken: string;
  let marketerId: string;
  let productId: string;
  let trackingCode: string;

  beforeAll(async () => {
    // Start in-memory MongoDB
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
    await User.deleteMany({});
    await Product.deleteMany({});
    await ReferralLink.deleteMany({});
    await ClickEvent.deleteMany({});
    await ConversionEvent.deleteMany({});

    // Create test marketer
    const marketer = new User({
      email: 'marketer@test.com',
      password: 'testpassword123',
      role: 'marketer',
      status: 'active'
    });
    await marketer.save();
    marketerId = marketer._id.toString();

    // Create JWT token for marketer
    marketerToken = jwt.sign(
      { userId: marketerId, role: 'marketer' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );

    // Create test product
    const product = new Product({
      name: 'Test Investment Product',
      description: 'A test investment product',
      category: 'investment',
      commissionType: 'percentage',
      commissionRate: 0.05,
      minInitialSpend: 100,
      status: 'active',
      landingPageUrl: 'https://example.com/invest'
    });
    await product.save();
    productId = product._id.toString();

    // Create test referral link
    const referralLink = await TrackingService.createReferralLink({
      marketerId,
      productId
    });
    trackingCode = referralLink.trackingCode;
  });

  describe('Click Tracking', () => {
    it('should track a click event successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/tracking/track/${trackingCode}/click`)
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        .set('X-Forwarded-For', '192.168.1.100')
        .send({
          customerId: 'customer123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.trackingCode).toBe(trackingCode);
      expect(response.body.data.clickId).toBeDefined();
      expect(response.body.data.sessionId).toBeDefined();

      // Verify click event was created in database
      const clickEvent = await ClickEvent.findOne({ trackingCode });
      expect(clickEvent).toBeTruthy();
      expect(clickEvent?.customerId).toBe('customer123');
      expect(clickEvent?.ipAddress).toBe('192.168.1.100');
      expect(clickEvent?.device).toBe('desktop');
      expect(clickEvent?.browser).toBe('chrome');
      expect(clickEvent?.os).toBe('windows');

      // Verify referral link click count was incremented
      const updatedLink = await ReferralLink.findOne({ trackingCode });
      expect(updatedLink?.clickCount).toBe(1);
    });

    it('should reject click tracking for invalid tracking code', async () => {
      const response = await request(app)
        .post('/api/v1/tracking/track/INVALID_CODE/click')
        .set('User-Agent', 'Mozilla/5.0')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('TRACK_CLICK_ERROR');
    });

    it('should set tracking cookies on successful click', async () => {
      const response = await request(app)
        .post(`/api/v1/tracking/track/${trackingCode}/click`)
        .set('User-Agent', 'Mozilla/5.0')
        .send({});

      expect(response.status).toBe(200);
      
      // Check that cookies were set
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      if (Array.isArray(cookies)) {
        expect(cookies.some((cookie: string) => cookie.includes('affiliate_tracking'))).toBe(true);
        expect(cookies.some((cookie: string) => cookie.includes('affiliate_session'))).toBe(true);
      } else if (typeof cookies === 'string') {
        expect(cookies.includes('affiliate_tracking') || cookies.includes('affiliate_session')).toBe(true);
      }
    });

    it('should handle referral redirect and track click', async () => {
      const response = await request(app)
        .get(`/api/v1/tracking/track/${trackingCode}`)
        .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)')
        .set('X-Forwarded-For', '10.0.0.1');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('https://example.com/invest');

      // Verify click was tracked
      const clickEvent = await ClickEvent.findOne({ trackingCode });
      expect(clickEvent).toBeTruthy();
      expect(clickEvent?.device).toBe('mobile');
      expect(clickEvent?.os).toBe('ios');
    });
  });

  describe('Conversion Tracking', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Create a click event first
      const clickResponse = await request(app)
        .post(`/api/v1/tracking/track/${trackingCode}/click`)
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .set('X-Forwarded-For', '192.168.1.100')
        .send({
          customerId: 'customer123'
        });

      sessionId = clickResponse.body.data.sessionId;
    });

    it('should record conversion with direct tracking code attribution', async () => {
      const response = await request(app)
        .post('/api/v1/tracking/conversions')
        .send({
          trackingCode,
          customerId: 'customer123',
          productId,
          initialSpendAmount: 1000,
          attributionMethod: 'portal'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.trackingCode).toBe(trackingCode);
      expect(response.body.data.attributionMethod).toBe('portal');
      expect(response.body.data.commissionEligible).toBe(true);

      // Verify conversion event was created
      const conversionEvent = await ConversionEvent.findOne({ customerId: 'customer123' });
      expect(conversionEvent).toBeTruthy();
      expect(conversionEvent?.initialSpendAmount).toBe(1000);
      expect(conversionEvent?.commissionEligible).toBe(true);

      // Verify referral link conversion count was incremented
      const updatedLink = await ReferralLink.findOne({ trackingCode });
      expect(updatedLink?.conversionCount).toBe(1);
    });

    it('should record conversion with cookie-based attribution', async () => {
      const response = await request(app)
        .post('/api/v1/tracking/conversions')
        .set('Cookie', `affiliate_tracking=${trackingCode}; affiliate_session=${sessionId}`)
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .set('X-Forwarded-For', '192.168.1.100')
        .send({
          customerId: 'customer123',
          productId,
          initialSpendAmount: 500
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.trackingCode).toBe(trackingCode);
      expect(response.body.data.attributionMethod).toBe('cookie');
      expect(response.body.data.commissionEligible).toBe(true);

      // Verify conversion event was created
      const conversionEvent = await ConversionEvent.findOne({ customerId: 'customer123' });
      expect(conversionEvent).toBeTruthy();
      expect(conversionEvent?.attributionMethod).toBe('cookie');
    });

    it('should handle conversion without attribution', async () => {
      const response = await request(app)
        .post('/api/v1/tracking/conversions')
        .send({
          customerId: 'newcustomer456',
          productId,
          initialSpendAmount: 750
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.attributionMethod).toBe('none');
      expect(response.body.data.commissionEligible).toBe(false);

      // Verify conversion event was created but not commission eligible
      const conversionEvent = await ConversionEvent.findOne({ customerId: 'newcustomer456' });
      expect(conversionEvent).toBeTruthy();
      expect(conversionEvent?.commissionEligible).toBe(false);
    });

    it('should prevent duplicate conversions with deduplication key', async () => {
      const conversionData = {
        trackingCode,
        customerId: 'customer123',
        productId,
        initialSpendAmount: 1000,
        attributionMethod: 'portal'
      };

      // First conversion
      const response1 = await request(app)
        .post('/api/v1/tracking/conversions')
        .send(conversionData);

      expect(response1.status).toBe(200);

      // Second conversion (should fail due to duplicate deduplication key)
      const response2 = await request(app)
        .post('/api/v1/tracking/conversions')
        .send(conversionData);

      expect(response2.status).toBe(400);
      expect(response2.body.error.code).toBe('RECORD_CONVERSION_ERROR');

      // Verify only one conversion event exists
      const conversionEvents = await ConversionEvent.find({ customerId: 'customer123' });
      expect(conversionEvents).toHaveLength(1);
    });

    it('should validate required fields for conversion', async () => {
      const response = await request(app)
        .post('/api/v1/tracking/conversions')
        .send({
          customerId: 'customer123'
          // Missing productId and initialSpendAmount
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Attribution Logic', () => {
    it('should perform session-based attribution correctly', async () => {
      // Create click event
      const clickEvent = new ClickEvent({
        trackingCode,
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        sessionId: 'session123',
        timestamp: new Date(),
        fingerprint: 'test-fingerprint-123'
      });
      await clickEvent.save();

      // Test attribution
      const attribution = await TrackingService.performAttribution({
        customerId: 'customer123',
        productId,
        initialSpendAmount: 1000,
        sessionId: 'session123'
      });

      expect(attribution.success).toBe(true);
      expect(attribution.trackingCode).toBe(trackingCode);
      expect(attribution.attributionMethod).toBe('cookie');
      expect(attribution.clickEventId).toBe(clickEvent._id.toString());
    });

    it('should perform fingerprint-based attribution when session fails', async () => {
      // Create click event
      const clickEvent = new ClickEvent({
        trackingCode,
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        sessionId: 'different-session',
        timestamp: new Date(),
        fingerprint: 'test-fingerprint-456'
      });
      await clickEvent.save();

      // Test attribution with matching fingerprint
      const attribution = await TrackingService.performAttribution({
        customerId: 'customer123',
        productId,
        initialSpendAmount: 1000,
        sessionId: 'session123',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      });

      expect(attribution.success).toBe(true);
      expect(attribution.trackingCode).toBe(trackingCode);
      expect(attribution.attributionMethod).toBe('cookie');
    });

    it('should respect attribution window', async () => {
      // Create old click event (outside attribution window)
      const oldClickEvent = new ClickEvent({
        trackingCode,
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        sessionId: 'session123',
        timestamp: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // 31 days ago
        fingerprint: 'test-fingerprint-old'
      });
      await oldClickEvent.save();

      // Test attribution
      const attribution = await TrackingService.performAttribution({
        customerId: 'customer123',
        productId,
        initialSpendAmount: 1000,
        sessionId: 'session123'
      });

      expect(attribution.success).toBe(false);
      expect(attribution.attributionMethod).toBe('none');
    });
  });

  describe('Data Retrieval', () => {
    beforeEach(async () => {
      // Create test click events
      await ClickEvent.create([
        {
          trackingCode,
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0',
          sessionId: 'session1',
          timestamp: new Date('2024-01-01'),
          fingerprint: 'test-fingerprint-1'
        },
        {
          trackingCode,
          ipAddress: '192.168.1.101',
          userAgent: 'Mozilla/5.0',
          sessionId: 'session2',
          timestamp: new Date('2024-01-02'),
          fingerprint: 'test-fingerprint-2'
        }
      ]);

      // Create test conversion events
      await ConversionEvent.create([
        {
          trackingCode,
          customerId: 'customer1',
          productId,
          initialSpendAmount: 1000,
          attributionMethod: 'cookie',
          commissionEligible: true,
          conversionTimestamp: new Date('2024-01-01'),
          deduplicationKey: 'dedup1'
        },
        {
          trackingCode,
          customerId: 'customer2',
          productId,
          initialSpendAmount: 500,
          attributionMethod: 'portal',
          commissionEligible: true,
          conversionTimestamp: new Date('2024-01-02'),
          deduplicationKey: 'dedup2'
        }
      ]);
    });

    it('should retrieve click events for tracking code', async () => {
      const response = await request(app)
        .get(`/api/v1/tracking/clicks/${trackingCode}`)
        .set('Authorization', `Bearer ${marketerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
    });

    it('should retrieve conversion events for tracking code', async () => {
      const response = await request(app)
        .get(`/api/v1/tracking/conversions/${trackingCode}`)
        .set('Authorization', `Bearer ${marketerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter events by date range', async () => {
      const response = await request(app)
        .get(`/api/v1/tracking/clicks/${trackingCode}`)
        .query({
          startDate: '2024-01-01',
          endDate: '2024-01-01'
        })
        .set('Authorization', `Bearer ${marketerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });

    it('should paginate results correctly', async () => {
      const response = await request(app)
        .get(`/api/v1/tracking/clicks/${trackingCode}`)
        .query({
          limit: 1,
          offset: 0
        })
        .set('Authorization', `Bearer ${marketerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination.total).toBe(2);
    });
  });

  describe('Statistics and Analytics', () => {
    beforeEach(async () => {
      // Update referral link with some stats
      await ReferralLink.findOneAndUpdate(
        { trackingCode },
        { clickCount: 10, conversionCount: 2 }
      );
    });

    it('should retrieve marketer statistics', async () => {
      const response = await request(app)
        .get(`/api/v1/tracking/stats/${marketerId}`)
        .set('Authorization', `Bearer ${marketerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalLinks).toBe(1);
      expect(response.body.data.activeLinks).toBe(1);
      expect(response.body.data.totalClicks).toBe(10);
      expect(response.body.data.totalConversions).toBe(2);
      expect(response.body.data.conversionRate).toBe(20); // 2/10 * 100
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Temporarily close database connection
      await mongoose.disconnect();

      const response = await request(app)
        .post(`/api/v1/tracking/track/${trackingCode}/click`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();

      // Reconnect for cleanup
      const mongoUri = mongoServer.getUri();
      await mongoose.connect(mongoUri);
    });

    it('should validate tracking code format', async () => {
      const isValid = TrackingService.validateTrackingCode(trackingCode);
      expect(isValid).toBe(true);

      const isInvalid = TrackingService.validateTrackingCode('INVALID_FORMAT');
      expect(isInvalid).toBe(false);
    });
  });
});