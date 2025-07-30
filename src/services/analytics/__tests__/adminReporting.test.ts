import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AdminReportingService } from '../adminReporting';
import { ClickEvent } from '../../../models/ClickEvent';
import { ConversionEvent } from '../../../models/ConversionEvent';
import { ReferralLink } from '../../../models/ReferralLink';
import { Commission } from '../../../models/Commission';
import { PayoutRequest } from '../../../models/PayoutRequest';
import { User } from '../../../models/User';
import { Product } from '../../../models/Product';
import { AuditLog } from '../../../models/AuditLog';

describe('AdminReportingService', () => {
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
      PayoutRequest.deleteMany({}),
      User.deleteMany({}),
      Product.deleteMany({}),
      AuditLog.deleteMany({})
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

  describe('getPlatformPerformanceDashboard', () => {
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
        }
      ]);

      // Create a payment method first
      const testPaymentMethod = await mongoose.connection.collection('paymentmethods').insertOne({
        userId: testUser._id,
        methodType: 'bank_transfer',
        accountDetails: { accountNumber: '123456789' },
        isDefault: true,
        isVerified: true,
        createdAt: new Date()
      });

      await PayoutRequest.create([
        {
          marketerId: testUser._id.toString(),
          paymentMethodId: testPaymentMethod.insertedId.toString(),
          amount: 150,
          status: 'completed',
          requestedAt: new Date('2024-01-20'),
          completedAt: new Date('2024-01-22')
        }
      ]);
    });

    it('should return platform performance dashboard', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const dashboard = await AdminReportingService.getPlatformPerformanceDashboard(startDate, endDate);

      expect(dashboard).toMatchObject({
        overview: {
          totalMarketers: 1,
          activeMarketers: 1,
          totalProducts: 1,
          activeProducts: 1,
          totalClicks: 3,
          totalConversions: 2,
          totalCommissions: 2,
          totalPayouts: 1,
          platformConversionRate: 66.67
        },
        period: {
          start: startDate,
          end: endDate
        }
      });

      expect(dashboard.trends).toHaveProperty('daily');
      expect(dashboard.trends).toHaveProperty('monthly');
      expect(dashboard.topPerformers).toHaveProperty('marketers');
      expect(dashboard.topPerformers).toHaveProperty('products');
    });

    it('should include daily trends data', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const dashboard = await AdminReportingService.getPlatformPerformanceDashboard(startDate, endDate);

      expect(dashboard.trends.daily).toHaveLength(3); // 3 days with activity
      expect(dashboard.trends.daily[0]).toHaveProperty('date');
      expect(dashboard.trends.daily[0]).toHaveProperty('clicks');
      expect(dashboard.trends.daily[0]).toHaveProperty('conversions');
      expect(dashboard.trends.daily[0]).toHaveProperty('commissions');
      expect(dashboard.trends.daily[0]).toHaveProperty('revenue');
    });

    it('should include top performers data', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const dashboard = await AdminReportingService.getPlatformPerformanceDashboard(startDate, endDate);

      expect(dashboard.topPerformers.marketers).toHaveLength(1);
      expect(dashboard.topPerformers.marketers[0]).toMatchObject({
        marketerId: testUser._id.toString(),
        marketerName: 'Test Marketer',
        conversions: 2,
        revenue: 3000,
        commissions: 150
      });

      expect(dashboard.topPerformers.products).toHaveLength(1);
      expect(dashboard.topPerformers.products[0]).toMatchObject({
        productId: testProduct._id.toString(),
        productName: 'Test Product',
        conversions: 2,
        revenue: 3000,
        commissions: 150
      });
    });

    it('should return empty dashboard for date range with no data', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      const dashboard = await AdminReportingService.getPlatformPerformanceDashboard(startDate, endDate);

      expect(dashboard.overview).toMatchObject({
        totalMarketers: 1, // Users still exist
        activeMarketers: 1,
        totalProducts: 1, // Products still exist
        activeProducts: 1,
        totalClicks: 0,
        totalConversions: 0,
        totalCommissions: 0,
        totalPayouts: 0,
        platformConversionRate: 0
      });

      expect(dashboard.trends.daily).toHaveLength(0);
      expect(dashboard.topPerformers.marketers).toHaveLength(0);
      expect(dashboard.topPerformers.products).toHaveLength(0);
    });
  });

  describe('getFinancialReport', () => {
    beforeEach(async () => {
      // Create financial test data
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

      // Create a payment method first
      const testPaymentMethod = await mongoose.connection.collection('paymentmethods').insertOne({
        userId: testUser._id,
        methodType: 'bank_transfer',
        accountDetails: { accountNumber: '123456789' },
        isDefault: true,
        isVerified: true,
        createdAt: new Date()
      });

      await PayoutRequest.create([
        {
          marketerId: testUser._id.toString(),
          paymentMethodId: testPaymentMethod.insertedId.toString(),
          amount: 150,
          status: 'completed',
          requestedAt: new Date('2024-01-20'),
          completedAt: new Date('2024-01-22')
        },
        {
          marketerId: testUser._id.toString(),
          paymentMethodId: testPaymentMethod.insertedId.toString(),
          amount: 75,
          status: 'requested',
          requestedAt: new Date('2024-01-25')
        }
      ]);
    });

    it('should return comprehensive financial report', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const report = await AdminReportingService.getFinancialReport(startDate, endDate);

      expect(report.summary).toMatchObject({
        totalRevenue: 3000,
        totalCommissions: 225, // 50 + 100 + 75
        totalPayouts: 225, // 150 + 75
        pendingCommissions: 75,
        pendingPayouts: 75,
        netProfit: 2550 // 3000 - 225 - 225
      });

      expect(report.period).toMatchObject({
        start: startDate,
        end: endDate
      });
    });

    it('should include commission breakdown by status', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const report = await AdminReportingService.getFinancialReport(startDate, endDate);

      expect(report.commissionBreakdown.byStatus).toHaveLength(3);
      
      const statusBreakdown = report.commissionBreakdown.byStatus.reduce((acc: any, item: any) => {
        acc[item.status] = item;
        return acc;
      }, {});

      expect(statusBreakdown.approved).toMatchObject({
        status: 'approved',
        count: 1,
        amount: 50
      });

      expect(statusBreakdown.paid).toMatchObject({
        status: 'paid',
        count: 1,
        amount: 100
      });

      expect(statusBreakdown.pending).toMatchObject({
        status: 'pending',
        count: 1,
        amount: 75
      });
    });

    it('should include commission breakdown by product and marketer', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const report = await AdminReportingService.getFinancialReport(startDate, endDate);

      expect(report.commissionBreakdown.byProduct).toHaveLength(1);
      expect(report.commissionBreakdown.byProduct[0]).toMatchObject({
        productId: testProduct._id.toString(),
        productName: 'Test Product',
        commissions: 2, // Only approved and paid
        amount: 150
      });

      expect(report.commissionBreakdown.byMarketer).toHaveLength(1);
      expect(report.commissionBreakdown.byMarketer[0]).toMatchObject({
        marketerId: testUser._id.toString(),
        marketerName: 'Test Marketer',
        commissions: 2, // Only approved and paid
        amount: 150
      });
    });

    it('should include payout breakdown by status', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const report = await AdminReportingService.getFinancialReport(startDate, endDate);

      expect(report.payoutBreakdown.byStatus).toHaveLength(2);
      
      const statusBreakdown = report.payoutBreakdown.byStatus.reduce((acc: any, item: any) => {
        acc[item.status] = item;
        return acc;
      }, {});

      expect(statusBreakdown.completed).toMatchObject({
        status: 'completed',
        count: 1,
        amount: 150
      });

      expect(statusBreakdown.requested).toMatchObject({
        status: 'requested',
        count: 1,
        amount: 75
      });
    });

    it('should include cash flow data', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const report = await AdminReportingService.getFinancialReport(startDate, endDate);

      expect(Array.isArray(report.cashFlow)).toBe(true);
      expect(report.cashFlow.length).toBeGreaterThan(0);
      
      if (report.cashFlow.length > 0) {
        expect(report.cashFlow[0]).toHaveProperty('date');
        expect(report.cashFlow[0]).toHaveProperty('revenue');
        expect(report.cashFlow[0]).toHaveProperty('commissions');
        expect(report.cashFlow[0]).toHaveProperty('payouts');
        expect(report.cashFlow[0]).toHaveProperty('netCashFlow');
      }
    });
  });

  describe('getComplianceReport', () => {
    beforeEach(async () => {
      // Create audit log test data
      await AuditLog.create([
        {
          adminId: testUser._id.toString(),
          action: 'admin_login',
          resource: 'system',
          timestamp: new Date('2024-01-15'),
          ipAddress: '192.168.1.1',
          details: { reason: 'Regular login' }
        },
        {
          adminId: testUser._id.toString(),
          action: 'data_export',
          resource: 'user',
          timestamp: new Date('2024-01-16'),
          ipAddress: '192.168.1.1',
          details: { reason: 'Data access request' }
        },
        {
          adminId: testUser._id.toString(),
          action: 'admin_login',
          resource: 'system',
          timestamp: new Date('2024-01-17'),
          ipAddress: '192.168.1.2',
          details: { reason: 'Failed login attempt' }
        }
      ]);
    });

    it('should return compliance report with audit trail', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const report = await AdminReportingService.getComplianceReport(startDate, endDate);

      expect(report).toMatchObject({
        gdprCompliance: {
          dataAccessRequests: 0,
          dataExportRequests: 0,
          dataDeletionRequests: 0,
          consentWithdrawals: 0,
          averageResponseTime: 0
        },
        period: {
          start: startDate,
          end: endDate
        }
      });

      expect(report.auditTrail).toHaveProperty('totalEvents');
      expect(report.auditTrail).toHaveProperty('criticalEvents');
      expect(report.auditTrail).toHaveProperty('securityEvents');
      expect(report.auditTrail).toHaveProperty('dataAccessEvents');
      expect(report.auditTrail).toHaveProperty('recentEvents');

      expect(report.auditTrail.totalEvents).toBe(3);
      expect(report.auditTrail.criticalEvents).toBe(1);
      expect(report.auditTrail.securityEvents).toBe(2);
      expect(report.auditTrail.dataAccessEvents).toBe(1);
    });

    it('should include user activity statistics', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const report = await AdminReportingService.getComplianceReport(startDate, endDate);

      expect(report.userActivity).toMatchObject({
        activeUsers: 1,
        suspendedUsers: 0,
        revokedUsers: 0,
        newRegistrations: 1, // testUser was created in this period
        failedLogins: 0
      });
    });

    it('should include data retention information', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const report = await AdminReportingService.getComplianceReport(startDate, endDate);

      expect(report.dataRetention).toMatchObject({
        recordsScheduledForDeletion: 0,
        recordsDeleted: 0,
        anonymizedRecords: 0,
        retentionPolicyViolations: 0
      });
    });

    it('should include recent audit events', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const report = await AdminReportingService.getComplianceReport(startDate, endDate);

      expect(Array.isArray(report.auditTrail.recentEvents)).toBe(true);
      expect(report.auditTrail.recentEvents.length).toBeLessThanOrEqual(50);
      
      if (report.auditTrail.recentEvents.length > 0) {
        expect(report.auditTrail.recentEvents[0]).toHaveProperty('timestamp');
        expect(report.auditTrail.recentEvents[0]).toHaveProperty('userId');
        expect(report.auditTrail.recentEvents[0]).toHaveProperty('action');
        expect(report.auditTrail.recentEvents[0]).toHaveProperty('resource');
        expect(report.auditTrail.recentEvents[0]).toHaveProperty('ipAddress');
        expect(report.auditTrail.recentEvents[0]).toHaveProperty('severity');
      }
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Close the database connection to simulate an error
      await mongoose.disconnect();

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      await expect(
        AdminReportingService.getPlatformPerformanceDashboard(startDate, endDate)
      ).rejects.toThrow('Failed to generate platform performance dashboard');

      await expect(
        AdminReportingService.getFinancialReport(startDate, endDate)
      ).rejects.toThrow('Failed to generate financial report');

      await expect(
        AdminReportingService.getComplianceReport(startDate, endDate)
      ).rejects.toThrow('Failed to generate compliance report');

      // Reconnect for cleanup
      const mongoUri = mongoServer.getUri();
      await mongoose.connect(mongoUri);
    });
  });
});