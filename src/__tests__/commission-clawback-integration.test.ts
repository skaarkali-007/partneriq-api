import request from 'supertest';
import { app } from '../index';
import { Commission } from '../models/Commission';
import { CommissionAdjustment } from '../models/CommissionAdjustment';
import { Product } from '../models/Product';
import { User } from '../models/User';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Helper function to generate access tokens for testing
const generateAccessToken = (payload: { userId: string }) => {
  return jwt.sign(
    { 
      userId: payload.userId, 
      email: 'test@example.com', 
      role: 'admin' 
    },
    process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    { 
      expiresIn: '1h',
      issuer: 'financial-affiliate-platform',
      audience: 'financial-affiliate-users'
    }
  );
};

const API_BASE = '/api/v1';

describe('Commission Clawback Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let testMarketer: any;
  let testAdmin: any;
  let testProduct: any;
  let testCommission: any;
  let marketerToken: string;
  let adminToken: string;

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

    // Create test admin
    testAdmin = await User.create({
      email: 'admin@test.com',
      password: 'password123',
      role: 'admin',
      status: 'active',
      emailVerified: true
    });

    // Create test product
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

    // Create test commission
    testCommission = await Commission.create({
      marketerId: testMarketer._id.toString(),
      customerId: 'customer123',
      productId: testProduct._id.toString(),
      trackingCode: 'track123',
      initialSpendAmount: 2000,
      commissionRate: 0.05,
      commissionAmount: 100,
      status: 'approved',
      conversionDate: new Date(),
      clearancePeriodDays: 30,
      eligibleForPayoutDate: new Date(),
      approvalDate: new Date()
    });

    // Generate tokens
    marketerToken = generateAccessToken({ userId: testMarketer._id.toString() });
    adminToken = generateAccessToken({ userId: testAdmin._id.toString() });
  });

  describe('POST /api/v1/commissions/:id/clawback', () => {
    it('should process full clawback successfully', async () => {
      const clawbackData = {
        clawbackAmount: 100,
        reason: 'Customer requested full refund',
        adminId: testAdmin._id.toString(),
        clawbackType: 'refund'
      };

      const response = await request(app)
        .post(`${API_BASE}/commissions/${testCommission._id}/clawback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(clawbackData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.commission.status).toBe('clawed_back');
      expect(response.body.data.adjustment.adjustmentType).toBe('clawback');
      expect(response.body.data.adjustment.amount).toBe(-100);
      expect(response.body.data.adjustment.reason).toContain('REFUND clawback');

      // Verify commission status in database
      const updatedCommission = await Commission.findById(testCommission._id);
      expect(updatedCommission?.status).toBe('clawed_back');

      // Verify adjustment record in database
      const adjustment = await CommissionAdjustment.findOne({ 
        commissionId: testCommission._id,
        adjustmentType: 'clawback'
      });
      expect(adjustment).toBeTruthy();
      expect(adjustment?.amount).toBe(-100);
      expect(adjustment?.adminId).toBe(testAdmin._id.toString());
    });

    it('should reject clawback with invalid amount', async () => {
      const clawbackData = {
        clawbackAmount: 150, // More than commission amount
        reason: 'Test clawback',
        adminId: testAdmin._id.toString(),
        clawbackType: 'refund'
      };

      const response = await request(app)
        .post(`${API_BASE}/commissions/${testCommission._id}/clawback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(clawbackData)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_OPERATION');
      expect(response.body.error.message).toContain('cannot exceed original commission amount');
    });

    it('should reject clawback for pending commission', async () => {
      // Update commission to pending status
      await Commission.findByIdAndUpdate(testCommission._id, { status: 'pending' });

      const clawbackData = {
        clawbackAmount: 50,
        reason: 'Test clawback',
        adminId: testAdmin._id.toString(),
        clawbackType: 'refund'
      };

      const response = await request(app)
        .post(`${API_BASE}/commissions/${testCommission._id}/clawback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(clawbackData)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_OPERATION');
      expect(response.body.error.message).toContain('Cannot process clawback for commission with status pending');
    });
  });

  describe('POST /api/v1/commissions/:id/partial-clawback', () => {
    it('should process partial clawback successfully', async () => {
      const clawbackData = {
        clawbackAmount: 25, // Partial amount
        reason: 'Partial refund processed',
        adminId: testAdmin._id.toString(),
        clawbackType: 'refund'
      };

      const response = await request(app)
        .post(`${API_BASE}/commissions/${testCommission._id}/partial-clawback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(clawbackData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.commission.status).toBe('approved'); // Status unchanged for partial
      expect(response.body.data.adjustment.adjustmentType).toBe('clawback');
      expect(response.body.data.adjustment.amount).toBe(-25);
      expect(response.body.data.adjustment.reason).toContain('Partial REFUND clawback');

      // Verify commission status unchanged in database
      const updatedCommission = await Commission.findById(testCommission._id);
      expect(updatedCommission?.status).toBe('approved');

      // Verify adjustment record in database
      const adjustment = await CommissionAdjustment.findOne({ 
        commissionId: testCommission._id,
        adjustmentType: 'clawback'
      });
      expect(adjustment).toBeTruthy();
      expect(adjustment?.amount).toBe(-25);
    });

    it('should reject partial clawback equal to commission amount', async () => {
      const clawbackData = {
        clawbackAmount: 100, // Equal to commission amount
        reason: 'Test partial clawback',
        adminId: testAdmin._id.toString(),
        clawbackType: 'refund'
      };

      const response = await request(app)
        .post(`${API_BASE}/commissions/${testCommission._id}/partial-clawback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(clawbackData)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_OPERATION');
      expect(response.body.error.message).toContain('Use full clawback for amounts equal to or greater than commission amount');
    });
  });

  describe('GET /api/v1/commissions/:id/adjustments', () => {
    it('should return commission adjustments including clawbacks', async () => {
      // Create some adjustments
      await CommissionAdjustment.create([
        {
          commissionId: testCommission._id.toString(),
          adjustmentType: 'clawback',
          amount: -25,
          reason: 'Partial refund',
          adminId: testAdmin._id.toString()
        },
        {
          commissionId: testCommission._id.toString(),
          adjustmentType: 'bonus',
          amount: 10,
          reason: 'Performance bonus',
          adminId: testAdmin._id.toString()
        }
      ]);

      const response = await request(app)
        .get(`${API_BASE}/commissions/${testCommission._id}/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      
      const clawbackAdjustment = response.body.data.find((adj: any) => adj.adjustmentType === 'clawback');
      expect(clawbackAdjustment).toBeTruthy();
      expect(clawbackAdjustment.amount).toBe(-25);
      expect(clawbackAdjustment.reason).toBe('Partial refund');
    });
  });

  describe('GET /api/v1/commissions/:id/with-adjustments', () => {
    it('should return commission with net amount after clawbacks', async () => {
      // Create clawback adjustment
      await CommissionAdjustment.create({
        commissionId: testCommission._id.toString(),
        adjustmentType: 'clawback',
        amount: -30,
        reason: 'Partial refund',
        adminId: testAdmin._id.toString()
      });

      const response = await request(app)
        .get(`${API_BASE}/commissions/${testCommission._id}/with-adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.commission.commissionAmount).toBe(100);
      expect(response.body.data.totalAdjustments).toBe(-30);
      expect(response.body.data.netAmount).toBe(70); // 100 - 30
      expect(response.body.data.adjustments).toHaveLength(1);
    });
  });

  describe('GET /api/v1/commissions/analytics/clawback', () => {
    it('should return clawback statistics', async () => {
      // Create some clawback adjustments
      await CommissionAdjustment.create([
        {
          commissionId: testCommission._id.toString(),
          adjustmentType: 'clawback',
          amount: -50,
          reason: 'REFUND clawback: Customer requested refund',
          adminId: testAdmin._id.toString()
        },
        {
          commissionId: testCommission._id.toString(),
          adjustmentType: 'clawback',
          amount: -25,
          reason: 'CHARGEBACK clawback: Payment disputed',
          adminId: testAdmin._id.toString()
        }
      ]);

      const response = await request(app)
        .get(`${API_BASE}/commissions/analytics/clawback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalClawbacks).toBe(2);
      expect(response.body.data.totalClawbackAmount).toBe(75);
      expect(response.body.data.clawbacksByType.refund.count).toBe(1);
      expect(response.body.data.clawbacksByType.refund.amount).toBe(50);
      expect(response.body.data.clawbacksByType.chargeback.count).toBe(1);
      expect(response.body.data.clawbacksByType.chargeback.amount).toBe(25);
    });
  });
});