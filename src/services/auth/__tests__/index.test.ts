import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuthService } from '../index';
import { User } from '../../../models/User';
import * as jwtUtils from '../../../utils/jwt';

describe('AuthService', () => {
  let mongoServer: MongoMemoryServer;

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
    await User.deleteMany({});
  });

  describe('registerUser', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!',
        role: 'marketer' as const
      };

      const result = await AuthService.registerUser(userData);

      expect(result.user).toBeDefined();
      expect(result.verificationToken).toBeDefined();
      expect(result.user.email).toBe(userData.email);
      expect(result.user.role).toBe(userData.role);
      expect(result.user.status).toBe('pending');
      expect(result.user.emailVerified).toBe(false);
      expect(typeof result.verificationToken).toBe('string');
      expect(result.verificationToken.length).toBe(64);
    });

    it('should default to marketer role when not specified', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.registerUser(userData);

      expect(result.user.role).toBe('marketer');
    });

    it('should throw error for duplicate email', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      await AuthService.registerUser(userData);

      await expect(AuthService.registerUser(userData))
        .rejects.toThrow('User with this email already exists');
    });

    it('should throw error for invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'Password123!'
      };

      await expect(AuthService.registerUser(userData))
        .rejects.toThrow();
    });

    it('should throw error for weak password', async () => {
      const userData = {
        email: 'test@example.com',
        password: '123'
      };

      await expect(AuthService.registerUser(userData))
        .rejects.toThrow();
    });
  });

  describe('loginUser', () => {
    let testUser: any;

    beforeEach(async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.registerUser(userData);
      testUser = result.user;
      
      // Verify email and activate user
      await AuthService.verifyEmail(result.verificationToken);
    });

    it('should login user with correct credentials', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.loginUser(credentials);

      expect(result.user).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(result.user.email).toBe(credentials.email);
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(result.user.lastLogin).toBeDefined();
    });

    it('should throw error for non-existent user', async () => {
      const credentials = {
        email: 'nonexistent@example.com',
        password: 'Password123!'
      };

      await expect(AuthService.loginUser(credentials))
        .rejects.toThrow('Invalid email or password');
    });

    it('should throw error for incorrect password', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'WrongPassword123!'
      };

      await expect(AuthService.loginUser(credentials))
        .rejects.toThrow('Invalid email or password');
    });

    it('should throw error for inactive user', async () => {
      // Create user and don't verify email (status remains pending)
      const userData = {
        email: 'inactive@example.com',
        password: 'Password123!'
      };

      await AuthService.registerUser(userData);

      const credentials = {
        email: 'inactive@example.com',
        password: 'Password123!'
      };

      await expect(AuthService.loginUser(credentials))
        .rejects.toThrow('Account is not active. Please contact support.');
    });

    it('should throw error for unverified email', async () => {
      // Create user but don't verify email
      const userData = {
        email: 'unverified@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.registerUser(userData);
      
      // Manually set status to active but keep email unverified
      await User.findByIdAndUpdate(result.user._id, { status: 'active' });

      const credentials = {
        email: 'unverified@example.com',
        password: 'Password123!'
      };

      await expect(AuthService.loginUser(credentials))
        .rejects.toThrow('Please verify your email before logging in');
    });
  });

  describe('refreshTokens', () => {
    let testUser: any;
    let refreshToken: string;

    beforeEach(async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.registerUser(userData);
      testUser = result.user;
      
      // Verify email and activate user
      await AuthService.verifyEmail(result.verificationToken);
      
      // Login to get refresh token
      const loginResult = await AuthService.loginUser({
        email: userData.email,
        password: userData.password
      });
      
      refreshToken = loginResult.tokens.refreshToken;
    });

    it('should refresh tokens with valid refresh token', async () => {
      // Add a small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const newTokens = await AuthService.refreshTokens(refreshToken);

      expect(newTokens.accessToken).toBeDefined();
      expect(newTokens.refreshToken).toBeDefined();
      expect(newTokens.accessToken).not.toBe(refreshToken);
      expect(newTokens.refreshToken).not.toBe(refreshToken);
    });

    it('should throw error for invalid refresh token', async () => {
      await expect(AuthService.refreshTokens('invalid-token'))
        .rejects.toThrow('Invalid or expired refresh token');
    });

    it('should throw error for non-existent user', async () => {
      // Delete user but try to refresh with their token
      await User.findByIdAndDelete(testUser._id);

      await expect(AuthService.refreshTokens(refreshToken))
        .rejects.toThrow('User not found');
    });

    it('should throw error for inactive user', async () => {
      // Suspend user
      await User.findByIdAndUpdate(testUser._id, { status: 'suspended' });

      await expect(AuthService.refreshTokens(refreshToken))
        .rejects.toThrow('Account is not active');
    });
  });

  describe('verifyEmail', () => {
    let testUser: any;
    let verificationToken: string;

    beforeEach(async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.registerUser(userData);
      testUser = result.user;
      verificationToken = result.verificationToken;
    });

    it('should verify email with valid token', async () => {
      const user = await AuthService.verifyEmail(verificationToken);

      expect(user.emailVerified).toBe(true);
      expect(user.status).toBe('active');
      expect(user.emailVerificationToken).toBeUndefined();
      expect(user.emailVerificationExpires).toBeUndefined();
    });

    it('should throw error for invalid token', async () => {
      await expect(AuthService.verifyEmail('invalid-token'))
        .rejects.toThrow('Invalid or expired verification token');
    });

    it('should throw error for expired token', async () => {
      // Manually expire the token
      await User.findByIdAndUpdate(testUser._id, {
        emailVerificationExpires: new Date(Date.now() - 1000) // 1 second ago
      });

      await expect(AuthService.verifyEmail(verificationToken))
        .rejects.toThrow('Invalid or expired verification token');
    });

    it('should throw error for already used token', async () => {
      // Verify email first time
      await AuthService.verifyEmail(verificationToken);

      // Try to use same token again
      await expect(AuthService.verifyEmail(verificationToken))
        .rejects.toThrow('Invalid or expired verification token');
    });
  });

  describe('resendVerificationEmail', () => {
    let testUser: any;

    beforeEach(async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.registerUser(userData);
      testUser = result.user;
    });

    it('should resend verification email for unverified user', async () => {
      const newToken = await AuthService.resendVerificationEmail('test@example.com');

      expect(typeof newToken).toBe('string');
      expect(newToken.length).toBe(64);
    });

    it('should throw error for non-existent user', async () => {
      await expect(AuthService.resendVerificationEmail('nonexistent@example.com'))
        .rejects.toThrow('User not found');
    });

    it('should throw error for already verified user', async () => {
      // Verify email first
      const userData = {
        email: 'verified@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.registerUser(userData);
      await AuthService.verifyEmail(result.verificationToken);

      await expect(AuthService.resendVerificationEmail('verified@example.com'))
        .rejects.toThrow('Email is already verified');
    });
  });

  describe('requestPasswordReset', () => {
    beforeEach(async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      await AuthService.registerUser(userData);
    });

    it('should generate reset token for existing user', async () => {
      const resetToken = await AuthService.requestPasswordReset('test@example.com');

      expect(typeof resetToken).toBe('string');
      expect(resetToken.length).toBe(64);
    });

    it('should return dummy token for non-existent user', async () => {
      const resetToken = await AuthService.requestPasswordReset('nonexistent@example.com');

      expect(resetToken).toBe('dummy-token');
    });
  });

  describe('resetPassword', () => {
    let testUser: any;
    let resetToken: string;

    beforeEach(async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.registerUser(userData);
      testUser = result.user;
      resetToken = await AuthService.requestPasswordReset(userData.email);
    });

    it('should reset password with valid token', async () => {
      const newPassword = 'NewPassword123!';
      const user = await AuthService.resetPassword(resetToken, newPassword);

      expect(user.email).toBe('test@example.com');
      expect(user.passwordResetToken).toBeUndefined();
      expect(user.passwordResetExpires).toBeUndefined();

      // Verify new password works
      const userWithPassword = await User.findById(user._id).select('+password');
      const isPasswordValid = await userWithPassword!.comparePassword(newPassword);
      expect(isPasswordValid).toBe(true);
    });

    it('should throw error for invalid token', async () => {
      await expect(AuthService.resetPassword('invalid-token', 'NewPassword123!'))
        .rejects.toThrow('Invalid or expired reset token');
    });

    it('should throw error for expired token', async () => {
      // Manually expire the token
      await User.findByIdAndUpdate(testUser._id, {
        passwordResetExpires: new Date(Date.now() - 1000) // 1 second ago
      });

      await expect(AuthService.resetPassword(resetToken, 'NewPassword123!'))
        .rejects.toThrow('Invalid or expired reset token');
    });

    it('should throw error for already used token', async () => {
      // Use token first time
      await AuthService.resetPassword(resetToken, 'NewPassword123!');

      // Try to use same token again
      await expect(AuthService.resetPassword(resetToken, 'AnotherPassword123!'))
        .rejects.toThrow('Invalid or expired reset token');
    });
  });
});