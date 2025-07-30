import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ProfileService, CreateProfileData, UpdateProfileData, KYCReviewData } from '../profileService';
import { UserProfile } from '../../../models/UserProfile';
import { User } from '../../../models/User';
import fs from 'fs/promises';
import path from 'path';

// Mock fs module
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('ProfileService', () => {
  let mongoServer: MongoMemoryServer;
  let testUserId: string;
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
    const testUser = new User({
      email: 'test@example.com',
      password: 'TestPassword123!',
      role: 'marketer'
    });
    await testUser.save();
    testUserId = testUser._id.toString();

    const adminUser = new User({
      email: 'admin@example.com',
      password: 'AdminPassword123!',
      role: 'admin'
    });
    await adminUser.save();
    adminUserId = adminUser._id.toString();

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('createProfile', () => {
    it('should create a new profile successfully', async () => {
      const profileData: CreateProfileData = {
        userId: testUserId,
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

      const profile = await ProfileService.createProfile(profileData);

      expect(profile.userId.toString()).toBe(testUserId);
      expect(profile.firstName).toBe('John');
      expect(profile.lastName).toBe('Doe');
      expect(profile.kycStatus).toBe('pending');
    });

    it('should throw error if user does not exist', async () => {
      const nonExistentUserId = new mongoose.Types.ObjectId().toString();
      const profileData: CreateProfileData = {
        userId: nonExistentUserId,
        firstName: 'John',
        lastName: 'Doe'
      };

      await expect(ProfileService.createProfile(profileData)).rejects.toThrow('User not found');
    });

    it('should throw error if profile already exists', async () => {
      // Create first profile
      const profileData: CreateProfileData = {
        userId: testUserId,
        firstName: 'John',
        lastName: 'Doe'
      };

      await ProfileService.createProfile(profileData);

      // Try to create second profile for same user
      await expect(ProfileService.createProfile(profileData)).rejects.toThrow('Profile already exists for this user');
    });
  });

  describe('getProfileByUserId', () => {
    it('should return profile if exists', async () => {
      const profileData: CreateProfileData = {
        userId: testUserId,
        firstName: 'John',
        lastName: 'Doe'
      };

      await ProfileService.createProfile(profileData);
      const profile = await ProfileService.getProfileByUserId(testUserId);

      expect(profile).toBeTruthy();
      expect(profile?.firstName).toBe('John');
    });

    it('should return null if profile does not exist', async () => {
      const profile = await ProfileService.getProfileByUserId(testUserId);
      expect(profile).toBeNull();
    });
  });

  describe('updateProfile', () => {
    beforeEach(async () => {
      const profileData: CreateProfileData = {
        userId: testUserId,
        firstName: 'John',
        lastName: 'Doe'
      };
      await ProfileService.createProfile(profileData);
    });

    it('should update profile successfully', async () => {
      const updateData: UpdateProfileData = {
        firstName: 'Jane',
        phone: '+9876543210',
        address: {
          street: '456 Oak Ave',
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90210',
          country: 'US'
        }
      };

      const updatedProfile = await ProfileService.updateProfile(testUserId, updateData);

      expect(updatedProfile.firstName).toBe('Jane');
      expect(updatedProfile.phone).toBe('+9876543210');
      expect(updatedProfile.address?.city).toBe('Los Angeles');
    });

    it('should handle bank account info encryption', async () => {
      const updateData: UpdateProfileData = {
        bankAccountInfo: {
          accountNumber: '1234567890',
          routingNumber: '987654321',
          bankName: 'Test Bank',
          accountType: 'checking'
        }
      };

      const updatedProfile = await ProfileService.updateProfile(testUserId, updateData);

      expect(updatedProfile.bankAccountInfo?.bankName).toBe('Test Bank');
      expect(updatedProfile.bankAccountInfo?.accountType).toBe('checking');
      // Account number should be encrypted (not equal to original)
      expect(updatedProfile.bankAccountInfo?.accountNumber).not.toBe('1234567890');
    });

    it('should throw error if profile not found', async () => {
      const nonExistentUserId = new mongoose.Types.ObjectId().toString();
      const updateData: UpdateProfileData = {
        firstName: 'Jane'
      };

      await expect(ProfileService.updateProfile(nonExistentUserId, updateData)).rejects.toThrow('Profile not found');
    });
  });

  describe('uploadKYCDocument', () => {
    beforeEach(async () => {
      const profileData: CreateProfileData = {
        userId: testUserId,
        firstName: 'John',
        lastName: 'Doe'
      };
      await ProfileService.createProfile(profileData);

      // Mock fs operations
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
    });

    it('should upload KYC document successfully', async () => {
      const documentData = {
        type: 'government_id' as const,
        filename: 'test-id.jpg',
        originalName: 'drivers-license.jpg',
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg'
      };

      const updatedProfile = await ProfileService.uploadKYCDocument(testUserId, documentData);

      expect(updatedProfile.kycDocuments).toHaveLength(1);
      expect(updatedProfile.kycDocuments[0].type).toBe('government_id');
      expect(updatedProfile.kycDocuments[0].originalName).toBe('drivers-license.jpg');
      expect(updatedProfile.kycStatus).toBe('in_review');
      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should reject invalid file types', async () => {
      const documentData = {
        type: 'government_id' as const,
        filename: 'test.txt',
        originalName: 'document.txt',
        buffer: Buffer.from('text-data'),
        mimeType: 'text/plain'
      };

      await expect(ProfileService.uploadKYCDocument(testUserId, documentData)).rejects.toThrow('Invalid file type');
    });

    it('should reject files that are too large', async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      const documentData = {
        type: 'government_id' as const,
        filename: 'large-file.jpg',
        originalName: 'large-image.jpg',
        buffer: largeBuffer,
        mimeType: 'image/jpeg'
      };

      await expect(ProfileService.uploadKYCDocument(testUserId, documentData)).rejects.toThrow('File size exceeds maximum limit');
    });

    it('should throw error if profile not found', async () => {
      const nonExistentUserId = new mongoose.Types.ObjectId().toString();
      const documentData = {
        type: 'government_id' as const,
        filename: 'test-id.jpg',
        originalName: 'drivers-license.jpg',
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg'
      };

      await expect(ProfileService.uploadKYCDocument(nonExistentUserId, documentData)).rejects.toThrow('Profile not found');
    });
  });

  describe('reviewKYC', () => {
    let profileId: string;

    beforeEach(async () => {
      const profileData: CreateProfileData = {
        userId: testUserId,
        firstName: 'John',
        lastName: 'Doe'
      };
      const profile = await ProfileService.createProfile(profileData);
      profileId = profile._id.toString();
    });

    it('should approve KYC successfully', async () => {
      const reviewData: KYCReviewData = {
        status: 'approved',
        reviewerId: adminUserId
      };

      const updatedProfile = await ProfileService.reviewKYC(testUserId, reviewData);

      expect(updatedProfile.kycStatus).toBe('approved');
      expect(updatedProfile.kycReviewedBy?.toString()).toBe(adminUserId);
      expect(updatedProfile.kycApprovedAt).toBeInstanceOf(Date);

      // Check that user status was updated to active
      const user = await User.findById(testUserId);
      expect(user?.status).toBe('active');
    });

    it('should reject KYC with reason', async () => {
      const reviewData: KYCReviewData = {
        status: 'rejected',
        reason: 'Document quality is poor',
        reviewerId: adminUserId
      };

      const updatedProfile = await ProfileService.reviewKYC(testUserId, reviewData);

      expect(updatedProfile.kycStatus).toBe('rejected');
      expect(updatedProfile.kycRejectionReason).toBe('Document quality is poor');
      expect(updatedProfile.kycRejectedAt).toBeInstanceOf(Date);
    });

    it('should throw error if reviewer is not admin', async () => {
      const reviewData: KYCReviewData = {
        status: 'approved',
        reviewerId: testUserId // Regular user, not admin
      };

      await expect(ProfileService.reviewKYC(testUserId, reviewData)).rejects.toThrow('Unauthorized: Admin access required');
    });

    it('should throw error if profile not found', async () => {
      const nonExistentUserId = new mongoose.Types.ObjectId().toString();
      const reviewData: KYCReviewData = {
        status: 'approved',
        reviewerId: adminUserId
      };

      await expect(ProfileService.reviewKYC(nonExistentUserId, reviewData)).rejects.toThrow('Profile not found');
    });
  });

  describe('submitComplianceQuiz', () => {
    beforeEach(async () => {
      const profileData: CreateProfileData = {
        userId: testUserId,
        firstName: 'John',
        lastName: 'Doe'
      };
      await ProfileService.createProfile(profileData);
    });

    it('should submit passing quiz score', async () => {
      const score = 85;
      const updatedProfile = await ProfileService.submitComplianceQuiz(testUserId, score);

      expect(updatedProfile.complianceQuizScore).toBe(85);
      expect(updatedProfile.complianceQuizPassed).toBe(true);
      expect(updatedProfile.complianceQuizCompletedAt).toBeInstanceOf(Date);
    });

    it('should submit failing quiz score', async () => {
      const score = 75;
      const updatedProfile = await ProfileService.submitComplianceQuiz(testUserId, score);

      expect(updatedProfile.complianceQuizScore).toBe(75);
      expect(updatedProfile.complianceQuizPassed).toBe(false);
      expect(updatedProfile.complianceQuizCompletedAt).toBeInstanceOf(Date);
    });

    it('should throw error if profile not found', async () => {
      const nonExistentUserId = new mongoose.Types.ObjectId().toString();
      
      await expect(ProfileService.submitComplianceQuiz(nonExistentUserId, 85)).rejects.toThrow('Profile not found');
    });
  });

  describe('getAllProfilesForReview', () => {
    beforeEach(async () => {
      // Create multiple profiles with different statuses
      const users = [];
      for (let i = 0; i < 5; i++) {
        const user = new User({
          email: `user${i}@example.com`,
          password: 'TestPassword123!',
          role: 'marketer'
        });
        await user.save();
        users.push(user);
      }

      // Create profiles with different KYC statuses
      const statuses = ['pending', 'in_review', 'approved', 'rejected', 'requires_resubmission'];
      for (let i = 0; i < users.length; i++) {
        const profile = new UserProfile({
          userId: users[i]._id,
          firstName: `User${i}`,
          lastName: 'Test',
          kycStatus: statuses[i] as any
        });
        await profile.save();
      }
    });

    it('should return all profiles when no status filter', async () => {
      const result = await ProfileService.getAllProfilesForReview();

      expect(result.profiles).toHaveLength(5);
      expect(result.total).toBe(5);
      expect(result.pages).toBe(1);
    });

    it('should filter profiles by status', async () => {
      const result = await ProfileService.getAllProfilesForReview('pending');

      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0].kycStatus).toBe('pending');
    });

    it('should handle pagination', async () => {
      const result = await ProfileService.getAllProfilesForReview(undefined, 1, 2);

      expect(result.profiles).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.pages).toBe(3);
    });
  });

  describe('deleteKYCDocument', () => {
    let profile: any;
    let documentId: string;

    beforeEach(async () => {
      const profileData: CreateProfileData = {
        userId: testUserId,
        firstName: 'John',
        lastName: 'Doe'
      };
      profile = await ProfileService.createProfile(profileData);

      // Add a KYC document
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

      documentId = profile.kycDocuments[0]._id.toString();

      // Mock fs.unlink
      mockFs.unlink.mockResolvedValue(undefined);
    });

    it('should delete KYC document successfully', async () => {
      const updatedProfile = await ProfileService.deleteKYCDocument(testUserId, documentId);

      expect(updatedProfile.kycDocuments).toHaveLength(0);
      expect(mockFs.unlink).toHaveBeenCalledWith('/fake/path/test-id.jpg');
    });

    it('should handle file deletion errors gracefully', async () => {
      mockFs.unlink.mockRejectedValue(new Error('File not found'));

      // Should not throw error even if file deletion fails
      const updatedProfile = await ProfileService.deleteKYCDocument(testUserId, documentId);
      expect(updatedProfile.kycDocuments).toHaveLength(0);
    });

    it('should throw error if document not found', async () => {
      const nonExistentDocId = new mongoose.Types.ObjectId().toString();

      await expect(ProfileService.deleteKYCDocument(testUserId, nonExistentDocId)).rejects.toThrow('Document not found');
    });
  });
});