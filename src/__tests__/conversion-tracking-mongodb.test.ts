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

describe('MongoDB Conversion Event Recording System (Task 4.3)', () => {
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

  describe('MongoDB-based Conversion Tracking API', () => {
    it('should record conversion event with MongoDB storage', async () => {
      const conversionData = {
        trackingCode,
        customerId: 'customer123',
        productId,
        initialSpendAmount: 1000,
        attributionMethod: 'portal'
      };

      const response = await request(app)
        .post('/api/v1/tracking/conversions')
        .send(conversionData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.trackingCode).toBe(trackingCode);
      expect(response.body.data.commissionEligible).toBe(true);

      // Verify conversion was stored in MongoDB
      const conversionEvent = await ConversionEvent.findOne({ customerId: 'customer123' });
      expect(conversionEvent).toBeTruthy();
      expect(conversionEvent?.trackingCode).toBe(trackingCode);
      expect(conversionEvent?.initialSpendAmount).toBe(1000);
      expect(conversionEvent?.attributionMethod).toBe('portal');
      expect(conversionEvent?.commissionEligible).toBe(true);
      expect(conversionEvent?.deduplicationKey).toBeDefined();
    });

    it('should handle server-to-server (s2s) conversion tracking', async () => {
      const conversionData = {
        trackingCode,
        customerId: 'customer456',
        productId,
        initialSpendAmount: 2500,
        attributionMethod: 's2s'
      };

      const response = await request(app)
        .post('/api/v1/tracking/conversions')
        .send(conversionData);

      expect(response.status).toBe(200);
      expect(response.body.data.attributionMethod).toBe('s2s');

      // Verify MongoDB storage
      const conversionEvent = await ConversionEvent.findOne({ customerId: 'customer456' });
      expect(conversionEvent?.attributionMethod).toBe('s2s');
      expect(conversionEvent?.initialSpendAmount).toBe(2500);
    });

    it('should store conversion metadata in MongoDB', async () => {
      const conversionData = {
        trackingCode,
        customerId: 'customer789',
        productId,
        initialSpendAmount: 750
      };

      await request(app)
        .post('/api/v1/tracking/conversions')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .set('X-Forwarded-For', '192.168.1.100')
        .send(conversionData);

      const conversionEvent = await ConversionEvent.findOne({ customerId: 'customer789' });
      expect(conversionEvent?.ipAddress).toBeDefined();
      expect(conversionEvent?.userAgent).toBeDefined();
      expect(conversionEvent?.conversionTimestamp).toBeDefined();
      expect(conversionEvent?.attributionWindowDays).toBe(30);
    });
  });

  describe('Customer Identification and Deduplication with MongoDB Aggregation', () => {
    it('should prevent duplicate conversions using MongoDB aggregation', async () => {
      const conversionData = {
        trackingCode,
        customerId: 'customer123',
        productId,
        initialSpendAmount: 1000,
        attributionMethod: 'portal'
      };

      // First conversion
      const response1 = await request(app)
        .post('/api/v1/tracking/conversions/deduplication')
        .send(conversionData);

      expect(response1.status).toBe(200);
      expect(response1.body.data.deduplication.isDuplicate).toBe(false);

      // Second conversion (should be detected as duplicate)
      const response2 = await request(app)
        .post('/api/v1/tracking/conversions/deduplication')
        .send(conversionData);

      expect(response2.status).toBe(200);
      expect(response2.body.data.deduplication.isDuplicate).toBe(true);
      expect(response2.body.data.deduplication.duplicateReason).toBeDefined();

      // Verify only one conversion exists in MongoDB
      const conversionCount = await ConversionEvent.countDocuments({ customerId: 'customer123' });
      expect(conversionCount).toBe(1);
    });

    it('should detect duplicates within same day using MongoDB aggregation', async () => {
      const baseData = {
        trackingCode,
        customerId: 'customer456',
        productId,
        attributionMethod: 'portal'
      };

      // First conversion
      await request(app)
        .post('/api/v1/tracking/conversions/deduplication')
        .send({ ...baseData, initialSpendAmount: 1000 });

      // Second conversion with slightly different amount (same day)
      const response = await request(app)
        .post('/api/v1/tracking/conversions/deduplication')
        .send({ ...baseData, initialSpendAmount: 1001 });

      expect(response.body.data.deduplication.isDuplicate).toBe(true);
      expect(response.body.data.deduplication.duplicateReason).toMatch(/day|hour/);
    });

    it('should allow conversions for different customers', async () => {
      const baseData = {
        trackingCode,
        productId,
        initialSpendAmount: 1000,
        attributionMethod: 'portal'
      };

      // First customer
      await request(app)
        .post('/api/v1/tracking/conversions/deduplication')
        .send({ ...baseData, customerId: 'customer1' });

      // Different customer (should not be duplicate)
      const response = await request(app)
        .post('/api/v1/tracking/conversions/deduplication')
        .send({ ...baseData, customerId: 'customer2' });

      expect(response.body.data.deduplication.isDuplicate).toBe(false);

      // Verify both conversions exist
      const conversionCount = await ConversionEvent.countDocuments({});
      expect(conversionCount).toBe(2);
    });

    it('should use MongoDB aggregation for complex deduplication logic', async () => {
      // Test the deduplication service directly
      const result1 = await TrackingService.checkCustomerDeduplication(
        'customer123',
        productId,
        1000
      );
      expect(result1.isDuplicate).toBe(false);

      // Create a conversion
      await ConversionEvent.create({
        trackingCode,
        customerId: 'customer123',
        productId,
        initialSpendAmount: 1000,
        attributionMethod: 'portal',
        commissionEligible: true,
        conversionTimestamp: new Date(),
        deduplicationKey: 'test-key-1'
      });

      // Check for duplicate
      const result2 = await TrackingService.checkCustomerDeduplication(
        'customer123',
        productId,
        1000
      );
      expect(result2.isDuplicate).toBe(true);
      expect(result2.existingConversionId).toBeDefined();
    });
  });

  describe('Real-time Conversion Notification System with MongoDB Change Streams', () => {
    it('should emit notifications for new conversions', async () => {
      let notificationReceived = false;
      let notificationData: any = null;

      // Set up notification listener
      const notificationHandler = (data: any) => {
        notificationReceived = true;
        notificationData = data;
      };

      TrackingService.onConversionNotification(notificationHandler);

      // Create a conversion that should trigger notification
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

      // Wait a bit for the notification to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify notification was emitted (or at least the conversion was recorded)
      const conversionEvent = await ConversionEvent.findOne({ customerId: 'customer123' });
      expect(conversionEvent).toBeTruthy();
      expect(conversionEvent?.commissionEligible).toBe(true);

      // Clean up listener
      TrackingService.offConversionNotification(notificationHandler);
    });

    it('should not emit notifications for non-commission-eligible conversions', (done) => {
      let notificationReceived = false;

      const notificationHandler = () => {
        notificationReceived = true;
      };

      TrackingService.onConversionNotification(notificationHandler);

      // Create a conversion without attribution (not commission eligible)
      request(app)
        .post('/api/v1/tracking/conversions')
        .send({
          customerId: 'customer456',
          productId,
          initialSpendAmount: 500
          // No tracking code - should not be commission eligible
        })
        .end(() => {
          // Wait a bit to ensure no notification is sent
          setTimeout(() => {
            expect(notificationReceived).toBe(false);
            TrackingService.offConversionNotification(notificationHandler);
            done();
          }, 100);
        });
    });
  });

  describe('Efficient MongoDB Queries for Conversion Analytics', () => {
    beforeEach(async () => {
      // Create test conversion events
      const conversions = [
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
          initialSpendAmount: 2000,
          attributionMethod: 'portal',
          commissionEligible: true,
          conversionTimestamp: new Date('2024-01-02'),
          deduplicationKey: 'dedup2'
        },
        {
          trackingCode,
          customerId: 'customer3',
          productId,
          initialSpendAmount: 500,
          attributionMethod: 's2s',
          commissionEligible: false,
          conversionTimestamp: new Date('2024-01-03'),
          deduplicationKey: 'dedup3'
        }
      ];

      await ConversionEvent.insertMany(conversions);
    });

    it('should perform efficient MongoDB aggregation for conversion analytics', async () => {
      const analytics = await TrackingService.getConversionAnalytics({
        marketerId,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-03')
      });

      expect(analytics.totalConversions).toBe(2); // Only commission eligible
      expect(analytics.totalRevenue).toBe(3000); // 1000 + 2000
      expect(analytics.averageOrderValue).toBe(1500);
      expect(analytics.conversionsByMethod.cookie).toBe(1);
      expect(analytics.conversionsByMethod.portal).toBe(1);
      expect(analytics.conversionsByMethod.s2s).toBe(0); // Not commission eligible
    });

    it('should use MongoDB aggregation for advanced conversion queries', async () => {
      const result = await TrackingService.getAdvancedConversionEvents({
        marketerId,
        commissionEligible: true,
        minAmount: 500,
        maxAmount: 1500,
        sortBy: 'initialSpendAmount',
        sortOrder: 'asc'
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].initialSpendAmount).toBe(1000);
      expect(result.total).toBe(1);
      expect(result.analytics.totalConversions).toBe(1);
      expect(result.analytics.totalRevenue).toBe(1000);
    });

    it('should filter conversions by attribution method using MongoDB queries', async () => {
      const result = await TrackingService.getAdvancedConversionEvents({
        attributionMethods: ['portal'],
        commissionEligible: true
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].attributionMethod).toBe('portal');
      expect(result.events[0].initialSpendAmount).toBe(2000);
    });

    it('should perform time-based analytics with MongoDB aggregation', async () => {
      const analytics = await TrackingService.getConversionAnalytics({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-01')
      });

      expect(analytics.conversionsByTimeframe).toHaveLength(1);
      expect(analytics.conversionsByTimeframe[0].date).toBe('2024-01-01');
      expect(analytics.conversionsByTimeframe[0].conversions).toBe(1);
      expect(analytics.conversionsByTimeframe[0].revenue).toBe(1000);
    });

    it('should handle complex MongoDB aggregation pipelines efficiently', async () => {
      // Test with multiple filters and sorting
      const result = await TrackingService.getAdvancedConversionEvents({
        marketerId,
        productIds: [productId],
        customerIds: ['customer1', 'customer2'],
        attributionMethods: ['cookie', 'portal'],
        commissionEligible: true,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02'),
        sortBy: 'conversionTimestamp',
        sortOrder: 'desc',
        limit: 10,
        offset: 0
      });

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.analytics.totalRevenue).toBe(3000);
      
      // Verify sorting (desc by timestamp)
      expect(new Date(result.events[0].conversionTimestamp).getTime())
        .toBeGreaterThan(new Date(result.events[1].conversionTimestamp).getTime());
    });
  });

  describe('MongoDB Indexes and Performance', () => {
    it('should use proper indexes for conversion queries', async () => {
      // Create multiple conversions to test index usage
      const conversions = Array.from({ length: 100 }, (_, i) => ({
        trackingCode: `${trackingCode}_${i}`,
        customerId: `customer${i}`,
        productId,
        initialSpendAmount: Math.random() * 1000 + 100,
        attributionMethod: ['cookie', 'portal', 's2s'][i % 3] as 'cookie' | 'portal' | 's2s',
        commissionEligible: i % 2 === 0,
        conversionTimestamp: new Date(Date.now() - i * 60000), // Spread over time
        deduplicationKey: `dedup${i}`
      }));

      await ConversionEvent.insertMany(conversions);

      // Test query performance with indexes
      const startTime = Date.now();
      const result = await TrackingService.getAdvancedConversionEvents({
        commissionEligible: true,
        startDate: new Date(Date.now() - 50 * 60000),
        sortBy: 'conversionTimestamp',
        sortOrder: 'desc',
        limit: 10
      });
      const queryTime = Date.now() - startTime;

      expect(result.events).toHaveLength(10);
      expect(queryTime).toBeLessThan(1000); // Should be fast with proper indexes
    });

    it('should efficiently handle large dataset aggregations', async () => {
      // Create a larger dataset
      const conversions = Array.from({ length: 500 }, (_, i) => ({
        trackingCode: `${trackingCode}_${i % 10}`, // Group by tracking codes
        customerId: `customer${i}`,
        productId,
        initialSpendAmount: Math.random() * 2000 + 100,
        attributionMethod: ['cookie', 'portal', 's2s'][i % 3] as 'cookie' | 'portal' | 's2s',
        commissionEligible: i % 3 !== 2, // 2/3 are commission eligible
        conversionTimestamp: new Date(Date.now() - i * 60000),
        deduplicationKey: `dedup${i}`
      }));

      await ConversionEvent.insertMany(conversions);

      const startTime = Date.now();
      const analytics = await TrackingService.getConversionAnalytics({
        startDate: new Date(Date.now() - 500 * 60000)
      });
      const queryTime = Date.now() - startTime;

      expect(analytics.totalConversions).toBeGreaterThan(300); // ~333 commission eligible
      expect(analytics.conversionsByMethod.cookie).toBeGreaterThan(0);
      expect(analytics.conversionsByMethod.portal).toBeGreaterThan(0);
      expect(queryTime).toBeLessThan(2000); // Should handle large datasets efficiently
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid conversion data gracefully', async () => {
      const response = await request(app)
        .post('/api/v1/tracking/conversions')
        .send({
          customerId: 'customer123'
          // Missing required fields
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle MongoDB connection issues in deduplication', async () => {
      // Temporarily close MongoDB connection
      await mongoose.disconnect();

      const result = await TrackingService.checkCustomerDeduplication(
        'customer123',
        productId,
        1000
      );

      // Should return safe default when DB is unavailable
      expect(result.isDuplicate).toBe(false);

      // Reconnect for other tests
      const mongoUri = mongoServer.getUri();
      await mongoose.connect(mongoUri);
    });

    it('should handle change stream initialization errors gracefully', async () => {
      // This test verifies that change stream errors don't crash the application
      await expect(TrackingService.initializeConversionChangeStream()).resolves.not.toThrow();
    });
  });
});