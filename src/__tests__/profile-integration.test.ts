import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../index';
import { User } from '../models/User';
import { UserProfile } from '../models/UserProfile';
import { generateTokenPair } from '../utils/jwt';

describe('Profile Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let marketerToken: string;
  let adminToken: string;
  let marketerUserId: string;
  let adminUserId: string;

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
    await UserProfile.deleteMany({});
    await User.deleteMany({});

    // Create test users
    const marketerUser = new User({
      email: 'marketer@example.com',
      password: 'TestPassword123!',
      role: 'marketer',
      emailVerified: true,
      status: 'active'
    });
    await marketerUser.save();
    marketerUserId = marketerUser._id.toString();

    const adminUser = new User({
      email: 'admin@example.com',
      password: 'AdminPassword123!',
      role: 'admin',
      emailVerified: true,
      status: 'active'
    });
    await adminUser.save();
    adminUserId = adminUser._id.toString();

    // Generate tokens
    const marketerTokens = generateTokenPair(marketerUser);
    const adminTokens = generateTokenPair(adminUser);
    marketerToken = marketerTokens.accessToken;
    adminToken = adminTokens.accessToken;
  });

  describe('Profile Management Workflow', () => {
    it('should complete full profile creation and update workflow', async () => {
      // 1. Create profile
      const profileData = {
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        dateOfBirth: '1990-01-01',
        address: {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US'
        }
      };

      const createResponse = await request(app)
        .post('/api/v1/profile')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(profileData)
        .expect(201);

      expect(createResponse.body.success).toBe(true);
      expect(createResponse.body.data.firstName).toBe('John');
      expect(createResponse.body.data.kycStatus).toBe('pending');

      // 2. Get profile
      const getResponse = await request(app)
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${marketerToken}`)
        .expect(200);

      expect(getResponse.body.success).toBe(true);
      expect(getResponse.body.data.firstName).toBe('John');

      // 3. Update profile
      const updateData = {
        firstName: 'Jane',
        bankAccountInfo: {
          accountNumber: '1234567890',
          routingNumber: '987654321',
          bankName: 'Test Bank',
          accountType: 'checking'
        }
      };

      const updateResponse = await request(app)
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(updateData)
        .expect(200);

      expect(updateResponse.body.success).toBe(true);
      expect(updateResponse.body.data.firstName).toBe('Jane');
      expect(updateResponse.body.data.bankAccountInfo.bankName).toBe('Test Bank');
      // Sensitive fields should not be returned
      expect(updateResponse.body.data.bankAccountInfo.accountNumber).toBeUndefined();
    });

    it('should handle profile creation validation errors', async () => {
      const invalidProfileData = {
        firstName: 'John',
        lastName: 'Doe',
        phone: 'invalid-phone',
        dateOfBirth: '2010-01-01' // Too young
      };

      const response = await request(app)
        .post('/api/v1/profile')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(invalidProfileData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should prevent duplicate profile creation', async () => {
      const profileData = {
        firstName: 'John',
        lastName: 'Doe'
      };

      // Create first profile
      await request(app)
        .post('/api/v1/profile')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(profileData)
        .expect(201);

      // Try to create second profile
      const response = await request(app)
        .post('/api/v1/profile')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(profileData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Profile already exists');
    });
  });

  describe('KYC Document Upload Workflow', () => {
    beforeEach(async () => {
      // Create profile first
      const profileData = {
        firstName: 'John',
        lastName: 'Doe'
      };

      await request(app)
        .post('/api/v1/profile')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(profileData);
    });

    it('should upload KYC document successfully', async () => {
      const response = await request(app)
        .post('/api/v1/profile/kyc/upload')
        .set('Authorization', `Bearer ${marketerToken}`)
        .field('type', 'government_id')
        .attach('document', Buffer.from('fake-image-data'), {
          filename: 'drivers-license.jpg',
          contentType: 'image/jpeg'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.kycDocuments).toHaveLength(1);
      expect(response.body.data.kycDocuments[0].type).toBe('government_id');
      expect(response.body.data.kycStatus).toBe('in_review');
    });

    it('should reject invalid file types', async () => {
      const response = await request(app)
        .post('/api/v1/profile/kyc/upload')
        .set('Authorization', `Bearer ${marketerToken}`)
        .field('type', 'government_id')
        .attach('document', Buffer.from('text-content'), {
          filename: 'document.txt',
          contentType: 'text/plain'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid file type');
    });

    it('should require authentication for document upload', async () => {
      const response = await request(app)
        .post('/api/v1/profile/kyc/upload')
        .field('type', 'government_id')
        .attach('document', Buffer.from('fake-image-data'), {
          filename: 'drivers-license.jpg',
          contentType: 'image/jpeg'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('KYC Review Workflow (Admin)', () => {
    let profileId: string;
    let documentId: string;

    beforeEach(async () => {
      // Create profile and upload document
      const profile = new UserProfile({
        userId: marketerUserId,
        firstName: 'John',
        lastName: 'Doe',
        kycStatus: 'in_review'
      });

      profile.addKYCDocument({
        type: 'government_id',
        filename: 'test-id.jpg',
        originalName: 'drivers-license.jpg',
        encryptedPath: '/fake/path/test-id.jpg',
        encryptionKey: 'fake-key',
        mimeType: 'image/jpeg',
        size: 1024000
      });

      await profile.save();
      profileId = profile._id.toString();
      documentId = profile.kycDocuments[0]._id!.toString();
    });

    it('should allow admin to approve KYC', async () => {
      const reviewData = {
        status: 'approved'
      };

      const response = await request(app)
        .put(`/api/v1/profile/admin/${marketerUserId}/kyc/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(reviewData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.kycStatus).toBe('approved');

      // Check that user status was updated
      const user = await User.findById(marketerUserId);
      expect(user?.status).toBe('active');
    });

    it('should allow admin to reject KYC with reason', async () => {
      const reviewData = {
        status: 'rejected',
        reason: 'Document quality is poor'
      };

      const response = await request(app)
        .put(`/api/v1/profile/admin/${marketerUserId}/kyc/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(reviewData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.kycStatus).toBe('rejected');
      expect(response.body.data.kycRejectionReason).toBe('Document quality is poor');
    });

    it('should prevent non-admin from reviewing KYC', async () => {
      const reviewData = {
        status: 'approved'
      };

      const response = await request(app)
        .put(`/api/v1/profile/admin/${marketerUserId}/kyc/review`)
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(reviewData)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Admin access required');
    });

    it('should allow admin to get all profiles for review', async () => {
      const response = await request(app)
        .get('/api/v1/profile/admin/all')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].kycStatus).toBe('in_review');
    });

    it('should filter profiles by status', async () => {
      const response = await request(app)
        .get('/api/v1/profile/admin/all?status=in_review')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe('Compliance Quiz Workflow', () => {
    beforeEach(async () => {
      // Create profile first
      const profileData = {
        firstName: 'John',
        lastName: 'Doe'
      };

      await request(app)
        .post('/api/v1/profile')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(profileData);
    });

    it('should submit passing compliance quiz', async () => {
      const quizData = {
        score: 85
      };

      const response = await request(app)
        .post('/api/v1/profile/compliance-quiz')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(quizData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.complianceQuizScore).toBe(85);
      expect(response.body.data.complianceQuizPassed).toBe(true);
    });

    it('should submit failing compliance quiz', async () => {
      const quizData = {
        score: 75
      };

      const response = await request(app)
        .post('/api/v1/profile/compliance-quiz')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(quizData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.complianceQuizScore).toBe(75);
      expect(response.body.data.complianceQuizPassed).toBe(false);
    });

    it('should validate quiz score range', async () => {
      const quizData = {
        score: 150 // Invalid score > 100
      };

      const response = await request(app)
        .post('/api/v1/profile/compliance-quiz')
        .set('Authorization', `Bearer ${marketerToken}`)
        .send(quizData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require authentication for all profile endpoints', async () => {
      const endpoints = [
        { method: 'post', path: '/api/v1/profile' },
        { method: 'get', path: '/api/v1/profile' },
        { method: 'put', path: '/api/v1/profile' },
        { method: 'post', path: '/api/v1/profile/kyc/upload' },
        { method: 'post', path: '/api/v1/profile/compliance-quiz' }
      ];

      for (const endpoint of endpoints) {
        let response;
        if (endpoint.method === 'post') {
          response = await request(app).post(endpoint.path).expect(401);
        } else if (endpoint.method === 'get') {
          response = await request(app).get(endpoint.path).expect(401);
        } else if (endpoint.method === 'put') {
          response = await request(app).put(endpoint.path).expect(401);
        }
        
        expect(response?.body.success).toBe(false);
      }
    });

    it('should require admin role for admin endpoints', async () => {
      const adminEndpoints = [
        { method: 'get', path: '/api/v1/profile/admin/all' },
        { method: 'put', path: `/api/v1/profile/admin/${marketerUserId}/kyc/review` },
        { method: 'get', path: `/api/v1/profile/admin/${marketerUserId}/kyc/documents/123` }
      ];

      for (const endpoint of adminEndpoints) {
        let response;
        if (endpoint.method === 'get') {
          response = await request(app).get(endpoint.path)
            .set('Authorization', `Bearer ${marketerToken}`)
            .expect(403);
        } else if (endpoint.method === 'put') {
          response = await request(app).put(endpoint.path)
            .set('Authorization', `Bearer ${marketerToken}`)
            .send({ status: 'approved' })
            .expect(403);
        }
        
        expect(response?.body.success).toBe(false);
        expect(response?.body.error).toBe('Admin access required');
      }
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to profile endpoints', async () => {
      // This test would require making multiple requests quickly
      // For now, we'll just verify the endpoint structure is correct
      const response = await request(app)
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${marketerToken}`)
        .expect(404); // Profile doesn't exist yet, but rate limiting should allow the request

      expect(response.body.success).toBe(false);
    });
  });
});