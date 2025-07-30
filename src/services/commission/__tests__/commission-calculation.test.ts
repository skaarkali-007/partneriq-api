import { CommissionService, CommissionRules } from '../index';
import { Commission } from '../../../models/Commission';
import { CommissionAdjustment } from '../../../models/CommissionAdjustment';
import { Product } from '../../../models/Product';
import { User } from '../../../models/User';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

describe('Commission Calculation Engine Tests', () => {
  let mongoServer: MongoMemoryServer;
  let testMarketer: any;
  let testProduct: any;
  let testProductFlat: any;

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
    await Commission.deleteMany({});
    await CommissionAdjustment.deleteMany({});
    await Product.deleteMany({});
    await User.deleteMany({});

    // Create test marketer
    testMarketer = await User.create({
      email: 'marketer@test.com',
      password: 'password123',
      role: 'marketer',
      status: 'active',
      emailVerified: true
    });

    // Create test product with percentage commission
    testProduct = await Product.create({
      name: 'Test Investment Product',
      description: 'A test investment product',
      category: 'investment',
      commissionType: 'percentage',
      commissionRate: 0.05, // 5%
      minInitialSpend: 1000,
      status: 'active',
      landingPageUrl: 'https://example.com/product'
    });

    // Create test product with flat commission
    testProductFlat = await Product.create({
      name: 'Test Flat Commission Product',
      description: 'A test product with flat commission',
      category: 'insurance',
      commissionType: 'flat',
      commissionFlatAmount: 100,
      minInitialSpend: 500,
      status: 'active',
      landingPageUrl: 'https://example.com/product-flat'
    });
  });

  describe('calculateCommissionAmount', () => {
    it('should calculate percentage-based commission correctly', () => {
      const rules: CommissionRules = {
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000
      };

      const result = CommissionService.calculateCommissionAmount(2000, rules);
      
      expect(result.commissionRate).toBe(0.05);
      expect(result.commissionAmount).toBe(100); // 2000 * 0.05
    });

    it('should calculate flat commission correctly', () => {
      const rules: CommissionRules = {
        commissionType: 'flat',
        commissionFlatAmount: 100,
        minInitialSpend: 500
      };

      const result = CommissionService.calculateCommissionAmount(2000, rules);
      
      expect(result.commissionRate).toBe(0.05); // 100/2000
      expect(result.commissionAmount).toBe(100);
    });

    it('should use custom commission rate when provided with override', () => {
      const rules: CommissionRules = {
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000
      };

      const result = CommissionService.calculateCommissionAmount(
        2000, 
        rules, 
        0.07, // Custom rate
        undefined, 
        true // Override
      );
      
      expect(result.commissionRate).toBe(0.07);
      expect(result.commissionAmount).toBe(140); // 2000 * 0.07
    });

    it('should use custom commission amount when provided with override', () => {
      const rules: CommissionRules = {
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000
      };

      const result = CommissionService.calculateCommissionAmount(
        2000, 
        rules, 
        undefined, 
        150, // Custom amount
        true // Override
      );
      
      expect(result.commissionRate).toBe(0.075); // 150/2000
      expect(result.commissionAmount).toBe(150);
    });

    it('should ignore custom values when override is false', () => {
      const rules: CommissionRules = {
        commissionType: 'percentage',
        commissionRate: 0.05,
        minInitialSpend: 1000
      };

      const result = CommissionService.calculateCommissionAmount(
        2000, 
        rules, 
        0.07, // Custom rate (should be ignored)
        undefined, 
        false // No override
      );
      
      expect(result.commissionRate).toBe(0.05);
      expect(result.commissionAmount).toBe(100); // 2000 * 0.05
    });

    it('should throw error for missing commission rate', () => {
      const rules: CommissionRules = {
        commissionType: 'percentage',
        // commissionRate is missing
        minInitialSpend: 1000
      };

      expect(() => {
        CommissionService.calculateCommissionAmount(2000, rules);
      }).toThrow('Product commission rate is not defined');
    });

    it('should throw error for missing flat amount', () => {
      const rules: CommissionRules = {
        commissionType: 'flat',
        // commissionFlatAmount is missing
        minInitialSpend: 500
      };

      expect(() => {
        CommissionService.calculateCommissionAmount(2000, rules);
      }).toThrow('Product flat commission amount is not defined');
    });

    it('should use tiered rates when available', () => {
      const rules: CommissionRules = {
        commissionType: 'percentage',
        commissionRate: 0.03, // Default rate
        minInitialSpend: 1000,
        tieredRates: [
          { minAmount: 1000, maxAmount: 5000, rate: 0.05 },
          { minAmount: 5000, maxAmount: 10000, rate: 0.07 },
          { minAmount: 10000, rate: 0.1 }
        ]
      };

      // Test tier 1
      let result = CommissionService.calculateCommissionAmount(3000, rules);
      expect(result.commissionRate).toBe(0.05);
      expect(result.commissionAmount).toBe(150); // 3000 * 0.05

      // Test tier 2
      result = CommissionService.calculateCommissionAmount(7500, rules);
      expect(result.commissionRate).toBe(0.07);
      expect(result.commissionAmount).toBe(525); // 7500 * 0.07

      // Test tier 3
      result = CommissionService.calculateCommissionAmount(15000, rules);
      expect(result.commissionRate).toBe(0.1);
      expect(result.commissionAmount).toBe(1500); // 15000 * 0.1
    });
  });

  describe('calculateCommission', () => {
    it('should calculate commission with custom rate', async () => {
      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProduct._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 2000,
        conversionDate: new Date(),
        customCommissionRate: 0.07, // Custom rate
        overrideProductRules: true
      };

      const commission = await CommissionService.calculateCommission(commissionData);

      expect(commission.commissionRate).toBe(0.07);
      expect(commission.commissionAmount).toBe(140); // 2000 * 0.07
    });

    it('should calculate commission with custom amount', async () => {
      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProduct._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 2000,
        conversionDate: new Date(),
        customCommissionAmount: 150, // Custom amount
        overrideProductRules: true
      };

      const commission = await CommissionService.calculateCommission(commissionData);

      expect(commission.commissionAmount).toBe(150);
      expect(commission.commissionRate).toBe(0.075); // 150/2000
    });

    it('should allow spend below minimum when overriding rules', async () => {
      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProduct._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 500, // Below minimum of 1000
        conversionDate: new Date(),
        customCommissionRate: 0.05,
        overrideProductRules: true
      };

      const commission = await CommissionService.calculateCommission(commissionData);

      expect(commission.initialSpendAmount).toBe(500);
      expect(commission.commissionAmount).toBe(25); // 500 * 0.05
    });

    it('should reject spend below minimum when not overriding rules', async () => {
      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProduct._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 500, // Below minimum of 1000
        conversionDate: new Date()
      };

      await expect(CommissionService.calculateCommission(commissionData))
        .rejects.toThrow('Initial spend amount 500 is below minimum required 1000');
    });
  });

  describe('batchCalculateCommissions', () => {
    it('should process multiple commissions in batch', async () => {
      const commissionDataArray = [
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer1',
          productId: testProduct._id.toString(),
          trackingCode: 'track1',
          initialSpendAmount: 2000,
          conversionDate: new Date()
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer2',
          productId: testProductFlat._id.toString(),
          trackingCode: 'track2',
          initialSpendAmount: 1000,
          conversionDate: new Date()
        }
      ];

      const result = await CommissionService.batchCalculateCommissions(commissionDataArray);

      expect(result.commissions).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      
      // Verify first commission
      expect(result.commissions[0].customerId).toBe('customer1');
      expect(result.commissions[0].commissionAmount).toBe(100); // 2000 * 0.05
      
      // Verify second commission
      expect(result.commissions[1].customerId).toBe('customer2');
      expect(result.commissions[1].commissionAmount).toBe(100); // Flat amount
    });

    it('should handle errors in batch processing', async () => {
      const commissionDataArray = [
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer1',
          productId: testProduct._id.toString(),
          trackingCode: 'track1',
          initialSpendAmount: 2000,
          conversionDate: new Date()
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer2',
          productId: testProduct._id.toString(),
          trackingCode: 'track2',
          initialSpendAmount: 500, // Below minimum
          conversionDate: new Date()
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer3',
          productId: 'invalid-product-id', // Invalid product
          trackingCode: 'track3',
          initialSpendAmount: 2000,
          conversionDate: new Date()
        }
      ];

      const result = await CommissionService.batchCalculateCommissions(commissionDataArray);

      expect(result.commissions).toHaveLength(1);
      expect(result.errors).toHaveLength(2);
      
      // Verify successful commission
      expect(result.commissions[0].customerId).toBe('customer1');
      
      // Verify errors
      expect(result.errors[0].index).toBe(1);
      expect(result.errors[0].error).toContain('below minimum required');
      
      expect(result.errors[1].index).toBe(2);
      expect(result.errors[1].error).toContain('Invalid or inactive product');
    });
  });

  describe('recalculateCommission', () => {
    let testCommission: any;

    beforeEach(async () => {
      // Create a test commission
      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 2000,
        commissionRate: 0.05,
        commissionAmount: 100,
        status: 'pending',
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        eligibleForPayoutDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
    });

    it('should recalculate commission with new rate', async () => {
      const updatedCommission = await CommissionService.recalculateCommission(
        testCommission._id.toString(),
        undefined, // No custom amount
        0.07 // New rate
      );

      expect(updatedCommission.commissionRate).toBe(0.07);
      expect(updatedCommission.commissionAmount).toBe(140); // 2000 * 0.07
    });

    it('should recalculate commission with new amount', async () => {
      const updatedCommission = await CommissionService.recalculateCommission(
        testCommission._id.toString(),
        150 // New amount
      );

      expect(updatedCommission.commissionAmount).toBe(150);
      expect(updatedCommission.commissionRate).toBe(0.075); // 150/2000
    });

    it('should create adjustment record when admin ID is provided', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      
      await CommissionService.recalculateCommission(
        testCommission._id.toString(),
        150, // New amount
        undefined,
        adminId
      );

      // Check for adjustment record
      const adjustment = await CommissionAdjustment.findOne({
        commissionId: testCommission._id.toString()
      });

      expect(adjustment).toBeDefined();
      expect(adjustment!.adjustmentType).toBe('correction');
      expect(adjustment!.amount).toBe(50); // 150 - 100
      expect(adjustment!.adminId).toBe(adminId);
    });

    it('should reject recalculation for non-pending commissions', async () => {
      // Update commission status to approved
      await Commission.findByIdAndUpdate(testCommission._id, { status: 'approved' });

      await expect(CommissionService.recalculateCommission(
        testCommission._id.toString(),
        150
      )).rejects.toThrow('Only pending commissions can be recalculated');
    });

    it('should throw error for non-existent commission', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      
      await expect(CommissionService.recalculateCommission(fakeId, 150))
        .rejects.toThrow('Commission not found');
    });
  });

  describe('getProductCommissionPerformance', () => {
    beforeEach(async () => {
      // Create test commissions for product performance analysis
      await Commission.create([
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer1',
          productId: testProduct._id.toString(),
          trackingCode: 'track1',
          initialSpendAmount: 1000,
          commissionRate: 0.05,
          commissionAmount: 50,
          status: 'pending',
          conversionDate: new Date(),
          clearancePeriodDays: 30,
          eligibleForPayoutDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer2',
          productId: testProduct._id.toString(),
          trackingCode: 'track2',
          initialSpendAmount: 2000,
          commissionRate: 0.05,
          commissionAmount: 100,
          status: 'approved',
          conversionDate: new Date(),
          clearancePeriodDays: 30,
          eligibleForPayoutDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer3',
          productId: testProduct._id.toString(),
          trackingCode: 'track3',
          initialSpendAmount: 3000,
          commissionRate: 0.05,
          commissionAmount: 150,
          status: 'paid',
          conversionDate: new Date(),
          clearancePeriodDays: 30,
          eligibleForPayoutDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
        }
      ]);
    });

    it('should return correct product performance metrics', async () => {
      const performance = await CommissionService.getProductCommissionPerformance(
        testProduct._id.toString()
      );

      expect(performance.totalCommissions).toBe(3);
      expect(performance.totalAmount).toBe(300); // 50 + 100 + 150
      expect(performance.averageCommission).toBe(100); // 300 / 3
      
      // Check status breakdown
      expect(performance.statusBreakdown.pending.count).toBe(1);
      expect(performance.statusBreakdown.pending.amount).toBe(50);
      
      expect(performance.statusBreakdown.approved.count).toBe(1);
      expect(performance.statusBreakdown.approved.amount).toBe(100);
      
      expect(performance.statusBreakdown.paid.count).toBe(1);
      expect(performance.statusBreakdown.paid.amount).toBe(150);
    });

    it('should return empty results for product with no commissions', async () => {
      const newProductId = new mongoose.Types.ObjectId().toString();
      
      const performance = await CommissionService.getProductCommissionPerformance(newProductId);

      expect(performance.totalCommissions).toBe(0);
      expect(performance.totalAmount).toBe(0);
      expect(performance.averageCommission).toBe(0);
      expect(Object.keys(performance.statusBreakdown).length).toBe(0);
    });
  });
});