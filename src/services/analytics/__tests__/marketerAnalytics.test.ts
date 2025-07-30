import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MarketerAnalyticsService } from '../marketerAnalytics';
import { ClickEvent } from '../../../models/ClickEvent';
import { ConversionEvent } from '../../../models/ConversionEvent';
import { ReferralLink } from '../../../models/ReferralLink';
import { Commission } from '../../../models/Commission';
import { User } from '../../../models/User';
import { Product } from '../../../models/Product';

describe('MarketerAnalyticsService', () => {
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
      email: 'marketer@example.com',
      password: 'hashedpassword123',
      firstName: 'Test',
      lastName: 'Marketer',
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

  describe('getConversionRateAnalysis', () => {
    beforeEach(async () => {
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
        },
        {
          trackingCode: 'TEST_TRACKING_123',
          ipAddress: '192.168.1.3',
          userAgent: 'Mozilla/5.0',
          timestamp: new Date('2024-01-17'),
          sessionId: 'session3',
          customerId: 'customer3'
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

    it('should return conversion rate analysis for a marketer', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const analysis = await MarketerAnalyticsService.getConversionRateAnalysis(
        testUser._id.toString(),
        startDate,
        endDate
      );

      expect(analysis).toMatchObject({
        marketerId: testUser._id.toString(),
        totalClicks: 3,
        totalConversions: 2,
        conversionRate: 66.67,
        period: {
          start: startDate,
          end: endDate
        }
      });

      expect(analysis.byProduct).toHaveLength(1);
      expect(analysis.byTimeframe).toHaveLength(3); // 3 days with clicks
    });

    it('should return empty analysis for marketer with no referral links', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      // Create another user without referral links
      const anotherUser = await User.create({
        email: 'another@example.com',
        password: 'hashedpassword123',
        firstName: 'Another',
        lastName: 'User',
        role: 'marketer',
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        mfaSetupCompleted: false
      });

      const analysis = await MarketerAnalyticsService.getConversionRateAnalysis(
        anotherUser._id.toString(),
        startDate,
        endDate
      );

      expect(analysis).toMatchObject({
        marketerId: anotherUser._id.toString(),
        totalClicks: 0,
        totalConversions: 0,
        conversionRate: 0,
        byProduct: [],
        byTimeframe: []
      });
    });

    it('should filter by date range correctly', async () => {
      const startDate = new Date('2024-01-16');
      const endDate = new Date('2024-01-16');

      const analysis = await MarketerAnalyticsService.getConversionRateAnalysis(
        testUser._id.toString(),
        startDate,
        endDate
      );

      expect(analysis.totalClicks).toBe(1);
      expect(analysis.totalConversions).toBe(1);
      expect(analysis.conversionRate).toBe(100);
    });
  });

  describe('getCommissionTrendAnalysis', () => {
    beforeEach(async () => {
      // Create test commissions
      await Commission.create([
        {
          marketerId: testUser._id.toString(),
          customerId: 'customer1',
          productId: testProduct._id.toString(),
          trackingCode: 'TEST_TRACKING_123',
          initialSpendAmount: 1000,
          commissionRate: 0.05,
          commissionAmount: 50,
          status: 'approved',
          conversionDate: new Date('2024-01-15')
        },
        {
          marketerId: testUser._id.toString(),
          customerId: 'customer2',
          productId: testProduct._id.toString(),
          trackingCode: 'TEST_TRACKING_123',
          initialSpendAmount: 2000,
          commissionRate: 0.05,
          commissionAmount: 100,
          status: 'paid',
          conversionDate: new Date('2024-01-16')
        },
        {
          marketerId: testUser._id.toString(),
          customerId: 'customer3',
          productId: testProduct._id.toString(),
          trackingCode: 'TEST_TRACKING_123',
          initialSpendAmount: 1500,
          commissionRate: 0.05,
          commissionAmount: 75,
          status: 'pending',
          conversionDate: new Date('2024-01-17')
        }
      ]);
    });

    it('should return commission trend analysis for a marketer', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const analysis = await MarketerAnalyticsService.getCommissionTrendAnalysis(
        testUser._id.toString(),
        startDate,
        endDate
      );

      expect(analysis).toMatchObject({
        marketerId: testUser._id.toString(),
        totalCommissions: 2, // Only approved and paid
        totalAmount: 150,
        averageCommission: 75,
        period: {
          start: startDate,
          end: endDate
        }
      });

      expect(analysis.byProduct).toHaveLength(1);
      expect(analysis.statusBreakdown).toHaveLength(3);
      expect(analysis.trends).toHaveLength(2); // Only approved and paid commissions
    });

    it('should include cumulative amounts in trends', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const analysis = await MarketerAnalyticsService.getCommissionTrendAnalysis(
        testUser._id.toString(),
        startDate,
        endDate
      );

      const trends = analysis.trends;
      expect(trends).toHaveLength(2);
      
      if (trends.length >= 2) {
        expect(trends[0].cumulativeAmount).toBe(50);
        expect(trends[1].cumulativeAmount).toBe(150);
      }
    });

    it('should return empty analysis for date range with no commissions', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      const analysis = await MarketerAnalyticsService.getCommissionTrendAnalysis(
        testUser._id.toString(),
        startDate,
        endDate
      );

      expect(analysis).toMatchObject({
        marketerId: testUser._id.toString(),
        totalCommissions: 0,
        totalAmount: 0,
        averageCommission: 0,
        trends: [],
        byProduct: [],
        statusBreakdown: []
      });
    });
  });

  describe('getCustomerAcquisitionCost', () => {
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
        },
        {
          trackingCode: 'TEST_TRACKING_123',
          customerId: 'customer3',
          productId: testProduct._id.toString(),
          initialSpendAmount: 1500,
          conversionTimestamp: new Date('2024-02-15'),
          attributionMethod: 'cookie',
          commissionEligible: true,
          deduplicationKey: 'dedup3'
        }
      ]);
    });

    it('should calculate customer acquisition cost with marketing spend', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const marketingSpend = 300;

      const analysis = await MarketerAnalyticsService.getCustomerAcquisitionCost(
        testUser._id.toString(),
        startDate,
        endDate,
        marketingSpend
      );

      expect(analysis).toMatchObject({
        marketerId: testUser._id.toString(),
        totalCustomers: 2,
        totalSpend: 3000,
        averageCustomerValue: 1500,
        acquisitionCost: 150, // 300 / 2 customers
        period: {
          start: startDate,
          end: endDate
        }
      });

      expect(analysis.byProduct).toHaveLength(1);
      expect(analysis.cohortAnalysis).toHaveLength(1);
    });

    it('should calculate customer acquisition cost without marketing spend', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const analysis = await MarketerAnalyticsService.getCustomerAcquisitionCost(
        testUser._id.toString(),
        startDate,
        endDate
      );

      expect(analysis).toMatchObject({
        marketerId: testUser._id.toString(),
        totalCustomers: 2,
        totalSpend: 3000,
        averageCustomerValue: 1500,
        acquisitionCost: 0, // No marketing spend provided
        period: {
          start: startDate,
          end: endDate
        }
      });
    });

    it('should group customers by cohort month', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-02-28');

      const analysis = await MarketerAnalyticsService.getCustomerAcquisitionCost(
        testUser._id.toString(),
        startDate,
        endDate
      );

      expect(analysis.cohortAnalysis).toHaveLength(2);
      expect(analysis.cohortAnalysis[0].cohortMonth).toBe('2024-01');
      expect(analysis.cohortAnalysis[1].cohortMonth).toBe('2024-02');
    });

    it('should return empty analysis for marketer with no referral links', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      // Create another user without referral links
      const anotherUser = await User.create({
        email: 'another@example.com',
        password: 'hashedpassword123',
        firstName: 'Another',
        lastName: 'User',
        role: 'marketer',
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        mfaSetupCompleted: false
      });

      const analysis = await MarketerAnalyticsService.getCustomerAcquisitionCost(
        anotherUser._id.toString(),
        startDate,
        endDate
      );

      expect(analysis).toMatchObject({
        marketerId: anotherUser._id.toString(),
        totalCustomers: 0,
        totalSpend: 0,
        averageCustomerValue: 0,
        acquisitionCost: 0,
        byProduct: [],
        cohortAnalysis: []
      });
    });
  });

  describe('getPerformanceBenchmark', () => {
    beforeEach(async () => {
      // Create comprehensive test data
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

      await Commission.create([
        {
          marketerId: testUser._id.toString(),
          customerId: 'customer1',
          productId: testProduct._id.toString(),
          trackingCode: 'TEST_TRACKING_123',
          initialSpendAmount: 1000,
          commissionRate: 0.05,
          commissionAmount: 50,
          status: 'approved',
          conversionDate: new Date('2024-01-15')
        }
      ]);
    });

    it('should return performance benchmark for a marketer', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const benchmark = await MarketerAnalyticsService.getPerformanceBenchmark(
        testUser._id.toString(),
        startDate,
        endDate
      );

      expect(benchmark).toMatchObject({
        marketerId: testUser._id.toString(),
        metrics: {
          conversionRate: 50, // 1 conversion out of 2 clicks
          averageCommission: 50,
          customerValue: 1000,
          acquisitionCost: 0
        }
      });

      expect(benchmark.benchmarks).toHaveProperty('conversionRate');
      expect(benchmark.benchmarks).toHaveProperty('averageCommission');
      expect(benchmark.benchmarks).toHaveProperty('customerValue');
      expect(benchmark.benchmarks).toHaveProperty('acquisitionCost');

      expect(benchmark.ranking).toHaveProperty('overall');
      expect(benchmark.ranking).toHaveProperty('totalMarketers');
      expect(benchmark.ranking).toHaveProperty('category');
      expect(['top', 'above_average', 'average', 'below_average', 'bottom']).toContain(benchmark.ranking.category);
    });

    it('should calculate ranking category correctly', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const benchmark = await MarketerAnalyticsService.getPerformanceBenchmark(
        testUser._id.toString(),
        startDate,
        endDate
      );

      expect(typeof benchmark.ranking.overall).toBe('number');
      expect(benchmark.ranking.totalMarketers).toBe(100);
      expect(['top', 'above_average', 'average', 'below_average', 'bottom']).toContain(benchmark.ranking.category);
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Close the database connection to simulate an error
      await mongoose.disconnect();

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      await expect(
        MarketerAnalyticsService.getConversionRateAnalysis(
          testUser._id.toString(),
          startDate,
          endDate
        )
      ).rejects.toThrow('Failed to retrieve conversion rate analysis');

      // Reconnect for cleanup
      const mongoUri = mongoServer.getUri();
      await mongoose.connect(mongoUri);
    });
  });
});