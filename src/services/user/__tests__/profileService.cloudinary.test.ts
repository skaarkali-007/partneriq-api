import { ProfileService } from '../profileService';
import { UserProfile } from '../../../models/UserProfile';
import { User } from '../../../models/User';
import { cloudinaryService } from '../../cloudinary';

// Mock dependencies
jest.mock('../../../models/UserProfile');
jest.mock('../../../models/User');
jest.mock('../../cloudinary');
jest.mock('../../../utils/logger');

// Mock fetch for document retrieval
global.fetch = jest.fn();

describe('ProfileService with Cloudinary Integration', () => {
  const mockUserId = 'user123';
  const mockDocumentId = 'doc123';
  const mockAdminId = 'admin123';
  
  const mockProfile = {
    _id: 'profile123',
    userId: mockUserId,
    kycDocuments: [],
    kycStatus: 'pending',
    addKYCDocument: jest.fn(),
    updateKYCStatus: jest.fn(),
    save: jest.fn()
  };

  const mockAdmin = {
    _id: mockAdminId,
    role: 'admin'
  };

  const mockDocumentData = {
    type: 'government_id' as const,
    filename: 'test.jpg',
    originalName: 'passport.jpg',
    buffer: Buffer.from('test file content'),
    mimeType: 'image/jpeg'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (cloudinaryService.isReady as jest.Mock).mockReturnValue(true);
  });

  describe('uploadKYCDocument', () => {
    it('should upload document to Cloudinary successfully', async () => {
      const mockUploadResult = {
        public_id: 'kyc/user123/government_id_123456789',
        secure_url: 'https://res.cloudinary.com/test/kyc/document.jpg',
        url: 'http://res.cloudinary.com/test/kyc/document.jpg',
        format: 'jpg',
        resource_type: 'image',
        bytes: 2048,
        created_at: '2023-01-01T00:00:00Z'
      };

      (UserProfile.findOne as jest.Mock).mockResolvedValue(mockProfile);
      (cloudinaryService.uploadKYCDocument as jest.Mock).mockResolvedValue(mockUploadResult);

      const result = await ProfileService.uploadKYCDocument(mockUserId, mockDocumentData);

      expect(cloudinaryService.uploadKYCDocument).toHaveBeenCalledWith(
        expect.any(Buffer), // encrypted buffer
        'government_id',
        mockUserId,
        'passport.jpg'
      );

      expect(mockProfile.addKYCDocument).toHaveBeenCalledWith({
        type: 'government_id',
        filename: mockUploadResult.public_id,
        originalName: 'passport.jpg',
        encryptedPath: mockUploadResult.secure_url,
        encryptionKey: expect.any(String),
        mimeType: 'image/jpeg',
        size: mockDocumentData.buffer.length
      });

      expect(mockProfile.save).toHaveBeenCalled();
    });

    it('should throw error if Cloudinary is not configured', async () => {
      (cloudinaryService.isReady as jest.Mock).mockReturnValue(false);
      (UserProfile.findOne as jest.Mock).mockResolvedValue(mockProfile);

      await expect(
        ProfileService.uploadKYCDocument(mockUserId, mockDocumentData)
      ).rejects.toThrow('File upload service is not configured');
    });

    it('should throw error for invalid file type', async () => {
      const invalidDocumentData = {
        ...mockDocumentData,
        mimeType: 'text/plain'
      };

      await expect(
        ProfileService.uploadKYCDocument(mockUserId, invalidDocumentData)
      ).rejects.toThrow('Invalid file type');
    });

    it('should throw error for file size exceeding limit', async () => {
      const largeDocumentData = {
        ...mockDocumentData,
        buffer: Buffer.alloc(11 * 1024 * 1024) // 11MB
      };

      await expect(
        ProfileService.uploadKYCDocument(mockUserId, largeDocumentData)
      ).rejects.toThrow('File size exceeds maximum limit');
    });
  });

  describe('getKYCDocument', () => {
    const mockDocument = {
      _id: mockDocumentId,
      filename: 'kyc/user123/government_id_123456789',
      encryptedPath: 'https://res.cloudinary.com/test/kyc/document.jpg',
      encryptionKey: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      type: 'government_id',
      originalName: 'passport.jpg'
    };

    it('should retrieve and decrypt document successfully', async () => {
      const mockProfileWithDoc = {
        ...mockProfile,
        kycDocuments: [mockDocument]
      };

      // Mock encrypted data with IV prepended
      const mockIV = Buffer.alloc(16, 1); // Mock IV
      const mockEncryptedData = Buffer.from('encrypted content');
      const mockEncryptedBuffer = Buffer.concat([mockIV, mockEncryptedData]);

      (User.findById as jest.Mock).mockResolvedValue(mockAdmin);
      (UserProfile.findOne as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockProfileWithDoc)
      });
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockEncryptedBuffer.buffer)
      });

      const result = await ProfileService.getKYCDocument(mockUserId, mockDocumentId, mockAdminId);

      expect(User.findById).toHaveBeenCalledWith(mockAdminId);
      expect(global.fetch).toHaveBeenCalledWith(mockDocument.encryptedPath);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should throw error for non-admin user', async () => {
      const mockNonAdmin = { _id: 'user456', role: 'user' };
      (User.findById as jest.Mock).mockResolvedValue(mockNonAdmin);

      await expect(
        ProfileService.getKYCDocument(mockUserId, mockDocumentId, 'user456')
      ).rejects.toThrow('Unauthorized: Admin access required');
    });

    it('should throw error if document not found', async () => {
      (User.findById as jest.Mock).mockResolvedValue(mockAdmin);
      (UserProfile.findOne as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue({ ...mockProfile, kycDocuments: [] })
      });

      await expect(
        ProfileService.getKYCDocument(mockUserId, mockDocumentId, mockAdminId)
      ).rejects.toThrow('Document not found');
    });
  });

  describe('getKYCDocumentUrl', () => {
    const mockDocument = {
      _id: mockDocumentId,
      filename: 'kyc/user123/government_id_123456789',
      encryptedPath: 'https://res.cloudinary.com/test/kyc/document.jpg'
    };

    it('should generate secure URL from Cloudinary', async () => {
      const mockSecureUrl = 'https://res.cloudinary.com/test/secure/kyc/document.jpg';
      const mockProfileWithDoc = {
        ...mockProfile,
        kycDocuments: [mockDocument]
      };

      (User.findById as jest.Mock).mockResolvedValue(mockAdmin);
      (UserProfile.findOne as jest.Mock).mockResolvedValue(mockProfileWithDoc);
      (cloudinaryService.generateSecureUrl as jest.Mock).mockReturnValue(mockSecureUrl);

      const result = await ProfileService.getKYCDocumentUrl(mockUserId, mockDocumentId, mockAdminId);

      expect(cloudinaryService.generateSecureUrl).toHaveBeenCalledWith(
        mockDocument.filename,
        [
          { quality: 'auto:good' },
          { fetch_format: 'auto' }
        ]
      );
      expect(result).toBe(mockSecureUrl);
    });

    it('should fallback to stored URL if Cloudinary fails', async () => {
      const mockProfileWithDoc = {
        ...mockProfile,
        kycDocuments: [mockDocument]
      };

      (User.findById as jest.Mock).mockResolvedValue(mockAdmin);
      (UserProfile.findOne as jest.Mock).mockResolvedValue(mockProfileWithDoc);
      (cloudinaryService.generateSecureUrl as jest.Mock).mockImplementation(() => {
        throw new Error('Cloudinary error');
      });

      const result = await ProfileService.getKYCDocumentUrl(mockUserId, mockDocumentId, mockAdminId);

      expect(result).toBe(mockDocument.encryptedPath);
    });
  });

  describe('deleteKYCDocument', () => {
    const mockDocument = {
      _id: mockDocumentId,
      filename: 'kyc/user123/government_id_123456789',
      encryptedPath: 'https://res.cloudinary.com/test/kyc/document.jpg'
    };

    it('should delete document from Cloudinary and database', async () => {
      const mockProfileWithDoc = {
        ...mockProfile,
        kycDocuments: [mockDocument],
        save: jest.fn()
      };

      (UserProfile.findOne as jest.Mock).mockResolvedValue(mockProfileWithDoc);
      (cloudinaryService.deleteFile as jest.Mock).mockResolvedValue({ result: 'ok' });

      const result = await ProfileService.deleteKYCDocument(mockUserId, mockDocumentId);

      expect(cloudinaryService.deleteFile).toHaveBeenCalledWith(mockDocument.filename);
      expect(mockProfileWithDoc.kycDocuments).toHaveLength(0);
      expect(mockProfileWithDoc.save).toHaveBeenCalled();
    });

    it('should continue with database deletion if Cloudinary deletion fails', async () => {
      const mockProfileWithDoc = {
        ...mockProfile,
        kycDocuments: [mockDocument],
        save: jest.fn()
      };

      (UserProfile.findOne as jest.Mock).mockResolvedValue(mockProfileWithDoc);
      (cloudinaryService.deleteFile as jest.Mock).mockRejectedValue(new Error('Cloudinary error'));

      const result = await ProfileService.deleteKYCDocument(mockUserId, mockDocumentId);

      expect(mockProfileWithDoc.kycDocuments).toHaveLength(0);
      expect(mockProfileWithDoc.save).toHaveBeenCalled();
    });
  });
});