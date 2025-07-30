import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User, IUser } from '../User';

describe('User Model', () => {
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

  describe('User Creation', () => {
    it('should create a user with valid data', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!',
        role: 'marketer' as const
      };

      const user = new User(userData);
      const savedUser = await user.save();

      expect(savedUser.email).toBe(userData.email);
      expect(savedUser.role).toBe(userData.role);
      expect(savedUser.status).toBe('pending');
      expect(savedUser.emailVerified).toBe(false);
      expect(savedUser.password).not.toBe(userData.password); // Should be hashed
      expect(savedUser.createdAt).toBeDefined();
      expect(savedUser.updatedAt).toBeDefined();
    });

    it('should set default values correctly', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const user = new User(userData);
      const savedUser = await user.save();

      expect(savedUser.role).toBe('marketer');
      expect(savedUser.status).toBe('pending');
      expect(savedUser.emailVerified).toBe(false);
    });

    it('should require email and password', async () => {
      const user = new User({});
      
      await expect(user.save()).rejects.toThrow();
    });

    it('should validate email format', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'Password123!'
      };

      const user = new User(userData);
      
      await expect(user.save()).rejects.toThrow();
    });

    it('should enforce unique email constraint', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const user1 = new User(userData);
      await user1.save();

      const user2 = new User(userData);
      
      await expect(user2.save()).rejects.toThrow();
    });

    it('should validate password minimum length', async () => {
      const userData = {
        email: 'test@example.com',
        password: '123' // Too short
      };

      const user = new User(userData);
      
      await expect(user.save()).rejects.toThrow();
    });

    it('should validate role enum values', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!',
        role: 'invalid-role' as any
      };

      const user = new User(userData);
      
      await expect(user.save()).rejects.toThrow();
    });
  });

  describe('Password Hashing', () => {
    it('should hash password before saving', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const user = new User(userData);
      await user.save();

      expect(user.password).not.toBe(userData.password);
      expect(user.password).toMatch(/^\$2[aby]\$\d+\$/); // bcrypt hash pattern
    });

    it('should not rehash password if not modified', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const user = new User(userData);
      await user.save();
      const originalHash = user.password;

      user.email = 'updated@example.com';
      await user.save();

      expect(user.password).toBe(originalHash);
    });

    it('should rehash password when modified', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const user = new User(userData);
      await user.save();
      const originalHash = user.password;

      user.password = 'NewPassword123!';
      await user.save();

      expect(user.password).not.toBe(originalHash);
    });
  });

  describe('Password Comparison', () => {
    let user: IUser;

    beforeEach(async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      user = new User(userData);
      await user.save();
    });

    it('should return true for correct password', async () => {
      const isMatch = await user.comparePassword('Password123!');
      expect(isMatch).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const isMatch = await user.comparePassword('WrongPassword');
      expect(isMatch).toBe(false);
    });

    it('should return false for empty password', async () => {
      const isMatch = await user.comparePassword('');
      expect(isMatch).toBe(false);
    });
  });

  describe('Email Verification Token', () => {
    let user: IUser;

    beforeEach(async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      user = new User(userData);
      await user.save();
    });

    it('should generate email verification token', () => {
      const token = user.generateEmailVerificationToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes = 64 hex characters
      expect(user.emailVerificationToken).toBeDefined();
      expect(user.emailVerificationExpires).toBeDefined();
      expect(user.emailVerificationExpires!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should set expiration to 24 hours from now', () => {
      const beforeGeneration = Date.now();
      user.generateEmailVerificationToken();
      const afterGeneration = Date.now();

      const expectedExpiration = 24 * 60 * 60 * 1000; // 24 hours in ms
      const actualExpiration = user.emailVerificationExpires!.getTime() - beforeGeneration;

      expect(actualExpiration).toBeGreaterThanOrEqual(expectedExpiration - 1000); // Allow 1s tolerance
      expect(actualExpiration).toBeLessThanOrEqual(expectedExpiration + (afterGeneration - beforeGeneration));
    });
  });

  describe('Password Reset Token', () => {
    let user: IUser;

    beforeEach(async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      user = new User(userData);
      await user.save();
    });

    it('should generate password reset token', () => {
      const token = user.generatePasswordResetToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes = 64 hex characters
      expect(user.passwordResetToken).toBeDefined();
      expect(user.passwordResetExpires).toBeDefined();
      expect(user.passwordResetExpires!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should set expiration to 10 minutes from now', () => {
      const beforeGeneration = Date.now();
      user.generatePasswordResetToken();
      const afterGeneration = Date.now();

      const expectedExpiration = 10 * 60 * 1000; // 10 minutes in ms
      const actualExpiration = user.passwordResetExpires!.getTime() - beforeGeneration;

      expect(actualExpiration).toBeGreaterThanOrEqual(expectedExpiration - 1000); // Allow 1s tolerance
      expect(actualExpiration).toBeLessThanOrEqual(expectedExpiration + (afterGeneration - beforeGeneration));
    });
  });

  describe('JSON Transformation', () => {
    it('should exclude sensitive fields from JSON output', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const user = new User(userData);
      user.generateEmailVerificationToken();
      user.generatePasswordResetToken();
      await user.save();

      const userJson = user.toJSON();

      expect(userJson.id).toBeDefined();
      expect(userJson.email).toBe(userData.email);
      expect(userJson.role).toBe('marketer');
      expect(userJson.status).toBe('pending');
      expect(userJson.emailVerified).toBe(false);
      expect(userJson.createdAt).toBeDefined();
      expect(userJson.updatedAt).toBeDefined();

      // Sensitive fields should be excluded
      expect(userJson.password).toBeUndefined();
      expect(userJson.emailVerificationToken).toBeUndefined();
      expect(userJson.emailVerificationExpires).toBeUndefined();
      expect(userJson.passwordResetToken).toBeUndefined();
      expect(userJson.passwordResetExpires).toBeUndefined();
      expect(userJson._id).toBeUndefined();
      expect(userJson.__v).toBeUndefined();
    });
  });
});