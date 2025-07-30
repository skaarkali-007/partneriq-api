import { Request, Response } from 'express';
import { GDPRService, DataRectificationRequest } from '../services/gdpr';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { validationResult } from 'express-validator';

/**
 * Export user data for portability (GDPR Article 20)
 */
export const exportUserData = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated'
        }
      });
    }

    // Validate export request
    const isValid = await GDPRService.validateDataExportRequest(userId);
    if (!isValid) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found or invalid request'
        }
      });
    }

    // Export user data
    const exportData = await GDPRService.exportUserData(userId);

    // Set appropriate headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="user_data_export_${userId}_${Date.now()}.json"`);

    logger.info(`Data export requested by user ${userId}`);
    
    res.status(200).json({
      success: true,
      data: exportData
    });
  } catch (error) {
    logger.error('Error in exportUserData:', error);
    res.status(500).json({
      error: {
        code: 'EXPORT_ERROR',
        message: 'Failed to export user data'
      }
    });
  }
};

/**
 * Request user data deletion (GDPR Article 17)
 */
export const requestDataDeletion = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const { reason } = req.body;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated'
        }
      });
    }

    // Check if user data can be deleted
    const deletionCheck = await GDPRService.canDeleteUserData(userId);
    if (!deletionCheck.canDelete) {
      return res.status(400).json({
        error: {
          code: 'DELETION_NOT_ALLOWED',
          message: deletionCheck.reason || 'User data cannot be deleted at this time'
        }
      });
    }

    // Delete user data
    await GDPRService.deleteUserData(userId, reason || 'User requested deletion');

    logger.info(`Data deletion completed for user ${userId}`);
    
    res.status(200).json({
      success: true,
      message: 'User data has been successfully deleted'
    });
  } catch (error) {
    logger.error('Error in requestDataDeletion:', error);
    res.status(500).json({
      error: {
        code: 'DELETION_ERROR',
        message: 'Failed to delete user data'
      }
    });
  }
};

/**
 * Rectify user data (GDPR Article 16)
 */
export const rectifyUserData = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const { rectifications }: { rectifications: DataRectificationRequest[] } = req.body;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated'
        }
      });
    }

    if (!Array.isArray(rectifications) || rectifications.length === 0) {
      return res.status(400).json({
        error: {
          code: 'INVALID_RECTIFICATIONS',
          message: 'Rectifications must be a non-empty array'
        }
      });
    }

    // Validate rectification requests
    for (const rectification of rectifications) {
      if (!rectification.field || rectification.newValue === undefined) {
        return res.status(400).json({
          error: {
            code: 'INVALID_RECTIFICATION',
            message: 'Each rectification must have field and newValue properties'
          }
        });
      }
    }

    // Apply rectifications
    await GDPRService.rectifyUserData(userId, rectifications);

    logger.info(`Data rectification completed for user ${userId}`);
    
    res.status(200).json({
      success: true,
      message: 'User data has been successfully rectified',
      rectifiedFields: rectifications.map(r => r.field)
    });
  } catch (error) {
    logger.error('Error in rectifyUserData:', error);
    res.status(500).json({
      error: {
        code: 'RECTIFICATION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to rectify user data'
      }
    });
  }
};

/**
 * Get user data summary
 */
export const getUserDataSummary = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated'
        }
      });
    }

    const dataSummary = await GDPRService.getUserDataSummary(userId);

    res.status(200).json({
      success: true,
      data: dataSummary
    });
  } catch (error) {
    logger.error('Error in getUserDataSummary:', error);
    res.status(500).json({
      error: {
        code: 'SUMMARY_ERROR',
        message: 'Failed to get user data summary'
      }
    });
  }
};

/**
 * Check if user data can be deleted
 */
export const checkDeletionEligibility = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated'
        }
      });
    }

    const deletionCheck = await GDPRService.canDeleteUserData(userId);

    res.status(200).json({
      success: true,
      data: deletionCheck
    });
  } catch (error) {
    logger.error('Error in checkDeletionEligibility:', error);
    res.status(500).json({
      error: {
        code: 'CHECK_ERROR',
        message: 'Failed to check deletion eligibility'
      }
    });
  }
};

/**
 * Admin: Delete user data (for admin use)
 */
export const adminDeleteUserData = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const { userId } = req.params;
    const { reason } = req.body;
    const authReq = req as AuthenticatedRequest;
    const adminId = authReq.user?.id;

    if (!userId) {
      return res.status(400).json({
        error: {
          code: 'MISSING_USER_ID',
          message: 'User ID is required'
        }
      });
    }

    // Delete user data
    await GDPRService.deleteUserData(userId, reason || `Admin deletion by ${adminId}`);

    logger.info(`Admin ${adminId} deleted data for user ${userId}`);
    
    res.status(200).json({
      success: true,
      message: 'User data has been successfully deleted by admin'
    });
  } catch (error) {
    logger.error('Error in adminDeleteUserData:', error);
    res.status(500).json({
      error: {
        code: 'ADMIN_DELETION_ERROR',
        message: 'Failed to delete user data'
      }
    });
  }
};

/**
 * Admin: Anonymize user data
 */
export const adminAnonymizeUserData = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const { userId } = req.params;
    const { reason } = req.body;
    const authReq = req as AuthenticatedRequest;
    const adminId = authReq.user?.id;

    if (!userId) {
      return res.status(400).json({
        error: {
          code: 'MISSING_USER_ID',
          message: 'User ID is required'
        }
      });
    }

    // Anonymize user data
    await GDPRService.anonymizeUserData(userId, reason || `Admin anonymization by ${adminId}`);

    logger.info(`Admin ${adminId} anonymized data for user ${userId}`);
    
    res.status(200).json({
      success: true,
      message: 'User data has been successfully anonymized by admin'
    });
  } catch (error) {
    logger.error('Error in adminAnonymizeUserData:', error);
    res.status(500).json({
      error: {
        code: 'ADMIN_ANONYMIZATION_ERROR',
        message: 'Failed to anonymize user data'
      }
    });
  }
};