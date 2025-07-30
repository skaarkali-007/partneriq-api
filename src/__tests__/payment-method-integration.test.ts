import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../index';
import { User } from '../models/User';
import { PaymentMethod } from '../models/PaymentMethod';
import jwt from 'jsonwebtoken';

describe('Payment Method Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let testUser: any;
  let authToken: string;
  let adminUser: any;
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
    // Clear database
    await User.deleteMany({});
    await PaymentMethod.deleteMany({});

    // Create test user
    testUser = new User({
      email: 'marketer@test.com',
      password: 'password123',
      firstName: 'John',
      lastName: 'Doe',
      role: 'marketer',
      status: 'active',
      emailVerified: true
    });
    await testUser.save();

    // Create admin user
    adminUser = new User({
      email: 'admin@test.com',
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      status: 'active',
      emailVerified: true
    });
    await adminUser.save();

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

  describe('POST /api/v1/payment-methods', () => {
    it('should create a bank transfer payment method', async () => {
      const paymentMethodData = {
        methodType: 'bank_transfer',
        accountDetails: {
          accountNumber: '1234567890',
          routingNumber: '021000021',
          bankName: 'Test Bank',
          accountHolderName: 'John Doe',
          currency: 'USD',
          country: 'US'
        },
        isDefault: true
      };

      const response = await request(app)
        .post('/api/v1/payment-methods')
        .set('Authorization', `Bearer ${authToken}`)
        .send(paymentMethodData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.methodType).toBe('bank_transfer');
      expect(response.body.data.isDefault).toBe(true);
      expect(response.body.data.verificationStatus).toBe('pending');
      expect(response.body.data.accountDetails).toBeUndefined(); // Should not be returned
    });

    it('should create a PayPal payment method', async () => {
      const paymentMethodData = {
        methodType: 'paypal',
        accountDetails: {
          paypalEmail: 'user@paypal.com',
          currency: 'USD',
          country: 'US'
        }
      };

      const response = await request(app)
        .post('/api/v1/payment-methods')
        .set('Authorization', `Bearer ${authToken}`)
        .send(paymentMethodData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.methodType).toBe('paypal');
      expect(response.body.data.isDefault).toBe(false);
    });

    it('should reject invalid payment method data', async () => {
      const invalidData = {
        methodType: 'bank_transfer',
        accountDetails: {
          accountNumber: '1234567890'
          // Missing required fields
        }
      };

      const response = await request(app)
        .post('/api/v1/payment-methods')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should enforce payment method limit', async () => {
      // Create 5 payment methods
      for (let i = 0; i < 5; i++) {
        await new PaymentMethod({
          userId: testUser._id,
          methodType: 'paypal',
          accountDetails: { paypalEmail: `user${i}@paypal.com`, country: 'US' },
          encryptedAccountDetails: 'encrypted-data'
        }).save();
      }

      const paymentMethodData = {
        methodType: 'paypal',
        accountDetails: {
          paypalEmail: 'user6@paypal.com',
          country: 'US'
        }
      };

      const response = await request(app)
        .post('/api/v1/payment-methods')
        .set('Authorization', `Bearer ${authToken}`)
        .send(paymentMethodData)
        .expect(400);

      expect(response.body.error.code).toBe('LIMIT_EXCEEDED');
    });

    it('should require authentication', async () => {
      const paymentMethodData = {
        methodType: 'paypal',
        accountDetails: {
          paypalEmail: 'user@paypal.com',
          country: 'US'
        }
      };

      await request(app)
        .post('/api/v1/payment-methods')
        .send(paymentMethodData)
        .expect(401);
    });
  });

  describe('GET /api/v1/payment-methods', () => {
    beforeEach(async () => {
      // Create test payment methods
      await new PaymentMethod({
        userId: testUser._id,
        methodType: 'paypal',
        accountDetails: { paypalEmail: 'user1@paypal.com', country: 'US' },
        encryptedAccountDetails: 'encrypted-data-1',
        isDefault: true
      }).save();

      await new PaymentMethod({
        userId: testUser._id,
        methodType: 'bank_transfer',
        accountDetails: { 
          accountNumber: '1234567890',
          routingNumber: '021000021',
          bankName: 'Test Bank',
          accountHolderName: 'John Doe',
          country: 'US'
        },
        encryptedAccountDetails: 'encrypted-data-2'
      }).save();
    });

    it('should return user payment methods', async () => {
      const response = await request(app)
        .get('/api/v1/payment-methods')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].isDefault).toBe(true); // Default should be first
    });

    it('should not return other users payment methods', async () => {
      // Create another user with payment method
      const otherUser = new User({
        email: 'other@test.com',
        password: 'password123',
        firstName: 'Other',
        lastName: 'User',
        role: 'marketer',
        status: 'active',
        emailVerified: true
      });
      await otherUser.save();

      await new PaymentMethod({
        userId: otherUser._id,
        methodType: 'paypal',
        accountDetails: { paypalEmail: 'other@paypal.com', country: 'US' },
        encryptedAccountDetails: 'encrypted-data-other'
      }).save();

      const response = await request(app)
        .get('/api/v1/payment-methods')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2); // Only testUser's methods
    });
  });

  describe('GET /api/v1/payment-methods/:id', () => {
    let paymentMethod: any;

    beforeEach(async () => {
      paymentMethod = new PaymentMethod({
        userId: testUser._id,
        methodType: 'paypal',
        accountDetails: { paypalEmail: 'user@paypal.com', country: 'US' },
        encryptedAccountDetails: 'encrypted-data'
      });
      await paymentMethod.save();
    });

    it('should return specific payment method', async () => {
      const response = await request(app)
        .get(`/api/v1/payment-methods/${paymentMethod._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.methodType).toBe('paypal');
    });

    it('should return 404 for non-existent payment method', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      
      const response = await request(app)
        .get(`/api/v1/payment-methods/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/v1/payment-methods/:id', () => {
    let paymentMethod: any;

    beforeEach(async () => {
      paymentMethod = new PaymentMethod({
        userId: testUser._id,
        methodType: 'paypal',
        accountDetails: { paypalEmail: 'user@paypal.com', country: 'US' },
        encryptedAccountDetails: 'encrypted-data',
        verificationStatus: 'verified',
        isVerified: true
      });
      await paymentMethod.save();
    });

    it('should update payment method', async () => {
      const updateData = {
        accountDetails: {
          paypalEmail: 'updated@paypal.com'
        },
        isDefault: true
      };

      const response = await request(app)
        .put(`/api/v1/payment-methods/${paymentMethod._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isDefault).toBe(true);
      expect(response.body.data.verificationStatus).toBe('pending'); // Should reset
      expect(response.body.data.isVerified).toBe(false);
    });

    it('should return 404 for non-existent payment method', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      
      await request(app)
        .put(`/api/v1/payment-methods/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isDefault: true })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/payment-methods/:id', () => {
    let paymentMethod: any;

    beforeEach(async () => {
      paymentMethod = new PaymentMethod({
        userId: testUser._id,
        methodType: 'paypal',
        accountDetails: { paypalEmail: 'user@paypal.com', country: 'US' },
        encryptedAccountDetails: 'encrypted-data'
      });
      await paymentMethod.save();
    });

    it('should delete payment method', async () => {
      const response = await request(app)
        .delete(`/api/v1/payment-methods/${paymentMethod._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify deletion
      const deletedMethod = await PaymentMethod.findById(paymentMethod._id);
      expect(deletedMethod).toBeNull();
    });

    it('should return 404 for non-existent payment method', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      
      await request(app)
        .delete(`/api/v1/payment-methods/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('PUT /api/v1/payment-methods/:id/default', () => {
    let paymentMethod1: any;
    let paymentMethod2: any;

    beforeEach(async () => {
      paymentMethod1 = new PaymentMethod({
        userId: testUser._id,
        methodType: 'paypal',
        accountDetails: { paypalEmail: 'user1@paypal.com', country: 'US' },
        encryptedAccountDetails: 'encrypted-data-1',
        isDefault: true
      });
      await paymentMethod1.save();

      paymentMethod2 = new PaymentMethod({
        userId: testUser._id,
        methodType: 'bank_transfer',
        accountDetails: { 
          accountNumber: '1234567890',
          routingNumber: '021000021',
          bankName: 'Test Bank',
          accountHolderName: 'John Doe',
          country: 'US'
        },
        encryptedAccountDetails: 'encrypted-data-2'
      });
      await paymentMethod2.save();
    });

    it('should set payment method as default', async () => {
      const response = await request(app)
        .put(`/api/v1/payment-methods/${paymentMethod2._id}/default`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isDefault).toBe(true);

      // Verify old default is no longer default
      const oldDefault = await PaymentMethod.findById(paymentMethod1._id);
      expect(oldDefault?.isDefault).toBe(false);
    });
  });

  describe('PUT /api/v1/admin/payment-methods/:id/verify', () => {
    let paymentMethod: any;

    beforeEach(async () => {
      paymentMethod = new PaymentMethod({
        userId: testUser._id,
        methodType: 'paypal',
        accountDetails: { paypalEmail: 'user@paypal.com', country: 'US' },
        encryptedAccountDetails: 'encrypted-data'
      });
      await paymentMethod.save();
    });

    it('should verify payment method (admin only)', async () => {
      const response = await request(app)
        .put(`/api/v1/admin/payment-methods/${paymentMethod._id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'verified', notes: 'Verified successfully' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.verificationStatus).toBe('verified');
      expect(response.body.data.isVerified).toBe(true);
      expect(response.body.data.verificationDate).toBeDefined();
    });

    it('should reject verification with invalid status', async () => {
      const response = await request(app)
        .put(`/api/v1/admin/payment-methods/${paymentMethod._id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'invalid' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should require admin role', async () => {
      await request(app)
        .put(`/api/v1/admin/payment-methods/${paymentMethod._id}/verify`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'verified' })
        .expect(403);
    });
  });
});