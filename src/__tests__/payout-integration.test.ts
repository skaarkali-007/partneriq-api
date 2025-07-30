import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../index';
import { User } from '../models/User';
import { PaymentMethod } from '../models/PaymentMethod';
import { PayoutRequest } from '../models/PayoutRequest';
import { Commission } from '../models/Commission';
import jwt from 'jsonwebtoken';

describe('Payout Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let testUser: any;
  let authToken: string;
  let adminUser: any;
  let adminToken: string;
  let paymentMethod: any;

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

    // Create approved commissions for balance
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
      initialSpendAmount: 2000,
      commissionRate: 0.03,
      commissionAmount: 60,
      status: 'approved',
      conversionDate: new Date(),
      clearancePeriodDays: 30
    }).save();

    // Generate auth tokens
    authToken = jwt.sign(
      { id: testUser._id, email: testUser.email, role: testUser.role },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );

    adminToken = jwt.sign(
      { id: adminUser._id, email: adminUser.email, role: adminUser.role },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  describe('POST /api/v1/payouts/request', () => {
    it('should create a payout request', async () => {
      const payoutData = {
        paymentMethodId: paymentMethod._id,
        amount: 100
      };

      const response = await request(app)
        .post('/api/v1/payouts/request')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payoutData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.amount).toBe(100);
      expect(response.body.data.status).toBe('requested');
      expect(response.body.data.marketerId).toBe(testUser._id.toString());
    });

    it('should reject payout request below minimum amount', async () => {
      const payoutData = {
        paymentMethodId: paymentMethod._id,
        amount: 10 // Below minimum of 50
      };

      const response = await request(app)
        .post('/api/v1/payouts/request')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payoutData)
        .expect(400);

      expect(response.body.error.code).toBe('AMOUNT_TOO_LOW');
    });

    it('should reject payout request exceeding available balance', async () => {
      const payoutData = {
        paymentMethodId: paymentMethod._id,
        amount: 200 // More than available balance of 110
      };

      const response = await request(app)
        .post('/api/v1/payouts/request')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payoutData)
        .expect(400);

      expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('should reject payout request with unverified payment method', async () => {
      // Create unverified payment method
      const unverifiedMethod = new PaymentMethod({
        userId: testUser._id,
        methodType: 'bank_transfer',
        accountDetails: { 
          accountNumber: '1234567890',
          routingNumber: '021000021',
          bankName: 'Test Bank',
          accountHolderName: 'John Doe',
          country: 'US'
        },
        encryptedAccountDetails: 'encrypted-data',
        isVerified: false
      });
      await unverifiedMethod.save();

      const payoutData = {
        paymentMethodId: unverifiedMethod._id,
        amount: 100
      };

      const response = await request(app)
        .post('/api/v1/payouts/request')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payoutData)
        .expect(400);

      expect(response.body.error.code).toBe('PAYMENT_METHOD_NOT_VERIFIED');
    });

    it('should reject payout request with non-existent payment method', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const payoutData = {
        paymentMethodId: fakeId,
        amount: 100
      };

      const response = await request(app)
        .post('/api/v1/payouts/request')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payoutData)
        .expect(404);

      expect(response.body.error.code).toBe('PAYMENT_METHOD_NOT_FOUND');
    });

    it('should reject multiple pending payout requests', async () => {
      // Create first payout request
      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 50,
        status: 'requested'
      }).save();

      const payoutData = {
        paymentMethodId: paymentMethod._id,
        amount: 50
      };

      const response = await request(app)
        .post('/api/v1/payouts/request')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payoutData)
        .expect(400);

      expect(response.body.error.code).toBe('PENDING_REQUEST_EXISTS');
    });
  });

  describe('GET /api/v1/payouts', () => {
    beforeEach(async () => {
      // Create test payout requests
      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 100,
        status: 'completed',
        requestedAt: new Date('2024-01-01')
      }).save();

      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 75,
        status: 'requested',
        requestedAt: new Date('2024-01-02')
      }).save();
    });

    it('should return user payout requests', async () => {
      const response = await request(app)
        .get('/api/v1/payouts')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].amount).toBe(75); // Most recent first
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter payout requests by status', async () => {
      const response = await request(app)
        .get('/api/v1/payouts?status=completed')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('completed');
    });

    it('should paginate payout requests', async () => {
      const response = await request(app)
        .get('/api/v1/payouts?page=1&limit=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(1);
      expect(response.body.pagination.total).toBe(2);
      expect(response.body.pagination.pages).toBe(2);
    });
  });

  describe('GET /api/v1/payouts/balance', () => {
    beforeEach(async () => {
      // Create completed payout
      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 50,
        status: 'completed'
      }).save();

      // Create pending payout
      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 30,
        status: 'requested'
      }).save();
    });

    it('should return balance summary', async () => {
      const response = await request(app)
        .get('/api/v1/payouts/balance')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.lifetimeEarnings).toBe(110); // Total approved commissions
      expect(response.body.data.totalPaidOut).toBe(50); // Completed payouts
      expect(response.body.data.pendingPayouts).toBe(30); // Pending payouts
      expect(response.body.data.availableBalance).toBe(30); // 110 - 50 - 30
      expect(response.body.data.minWithdrawalAmount).toBeDefined();
      expect(response.body.data.maxWithdrawalAmount).toBeDefined();
    });
  });

  describe('GET /api/v1/payouts/:id', () => {
    let payoutRequest: any;

    beforeEach(async () => {
      payoutRequest = new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 100,
        status: 'requested'
      });
      await payoutRequest.save();
    });

    it('should return specific payout request', async () => {
      const response = await request(app)
        .get(`/api/v1/payouts/${payoutRequest._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.amount).toBe(100);
      expect(response.body.data.status).toBe('requested');
    });

    it('should return 404 for non-existent payout request', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      
      const response = await request(app)
        .get(`/api/v1/payouts/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/v1/payouts/:id/cancel', () => {
    let payoutRequest: any;

    beforeEach(async () => {
      payoutRequest = new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 100,
        status: 'requested'
      });
      await payoutRequest.save();
    });

    it('should cancel payout request', async () => {
      const response = await request(app)
        .put(`/api/v1/payouts/${payoutRequest._id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('cancelled');
    });

    it('should not cancel non-requested payout', async () => {
      payoutRequest.status = 'approved';
      await payoutRequest.save();

      const response = await request(app)
        .put(`/api/v1/payouts/${payoutRequest._id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('CANNOT_CANCEL');
    });
  });

  describe('Admin Endpoints', () => {
    let payoutRequest: any;

    beforeEach(async () => {
      payoutRequest = new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: paymentMethod._id,
        amount: 100,
        status: 'requested'
      });
      await payoutRequest.save();
    });

    describe('GET /api/v1/admin/payouts', () => {
      it('should return all payout requests for admin', async () => {
        const response = await request(app)
          .get('/api/v1/admin/payouts')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].amount).toBe(100);
      });

      it('should filter by status', async () => {
        const response = await request(app)
          .get('/api/v1/admin/payouts?status=requested')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].status).toBe('requested');
      });

      it('should require admin role', async () => {
        await request(app)
          .get('/api/v1/admin/payouts')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(403);
      });
    });

    describe('PUT /api/v1/admin/payouts/:id/status', () => {
      it('should approve payout request', async () => {
        const response = await request(app)
          .put(`/api/v1/admin/payouts/${payoutRequest._id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            status: 'approved',
            notes: 'Approved for processing'
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('approved');
        expect(response.body.data.notes).toBe('Approved for processing');
        expect(response.body.data.approvedAt).toBeDefined();
      });

      it('should complete payout request and update commissions', async () => {
        // First approve
        payoutRequest.status = 'processing';
        await payoutRequest.save();

        const response = await request(app)
          .put(`/api/v1/admin/payouts/${payoutRequest._id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            status: 'completed',
            transactionId: 'txn_123456',
            processingFee: 2.50
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('completed');
        expect(response.body.data.transactionId).toBe('txn_123456');
        expect(response.body.data.processingFee).toBe(2.50);
        expect(response.body.data.netAmount).toBe(97.50);

        // Check that commissions were marked as paid
        const paidCommissions = await Commission.find({
          marketerId: testUser._id,
          status: 'paid'
        });
        expect(paidCommissions).toHaveLength(2);
      });

      it('should fail payout request with reason', async () => {
        payoutRequest.status = 'processing';
        await payoutRequest.save();

        const response = await request(app)
          .put(`/api/v1/admin/payouts/${payoutRequest._id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            status: 'failed',
            failureReason: 'Invalid account details'
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('failed');
        expect(response.body.data.failureReason).toBe('Invalid account details');
      });

      it('should reject invalid status transitions', async () => {
        const response = await request(app)
          .put(`/api/v1/admin/payouts/${payoutRequest._id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            status: 'completed' // Cannot go directly from requested to completed
          })
          .expect(400);

        expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      });

      it('should require admin role', async () => {
        await request(app)
          .put(`/api/v1/admin/payouts/${payoutRequest._id}/status`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ status: 'approved' })
          .expect(403);
      });
    });
  });
});