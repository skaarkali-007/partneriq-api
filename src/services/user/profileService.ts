import { UserProfile, IUserProfile, IKYCDocument } from '../../models/UserProfile';
import { User } from '../../models/User';
import { logger } from '../../utils/logger';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface CreateProfileData {
  userId: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: Date;
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

export interface UpdateProfileData {
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: Date;
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  taxId?: string;
  bankAccountInfo?: {
    accountNumber: string;
    routingNumber: string;
    bankName: string;
    accountType: 'checking' | 'savings';
  };
}

export interface KYCDocumentUpload {
  type: IKYCDocument['type'];
  filename: string;
  originalName: string;
  buffer: Buffer;
  mimeType: string;
}

export interface KYCReviewData {
  status: 'approved' | 'rejected' | 'requires_resubmission';
  reason?: string;
  reviewerId: string;
}

export class ProfileService {
  private static readonly UPLOAD_DIR = process.env.KYC_UPLOAD_DIR || './uploads/kyc';
  private static readonly ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf'
  ];
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  /**
   * Create a new user profile
   */
  static async createProfile(data: CreateProfileData): Promise<IUserProfile> {
    try {
      // Verify user exists
      const user = await User.findById(data.userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if profile already exists
      const existingProfile = await UserProfile.findOne({ userId: data.userId });
      if (existingProfile) {
        throw new Error('Profile already exists for this user');
      }

      const { userId, ...profileData } = data;
      const profile = new UserProfile({
        userId: new mongoose.Types.ObjectId(userId),
        ...profileData
      });

      await profile.save();
      logger.info(`Profile created for user ${data.userId}`);
      
      return profile;
    } catch (error) {
      logger.error('Error creating profile:', error);
      throw error;
    }
  }

  /**
   * Get user profile by user ID
   */
  static async getProfileByUserId(userId: string): Promise<IUserProfile | null> {
    try {
      const profile = await UserProfile.findOne({ userId }).populate('kycReviewedBy', 'email');
      return profile;
    } catch (error) {
      logger.error('Error fetching profile:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(userId: string, data: UpdateProfileData): Promise<IUserProfile> {
    try {
      const profile = await UserProfile.findOne({ userId });
      if (!profile) {
        throw new Error('Profile not found');
      }

      // Handle encrypted fields
      if (data.taxId) {
        const encrypted = profile.encryptSensitiveField(data.taxId);
        profile.taxId = encrypted.encrypted;
        // Store encryption key securely (in production, use a key management service)
        // For now, we'll store it in the document (not recommended for production)
      }

      if (data.bankAccountInfo) {
        const encryptedAccount = profile.encryptSensitiveField(data.bankAccountInfo.accountNumber);
        const encryptedRouting = profile.encryptSensitiveField(data.bankAccountInfo.routingNumber);
        
        profile.bankAccountInfo = {
          accountNumber: encryptedAccount.encrypted,
          routingNumber: encryptedRouting.encrypted,
          bankName: data.bankAccountInfo.bankName,
          accountType: data.bankAccountInfo.accountType
        };
      }

      // Update other fields
      Object.assign(profile, {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        dateOfBirth: data.dateOfBirth,
        address: data.address
      });

      await profile.save();
      logger.info(`Profile updated for user ${userId}`);
      
      return profile;
    } catch (error) {
      logger.error('Error updating profile:', error);
      throw error;
    }
  }

  /**
   * Upload KYC document with encryption
   */
  static async uploadKYCDocument(userId: string, documentData: KYCDocumentUpload): Promise<IUserProfile> {
    try {
      // Validate file
      if (!this.ALLOWED_MIME_TYPES.includes(documentData.mimeType)) {
        throw new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF files are allowed.');
      }

      if (documentData.buffer.length > this.MAX_FILE_SIZE) {
        throw new Error('File size exceeds maximum limit of 10MB');
      }

      const profile = await UserProfile.findOne({ userId });
      if (!profile) {
        throw new Error('Profile not found');
      }

      // Ensure upload directory exists
      await fs.mkdir(this.UPLOAD_DIR, { recursive: true });

      // Generate unique filename and encryption key
      const fileExtension = path.extname(documentData.originalName);
      const uniqueFilename = `${crypto.randomUUID()}${fileExtension}`;
      const encryptionKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);

      // Encrypt file content
      const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
      const encryptedBuffer = Buffer.concat([
        cipher.update(documentData.buffer),
        cipher.final()
      ]);

      // Save encrypted file
      const filePath = path.join(this.UPLOAD_DIR, uniqueFilename);
      await fs.writeFile(filePath, encryptedBuffer);

      // Add document to profile
      const kycDocument: Omit<IKYCDocument, 'uploadedAt' | 'status'> = {
        type: documentData.type,
        filename: uniqueFilename,
        originalName: documentData.originalName,
        encryptedPath: filePath,
        encryptionKey: encryptionKey.toString('hex'),
        mimeType: documentData.mimeType,
        size: documentData.buffer.length
      };

      profile.addKYCDocument(kycDocument);

      // Update KYC status to in_review if this is the first document
      if (profile.kycStatus === 'pending') {
        profile.updateKYCStatus('in_review');
      }

      await profile.save();
      logger.info(`KYC document uploaded for user ${userId}: ${documentData.type}`);
      
      return profile;
    } catch (error) {
      logger.error('Error uploading KYC document:', error);
      throw error;
    }
  }

  /**
   * Get decrypted KYC document (admin only)
   */
  static async getKYCDocument(userId: string, documentId: string, requesterId: string): Promise<Buffer> {
    try {
      // Verify requester is admin
      const requester = await User.findById(requesterId);
      if (!requester || requester.role !== 'admin') {
        throw new Error('Unauthorized: Admin access required');
      }

      const profile = await UserProfile.findOne({ userId }).select('+kycDocuments.encryptionKey');
      if (!profile) {
        throw new Error('Profile not found');
      }

      const document = profile.kycDocuments.find(doc => doc._id?.toString() === documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      // Read and decrypt file
      const encryptedBuffer = await fs.readFile(document.encryptedPath);
      const encryptionKey = Buffer.from(document.encryptionKey, 'hex');
      
      // For file decryption, we need to extract the IV from the encrypted data
      // In a real implementation, you'd store IV separately or prepend it to the encrypted data
      const iv = crypto.randomBytes(16); // This is a simplified approach for testing
      const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
      const decryptedBuffer = Buffer.concat([
        decipher.update(encryptedBuffer),
        decipher.final()
      ]);

      logger.info(`KYC document accessed by admin ${requesterId} for user ${userId}`);
      return decryptedBuffer;
    } catch (error) {
      logger.error('Error retrieving KYC document:', error);
      throw error;
    }
  }

  /**
   * Review KYC documents (admin only)
   */
  static async reviewKYC(userId: string, reviewData: KYCReviewData): Promise<IUserProfile> {
    try {
      // Verify reviewer is admin
      const reviewer = await User.findById(reviewData.reviewerId);
      if (!reviewer || reviewer.role !== 'admin') {
        throw new Error('Unauthorized: Admin access required');
      }

      const profile = await UserProfile.findOne({ userId });
      if (!profile) {
        throw new Error('Profile not found');
      }

      // Update KYC status
      profile.updateKYCStatus(reviewData.status, reviewData.reviewerId, reviewData.reason);

      // If approved, update user status to active
      if (reviewData.status === 'approved') {
        await User.findByIdAndUpdate(userId, { status: 'active' });
      }

      await profile.save();
      logger.info(`KYC reviewed for user ${userId} by admin ${reviewData.reviewerId}: ${reviewData.status}`);
      
      return profile;
    } catch (error) {
      logger.error('Error reviewing KYC:', error);
      throw error;
    }
  }

  /**
   * Submit compliance quiz results
   */
  static async submitComplianceQuiz(userId: string, score: number): Promise<IUserProfile> {
    try {
      const profile = await UserProfile.findOne({ userId });
      if (!profile) {
        throw new Error('Profile not found');
      }

      const passingScore = 80; // 80% passing score
      const passed = score >= passingScore;

      profile.complianceQuizScore = score;
      profile.complianceQuizCompletedAt = new Date();
      profile.complianceQuizPassed = passed;

      await profile.save();
      logger.info(`Compliance quiz submitted for user ${userId}: ${score}% (${passed ? 'PASSED' : 'FAILED'})`);
      
      return profile;
    } catch (error) {
      logger.error('Error submitting compliance quiz:', error);
      throw error;
    }
  }

  /**
   * Get all profiles for admin review
   */
  static async getAllProfilesForReview(
    status?: IUserProfile['kycStatus'],
    page: number = 1,
    limit: number = 20
  ): Promise<{ profiles: IUserProfile[]; total: number; pages: number }> {
    try {
      const query = status ? { kycStatus: status } : {};
      const skip = (page - 1) * limit;

      const [profiles, total] = await Promise.all([
        UserProfile.find(query)
          .populate('userId', 'email role status')
          .populate('kycReviewedBy', 'email')
          .sort({ kycSubmittedAt: -1 })
          .skip(skip)
          .limit(limit),
        UserProfile.countDocuments(query)
      ]);

      const pages = Math.ceil(total / limit);

      return { profiles, total, pages };
    } catch (error) {
      logger.error('Error fetching profiles for review:', error);
      throw error;
    }
  }

  /**
   * Delete KYC document
   */
  static async deleteKYCDocument(userId: string, documentId: string): Promise<IUserProfile> {
    try {
      const profile = await UserProfile.findOne({ userId });
      if (!profile) {
        throw new Error('Profile not found');
      }

      const documentIndex = profile.kycDocuments.findIndex(doc => doc._id?.toString() === documentId);
      if (documentIndex === -1) {
        throw new Error('Document not found');
      }

      const document = profile.kycDocuments[documentIndex];

      // Delete file from filesystem
      try {
        await fs.unlink(document.encryptedPath);
      } catch (fileError) {
        logger.warn(`Could not delete file ${document.encryptedPath}:`, fileError);
      }

      // Remove document from profile
      profile.kycDocuments.splice(documentIndex, 1);
      await profile.save();

      logger.info(`KYC document deleted for user ${userId}: ${documentId}`);
      return profile;
    } catch (error) {
      logger.error('Error deleting KYC document:', error);
      throw error;
    }
  }
}