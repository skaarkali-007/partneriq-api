import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import speakeasy from 'speakeasy';
import { MFAService } from '../index';
import { AuthService } from '../../auth';
import { User } from '../../../models/User';

describe('MFAService', () => {
  let mongoServer: MongoMemoryServer;
  let testUser: any;
  let userId: string;

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

  describe('setupMFA', () => {
    it('should setup MFA for a user successfully', async () => {
      const setupResult = await MFAService.setupMFA(userId);

      expect(setupResult.secret).toBeDefined();
      expect(setupResult.qrCodeUrl).toBeDefined();
      expect(setupResult.backupCodes).toBeDefined();
      expect(setupResult.backupCodes).toHaveLength(8);
      expect(setupResult.qrCodeUrl).toContain('data:image/png;base64');
      
      // Verify user has MFA secret but is not enabled yet
      const updatedUser = await User.findById(userId).select('+mfaSecret +mfaBackupCodes');
      expect(updatedUser!.mfaSecret).toBeDefined();
      expect(updatedUser!.mfaBackupCodes).toHaveLength(8);
      expect(updatedUser!.mfaEnabled).toBe(false);
      expect(updatedUser!.mfaSetupCompleted).toBe(false);
    });

    it('should throw error for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      
      await expect(MFAService.setupMFA(nonExistentId))
        .rejects.toThrow('User not found');
    });

    it('should throw error if MFA is already enabled', async () => {
      // Setup and enable MFA first
      const setupResult = await MFAService.setupMFA(userId);
      const token = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);

      // Try to setup again
      await expect(MFAService.setupMFA(userId))
        .rejects.toThrow('MFA is already enabled for this user');
    });

    it('should allow re-setup if MFA was initiated but not completed', async () => {
      // Setup MFA but don't complete verification
      await MFAService.setupMFA(userId);

      // Should allow setup again
      const secondSetup = await MFAService.setupMFA(userId);
      expect(secondSetup.secret).toBeDefined();
      expect(secondSetup.qrCodeUrl).toBeDefined();
      expect(secondSetup.backupCodes).toBeDefined();
    });
  });

  describe('verifyAndEnableMFA', () => {
    let mfaSecret: string;

    beforeEach(async () => {
      const setupResult = await MFAService.setupMFA(userId);
      mfaSecret = setupResult.secret;
    });

    it('should verify token and enable MFA successfully', async () => {
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      const user = await MFAService.verifyAndEnableMFA(userId, token);

      expect(user.mfaEnabled).toBe(true);
      expect(user.mfaSetupCompleted).toBe(true);
    });

    it('should throw error for invalid token', async () => {
      await expect(MFAService.verifyAndEnableMFA(userId, '123456'))
        .rejects.toThrow('Invalid MFA token');
    });

    it('should throw error for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      await expect(MFAService.verifyAndEnableMFA(nonExistentId, token))
        .rejects.toThrow('User not found');
    });

    it('should throw error if MFA setup not initiated', async () => {
      // Create new user without MFA setup
      const newUserData = {
        email: 'newuser@example.com',
        password: 'Password123!'
      };
      const newUserResult = await AuthService.registerUser(newUserData);
      await AuthService.verifyEmail(newUserResult.verificationToken);

      await expect(MFAService.verifyAndEnableMFA(newUserResult.user._id, '123456'))
        .rejects.toThrow('MFA setup not initiated. Please start MFA setup first.');
    });

    it('should throw error if MFA is already enabled', async () => {
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      // Enable MFA first
      await MFAService.verifyAndEnableMFA(userId, token);

      // Try to enable again
      const newToken = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      await expect(MFAService.verifyAndEnableMFA(userId, newToken))
        .rejects.toThrow('MFA is already enabled for this user');
    });
  });

  describe('verifyMFAToken', () => {
    let mfaSecret: string;
    let backupCodes: string[];

    beforeEach(async () => {
      const setupResult = await MFAService.setupMFA(userId);
      mfaSecret = setupResult.secret;
      backupCodes = setupResult.backupCodes;

      // Enable MFA
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);
    });

    it('should verify valid TOTP token', async () => {
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      const result = await MFAService.verifyMFAToken(userId, token);

      expect(result.isValid).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user!.email).toBe('test@example.com');
    });

    it('should verify valid backup code', async () => {
      const backupCode = backupCodes[0];

      const result = await MFAService.verifyMFAToken(userId, backupCode);

      expect(result.isValid).toBe(true);
      expect(result.user).toBeDefined();

      // Verify backup code is removed after use
      const updatedUser = await User.findById(userId).select('+mfaBackupCodes');
      expect(updatedUser!.mfaBackupCodes).toHaveLength(7);
    });

    it('should reject invalid TOTP token', async () => {
      const result = await MFAService.verifyMFAToken(userId, '123456');

      expect(result.isValid).toBe(false);
      expect(result.user).toBeUndefined();
    });

    it('should reject invalid backup code', async () => {
      const result = await MFAService.verifyMFAToken(userId, 'INVALID1');

      expect(result.isValid).toBe(false);
      expect(result.user).toBeUndefined();
    });

    it('should reject used backup code', async () => {
      const backupCode = backupCodes[0];

      // Use backup code first time
      const firstResult = await MFAService.verifyMFAToken(userId, backupCode);
      expect(firstResult.isValid).toBe(true);

      // Try to use same backup code again
      const secondResult = await MFAService.verifyMFAToken(userId, backupCode);
      expect(secondResult.isValid).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      const result = await MFAService.verifyMFAToken(nonExistentId, token);

      expect(result.isValid).toBe(false);
    });

    it('should throw error if MFA is not enabled', async () => {
      // Create new user without MFA
      const newUserData = {
        email: 'newuser@example.com',
        password: 'Password123!'
      };
      const newUserResult = await AuthService.registerUser(newUserData);
      await AuthService.verifyEmail(newUserResult.verificationToken);

      await expect(MFAService.verifyMFAToken(newUserResult.user._id, '123456'))
        .rejects.toThrow('MFA is not enabled for this user');
    });
  });

  describe('disableMFA', () => {
    let mfaSecret: string;

    beforeEach(async () => {
      const setupResult = await MFAService.setupMFA(userId);
      mfaSecret = setupResult.secret;

      // Enable MFA
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);
    });

    it('should disable MFA with valid token', async () => {
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      const user = await MFAService.disableMFA(userId, token);

      expect(user.mfaEnabled).toBe(false);
      expect(user.mfaSetupCompleted).toBe(false);

      // Verify secrets are cleared
      const updatedUser = await User.findById(userId).select('+mfaSecret +mfaBackupCodes');
      expect(updatedUser!.mfaSecret).toBeUndefined();
      expect(updatedUser!.mfaBackupCodes).toEqual([]);
    });

    it('should throw error for invalid token', async () => {
      await expect(MFAService.disableMFA(userId, '123456'))
        .rejects.toThrow('Invalid MFA token. Cannot disable MFA without valid token.');
    });

    it('should throw error for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      await expect(MFAService.disableMFA(nonExistentId, token))
        .rejects.toThrow('User not found');
    });

    it('should throw error if MFA is not enabled', async () => {
      // Create new user without MFA
      const newUserData = {
        email: 'newuser@example.com',
        password: 'Password123!'
      };
      const newUserResult = await AuthService.registerUser(newUserData);
      await AuthService.verifyEmail(newUserResult.verificationToken);

      await expect(MFAService.disableMFA(newUserResult.user._id, '123456'))
        .rejects.toThrow('MFA is not enabled for this user');
    });
  });

  describe('regenerateBackupCodes', () => {
    let mfaSecret: string;
    let originalBackupCodes: string[];

    beforeEach(async () => {
      const setupResult = await MFAService.setupMFA(userId);
      mfaSecret = setupResult.secret;
      originalBackupCodes = setupResult.backupCodes;

      // Enable MFA
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);
    });

    it('should regenerate backup codes with valid token', async () => {
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      const newBackupCodes = await MFAService.regenerateBackupCodes(userId, token);

      expect(newBackupCodes).toHaveLength(8);
      expect(newBackupCodes).not.toEqual(originalBackupCodes);

      // Verify old backup codes no longer work
      const oldCodeResult = await MFAService.verifyMFAToken(userId, originalBackupCodes[0]);
      expect(oldCodeResult.isValid).toBe(false);

      // Verify new backup codes work
      const newCodeResult = await MFAService.verifyMFAToken(userId, newBackupCodes[0]);
      expect(newCodeResult.isValid).toBe(true);
    });

    it('should throw error for invalid token', async () => {
      await expect(MFAService.regenerateBackupCodes(userId, '123456'))
        .rejects.toThrow('Invalid MFA token. Cannot regenerate backup codes without valid token.');
    });

    it('should throw error for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const token = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32'
      });

      await expect(MFAService.regenerateBackupCodes(nonExistentId, token))
        .rejects.toThrow('User not found');
    });

    it('should throw error if MFA is not enabled', async () => {
      // Create new user without MFA
      const newUserData = {
        email: 'newuser@example.com',
        password: 'Password123!'
      };
      const newUserResult = await AuthService.registerUser(newUserData);
      await AuthService.verifyEmail(newUserResult.verificationToken);

      await expect(MFAService.regenerateBackupCodes(newUserResult.user._id, '123456'))
        .rejects.toThrow('MFA is not enabled for this user');
    });
  });

  describe('getMFAStatus', () => {
    it('should return correct status for user without MFA', async () => {
      const status = await MFAService.getMFAStatus(userId);

      expect(status.mfaEnabled).toBe(false);
      expect(status.mfaSetupCompleted).toBe(false);
      expect(status.backupCodesCount).toBe(0);
    });

    it('should return correct status for user with MFA setup but not enabled', async () => {
      await MFAService.setupMFA(userId);

      const status = await MFAService.getMFAStatus(userId);

      expect(status.mfaEnabled).toBe(false);
      expect(status.mfaSetupCompleted).toBe(false);
      expect(status.backupCodesCount).toBe(8);
    });

    it('should return correct status for user with MFA enabled', async () => {
      const setupResult = await MFAService.setupMFA(userId);
      const token = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);

      const status = await MFAService.getMFAStatus(userId);

      expect(status.mfaEnabled).toBe(true);
      expect(status.mfaSetupCompleted).toBe(true);
      expect(status.backupCodesCount).toBe(8);
    });

    it('should return correct backup codes count after using some', async () => {
      const setupResult = await MFAService.setupMFA(userId);
      const token = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);

      // Use a backup code
      await MFAService.verifyMFAToken(userId, setupResult.backupCodes[0]);

      const status = await MFAService.getMFAStatus(userId);

      expect(status.backupCodesCount).toBe(7);
    });

    it('should throw error for non-existent user', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      await expect(MFAService.getMFAStatus(nonExistentId))
        .rejects.toThrow('User not found');
    });
  });

  describe('isMFARequired', () => {
    it('should return false for user without MFA', async () => {
      const user = await User.findById(userId);
      const isRequired = MFAService.isMFARequired(user!);

      expect(isRequired).toBe(false);
    });

    it('should return false for user with MFA setup but not enabled', async () => {
      await MFAService.setupMFA(userId);
      const user = await User.findById(userId);
      const isRequired = MFAService.isMFARequired(user!);

      expect(isRequired).toBe(false);
    });

    it('should return true for user with MFA enabled', async () => {
      const setupResult = await MFAService.setupMFA(userId);
      const token = speakeasy.totp({
        secret: setupResult.secret,
        encoding: 'base32'
      });
      await MFAService.verifyAndEnableMFA(userId, token);

      const user = await User.findById(userId);
      const isRequired = MFAService.isMFARequired(user!);

      expect(isRequired).toBe(true);
    });
  });
});