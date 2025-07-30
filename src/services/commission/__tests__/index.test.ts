import { CommissionService } from '../index';
import { Commission } from '../../../models/Commission';
import { CommissionAdjustment } from '../../../models/CommissionAdjustment';
import { Product } from '../../../models/Product';
import { User } from '../../../models/User';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

describe('CommissionService', () => {
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

  describe('calculateCommission', () => {
    it('should calculate percentage-based commission correctly', async () => {
      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProduct._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 2000,
        conversionDate: new Date()
      };

      const commission = await CommissionService.calculateCommission(commissionData);

      expect(commission.marketerId).toBe(testMarketer._id.toString());
      expect(commission.customerId).toBe('customer123');
      expect(commission.productId).toBe(testProduct._id.toString());
      expect(commission.trackingCode).toBe('track123');
      expect(commission.initialSpendAmount).toBe(2000);
      expect(commission.commissionRate).toBe(0.05);
      expect(commission.commissionAmount).toBe(100); // 2000 * 0.05
      expect(commission.status).toBe('pending');
      expect(commission.clearancePeriodDays).toBe(30);
    });

    it('should calculate flat commission correctly', async () => {
      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProductFlat._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 1000,
        conversionDate: new Date()
      };

      const commission = await CommissionService.calculateCommission(commissionData);

      expect(commission.commissionAmount).toBe(100); // Flat amount
      expect(commission.commissionRate).toBe(0.1); // 100/1000 for tracking
    });

    it('should set eligible for payout date correctly', async () => {
      const conversionDate = new Date('2024-01-01');
      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProduct._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 2000,
        conversionDate,
        clearancePeriodDays: 15
      };

      const commission = await CommissionService.calculateCommission(commissionData);

      const expectedDate = new Date('2024-01-16'); // 15 days after conversion
      expect(commission.eligibleForPayoutDate.toDateString()).toBe(expectedDate.toDateString());
    });

    it('should throw error for inactive marketer', async () => {
      // Update marketer status to inactive
      await User.findByIdAndUpdate(testMarketer._id, { status: 'suspended' });

      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProduct._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 2000,
        conversionDate: new Date()
      };

      await expect(CommissionService.calculateCommission(commissionData))
        .rejects.toThrow('Invalid or inactive marketer');
    });

    it('should throw error for inactive product', async () => {
      // Update product status to inactive
      await Product.findByIdAndUpdate(testProduct._id, { status: 'inactive' });

      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProduct._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 2000,
        conversionDate: new Date()
      };

      await expect(CommissionService.calculateCommission(commissionData))
        .rejects.toThrow('Invalid or inactive product');
    });

    it('should throw error for spend below minimum', async () => {
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

    it('should throw error for duplicate commission', async () => {
      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: testProduct._id.toString(),
        trackingCode: 'track123',
        initialSpendAmount: 2000,
        conversionDate: new Date()
      };

      // Create first commission
      await CommissionService.calculateCommission(commissionData);

      // Try to create duplicate
      await expect(CommissionService.calculateCommission(commissionData))
        .rejects.toThrow('Commission already exists for this customer and product combination');
    });

    it('should throw error for product without commission rate', async () => {
      // Create product without commission rate by directly inserting into database
      const invalidProductData = {
        name: 'Invalid Product',
        description: 'Product without commission rate',
        category: 'test',
        commissionType: 'percentage',
        // commissionRate: undefined - this will be missing
        minInitialSpend: 100,
        status: 'active',
        landingPageUrl: 'https://example.com/invalid'
      };
      
      // Insert directly into the collection to bypass validation
      const result = await Product.collection.insertOne(invalidProductData);
      const invalidProductId = result.insertedId.toString();

      const commissionData = {
        marketerId: testMarketer._id.toString(),
        customerId: 'customer123',
        productId: invalidProductId,
        trackingCode: 'track123',
        initialSpendAmount: 2000,
        conversionDate: new Date()
      };

      await expect(CommissionService.calculateCommission(commissionData))
        .rejects.toThrow('Product commission rate is not defined');
    });
  });

  describe('getCommissionSummary', () => {
    beforeEach(async () => {
      // Create test commissions with different statuses
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
          initialSpendAmount: 1500,
          commissionRate: 0.05,
          commissionAmount: 75,
          status: 'paid',
          conversionDate: new Date(),
          clearancePeriodDays: 30,
          eligibleForPayoutDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
        }
      ]);
    });

    it('should return correct commission summary', async () => {
      const summary = await CommissionService.getCommissionSummary(testMarketer._id.toString());

      expect(summary.totalCommissions).toBe(3);
      expect(summary.pendingAmount).toBe(50);
      expect(summary.approvedAmount).toBe(100);
      expect(summary.paidAmount).toBe(75);
      expect(summary.clawedBackAmount).toBe(0);
      expect(summary.totalEarned).toBe(225); // 50 + 100 + 75
    });

    it('should return zero summary for marketer with no commissions', async () => {
      const otherMarketer = await User.create({
        email: 'other@test.com',
        password: 'password123',
        role: 'marketer',
        status: 'active',
        emailVerified: true
      });

      const summary = await CommissionService.getCommissionSummary(otherMarketer._id.toString());

      expect(summary.totalCommissions).toBe(0);
      expect(summary.pendingAmount).toBe(0);
      expect(summary.approvedAmount).toBe(0);
      expect(summary.paidAmount).toBe(0);
      expect(summary.clawedBackAmount).toBe(0);
      expect(summary.totalEarned).toBe(0);
    });
  });

  describe('updateCommissionStatus', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      // Create test admin
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
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
      });
    });

    it('should update status from pending to approved', async () => {
      const updatedCommission = await CommissionService.updateCommissionStatus(
        testCommission._id.toString(),
        'approved'
      );

      expect(updatedCommission.status).toBe('approved');
      expect(updatedCommission.approvalDate).toBeDefined();
    });

    it('should update status from pending to rejected', async () => {
      const updatedCommission = await CommissionService.updateCommissionStatus(
        testCommission._id.toString(),
        'rejected',
        testAdmin._id.toString(),
        'Invalid conversion data'
      );

      expect(updatedCommission.status).toBe('rejected');
      
      // Check that adjustment record was created
      const adjustments = await CommissionAdjustment.find({ commissionId: testCommission._id });
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].adjustmentType).toBe('status_change');
      expect(adjustments[0].reason).toContain('Invalid conversion data');
    });

    it('should update status from approved to paid', async () => {
      // First approve
      await CommissionService.updateCommissionStatus(testCommission._id.toString(), 'approved');
      
      // Then mark as paid
      const updatedCommission = await CommissionService.updateCommissionStatus(
        testCommission._id.toString(),
        'paid'
      );

      expect(updatedCommission.status).toBe('paid');
    });

    it('should create audit trail when admin ID is provided', async () => {
      await CommissionService.updateCommissionStatus(
        testCommission._id.toString(),
        'approved',
        testAdmin._id.toString()
      );

      const adjustments = await CommissionAdjustment.find({ commissionId: testCommission._id });
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].adjustmentType).toBe('status_change');
      expect(adjustments[0].adminId).toBe(testAdmin._id.toString());
      expect(adjustments[0].reason).toContain('Status changed from pending to approved');
    });

    it('should throw error for invalid status transition', async () => {
      await expect(CommissionService.updateCommissionStatus(
        testCommission._id.toString(),
        'paid' // Can't go directly from pending to paid
      )).rejects.toThrow('Invalid status transition from pending to paid');
    });

    it('should not allow transitions from rejected status', async () => {
      // First reject the commission
      await CommissionService.updateCommissionStatus(
        testCommission._id.toString(),
        'rejected',
        testAdmin._id.toString()
      );

      // Try to approve rejected commission
      await expect(CommissionService.updateCommissionStatus(
        testCommission._id.toString(),
        'approved'
      )).rejects.toThrow('Invalid status transition from rejected to approved');
    });

    it('should not allow transitions from clawed_back status', async () => {
      // First approve then claw back
      await CommissionService.updateCommissionStatus(testCommission._id.toString(), 'approved');
      await CommissionService.updateCommissionStatus(testCommission._id.toString(), 'clawed_back');

      // Try to change status from clawed_back
      await expect(CommissionService.updateCommissionStatus(
        testCommission._id.toString(),
        'paid'
      )).rejects.toThrow('Invalid status transition from clawed_back to paid');
    });

    it('should throw error for non-existent commission', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      
      await expect(CommissionService.updateCommissionStatus(fakeId, 'approved'))
        .rejects.toThrow('Commission not found');
    });
  });

  describe('approveCommission', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
        clearancePeriodDays: 30
      });
    });

    it('should approve commission past clearance period', async () => {
      const approvedCommission = await CommissionService.approveCommission(
        testCommission._id.toString(),
        testAdmin._id.toString()
      );

      expect(approvedCommission.status).toBe('approved');
      expect(approvedCommission.approvalDate).toBeDefined();
    });

    it('should allow admin to override clearance period', async () => {
      // Create commission within clearance period
      const recentCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer2',
        productId: testProduct._id.toString(),
        trackingCode: 'track2',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        clearancePeriodDays: 30
      });

      const approvedCommission = await CommissionService.approveCommission(
        recentCommission._id.toString(),
        testAdmin._id.toString(),
        true // Override clearance period
      );

      expect(approvedCommission.status).toBe('approved');
    });

    it('should throw error for commission within clearance period without override', async () => {
      const recentCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer2',
        productId: testProduct._id.toString(),
        trackingCode: 'track2',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        clearancePeriodDays: 30
      });

      await expect(CommissionService.approveCommission(
        recentCommission._id.toString(),
        testAdmin._id.toString()
      )).rejects.toThrow('Commission is still within clearance period and cannot be approved yet');
    });

    it('should throw error for non-pending commission', async () => {
      // First approve the commission
      await CommissionService.updateCommissionStatus(testCommission._id.toString(), 'approved');

      await expect(CommissionService.approveCommission(
        testCommission._id.toString(),
        testAdmin._id.toString()
      )).rejects.toThrow('Cannot approve commission with status approved');
    });
  });

  describe('rejectCommission', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: new Date(),
        clearancePeriodDays: 30
      });
    });

    it('should reject commission with reason', async () => {
      const rejectedCommission = await CommissionService.rejectCommission(
        testCommission._id.toString(),
        'Fraudulent activity detected',
        testAdmin._id.toString()
      );

      expect(rejectedCommission.status).toBe('rejected');

      // Check adjustment record
      const adjustments = await CommissionAdjustment.find({ commissionId: testCommission._id });
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].reason).toContain('Fraudulent activity detected');
    });

    it('should throw error for non-pending commission', async () => {
      // First approve the commission
      await CommissionService.updateCommissionStatus(testCommission._id.toString(), 'approved');

      await expect(CommissionService.rejectCommission(
        testCommission._id.toString(),
        'Test rejection',
        testAdmin._id.toString()
      )).rejects.toThrow('Cannot reject commission with status approved');
    });
  });

  describe('markCommissionAsPaid', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'approved', // Start with approved status
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        approvalDate: new Date()
      });
    });

    it('should mark commission as paid', async () => {
      const paidCommission = await CommissionService.markCommissionAsPaid(
        testCommission._id.toString(),
        testAdmin._id.toString(),
        'PAY-123456789'
      );

      expect(paidCommission.status).toBe('paid');

      // Check payment adjustment record
      const adjustments = await CommissionAdjustment.find({ 
        commissionId: testCommission._id,
        adjustmentType: 'payment'
      });
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].reason).toContain('PAY-123456789');
      expect(adjustments[0].amount).toBe(50);
    });

    it('should throw error for non-approved commission', async () => {
      // Create pending commission
      const pendingCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer2',
        productId: testProduct._id.toString(),
        trackingCode: 'track2',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: new Date(),
        clearancePeriodDays: 30
      });

      await expect(CommissionService.markCommissionAsPaid(
        pendingCommission._id.toString(),
        testAdmin._id.toString()
      )).rejects.toThrow('Cannot mark commission as paid with status pending');
    });
  });

  describe('getCommissionsEligibleForApproval', () => {
    beforeEach(async () => {
      const pastConversionDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago (past clearance period)
      const recentConversionDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago (within clearance period)

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
          conversionDate: pastConversionDate, // This will make it eligible (35 days + 30 clearance = past eligible date)
          clearancePeriodDays: 30
          // Let middleware calculate eligibleForPayoutDate
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer2',
          productId: testProduct._id.toString(),
          trackingCode: 'track2',
          initialSpendAmount: 2000,
          commissionRate: 0.05,
          commissionAmount: 100,
          status: 'pending',
          conversionDate: recentConversionDate, // This will make it not eligible yet (5 days + 30 clearance = future eligible date)
          clearancePeriodDays: 30
          // Let middleware calculate eligibleForPayoutDate
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer3',
          productId: testProduct._id.toString(),
          trackingCode: 'track3',
          initialSpendAmount: 1500,
          commissionRate: 0.05,
          commissionAmount: 75,
          status: 'approved', // Already approved
          conversionDate: pastConversionDate,
          clearancePeriodDays: 30
          // Let middleware calculate eligibleForPayoutDate
        }
      ]);
    });

    it('should return only pending commissions past clearance period', async () => {
      const eligibleCommissions = await CommissionService.getCommissionsEligibleForApproval();

      expect(eligibleCommissions).toHaveLength(1);
      expect(eligibleCommissions[0].customerId).toBe('customer1');
      expect(eligibleCommissions[0].status).toBe('pending');
    });
  });

  describe('bulkApproveEligibleCommissions', () => {
    beforeEach(async () => {
      const pastConversionDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago (past clearance period)

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
          conversionDate: pastConversionDate,
          clearancePeriodDays: 30
          // Let middleware calculate eligibleForPayoutDate
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer2',
          productId: testProduct._id.toString(),
          trackingCode: 'track2',
          initialSpendAmount: 2000,
          commissionRate: 0.05,
          commissionAmount: 100,
          status: 'pending',
          conversionDate: pastConversionDate,
          clearancePeriodDays: 30
          // Let middleware calculate eligibleForPayoutDate
        }
      ]);
    });

    it('should approve all eligible commissions', async () => {
      const result = await CommissionService.bulkApproveEligibleCommissions();

      expect(result.approved).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify commissions were approved
      const approvedCommissions = await Commission.find({ status: 'approved' });
      expect(approvedCommissions).toHaveLength(2);
    });
  });

  describe('getAvailableBalance', () => {
    beforeEach(async () => {
      await Commission.create([
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer1',
          productId: testProduct._id.toString(),
          trackingCode: 'track1',
          initialSpendAmount: 1000,
          commissionRate: 0.05,
          commissionAmount: 50,
          status: 'approved', // Available for withdrawal
          conversionDate: new Date(),
          clearancePeriodDays: 30,
          eligibleForPayoutDate: new Date()
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer2',
          productId: testProduct._id.toString(),
          trackingCode: 'track2',
          initialSpendAmount: 2000,
          commissionRate: 0.05,
          commissionAmount: 100,
          status: 'approved', // Available for withdrawal
          conversionDate: new Date(),
          clearancePeriodDays: 30,
          eligibleForPayoutDate: new Date()
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer3',
          productId: testProduct._id.toString(),
          trackingCode: 'track3',
          initialSpendAmount: 1500,
          commissionRate: 0.05,
          commissionAmount: 75,
          status: 'pending', // Not available yet
          conversionDate: new Date(),
          clearancePeriodDays: 30,
          eligibleForPayoutDate: new Date()
        }
      ]);
    });

    it('should return correct available balance', async () => {
      const balance = await CommissionService.getAvailableBalance(testMarketer._id.toString());
      expect(balance).toBe(150); // 50 + 100 (only approved commissions)
    });

    it('should return zero for marketer with no approved commissions', async () => {
      const otherMarketer = await User.create({
        email: 'other@test.com',
        password: 'password123',
        role: 'marketer',
        status: 'active',
        emailVerified: true
      });

      const balance = await CommissionService.getAvailableBalance(otherMarketer._id.toString());
      expect(balance).toBe(0);
    });
  });

  describe('processAutomatedCommissionUpdates', () => {
    beforeEach(async () => {
      const pastConversionDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago (past clearance period)
      const recentConversionDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago (within clearance period)

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
          conversionDate: pastConversionDate,
          clearancePeriodDays: 30
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer2',
          productId: testProduct._id.toString(),
          trackingCode: 'track2',
          initialSpendAmount: 2000,
          commissionRate: 0.05,
          commissionAmount: 100,
          status: 'pending',
          conversionDate: pastConversionDate,
          clearancePeriodDays: 30
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer3',
          productId: testProduct._id.toString(),
          trackingCode: 'track3',
          initialSpendAmount: 1500,
          commissionRate: 0.05,
          commissionAmount: 75,
          status: 'pending',
          conversionDate: recentConversionDate, // Not eligible yet
          clearancePeriodDays: 30
        }
      ]);
    });

    it('should process automated commission updates', async () => {
      const result = await CommissionService.processAutomatedCommissionUpdates();

      expect(result.autoApproved).toBe(2); // Two commissions past clearance period
      expect(result.errors).toHaveLength(0);
      expect(result.summary).toContain('Auto-approved: 2 commissions');

      // Verify commissions were approved
      const approvedCommissions = await Commission.find({ status: 'approved' });
      expect(approvedCommissions).toHaveLength(2);

      const pendingCommissions = await Commission.find({ status: 'pending' });
      expect(pendingCommissions).toHaveLength(1); // One still pending (within clearance period)
    });

    it('should handle processing with no eligible commissions', async () => {
      // Clear all commissions
      await Commission.deleteMany({});

      const result = await CommissionService.processAutomatedCommissionUpdates();

      expect(result.autoApproved).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.summary).toContain('Auto-approved: 0 commissions');
    });
  });

  describe('getCommissionLifecycleStats', () => {
    beforeEach(async () => {
      const pastDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

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
          conversionDate: pastDate,
          clearancePeriodDays: 30
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
          conversionDate: pastDate,
          approvalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // Approved 10 days ago
          clearancePeriodDays: 30
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer3',
          productId: testProduct._id.toString(),
          trackingCode: 'track3',
          initialSpendAmount: 1500,
          commissionRate: 0.05,
          commissionAmount: 75,
          status: 'paid',
          conversionDate: recentDate,
          clearancePeriodDays: 30
        },
        {
          marketerId: testMarketer._id.toString(),
          customerId: 'customer4',
          productId: testProduct._id.toString(),
          trackingCode: 'track4',
          initialSpendAmount: 800,
          commissionRate: 0.05,
          commissionAmount: 40,
          status: 'rejected',
          conversionDate: recentDate,
          clearancePeriodDays: 30
        }
      ]);
    });

    it('should return comprehensive lifecycle statistics', async () => {
      const stats = await CommissionService.getCommissionLifecycleStats();

      expect(stats.totalCommissions).toBe(4);
      expect(stats.statusBreakdown.pending).toBe(1);
      expect(stats.statusBreakdown.approved).toBe(1);
      expect(stats.statusBreakdown.paid).toBe(1);
      expect(stats.statusBreakdown.rejected).toBe(1);
      expect(stats.pendingCommissions).toBe(1);
      expect(stats.eligibleForApproval).toBe(1); // One pending commission past clearance period
      expect(stats.averageClearanceTime).toBeGreaterThan(0); // Should have calculated average clearance time
    });

    it('should filter by date range', async () => {
      const startDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const endDate = new Date(); // Now

      const stats = await CommissionService.getCommissionLifecycleStats(startDate, endDate);

      expect(stats.totalCommissions).toBe(2); // Only recent commissions
      expect(stats.statusBreakdown.paid).toBe(1);
      expect(stats.statusBreakdown.rejected).toBe(1);
    });
  });

  describe('getCommissionStatusHistory', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: new Date(),
        clearancePeriodDays: 30
      });
    });

    it('should return commission status history', async () => {
      // Approve the commission
      await CommissionService.updateCommissionStatus(
        testCommission._id.toString(),
        'approved',
        testAdmin._id.toString()
      );

      // Mark as paid
      await CommissionService.markCommissionAsPaid(
        testCommission._id.toString(),
        testAdmin._id.toString(),
        'PAY-123456'
      );

      const history = await CommissionService.getCommissionStatusHistory(testCommission._id.toString());

      expect(history.commission).toBeDefined();
      expect(history.commission!.status).toBe('paid');
      expect(history.statusHistory).toHaveLength(3); // pending -> approved -> paid
      expect(history.statusHistory[0].status).toBe('pending');
      expect(history.statusHistory[0].reason).toBe('Commission created');
      expect(history.statusHistory[1].status).toBe('approved');
      expect(history.statusHistory[2].status).toBe('paid');
    });

    it('should return null for non-existent commission', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const history = await CommissionService.getCommissionStatusHistory(fakeId);

      expect(history.commission).toBeNull();
      expect(history.statusHistory).toHaveLength(0);
    });

    it('should show rejection in status history', async () => {
      // Reject the commission
      await CommissionService.rejectCommission(
        testCommission._id.toString(),
        'Fraudulent activity detected',
        testAdmin._id.toString()
      );

      const history = await CommissionService.getCommissionStatusHistory(testCommission._id.toString());

      expect(history.commission!.status).toBe('rejected');
      expect(history.statusHistory).toHaveLength(2); // pending -> rejected
      expect(history.statusHistory[1].status).toBe('rejected');
      expect(history.statusHistory[1].reason).toContain('Fraudulent activity detected');
    });
  });

  describe('processClawback', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'approved',
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        approvalDate: new Date(),
        eligibleForPayoutDate: new Date()
      });
    });

    it('should process full clawback for approved commission', async () => {
      const result = await CommissionService.processClawback(
        testCommission._id.toString(),
        50, // Full clawback amount
        'Customer requested refund',
        testAdmin._id.toString(),
        'refund'
      );

      expect(result.commission.status).toBe('clawed_back');
      expect(result.adjustment.adjustmentType).toBe('clawback');
      expect(result.adjustment.amount).toBe(-50); // Negative for clawback
      expect(result.adjustment.reason).toContain('REFUND clawback: Customer requested refund');
      expect(result.adjustment.adminId).toBe(testAdmin._id.toString());
    });

    it('should process full clawback for paid commission', async () => {
      // First mark as paid
      await CommissionService.updateCommissionStatus(testCommission._id.toString(), 'paid');

      const result = await CommissionService.processClawback(
        testCommission._id.toString(),
        50,
        'Chargeback from payment processor',
        testAdmin._id.toString(),
        'chargeback'
      );

      expect(result.commission.status).toBe('clawed_back');
      expect(result.adjustment.reason).toContain('CHARGEBACK clawback');
    });

    it('should process partial clawback amount', async () => {
      const result = await CommissionService.processClawback(
        testCommission._id.toString(),
        25, // Partial clawback
        'Partial refund processed',
        testAdmin._id.toString(),
        'refund'
      );

      expect(result.commission.status).toBe('clawed_back');
      expect(result.adjustment.amount).toBe(-25);
    });

    it('should throw error for pending commission', async () => {
      const pendingCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer2',
        productId: testProduct._id.toString(),
        trackingCode: 'track2',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        eligibleForPayoutDate: new Date()
      });

      await expect(CommissionService.processClawback(
        pendingCommission._id.toString(),
        50,
        'Test clawback',
        testAdmin._id.toString()
      )).rejects.toThrow('Cannot process clawback for commission with status pending');
    });

    it('should throw error for zero or negative clawback amount', async () => {
      await expect(CommissionService.processClawback(
        testCommission._id.toString(),
        0,
        'Test clawback',
        testAdmin._id.toString()
      )).rejects.toThrow('Clawback amount must be positive');

      await expect(CommissionService.processClawback(
        testCommission._id.toString(),
        -10,
        'Test clawback',
        testAdmin._id.toString()
      )).rejects.toThrow('Clawback amount must be positive');
    });

    it('should throw error for clawback amount exceeding commission', async () => {
      await expect(CommissionService.processClawback(
        testCommission._id.toString(),
        100, // More than commission amount of 50
        'Test clawback',
        testAdmin._id.toString()
      )).rejects.toThrow('Clawback amount cannot exceed original commission amount');
    });

    it('should throw error for non-existent commission', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      
      await expect(CommissionService.processClawback(
        fakeId,
        50,
        'Test clawback',
        testAdmin._id.toString()
      )).rejects.toThrow('Commission not found');
    });
  });

  describe('processPartialClawback', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'approved',
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        approvalDate: new Date(),
        eligibleForPayoutDate: new Date()
      });
    });

    it('should process partial clawback without changing commission status', async () => {
      const result = await CommissionService.processPartialClawback(
        testCommission._id.toString(),
        25, // Partial amount
        'Partial refund for customer complaint',
        testAdmin._id.toString(),
        'refund'
      );

      expect(result.commission.status).toBe('approved'); // Status unchanged
      expect(result.adjustment.adjustmentType).toBe('clawback');
      expect(result.adjustment.amount).toBe(-25);
      expect(result.adjustment.reason).toContain('Partial REFUND clawback');
    });

    it('should throw error for amount equal to commission amount', async () => {
      await expect(CommissionService.processPartialClawback(
        testCommission._id.toString(),
        50, // Equal to commission amount
        'Test partial clawback',
        testAdmin._id.toString()
      )).rejects.toThrow('Use full clawback for amounts equal to or greater than commission amount');
    });

    it('should throw error for amount greater than commission amount', async () => {
      await expect(CommissionService.processPartialClawback(
        testCommission._id.toString(),
        75, // Greater than commission amount
        'Test partial clawback',
        testAdmin._id.toString()
      )).rejects.toThrow('Use full clawback for amounts equal to or greater than commission amount');
    });
  });

  describe('applyManualAdjustment', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'approved',
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        approvalDate: new Date(),
        eligibleForPayoutDate: new Date()
      });
    });

    it('should apply positive bonus adjustment', async () => {
      const result = await CommissionService.applyManualAdjustment(
        testCommission._id.toString(),
        25, // Bonus amount
        'bonus',
        'Performance bonus for high-quality referral',
        testAdmin._id.toString()
      );

      expect(result.adjustment.adjustmentType).toBe('bonus');
      expect(result.adjustment.amount).toBe(25);
      expect(result.adjustment.reason).toContain('Manual bonus');
      expect(result.commission.commissionAmount).toBe(50); // Original amount unchanged for bonus
    });

    it('should apply positive correction adjustment', async () => {
      const result = await CommissionService.applyManualAdjustment(
        testCommission._id.toString(),
        10, // Correction amount
        'correction',
        'Correction for calculation error',
        testAdmin._id.toString()
      );

      expect(result.adjustment.adjustmentType).toBe('correction');
      expect(result.adjustment.amount).toBe(10);
      expect(result.commission.commissionAmount).toBe(60); // Updated amount for correction
    });

    it('should apply negative correction adjustment', async () => {
      const result = await CommissionService.applyManualAdjustment(
        testCommission._id.toString(),
        -15, // Negative correction
        'correction',
        'Correction for overpayment',
        testAdmin._id.toString()
      );

      expect(result.adjustment.amount).toBe(-15);
      expect(result.commission.commissionAmount).toBe(35); // 50 - 15
    });

    it('should prevent negative correction that exceeds commission amount', async () => {
      await expect(CommissionService.applyManualAdjustment(
        testCommission._id.toString(),
        -75, // More than commission amount
        'correction',
        'Test correction',
        testAdmin._id.toString()
      )).rejects.toThrow('Negative adjustment cannot exceed original commission amount');
    });

    it('should throw error for zero adjustment amount', async () => {
      await expect(CommissionService.applyManualAdjustment(
        testCommission._id.toString(),
        0,
        'bonus',
        'Test adjustment',
        testAdmin._id.toString()
      )).rejects.toThrow('Adjustment amount cannot be zero');
    });

    it('should throw error for clawed back commission', async () => {
      // First claw back the commission
      await CommissionService.updateCommissionStatus(testCommission._id.toString(), 'clawed_back');

      await expect(CommissionService.applyManualAdjustment(
        testCommission._id.toString(),
        25,
        'bonus',
        'Test adjustment',
        testAdmin._id.toString()
      )).rejects.toThrow('Cannot apply adjustment to commission with status clawed_back');
    });
  });

  describe('getCommissionAdjustments', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'approved',
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        approvalDate: new Date(),
        eligibleForPayoutDate: new Date()
      });

      // Create some adjustments
      await CommissionAdjustment.create([
        {
          commissionId: testCommission._id.toString(),
          adjustmentType: 'bonus',
          amount: 25,
          reason: 'Performance bonus',
          adminId: testAdmin._id.toString()
        },
        {
          commissionId: testCommission._id.toString(),
          adjustmentType: 'correction',
          amount: -5,
          reason: 'Calculation correction',
          adminId: testAdmin._id.toString()
        }
      ]);
    });

    it('should return all adjustments for a commission', async () => {
      const adjustments = await CommissionService.getCommissionAdjustments(testCommission._id.toString());

      expect(adjustments).toHaveLength(2);
      expect(adjustments[0].adjustmentType).toBe('correction'); // Most recent first
      expect(adjustments[1].adjustmentType).toBe('bonus');
    });

    it('should return empty array for commission with no adjustments', async () => {
      const newCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer2',
        productId: testProduct._id.toString(),
        trackingCode: 'track2',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'pending',
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        eligibleForPayoutDate: new Date()
      });

      const adjustments = await CommissionService.getCommissionAdjustments(newCommission._id.toString());
      expect(adjustments).toHaveLength(0);
    });
  });

  describe('getCommissionWithAdjustments', () => {
    let testCommission: any;
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      testCommission = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'approved',
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        approvalDate: new Date(),
        eligibleForPayoutDate: new Date()
      });

      // Create adjustments
      await CommissionAdjustment.create([
        {
          commissionId: testCommission._id.toString(),
          adjustmentType: 'bonus',
          amount: 25,
          reason: 'Performance bonus',
          adminId: testAdmin._id.toString()
        },
        {
          commissionId: testCommission._id.toString(),
          adjustmentType: 'clawback',
          amount: -10,
          reason: 'Partial refund',
          adminId: testAdmin._id.toString()
        }
      ]);
    });

    it('should return commission with adjustments and net amount', async () => {
      const result = await CommissionService.getCommissionWithAdjustments(testCommission._id.toString());

      expect(result.commission).toBeDefined();
      expect(result.adjustments).toHaveLength(2);
      expect(result.totalAdjustments).toBe(15); // 25 + (-10)
      expect(result.netAmount).toBe(65); // 50 + 15
    });

    it('should ensure net amount is not negative', async () => {
      // Add large negative adjustment
      await CommissionAdjustment.create({
        commissionId: testCommission._id.toString(),
        adjustmentType: 'clawback',
        amount: -100, // Would make net negative
        reason: 'Large clawback',
        adminId: testAdmin._id.toString()
      });

      const result = await CommissionService.getCommissionWithAdjustments(testCommission._id.toString());

      expect(result.totalAdjustments).toBe(-85); // 25 + (-10) + (-100)
      expect(result.netAmount).toBe(0); // Max(0, 50 + (-85))
    });

    it('should return null commission for non-existent ID', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const result = await CommissionService.getCommissionWithAdjustments(fakeId);

      expect(result.commission).toBeNull();
      expect(result.adjustments).toHaveLength(0);
      expect(result.netAmount).toBe(0);
      expect(result.totalAdjustments).toBe(0);
    });
  });

  describe('getClawbackStatistics', () => {
    let testAdmin: any;

    beforeEach(async () => {
      testAdmin = await User.create({
        email: 'admin@test.com',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerified: true
      });

      // Create commissions
      const commission1 = await Commission.create({
        marketerId: testMarketer._id.toString(),
        customerId: 'customer1',
        productId: testProduct._id.toString(),
        trackingCode: 'track1',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'clawed_back',
        conversionDate: new Date(),
        clearancePeriodDays: 30,
        eligibleForPayoutDate: new Date()
      });

      const commission2 = await Commission.create({
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
        eligibleForPayoutDate: new Date()
      });

      // Create clawback adjustments
      await CommissionAdjustment.create([
        {
          commissionId: commission1._id.toString(),
          adjustmentType: 'clawback',
          amount: -50,
          reason: 'REFUND clawback: Customer requested refund',
          adminId: testAdmin._id.toString()
        },
        {
          commissionId: commission2._id.toString(),
          adjustmentType: 'clawback',
          amount: -25,
          reason: 'CHARGEBACK clawback: Payment disputed',
          adminId: testAdmin._id.toString()
        },
        {
          commissionId: commission2._id.toString(),
          adjustmentType: 'clawback',
          amount: -10,
          reason: 'MANUAL clawback: Admin adjustment',
          adminId: testAdmin._id.toString()
        }
      ]);
    });

    it('should return correct clawback statistics', async () => {
      const stats = await CommissionService.getClawbackStatistics();

      expect(stats.totalClawbacks).toBe(3);
      expect(stats.totalClawbackAmount).toBe(85); // 50 + 25 + 10 (absolute values)
      expect(stats.affectedCommissions).toBe(2); // 2 unique commissions
      expect(stats.clawbacksByType.refund.count).toBe(1);
      expect(stats.clawbacksByType.refund.amount).toBe(50);
      expect(stats.clawbacksByType.chargeback.count).toBe(1);
      expect(stats.clawbacksByType.chargeback.amount).toBe(25);
      expect(stats.clawbacksByType.manual.count).toBe(1);
      expect(stats.clawbacksByType.manual.amount).toBe(10);
      expect(stats.clawbackRate).toBe(100); // 2 affected out of 2 total commissions = 100%
    });

    it('should filter by date range', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const stats = await CommissionService.getClawbackStatistics(yesterday, tomorrow);

      expect(stats.totalClawbacks).toBe(3); // All adjustments are within range
    });

    it('should return zero statistics when no clawbacks exist', async () => {
      // Clear all adjustments
      await CommissionAdjustment.deleteMany({});

      const stats = await CommissionService.getClawbackStatistics();

      expect(stats.totalClawbacks).toBe(0);
      expect(stats.totalClawbackAmount).toBe(0);
      expect(stats.affectedCommissions).toBe(0);
      expect(stats.clawbackRate).toBe(0);
      expect(Object.keys(stats.clawbacksByType)).toHaveLength(0);
    });
  });});
