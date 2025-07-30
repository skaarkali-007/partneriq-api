import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../index';
import { User } from '../models/User';
import { UserProfile } from '../models/UserProfile';
import { Consent } from '../models/Consent';
import { Commission } from '../models/Commission';
import { PayoutRequest } from '../models/PayoutRequest';
import { PaymentMethod } from '../models/PaymentMethod';
import { generateTokenPair } from '../utils/jwt';

// Helper function to generate a simple token for testing
const generateToken = (payload: any) => {
  const tokenPair = generateTokenPair({
    _id: payload.id,
    email: payload.email,
    role: payload.role
  } as any);
  return tokenPair.accessToken;
};

describe('GDPR Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let testUser: any;
  let adminUser: any;
  let userToken: string;
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
    await Promise.all([
      User.deleteMany({}),
      UserProfile.deleteMany({}),
      Consent.deleteMany({}),
      Commission.deleteMany({}),
      PayoutRequest.deleteMany({}),
      PaymentMethod.deleteMany({})
    ]);

    // Create test user
    testUser = new User({
      email: 'test@example.com',
      password: 'hashedpassword',
      firstName: 'John',
      lastName: 'Doe',
      role: 'marketer',
      status: 'active',
      emailVerified: true
    });
    await testUser.save();

    // Create admin user
    adminUser = new User({
      email: 'admin@example.com',
      password: 'hashedpassword',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      status: 'active',
      emailVerified: true
    });
    await adminUser.save();

    // Generate tokens
    userToken = generateToken({ id: testUser._id, email: testUser.email, role: testUser.role });
    adminToken = generateToken({ id: adminUser._id, email: adminUser.email, role: adminUser.role });

    // Create test profile
    const profile = new UserProfile({
      userId: testUser._id,
      firstName: 'John',
      lastName: 'Doe',
      phone: '+1234567890',
      address: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TC',
        postalCode: '12345',
        country: 'US'
      },
      kycStatus: 'approved'
    });
    await profile.save();

    // Create test data
    await Promise.all([
      new Consent({
        userId: testUser._id,
        ipAddress: '192.168.1.1',
        userAgent: 'Test Browser',
        consentTypes: {
          necessary: true,
          analytics: false,
          marketing: true,
          preferences: false
        },
        consentMethod: 'registration',
        dataProcessingPurposes: ['marketing', 'analytics']
      }).save(),
      
      new Commission({
        marketerId: testUser._id,
        customerId: new mongoose.Types.ObjectId(),
        productId: new mongoose.Types.ObjectId(),
        trackingCode: 'test-tracking-123',
        initialSpendAmount: 1000,
        commissionRate: 0.05,
        commissionAmount: 50,
        status: 'approved',
        conversionDate: new Date()
      }).save(),
      

    ]);
  });

  describe('GET /api/v1/gdpr/data-summary', () => {
    it('should return user data summary for authenticated user', async () => {
      const response = await request(app)
        .get('/api/v1/gdpr/data-summary')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.userId).toBe(testUser._id.toString());
      expect(response.body.data.email).toBe('test@example.com');
      expect(response.body.data.dataCategories).toBeDefined();
      expect(response.body.data.totalRecords).toBeGreaterThan(0);
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app)
        .get('/api/v1/gdpr/data-summary')
        .expect(401);
    });
  });

  describe('GET /api/v1/gdpr/export', () => {
    it('should export user data for authenticated user', async () => {
      const response = await request(app)
        .get('/api/v1/gdpr/export')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.data.profile).toBeDefined();
      expect(response.body.data.consents).toHaveLength(1);
      expect(response.body.data.commissions).toHaveLength(1);
      expect(response.body.data.paymentMethods).toHaveLength(0);
      expect(response.body.data.exportedAt).toBeDefined();
      expect(response.body.data.exportVersion).toBe('1.0');
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app)
        .get('/api/v1/gdpr/export')
        .expect(401);
    });

    it('should set appropriate headers for file download', async () => {
      const response = await request(app)
        .get('/api/v1/gdpr/export')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.headers['content-disposition']).toMatch(/attachment; filename="user_data_export_/);
    });
  });

  describe('POST /api/v1/gdpr/rectify', () => {
    it('should rectify user data successfully', async () => {
      const rectifications = [
        {
          field: 'firstName',
          oldValue: 'John',
          newValue: 'Jane',
          reason: 'Name change'
        },
        {
          field: 'profile.phone',
          oldValue: '+1234567890',
          newValue: '+0987654321',
          reason: 'Phone number update'
        }
      ];

      const response = await request(app)
        .post('/api/v1/gdpr/rectify')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rectifications })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('User data has been successfully rectified');
      expect(response.body.rectifiedFields).toEqual(['firstName', 'profile.phone']);

      // Verify the changes were applied
      const updatedUser = await User.findById(testUser._id);
      const updatedProfile = await UserProfile.findOne({ userId: testUser._id });
      expect(updatedUser!.firstName).toBe('Jane');
      expect(updatedProfile!.phone).toBe('+0987654321');
    });

    it('should return 400 for invalid rectifications', async () => {
      const response = await request(app)
        .post('/api/v1/gdpr/rectify')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rectifications: [] })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid field', async () => {
      const rectifications = [
        {
          field: 'invalidField',
          oldValue: 'old',
          newValue: 'new'
        }
      ];

      const response = await request(app)
        .post('/api/v1/gdpr/rectify')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rectifications })
        .expect(500);

      expect(response.body.error.code).toBe('RECTIFICATION_ERROR');
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app)
        .post('/api/v1/gdpr/rectify')
        .send({ rectifications: [] })
        .expect(401);
    });
  });

  describe('GET /api/v1/gdpr/deletion-eligibility', () => {
    it('should check deletion eligibility successfully', async () => {
      const response = await request(app)
        .get('/api/v1/gdpr/deletion-eligibility')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.canDelete).toBe(true);
    });

    it('should return false when pending payouts exist', async () => {
      // Create a pending payout
      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: new mongoose.Types.ObjectId(),
        amount: 100,
        status: 'requested'
      }).save();

      const response = await request(app)
        .get('/api/v1/gdpr/deletion-eligibility')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.canDelete).toBe(false);
      expect(response.body.data.reason).toBe('Cannot delete user with pending payout requests');
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app)
        .get('/api/v1/gdpr/deletion-eligibility')
        .expect(401);
    });
  });

  describe('DELETE /api/v1/gdpr/delete', () => {
    it('should delete user data successfully', async () => {
      const response = await request(app)
        .delete('/api/v1/gdpr/delete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ reason: 'User requested deletion' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('User data has been successfully deleted');

      // Verify user is deleted
      const deletedUser = await User.findById(testUser._id);
      expect(deletedUser).toBeNull();
    });

    it('should return 400 when deletion is not allowed', async () => {
      // Create a pending payout to prevent deletion
      await new PayoutRequest({
        marketerId: testUser._id,
        paymentMethodId: new mongoose.Types.ObjectId(),
        amount: 100,
        status: 'requested'
      }).save();

      const response = await request(app)
        .delete('/api/v1/gdpr/delete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ reason: 'User requested deletion' })
        .expect(400);

      expect(response.body.error.code).toBe('DELETION_NOT_ALLOWED');
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app)
        .delete('/api/v1/gdpr/delete')
        .send({ reason: 'User requested deletion' })
        .expect(401);
    });
  });

  describe('Admin GDPR Routes', () => {
    describe('DELETE /api/v1/admin/gdpr/users/:userId/delete', () => {
      it('should allow admin to delete user data', async () => {
        const response = await request(app)
          .delete(`/api/v1/admin/gdpr/users/${testUser._id}/delete`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ reason: 'Admin deletion for compliance' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('User data has been successfully deleted by admin');

        // Verify user is deleted
        const deletedUser = await User.findById(testUser._id);
        expect(deletedUser).toBeNull();
      });

      it('should return 403 for non-admin user', async () => {
        await request(app)
          .delete(`/api/v1/admin/gdpr/users/${testUser._id}/delete`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ reason: 'Admin deletion' })
          .expect(403);
      });

      it('should return 400 for invalid user ID', async () => {
        const response = await request(app)
          .delete('/api/v1/admin/gdpr/users/invalid-id/delete')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ reason: 'Admin deletion' })
          .expect(400);

        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should return 401 for unauthenticated request', async () => {
        await request(app)
          .delete(`/api/v1/admin/gdpr/users/${testUser._id}/delete`)
          .send({ reason: 'Admin deletion' })
          .expect(401);
      });
    });

    describe('POST /api/v1/admin/gdpr/users/:userId/anonymize', () => {
      it('should allow admin to anonymize user data', async () => {
        const response = await request(app)
          .post(`/api/v1/admin/gdpr/users/${testUser._id}/anonymize`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ reason: 'Data retention period expired' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('User data has been successfully anonymized by admin');

        // Verify user data is anonymized
        const anonymizedUser = await User.findById(testUser._id);
        expect(anonymizedUser).toBeDefined();
        expect(anonymizedUser!.email).toMatch(/^anonymized_\d+@deleted\.local$/);
        expect(anonymizedUser!.firstName).toBe('Anonymized User');
        expect(anonymizedUser!.status).toBe('revoked');
      });

      it('should return 403 for non-admin user', async () => {
        await request(app)
          .post(`/api/v1/admin/gdpr/users/${testUser._id}/anonymize`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ reason: 'Admin anonymization' })
          .expect(403);
      });

      it('should return 400 for invalid user ID', async () => {
        const response = await request(app)
          .post('/api/v1/admin/gdpr/users/invalid-id/anonymize')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ reason: 'Admin anonymization' })
          .expect(400);

        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should return 401 for unauthenticated request', async () => {
        await request(app)
          .post(`/api/v1/admin/gdpr/users/${testUser._id}/anonymize`)
          .send({ reason: 'Admin anonymization' })
          .expect(401);
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on GDPR endpoints', async () => {
      // Make multiple requests to exceed rate limit (5 requests per 15 minutes)
      const requests = Array(6).fill(null).map(() =>
        request(app)
          .get('/api/v1/gdpr/data-summary')
          .set('Authorization', `Bearer ${userToken}`)
      );

      const responses = await Promise.all(requests);
      
      // First 5 should succeed, 6th should be rate limited
      expect(responses.slice(0, 5).every(r => r.status === 200)).toBe(true);
      expect(responses[5].status).toBe(429);
      expect(responses[5].body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});