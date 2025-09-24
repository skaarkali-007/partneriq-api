import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { ProfileService, CreateProfileData, UpdateProfileData, KYCReviewData } from '../services/user/profileService';
import { logger } from '../utils/logger';
import Joi from 'joi';
import multer from 'multer';

// Validation schemas
const createProfileSchema = Joi.object({
  firstName: Joi.string().trim().max(50).optional(),
  lastName: Joi.string().trim().max(50).optional(),
  phone: Joi.string().pattern(/^\+?[\d\s\-\(\)]+$/).optional(),
  dateOfBirth: Joi.date().max('now').optional(),
  address: Joi.object({
    street: Joi.string().required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
    postalCode: Joi.string().required(),
    country: Joi.string().default('US')
  }).optional()
});

const updateProfileSchema = Joi.object({
  firstName: Joi.string().trim().max(50).optional(),
  lastName: Joi.string().trim().max(50).optional(),
  phone: Joi.string().pattern(/^\+?[\d\s\-\(\)]+$/).optional(),
  dateOfBirth: Joi.date().max('now').optional(),
  address: Joi.object({
    street: Joi.string().required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
    postalCode: Joi.string().required(),
    country: Joi.string().default('US')
  }).optional(),
  taxId: Joi.string().optional(),
  bankAccountInfo: Joi.object({
    accountNumber: Joi.string().required(),
    routingNumber: Joi.string().required(),
    bankName: Joi.string().required(),
    accountType: Joi.string().valid('checking', 'savings').required()
  }).optional()
});

const kycReviewSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected', 'requires_resubmission').required(),
  reason: Joi.string().when('status', {
    is: Joi.valid('rejected', 'requires_resubmission'),
    then: Joi.required(),
    otherwise: Joi.optional()
  })
});

const complianceQuizSchema = Joi.object({
  score: Joi.number().min(0).max(100).required()
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF files are allowed.') as any;
      error.code = 'INVALID_FILE_TYPE';
      cb(error, false);
    }
  }
});

// Configure multer for multiple file uploads (KYC submission)
const kycUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 5 // Allow up to 5 files
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF files are allowed.') as any;
      error.code = 'INVALID_FILE_TYPE';
      cb(error, false);
    }
  }
});

export class ProfileController {
  /**
   * Create user profile
   */
  static async createProfile(req: AuthenticatedRequest, res: Response) {
    try {
      // Validate request body
      const { error, value } = createProfileSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      const userId = req.user!._id.toString();
      const profileData: CreateProfileData = {
        userId,
        ...value
      };

      const profile = await ProfileService.createProfile(profileData);

      res.status(201).json({
        success: true,
        data: profile,
        message: 'Profile created successfully'
      });
    } catch (error: any) {
      logger.error('Profile creation error:', error);
      
      if (error.message === 'User not found') {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      if (error.message === 'Profile already exists for this user') {
        return res.status(409).json({
          success: false,
          error: 'Profile already exists'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Get user profile
   */
  static async getProfile(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!._id.toString();
      const profile = await ProfileService.getProfileByUserId(userId);

      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        });
      }

      res.json({
        success: true,
        data: profile
      });
    } catch (error) {
      logger.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(req: AuthenticatedRequest, res: Response) {
    try {
      // Validate request body
      const { error, value } = updateProfileSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      const userId = req.user!._id.toString();
      const updateData: UpdateProfileData = value;

      const profile = await ProfileService.updateProfile(userId, updateData);

      res.json({
        success: true,
        data: profile,
        message: 'Profile updated successfully'
      });
    } catch (error: any) {
      logger.error('Profile update error:', error);
      
      if (error.message === 'Profile not found') {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Upload KYC document
   */
  static uploadKYCDocument = [
    (req: AuthenticatedRequest, res: Response, next: any) => {
      upload.single('document')(req, res, (err: any) => {
        if (err) {
          if (err.code === 'INVALID_FILE_TYPE' || err.message.includes('Invalid file type')) {
            return res.status(400).json({
              success: false,
              error: err.message
            });
          }
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
              success: false,
              error: 'File size exceeds maximum limit of 10MB'
            });
          }
          return res.status(400).json({
            success: false,
            error: 'File upload error'
          });
        }
        next();
      });
    },
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'No file uploaded'
          });
        }

        const { type } = req.body;
        if (!type || !['government_id', 'proof_of_address', 'selfie', 'other'].includes(type)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid document type'
          });
        }

        const userId = req.user!._id.toString();
        const documentData = {
          type,
          filename: req.file.filename || `${Date.now()}-${req.file.originalname}`,
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          mimeType: req.file.mimetype
        };

        const profile = await ProfileService.uploadKYCDocument(userId, documentData);

        res.json({
          success: true,
          data: profile,
          message: 'KYC document uploaded successfully'
        });
      } catch (error: any) {
        logger.error('KYC document upload error:', error);
        
        if (error.message.includes('Invalid file type') || error.message.includes('File size exceeds')) {
          return res.status(400).json({
            success: false,
            error: error.message
          });
        }
        
        if (error.message === 'Profile not found') {
          return res.status(404).json({
            success: false,
            error: 'Profile not found'
          });
        }

        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  ];

  /**
   * Submit complete KYC information with documents
   */
  static submitKYC = [
    (req: AuthenticatedRequest, res: Response, next: any) => {
      kycUpload.fields([
        { name: 'idDocument', maxCount: 1 },
        { name: 'proofOfAddress', maxCount: 1 }
      ])(req, res, (err: any) => {
        if (err) {
          if (err.code === 'INVALID_FILE_TYPE' || err.message.includes('Invalid file type')) {
            return res.status(400).json({
              success: false,
              error: err.message
            });
          }
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
              success: false,
              error: 'File size exceeds maximum limit of 10MB'
            });
          }
          return res.status(400).json({
            success: false,
            error: 'File upload error'
          });
        }
        next();
      });
    },
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user!._id.toString();
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        
        // Extract profile data
        const { firstName, lastName, dateOfBirth, phoneNumber, address } = req.body;
        
        // Parse address if it's a string
        let parsedAddress;
        try {
          parsedAddress = typeof address === 'string' ? JSON.parse(address) : address;
        } catch (error) {
          return res.status(400).json({
            success: false,
            error: 'Invalid address format'
          });
        }

        // Update or create profile with personal information
        const profileData: UpdateProfileData = {
          firstName,
          lastName,
          phone: phoneNumber,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          address: parsedAddress ? {
            street: parsedAddress.street,
            city: parsedAddress.city,
            state: parsedAddress.state,
            postalCode: parsedAddress.zipCode,
            country: parsedAddress.country || 'US'
          } : undefined
        };

        // Update profile first
        let profile;
        try {
          profile = await ProfileService.updateProfile(userId, profileData);
        } catch (error: any) {
          if (error.message === 'Profile not found') {
            // Create profile if it doesn't exist
            const createData: CreateProfileData = {
              userId,
              ...profileData
            };
            profile = await ProfileService.createProfile(createData);
          } else {
            throw error;
          }
        }

        // Upload documents if provided
        if (files && files.idDocument && files.idDocument[0]) {
          const idDoc = files.idDocument[0];
          const documentData = {
            type: 'government_id' as const,
            filename: `${Date.now()}-${idDoc.originalname}`,
            originalName: idDoc.originalname,
            buffer: idDoc.buffer,
            mimeType: idDoc.mimetype
          };
          profile = await ProfileService.uploadKYCDocument(userId, documentData);
        }

        if (files && files.proofOfAddress && files.proofOfAddress[0]) {
          const proofDoc = files.proofOfAddress[0];
          const documentData = {
            type: 'proof_of_address' as const,
            filename: `${Date.now()}-${proofDoc.originalname}`,
            originalName: proofDoc.originalname,
            buffer: proofDoc.buffer,
            mimeType: proofDoc.mimetype
          };
          profile = await ProfileService.uploadKYCDocument(userId, documentData);
        }

        res.json({
          success: true,
          data: profile,
          message: 'KYC information submitted successfully'
        });
      } catch (error: any) {
        logger.error('KYC submission error:', error);
        
        if (error.message.includes('Invalid file type') || error.message.includes('File size exceeds') || error.message.includes('UserProfile validation failed')) {
          return res.status(400).json({
            success: false,
            error: error.message
          });
        }
        
        if (error.message === 'User not found') {
          return res.status(404).json({
            success: false,
            error: 'User not found'
          });
        }

        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  ];

  /**
   * Get KYC document (admin only)
   */
  static async getKYCDocument(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, documentId } = req.params;
      const requesterId = req.user!._id.toString();

      const documentBuffer = await ProfileService.getKYCDocument(userId, documentId, requesterId);
      
      // Get profile to determine content type
      const profile = await ProfileService.getProfileByUserId(userId);
      const document = profile?.kycDocuments.find(doc => doc._id?.toString() === documentId);
      
      if (!document) {
        return res.status(404).json({
          success: false,
          error: 'Document not found'
        });
      }

      res.set({
        'Content-Type': document.mimeType,
        'Content-Disposition': `attachment; filename="${document.originalName}"`
      });
      
      res.send(documentBuffer);
    } catch (error: any) {
      logger.error('Get KYC document error:', error);
      
      if (error.message.includes('Unauthorized')) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized: Admin access required'
        });
      }
      
      if (error.message === 'Profile not found' || error.message === 'Document not found') {
        return res.status(404).json({
          success: false,
          error: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Review KYC (admin only)
   */
  static async reviewKYC(req: AuthenticatedRequest, res: Response) {
    try {
      // Validate request body
      const { error, value } = kycReviewSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      const { userId } = req.params;
      const reviewerId = req.user!._id.toString();
      
      const reviewData: KYCReviewData = {
        ...value,
        reviewerId
      };

      const profile = await ProfileService.reviewKYC(userId, reviewData);

      res.json({
        success: true,
        data: profile,
        message: 'KYC review completed successfully'
      });
    } catch (error: any) {
      logger.error('KYC review error:', error);
      
      if (error.message.includes('Unauthorized')) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized: Admin access required'
        });
      }
      
      if (error.message === 'Profile not found') {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Submit compliance quiz
   */
  static async submitComplianceQuiz(req: AuthenticatedRequest, res: Response) {
    try {
      // Validate request body
      const { error, value } = complianceQuizSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      const userId = req.user!._id.toString();
      const { score } = value;

      const profile = await ProfileService.submitComplianceQuiz(userId, score);

      res.json({
        success: true,
        data: profile,
        message: 'Compliance quiz submitted successfully'
      });
    } catch (error: any) {
      logger.error('Compliance quiz submission error:', error);
      
      if (error.message === 'Profile not found') {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Get all profiles for admin review
   */
  static async getAllProfilesForReview(req: AuthenticatedRequest, res: Response) {
    try {
      const { status, page = '1', limit = '20' } = req.query;
      
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      
      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          error: 'Invalid pagination parameters'
        });
      }

      const result = await ProfileService.getAllProfilesForReview(
        status as any,
        pageNum,
        limitNum
      );

      res.json({
        success: true,
        data: result.profiles,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: result.total,
          pages: result.pages
        }
      });
    } catch (error) {
      logger.error('Get profiles for review error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Delete KYC document
   */
  static async deleteKYCDocument(req: AuthenticatedRequest, res: Response) {
    try {
      const { documentId } = req.params;
      const userId = req.user!._id.toString();

      const profile = await ProfileService.deleteKYCDocument(userId, documentId);

      res.json({
        success: true,
        data: profile,
        message: 'KYC document deleted successfully'
      });
    } catch (error: any) {
      logger.error('Delete KYC document error:', error);
      
      if (error.message === 'Profile not found' || error.message === 'Document not found') {
        return res.status(404).json({
          success: false,
          error: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
}