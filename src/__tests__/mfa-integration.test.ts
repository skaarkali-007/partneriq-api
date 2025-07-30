import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import speakeasy from 'speakeasy';
import { AuthService } from '../services/auth';
import { MFAService } from '../services/mfa';
import { User } from '../models/User';
import { requireMFA } from '../middleware/auth';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';

describe('MFA Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let testUser: any;
  let userId: string;
  let mfaSecret: string;

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
    
    // Create and verify a test user
    const userData = {
      email: 'test@example.com',
      password: 'Password123!',
      role: 'marketer' as const
    };

    const result = await AuthService.registerUser(userData);
    testUser = result.user;
    userId = testUser._id;
    
    // Verify email and activate user
    await AuthService.verifyEmail(result.verificationToken);
    
    // Refresh user data
    testUser = await User.findById(userId);
  });

  describe('MFA Enforcement for Sensitive Operations', () => {
    it('should allow access to sensitive operations when MFA is not enabled', async () => {
      // Mock request and response objects
      const mockReq = {
        user: testUser,
        headers: {}
      } as any;

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      } as any;

      const mockNext = jest.fn();

      // Call requireMFA middleware
      await requireMFA(mockReq, mockRes, mockNext);

      // Should call next() since MFA is not enabled
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should require MFA token when MFA is enabled', async () => {
      // Setup and enable MFA
      const setupResult = await MFAService.setupMFA(userId);
      mfaSecret = setupResult.secret;
      
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });
      
      await MFAService.verifyAndEnableMFA(userId, token);
      
      // Refresh user data
      const updatedUser = await User.findById(userId);

      // Mock request without MFA token
      const mockReq = {
        user: updatedUser,
        headers: {}
      } as any;

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      } as any;

      const mockNext = jest.fn();

      // Call requireMFA middleware
      await requireMFA(mockReq, mockRes, mockNext);

      // Should return 403 error
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'MFA token required for this operation',
        mfaRequired: true
      });
    });

    it('should allow access when valid MFA token is provided', async () => {
      // Setup and enable MFA
      const setupResult = await MFAService.setupMFA(userId);
      mfaSecret = setupResult.secret;
      
      let token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });
      
      await MFAService.verifyAndEnableMFA(userId, token);
      
      // Refresh user data
      const updatedUser = await User.findById(userId);

      // Generate new token for the request
      token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      // Mock request with valid MFA token
      const mockReq = {
        user: updatedUser,
        headers: {
          'x-mfa-token': token
        }
      } as any;

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      } as any;

      const mockNext = jest.fn();

      // Call requireMFA middleware
      await requireMFA(mockReq, mockRes, mockNext);

      // Should call next() since valid MFA token is provided
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should reject invalid MFA token', async () => {
      // Setup and enable MFA
      const setupResult = await MFAService.setupMFA(userId);
      mfaSecret = setupResult.secret;
      
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });
      
      await MFAService.verifyAndEnableMFA(userId, token);
      
      // Refresh user data
      const updatedUser = await User.findById(userId);

      // Mock request with invalid MFA token
      const mockReq = {
        user: updatedUser,
        headers: {
          'x-mfa-token': '123456' // Invalid token
        }
      } as any;

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      } as any;

      const mockNext = jest.fn();

      // Call requireMFA middleware
      await requireMFA(mockReq, mockRes, mockNext);

      // Should return 403 error
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid MFA token',
        mfaRequired: true
      });
    });

    it('should allow access with valid backup code', async () => {
      // Setup and enable MFA
      const setupResult = await MFAService.setupMFA(userId);
      mfaSecret = setupResult.secret;
      const backupCodes = setupResult.backupCodes;
      
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });
      
      await MFAService.verifyAndEnableMFA(userId, token);
      
      // Refresh user data
      const updatedUser = await User.findById(userId);

      // Mock request with valid backup code
      const mockReq = {
        user: updatedUser,
        headers: {
          'x-mfa-token': backupCodes[0]
        }
      } as any;

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      } as any;

      const mockNext = jest.fn();

      // Call requireMFA middleware
      await requireMFA(mockReq, mockRes, mockNext);

      // Should call next() since valid backup code is provided
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });

  describe('Login Flow with MFA Status', () => {
    it('should include MFA status in login response when MFA is not enabled', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.loginUser(credentials);
      const mfaStatus = await MFAService.getMFAStatus(result.user._id);

      expect(result.user).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(mfaStatus.mfaEnabled).toBe(false);
      expect(mfaStatus.mfaSetupCompleted).toBe(false);
    });

    it('should include MFA status in login response when MFA is enabled', async () => {
      // Setup and enable MFA
      const setupResult = await MFAService.setupMFA(userId);
      const token = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);

      const credentials = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const result = await AuthService.loginUser(credentials);
      const mfaStatus = await MFAService.getMFAStatus(result.user._id);

      expect(result.user).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(mfaStatus.mfaEnabled).toBe(true);
      expect(mfaStatus.mfaSetupCompleted).toBe(true);
    });
  });

  describe('MFA Service Integration', () => {
    it('should properly handle MFA setup flow end-to-end', async () => {
      // Step 1: Setup MFA
      const setupResult = await MFAService.setupMFA(userId);
      
      expect(setupResult.secret).toBeDefined();
      expect(setupResult.qrCodeUrl).toContain('data:image/png;base64');
      expect(setupResult.backupCodes).toHaveLength(8);
      
      // Verify user state after setup
      let user = await User.findById(userId).select('+mfaSecret +mfaBackupCodes');
      expect(user!.mfaEnabled).toBe(false);
      expect(user!.mfaSetupCompleted).toBe(false);
      expect(user!.mfaSecret).toBeDefined();
      expect(user!.mfaBackupCodes).toHaveLength(8);

      // Step 2: Verify and enable MFA
      const token = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      
      await MFAService.verifyAndEnableMFA(userId, token);
      
      // Verify user state after enabling
      user = await User.findById(userId);
      expect(user!.mfaEnabled).toBe(true);
      expect(user!.mfaSetupCompleted).toBe(true);

      // Step 3: Test MFA verification
      const newToken = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      
      const verification = await MFAService.verifyMFAToken(userId, newToken);
      expect(verification.isValid).toBe(true);
      expect(verification.user).toBeDefined();

      // Step 4: Test backup code usage
      const backupCodeVerification = await MFAService.verifyMFAToken(userId, setupResult.backupCodes[0]);
      expect(backupCodeVerification.isValid).toBe(true);
      
      // Verify backup code is removed after use
      user = await User.findById(userId).select('+mfaBackupCodes') as any;
      expect(user!.mfaBackupCodes).toHaveLength(7);
    });

    it('should handle MFA requirement checking correctly', async () => {
      // User without MFA should not require it
      let user = await User.findById(userId);
      expect(MFAService.isMFARequired(user!)).toBe(false);

      // Setup but not enable MFA
      await MFAService.setupMFA(userId);
      user = await User.findById(userId);
      expect(MFAService.isMFARequired(user!)).toBe(false);

      // Enable MFA
      const setupResult = await MFAService.setupMFA(userId);
      const token = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);

      user = await User.findById(userId);
      expect(MFAService.isMFARequired(user!)).toBe(true);
    });

    it('should handle backup code regeneration correctly', async () => {
      // Setup and enable MFA
      const setupResult = await MFAService.setupMFA(userId);
      const token = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);

      // Use a backup code
      await MFAService.verifyMFAToken(userId, setupResult.backupCodes[0]);

      // Regenerate backup codes
      const newToken = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      const newBackupCodes = await MFAService.regenerateBackupCodes(userId, newToken);

      expect(newBackupCodes).toHaveLength(8);
      expect(newBackupCodes).not.toEqual(setupResult.backupCodes);

      // Old backup codes should not work
      const oldCodeResult = await MFAService.verifyMFAToken(userId, setupResult.backupCodes[1]);
      expect(oldCodeResult.isValid).toBe(false);

      // New backup codes should work
      const newCodeResult = await MFAService.verifyMFAToken(userId, newBackupCodes[0]);
      expect(newCodeResult.isValid).toBe(true);
    });

    it('should handle MFA disable correctly', async () => {
      // Setup and enable MFA
      const setupResult = await MFAService.setupMFA(userId);
      const token = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);

      // Verify MFA is enabled
      let user = await User.findById(userId);
      expect(user!.mfaEnabled).toBe(true);
      expect(MFAService.isMFARequired(user!)).toBe(true);

      // Disable MFA
      const disableToken = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      await MFAService.disableMFA(userId, disableToken);

      // Verify MFA is disabled and secrets are cleared
      user = await User.findById(userId).select('+mfaSecret +mfaBackupCodes') as any;
      expect(user!.mfaEnabled).toBe(false);
      expect(user!.mfaSetupCompleted).toBe(false);
      expect(user!.mfaSecret).toBeUndefined();
      expect(user!.mfaBackupCodes).toEqual([]);
      expect(MFAService.isMFARequired(user!)).toBe(false);
    });
  });
});