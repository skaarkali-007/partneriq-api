import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { UserProfile, IUserProfile } from '../UserProfile';
import { User } from '../User';

describe('UserProfile Model', () => {
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
    await UserProfile.deleteMany({});
    await User.deleteMany({});
  });

  describe('Profile Creation', () => {
    it('should create a valid user profile', async () => {
      // Create a user first
      const user = new User({
        email: 'test@example.com',
        password: 'TestPassword123!',
        role: 'marketer'
      });
      await user.save();

      const profileData = {
        userId: user._id,
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        dateOfBirth: new Date('1990-01-01'),
        address: {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US'
        }
      };

      const profile = new UserProfile(profileData);
      await profile.save();

      expect(profile.userId.toString()).toBe(user._id.toString());
      expect(profile.firstName).toBe('John');
      expect(profile.lastName).toBe('Doe');
      expect(profile.kycStatus).toBe('pending');
      expect(profile.complianceQuizPassed).toBe(false);
    });

    it('should enforce unique userId constraint', async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'TestPassword123!',
        role: 'marketer'
      });
      await user.save();

      const profileData = {
        userId: user._id,
        firstName: 'John',
        lastName: 'Doe'
      };

      const profile1 = new UserProfile(profileData);
      await profile1.save();

      const profile2 = new UserProfile(profileData);
      await expect(profile2.save()).rejects.toThrow();
    });

    it('should validate age requirement (18+)', async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'TestPassword123!',
        role: 'marketer'
      });
      await user.save();

      const underageDate = new Date();
      underageDate.setFullYear(underageDate.getFullYear() - 17); // 17 years old

      const profileData = {
        userId: user._id,
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: underageDate
      };

      const profile = new UserProfile(profileData);
      await expect(profile.save()).rejects.toThrow('Must be at least 18 years old');
    });

    it('should validate phone number format', async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'TestPassword123!',
        role: 'marketer'
      });
      await user.save();

      const profileData = {
        userId: user._id,
        firstName: 'John',
        lastName: 'Doe',
        phone: 'invalid-phone'
      };

      const profile = new UserProfile(profileData);
      await expect(profile.save()).rejects.toThrow();
    });
  });

  describe('KYC Document Management', () => {
    let profile: IUserProfile;

    beforeEach(async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'TestPassword123!',
        role: 'marketer'
      });
      await user.save();

      profile = new UserProfile({
        userId: user._id,
        firstName: 'John',
        lastName: 'Doe'
      });
      await profile.save();
    });

    it('should add KYC document', () => {
      const document = {
        type: 'government_id' as const,
        filename: 'id-123.jpg',
        originalName: 'drivers-license.jpg',
        encryptedPath: '/uploads/encrypted/id-123.jpg',
        encryptionKey: 'test-key',
        mimeType: 'image/jpeg',
        size: 1024000
      };

      profile.addKYCDocument(document);

      expect(profile.kycDocuments).toHaveLength(1);
      expect(profile.kycDocuments[0].type).toBe('government_id');
      expect(profile.kycDocuments[0].status).toBe('pending');
      expect(profile.kycDocuments[0].uploadedAt).toBeInstanceOf(Date);
    });

    it('should update KYC status to approved', () => {
      const reviewerId = new mongoose.Types.ObjectId().toString();
      
      profile.updateKYCStatus('approved', reviewerId);

      expect(profile.kycStatus).toBe('approved');
      expect(profile.kycReviewedBy?.toString()).toBe(reviewerId);
      expect(profile.kycApprovedAt).toBeInstanceOf(Date);
      expect(profile.kycRejectedAt).toBeUndefined();
      expect(profile.kycRejectionReason).toBeUndefined();
    });

    it('should update KYC status to rejected with reason', () => {
      const reviewerId = new mongoose.Types.ObjectId().toString();
      const reason = 'Document quality is poor';
      
      profile.updateKYCStatus('rejected', reviewerId, reason);

      expect(profile.kycStatus).toBe('rejected');
      expect(profile.kycReviewedBy?.toString()).toBe(reviewerId);
      expect(profile.kycRejectedAt).toBeInstanceOf(Date);
      expect(profile.kycRejectionReason).toBe(reason);
      expect(profile.kycApprovedAt).toBeUndefined();
    });

    it('should set submission date when status changes to in_review', () => {
      profile.updateKYCStatus('in_review');

      expect(profile.kycStatus).toBe('in_review');
      expect(profile.kycSubmittedAt).toBeInstanceOf(Date);
    });
  });

  describe('Encryption Methods', () => {
    let profile: IUserProfile;

    beforeEach(async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'TestPassword123!',
        role: 'marketer'
      });
      await user.save();

      profile = new UserProfile({
        userId: user._id,
        firstName: 'John',
        lastName: 'Doe'
      });
      await profile.save();
    });

    it('should encrypt and decrypt sensitive fields', () => {
      const sensitiveData = 'SSN-123-45-6789';
      
      const { encrypted, key } = profile.encryptSensitiveField(sensitiveData);
      
      expect(encrypted).toBeDefined();
      expect(key).toBeDefined();
      expect(encrypted).not.toBe(sensitiveData);
      
      const decrypted = profile.decryptSensitiveField(encrypted, key);
      expect(decrypted).toBe(sensitiveData);
    });

    it('should generate different encryption keys for each field', () => {
      const data1 = 'sensitive-data-1';
      const data2 = 'sensitive-data-2';
      
      const result1 = profile.encryptSensitiveField(data1);
      const result2 = profile.encryptSensitiveField(data2);
      
      expect(result1.key).not.toBe(result2.key);
      expect(result1.encrypted).not.toBe(result2.encrypted);
    });
  });

  describe('JSON Transformation', () => {
    it('should exclude sensitive fields from JSON output', async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'TestPassword123!',
        role: 'marketer'
      });
      await user.save();

      const profile = new UserProfile({
        userId: user._id,
        firstName: 'John',
        lastName: 'Doe',
        taxId: 'encrypted-tax-id',
        bankAccountInfo: {
          accountNumber: 'encrypted-account',
          routingNumber: 'encrypted-routing',
          bankName: 'Test Bank',
          accountType: 'checking'
        }
      });

      // Add a KYC document
      profile.addKYCDocument({
        type: 'government_id',
        filename: 'id-123.jpg',
        originalName: 'drivers-license.jpg',
        encryptedPath: '/uploads/encrypted/id-123.jpg',
        encryptionKey: 'secret-key',
        mimeType: 'image/jpeg',
        size: 1024000
      });

      await profile.save();

      const json = profile.toJSON();

      expect(json.id).toBeDefined();
      expect(json._id).toBeUndefined();
      expect(json.__v).toBeUndefined();
      expect(json.taxId).toBeUndefined();
      
      if (json.bankAccountInfo) {
        expect(json.bankAccountInfo.accountNumber).toBeUndefined();
        expect(json.bankAccountInfo.routingNumber).toBeUndefined();
        expect(json.bankAccountInfo.bankName).toBe('Test Bank');
      }
      
      if (json.kycDocuments && json.kycDocuments.length > 0) {
        expect(json.kycDocuments[0].encryptionKey).toBeUndefined();
        expect(json.kycDocuments[0].type).toBe('government_id');
      }
    });
  });

  describe('Compliance Quiz', () => {
    let profile: IUserProfile;

    beforeEach(async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'TestPassword123!',
        role: 'marketer'
      });
      await user.save();

      profile = new UserProfile({
        userId: user._id,
        firstName: 'John',
        lastName: 'Doe'
      });
      await profile.save();
    });

    it('should store compliance quiz results', async () => {
      profile.complianceQuizScore = 85;
      profile.complianceQuizCompletedAt = new Date();
      profile.complianceQuizPassed = true;

      await profile.save();

      expect(profile.complianceQuizScore).toBe(85);
      expect(profile.complianceQuizCompletedAt).toBeInstanceOf(Date);
      expect(profile.complianceQuizPassed).toBe(true);
    });

    it('should validate quiz score range', async () => {
      profile.complianceQuizScore = 150; // Invalid score > 100

      await expect(profile.save()).rejects.toThrow();
    });
  });
});