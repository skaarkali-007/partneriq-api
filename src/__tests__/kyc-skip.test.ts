import request from 'supertest';
import { app } from '../app';
import { User } from '../models/User';
import { connectDB, disconnectDB } from '../config/database';

describe('KYC Skip Functionality', () => {
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    // Clean up database
    await User.deleteMany({});

    // Create a test user
    const userData = {
      email: 'test@example.com',
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'User',
      role: 'marketer'
    };

    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send(userData);

    // Activate the user for testing
    const user = await User.findOne({ email: userData.email });
    if (user) {
      user.status = 'active';
      user.emailVerified = true;
      await user.save();
      userId = user._id.toString();
    }

    // Login to get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: userData.email,
        password: userData.password
      });

    authToken = loginResponse.body.data.tokens.accessToken;
  });

  describe('POST /api/auth/skip-kyc', () => {
    it('should allow marketer to skip KYC', async () => {
      const response = await request(app)
        .post('/api/auth/skip-kyc')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('KYC verification skipped successfully');
      expect(response.body.data.kycSkipped).toBe(true);
      expect(response.body.data.kycRequired).toBe(false);

      // Verify in database
      const user = await User.findById(userId);
      expect(user?.kycSkipped).toBe(true);
      expect(user?.kycRequired).toBe(false);
    });

    it('should not allow admin to skip KYC', async () => {
      // Update user role to admin
      await User.findByIdAndUpdate(userId, { role: 'admin' });

      const response = await request(app)
        .post('/api/auth/skip-kyc')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('KYC skip is only available for marketer accounts');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/auth/skip-kyc')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should include KYC fields in user response', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('kycRequired');
      expect(response.body.data).toHaveProperty('kycCompleted');
      expect(response.body.data).toHaveProperty('kycSkipped');
      
      // Default values for new user
      expect(response.body.data.kycRequired).toBe(true);
      expect(response.body.data.kycCompleted).toBe(false);
      expect(response.body.data.kycSkipped).toBe(false);
    });

    it('should show updated KYC status after skipping', async () => {
      // Skip KYC first
      await request(app)
        .post('/api/auth/skip-kyc')
        .set('Authorization', `Bearer ${authToken}`);

      // Check updated status
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.kycRequired).toBe(false);
      expect(response.body.data.kycCompleted).toBe(false);
      expect(response.body.data.kycSkipped).toBe(true);
    });
  });
});