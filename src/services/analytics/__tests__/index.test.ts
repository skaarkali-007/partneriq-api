import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AnalyticsService } from '../index';
import { ClickEvent } from '../../../models/ClickEvent';
import { ConversionEvent } from '../../../models/ConversionEvent';
import { ReferralLink } from '../../../models/ReferralLink';
import { Commission } from '../../../models/Commission';
import { User } from '../../../models/User';
import { Product } from '../../../models/Product';

describe('AnalyticsService', () => {
  let mongoServer: MongoMemoryServer;
  let testUser: any;
  let testProduct: any;
  let testReferralLink: any;

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
      ClickEvent.deleteMany({}),
      ConversionEvent.deleteMany({}),
      ReferralLink.deleteMany({}),
      Commission.deleteMany({}),
      User.deleteMany({}),
      Product.deleteMany({})
    ]);

    // Create test data
    testUser = await User.create({
      email: 'test@example.com',
      password: 'hashedpassword123',
      firstName: 'Test',
      lastName: 'User',
      role: 'marketer',
      status: 'active',
      emailVerified: true,
      mfaEnabled: false,
      mfaSetupCompleted: false
    });

    testProduct = await Product.create({
      name: 'Test Product',
      description: 'Test product description',
      category: 'investment',
      commissionType: 'percentage',
      commissionRate: 0.05,
      minInitialSpend: 100,
      status: 'active',
      landingPageUrl: 'https://example.com/product'
    });

    testReferralLink = await ReferralLink.create({
      marketerId: testUser._id.toString(),
      productId: testProduct._id.toString(),
      trackingCode: 'TEST_TRACKING_123',
      linkUrl: 'https://example.com/ref/TEST_TRACKING_123',
      isActive: true
    });
  });

  describe('getPerformanceMetrics', () => {
    it('should return performance metrics for a date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      // Create test click events
      await ClickEvent.create([
        {
          trackingCode: 'TEST_TRACKING_123',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          timestamp: new Date('2024-01-15'),
          sessionId: 'session1',
          customerId: 'customer1'
        },
        {
          trackingCode: 'TEST_TRACKING_123',
          ipAddress: '192.168.1.2',
          userAgent: 'Mozilla/5.0',
          timestamp: new Date('2024-01-16'),
          sessionId: 'session2',
          customerId: 'customer2'
        }
      ]);

      // Create test conversion events
      await ConversionEvent.create([
        {
          trackingCode: 'TEST_TRACKING_123',
          customerId: 'customer1',
          productId: testProduct._id.toString(),
          initialSpendAmount: 1000,
          conversionTimestamp: new Date('2024-01-15'),
          attributionMethod: 'cookie',
          commissionEligible: true,
          deduplicationKey: 'dedup1'
        }
      ]);

      // Create test commission
      await Commission.create({
        marketerId: testUser._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'TEST_TRACKING_123',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'approved',
        conversionDate: new Date('2024-01-15')
      });

      const metrics = await AnalyticsService.getPerformanceMetrics(
        startDate,
        endDate,
        testUser._id.toString()
      );

      expect(metrics).toMatchObject({
        totalClicks: 2,
        totalConversions: 1,
        conversionRate: 50,
        totalCommissionAmount: 50,
        averageCommissionAmount: 50,
        totalCustomers: 1,
        period: {
          start: startDate,
          end: endDate
        }
      });
    });

    it('should filter metrics by product ID', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      // Create another product and referral link
      const anotherProduct = await Product.create({
        name: 'Another Product',
        description: 'Another product description',
        category: 'investment',
        commissionType: 'percentage',
        commissionRate: 0.03,
        minInitialSpend: 200,
        status: 'active',
        landingPageUrl: 'https://example.com/another-product'
      });

      await ReferralLink.create({
        marketerId: testUser._id.toString(),
        productId: anotherProduct._id.toString(),
        trackingCode: 'ANOTHER_TRACKING_456',
        linkUrl: 'https://example.com/ref/ANOTHER_TRACKING_456',
        isActive: true
      });

      // Create clicks for both products
      await ClickEvent.create([
        {
          trackingCode: 'TEST_TRACKING_123',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          timestamp: new Date('2024-01-15'),
          sessionId: 'session1'
        },
        {
          trackingCode: 'ANOTHER_TRACKING_456',
          ipAddress: '192.168.1.2',
          userAgent: 'Mozilla/5.0',
          timestamp: new Date('2024-01-16'),
          sessionId: 'session2'
        }
      ]);

      const metrics = await AnalyticsService.getPerformanceMetrics(
        startDate,
        endDate,
        undefined,
        testProduct._id.toString()
      );

      expect(metrics.totalClicks).toBe(1);
    });

    it('should return zero metrics for empty date range', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      const metrics = await AnalyticsService.getPerformanceMetrics(
        startDate,
        endDate
      );

      expect(metrics).toMatchObject({
        totalClicks: 0,
        totalConversions: 0,
        conversionRate: 0,
        totalCommissionAmount: 0,
        averageCommissionAmount: 0,
        totalCustomers: 0
      });
    });
  });

  describe('getConversionAnalytics', () => {
    beforeEach(async () => {
      // Create test conversion events
      await ConversionEvent.create([
        {
          trackingCode: 'TEST_TRACKING_123',
          customerId: 'customer1',
          productId: testProduct._id.toString(),
          initialSpendAmount: 1000,
          conversionTimestamp: new Date('2024-01-15'),
          attributionMethod: 'cookie',
          commissionEligible: true,
          deduplicationKey: 'dedup1'
        },
        {
          trackingCode: 'TEST_TRACKING_123',
          customerId: 'customer2',
          productId: testProduct._id.toString(),
          initialSpendAmount: 2000,
          conversionTimestamp: new Date('2024-01-16'),
          attributionMethod: 'portal',
          commissionEligible: true,
          deduplicationKey: 'dedup2'
        }
      ]);
    });

    it('should return conversion analytics by day', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const analytics = await AnalyticsService.getConversionAnalytics(
        startDate,
        endDate,
        testUser._id.toString()
      );

      expect(analytics.conversionsByDay).toHaveLength(2);
      expect(analytics.conversionsByDay[0]).toMatchObject({
        date: '2024-01-15',
        conversions: 1,
        revenue: 1000
      });
      expect(analytics.conversionsByDay[1]).toMatchObject({
        date: '2024-01-16',
        conversions: 1,
        revenue: 2000
      });
    });

    it('should return conversion analytics by product', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const analytics = await AnalyticsService.getConversionAnalytics(
        startDate,
        endDate,
        testUser._id.toString()
      );

      expect(analytics.conversionsByProduct).toHaveLength(1);
      expect(analytics.conversionsByProduct[0]).toMatchObject({
        productId: testProduct._id.toString(),
        conversions: 2,
        revenue: 3000
      });
    });

    it('should return conversion analytics by marketer when not filtered', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const analytics = await AnalyticsService.getConversionAnalytics(
        startDate,
        endDate
      );

      expect(analytics.conversionsByMarketer).toHaveLength(1);
      expect(analytics.conversionsByMarketer[0]).toMatchObject({
        marketerId: testUser._id.toString(),
        conversions: 2,
        revenue: 3000
      });
    });
  });

  describe('getRealtimeMetrics', () => {
    it('should return real-time metrics', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Create recent click events
      await ClickEvent.create([
        {
          trackingCode: 'TEST_TRACKING_123',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          timestamp: new Date(now.getTime() - 30 * 60 * 1000), // 30 minutes ago
          sessionId: 'session1'
        },
        {
          trackingCode: 'TEST_TRACKING_123',
          ipAddress: '192.168.1.2',
          userAgent: 'Mozilla/5.0',
          timestamp: new Date(now.getTime() - 45 * 60 * 1000), // 45 minutes ago
          sessionId: 'session2'
        }
      ]);

      // Create recent conversion event
      await ConversionEvent.create({
        trackingCode: 'TEST_TRACKING_123',
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        initialSpendAmount: 1000,
        conversionTimestamp: new Date(now.getTime() - 20 * 60 * 1000), // 20 minutes ago
        attributionMethod: 'cookie',
        commissionEligible: true,
        deduplicationKey: 'dedup1'
      });

      const metrics = await AnalyticsService.getRealtimeMetrics();

      expect(metrics.activeUsers).toBe(2);
      expect(metrics.recentClicks).toBe(2);
      expect(metrics.recentConversions).toBe(1);
      expect(Array.isArray(metrics.hourlyStats)).toBe(true);
    });
  });

  describe('generateCustomReport', () => {
    beforeEach(async () => {
      // Create test data for custom reports
      await ConversionEvent.create([
        {
          trackingCode: 'TEST_TRACKING_123',
          customerId: 'customer1',
          productId: testProduct._id.toString(),
          initialSpendAmount: 1000,
          conversionTimestamp: new Date('2024-01-15'),
          attributionMethod: 'cookie',
          commissionEligible: true,
          deduplicationKey: 'dedup1'
        },
        {
          trackingCode: 'TEST_TRACKING_123',
          customerId: 'customer2',
          productId: testProduct._id.toString(),
          initialSpendAmount: 2000,
          conversionTimestamp: new Date('2024-01-16'),
          attributionMethod: 'portal',
          commissionEligible: true,
          deduplicationKey: 'dedup2'
        }
      ]);
    });

    it('should generate custom conversion report', async () => {
      const filters = {
        startDate: '2024-01-01',
        endDate: '2024-01-31'
      };

      const report = await AnalyticsService.generateCustomReport(
        'conversions',
        filters
      );

      expect(report.data).toHaveLength(2);
      expect(report.totalCount).toBe(2);
    });

    it('should generate grouped custom report', async () => {
      const filters = {
        startDate: '2024-01-01',
        endDate: '2024-01-31'
      };

      const report = await AnalyticsService.generateCustomReport(
        'conversions',
        filters,
        'productId'
      );

      expect(report.data).toHaveLength(1);
      expect(report.data[0]).toMatchObject({
        productId: testProduct._id.toString(),
        count: 2,
        totalRevenue: 3000,
        avgRevenue: 1500
      });
    });

    it('should apply limit to custom report', async () => {
      const filters = {
        startDate: '2024-01-01',
        endDate: '2024-01-31'
      };

      const report = await AnalyticsService.generateCustomReport(
        'conversions',
        filters,
        undefined,
        undefined,
        1
      );

      expect(report.data).toHaveLength(1);
    });

    it('should throw error for invalid report type', async () => {
      await expect(
        AnalyticsService.generateCustomReport('invalid' as any, {})
      ).rejects.toThrow('Failed to generate custom report');
    });
  });

  describe('exportData', () => {
    const sampleData = {
      data: [
        { id: 1, name: 'Test 1', value: 100 },
        { id: 2, name: 'Test 2', value: 200 }
      ],
      totalCount: 2
    };

    it('should export data as JSON', async () => {
      const exported = await AnalyticsService.exportData(sampleData, {
        format: 'json'
      });

      const parsed = JSON.parse(exported as string);
      expect(parsed.data).toEqual(sampleData.data);
      expect(parsed.totalCount).toBe(2);
      expect(parsed.exportedAt).toBeDefined();
    });

    it('should export data as CSV', async () => {
      const exported = await AnalyticsService.exportData(sampleData, {
        format: 'csv'
      });

      const csvString = exported as string;
      expect(csvString).toContain('id,name,value');
      expect(csvString).toContain('1,Test 1,100');
      expect(csvString).toContain('2,Test 2,200');
    });

    it('should export CSV without headers', async () => {
      const exported = await AnalyticsService.exportData(sampleData, {
        format: 'csv',
        includeHeaders: false
      });

      const csvString = exported as string;
      expect(csvString).not.toContain('id,name,value');
      expect(csvString).toContain('1,Test 1,100');
    });

    it('should throw error for XLSX format (not implemented)', async () => {
      await expect(
        AnalyticsService.exportData(sampleData, { format: 'xlsx' })
      ).rejects.toThrow('Failed to export data');
    });

    it('should throw error for unsupported format', async () => {
      await expect(
        AnalyticsService.exportData(sampleData, { format: 'pdf' as any })
      ).rejects.toThrow('Failed to export data');
    });
  });

  describe('Real-time analytics', () => {
    it('should initialize and close real-time analytics', async () => {
      await expect(AnalyticsService.initializeRealtimeAnalytics()).resolves.not.toThrow();
      await expect(AnalyticsService.closeRealtimeAnalytics()).resolves.not.toThrow();
    });

    it('should register and unregister callbacks', () => {
      const callback = jest.fn();
      
      AnalyticsService.registerRealtimeCallback(callback);
      AnalyticsService.unregisterRealtimeCallback(callback);
      
      // Should not throw
      expect(true).toBe(true);
    });
  });
});