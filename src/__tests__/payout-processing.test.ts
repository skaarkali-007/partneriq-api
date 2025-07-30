import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../index';
import { User } from '../models/User';
import { PaymentMethod } from '../models/PaymentMethod';
import { PayoutRequest } from '../models/PayoutRequest';
import { Commission } from '../models/Commission';
import { PaymentService } from '../services/payment';
import jwt from 'jsonwebtoken';

// Mock the PaymentService
jest.mock('../services/payment');
const MockedPaymentService = PaymentService as jest.Mocked<typeof PaymentService>;

describe('Payout Processing Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let testUser: any;
  let authToken: string;
  let adminUser: any;
  let adminToken: string;
  let paymentMethod: any;
  let payoutRequest: any;

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
    // Clear database
    await User.deleteMany({});
    await PaymentMethod.deleteMany({});
    await PayoutRequest.deleteMany({});
    await Commission.deleteMany({});

    // Reset mocks
    jest.clearAllMocks();

    // Create test user
    testUser = new User({
      email: 'marketer@test.com',
      password: 'password123',
      role: 'marketer',
      status: 'active',
      emailVerified: true
    });
    await testUser.save();

    // Create admin user
    adminUser = new User({
      email: 'admin@test.com',
      password: 'password123',
      role: 'admin',
      status: 'active',
      emailVerified: true
    });
    await adminUser.save();

    // Create verified payment method
    paymentMethod = new PaymentMethod({
      userId: testUser._id,
      methodType: 'paypal',
      accountDetails: { paypalEmail: 'user@paypal.com', country: 'US' },
      encryptedAccountDetails: 'encrypted-data',
      isVerified: true,
      verificationStatus: 'verified'
    });
    await paymentMethod.save();

    // Create approved payout request
    payoutRequest = new PayoutRequest({
      marketerId: testUser._id,
      paymentMethodId: paymentMethod._id,
      amount: 100,
      status: 'approved',
      processingFee: 2.50,
      netAmount: 97.50
    });
    await payoutRequest.save();

    // Create approved commissions
    await new Commission({
      marketerId: testUser._id,
      customerId: 'customer1',
      productId: 'product1',
      trackingCode: 'track1',
      initialSpendAmount: 1000,
      commissionRate: 0.05,
      commissionAmount: 50,
      status: 'approved',
      conversionDate: new Date(),
      clearancePeriodDays: 30
    }).save();

    await new Commission({
      marketerId: testUser._id,
      customerId: 'customer2',
      productId: 'product2',
      trackingCode: 'track2',
      initialSpendAmount: 1000,
      commissionRate: 0.05,
      commissionAmount: 50,
      status: 'approved',
      conversionDate: new Date(),
      clearancePeriodDays: 30
    }).save();

    // Generate auth tokens
    authToken = jwt.sign(
      { userId: testUser._id, email: testUser.email, role: testUser.role },
      process.env.JWT_SECRET || 'your-super-secret-jwt-key',
      { 
        expiresIn: '1h',
        issuer: 'financial-affiliate-platform',
        audience: 'financial-affiliate-users'
      }
    );

    adminToken = jwt.sign(
      { userId: adminUser._id, email: adminUser.email, role: adminUser.role },
      process.env.JWT_SECRET || 'your-super-secret-jwt-key',
      { 
        expiresIn: '1h',
        issuer: 'financial-affiliate-platform',
        audience: 'financial-affiliate-users'
      }
    );
  });

  describe('POST /api/v1/admin/payouts/:id/process', () => {
    it('should successfully process a payout through payment gateway', async () => {
      // Mock successful payment processing
      MockedPaymentService.processPayout.mockResolvedValue({
        success: true,
        transactionId: 'txn_123456789',
        gatewayResponse: { status: 'completed' }
      });

      const response = await request(app)
        .post(`/api/v1/admin/payouts/${payoutRequest._id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('completed');
      expect(response.body.data.transactionId).toBe('txn_123456789');

      // Verify PaymentService was called
      expect(MockedPaymentService.processPayout).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: payoutRequest._id
        })
      );

      // Verify commissions were marked as paid
      const paidCommissions = await Commission.find({
        marketerId: testUser._id,
        status: 'paid'
      });
      expect(paidCommissions).toHaveLength(2);
    });

    it('should handle payment gateway failure', async () => {
      // Mock payment processing failure
      MockedPaymentService.processPayout.mockResolvedValue({
        success: false,
        error: 'Insufficient funds in PayPal account'
      });

      const response = await request(app)
        .post(`/api/v1/admin/payouts/${payoutRequest._id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('PAYMENT_GATEWAY_ERROR');
      expect(response.body.error.message).toBe('Insufficient funds in PayPal account');

      // Verify payout was marked as failed
      const failedPayout = await PayoutRequest.findById(payoutRequest._id);
      expect(failedPayout?.status).toBe('failed');
      expect(failedPayout?.failureReason).toBe('Insufficient funds in PayPal account');
    });

    it('should handle payment service exception', async () => {
      // Mock payment service throwing an exception
      MockedPaymentService.processPayout.mockRejectedValue(new Error('Service unavailable'));

      const response = await request(app)
        .post(`/api/v1/admin/payouts/${payoutRequest._id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(500);

      expect(response.body.error.code).toBe('GATEWAY_SERVICE_ERROR');

      // Verify payout was marked as failed
      const failedPayout = await PayoutRequest.findById(payoutRequest._id);
      expect(failedPayout?.status).toBe('failed');
      expect(failedPayout?.failureReason).toBe('Payment gateway service error');
    });

    it('should reject processing non-approved payouts', async () => {
      // Update payout to requested status
      payoutRequest.status = 'requested';
      await payoutRequest.save();

      const response = await request(app)
        .post(`/api/v1/admin/payouts/${payoutRequest._id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_STATUS');
    });

    it('should require admin role', async () => {
      await request(app)
        .post(`/api/v1/admin/payouts/${payoutRequest._id}/process`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });

    it('should return 404 for non-existent payout', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      
      await request(app)
        .post(`/api/v1/admin/payouts/${fakeId}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('POST /api/v1/admin/payouts/bulk-process', () => {
    let payoutRequest2: any;
    let payoutRequest3: any;

    beforeEach(async () => {
      // Create additional approved payout requests
      payoutRequest2 = new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 75,
        status: 'approved',
        processingFee: 1.50,
        netAmount: 73.50
      });
      await payoutRequest2.save();

      payoutRequest3 = new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 50,
        status: 'approved',
        processingFee: 1.00,
        netAmount: 49.00
      });
      await payoutRequest3.save();
    });

    it('should successfully process bulk payouts', async () => {
      // Mock successful bulk processing
      MockedPaymentService.processBulkPayouts.mockResolvedValue({
        successful: [payoutRequest._id.toString(), payoutRequest2._id.toString()],
        failed: [{
          payoutId: payoutRequest3._id.toString(),
          error: 'Invalid account'
        }],
        totalProcessed: 3
      });

      const bulkData = {
        payoutIds: [payoutRequest._id, payoutRequest2._id, payoutRequest3._id],
        processingFee: 2.00,
        notes: 'Bulk processing batch 1'
      };

      const response = await request(app)
        .post('/api/v1/admin/payouts/bulk-process')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(bulkData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalProcessed).toBe(3);
      expect(response.body.data.successful).toBe(2);
      expect(response.body.data.failed).toBe(1);
      expect(response.body.data.successfulIds).toHaveLength(2);
      expect(response.body.data.failures).toHaveLength(1);

      // Verify successful payouts were marked as completed
      const completedPayouts = await PayoutRequest.find({
        _id: { $in: [payoutRequest._id, payoutRequest2._id] },
        status: 'completed'
      });
      expect(completedPayouts).toHaveLength(2);

      // Verify failed payout was marked as failed
      const failedPayout = await PayoutRequest.findById(payoutRequest3._id);
      expect(failedPayout?.status).toBe('failed');
      expect(failedPayout?.failureReason).toBe('Invalid account');

      // Verify PaymentService was called
      expect(MockedPaymentService.processBulkPayouts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ _id: payoutRequest._id }),
          expect.objectContaining({ _id: payoutRequest2._id }),
          expect.objectContaining({ _id: payoutRequest3._id })
        ])
      );
    });

    it('should handle bulk processing service error', async () => {
      // Mock bulk processing service throwing an exception
      MockedPaymentService.processBulkPayouts.mockRejectedValue(new Error('Bulk service unavailable'));

      const bulkData = {
        payoutIds: [payoutRequest._id, payoutRequest2._id],
        processingFee: 2.00
      };

      const response = await request(app)
        .post('/api/v1/admin/payouts/bulk-process')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(bulkData)
        .expect(500);

      expect(response.body.error.code).toBe('BULK_PROCESSING_ERROR');

      // Verify all payouts were marked as failed
      const failedPayouts = await PayoutRequest.find({
        _id: { $in: [payoutRequest._id, payoutRequest2._id] },
        status: 'failed'
      });
      expect(failedPayouts).toHaveLength(2);
    });

    it('should validate bulk processing input', async () => {
      const invalidData = {
        payoutIds: [], // Empty array
        processingFee: -1 // Negative fee
      };

      const response = await request(app)
        .post('/api/v1/admin/payouts/bulk-process')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle no valid payouts for bulk processing', async () => {
      // Update all payouts to non-approved status
      await PayoutRequest.updateMany(
        { _id: { $in: [payoutRequest._id, payoutRequest2._id] } },
        { status: 'requested' }
      );

      const bulkData = {
        payoutIds: [payoutRequest._id, payoutRequest2._id]
      };

      const response = await request(app)
        .post('/api/v1/admin/payouts/bulk-process')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(bulkData)
        .expect(400);

      expect(response.body.error.code).toBe('NO_VALID_PAYOUTS');
    });

    it('should enforce maximum bulk processing limit', async () => {
      // Create array with more than 50 IDs
      const tooManyIds = Array(51).fill(payoutRequest._id);

      const bulkData = {
        payoutIds: tooManyIds
      };

      const response = await request(app)
        .post('/api/v1/admin/payouts/bulk-process')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(bulkData)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should require admin role', async () => {
      const bulkData = {
        payoutIds: [payoutRequest._id]
      };

      await request(app)
        .post('/api/v1/admin/payouts/bulk-process')
        .set('Authorization', `Bearer ${authToken}`)
        .send(bulkData)
        .expect(403);
    });
  });

  describe('GET /api/v1/admin/payouts/stats', () => {
    beforeEach(async () => {
      // Create payouts with different statuses and dates
      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 100,
        status: 'completed',
        requestedAt: new Date('2024-01-01'),
        completedAt: new Date('2024-01-02')
      }).save();

      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 75,
        status: 'failed',
        requestedAt: new Date('2024-01-03')
      }).save();

      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 50,
        status: 'processing',
        requestedAt: new Date('2024-01-04')
      }).save();
    });

    it('should return bulk processing statistics', async () => {
      const response = await request(app)
        .get('/api/v1/admin/payouts/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.statusBreakdown).toBeDefined();
      expect(response.body.data.processingTimes).toBeDefined();

      // Check status breakdown
      const statusBreakdown = response.body.data.statusBreakdown;
      expect(statusBreakdown).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ _id: 'approved' }),
          expect.objectContaining({ _id: 'completed' }),
          expect.objectContaining({ _id: 'failed' }),
          expect.objectContaining({ _id: 'processing' })
        ])
      );
    });

    it('should filter statistics by date range', async () => {
      const response = await request(app)
        .get('/api/v1/admin/payouts/stats?startDate=2024-01-01&endDate=2024-01-02')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.statusBreakdown).toBeDefined();
    });

    it('should require admin role', async () => {
      await request(app)
        .get('/api/v1/admin/payouts/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });
});