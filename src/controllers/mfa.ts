import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { MFAService } from '../services/mfa';
import { logger } from '../utils/logger';
import Joi from 'joi';

// Validation schemas
const mfaTokenSchema = Joi.object({
  token: Joi.string().length(6).pattern(/^\d{6}$/).required().messages({
    'string.length': 'MFA token must be exactly 6 digits',
    'string.pattern.base': 'MFA token must contain only digits',
    'any.required': 'MFA token is required'
  })
});

const mfaBackupCodeSchema = Joi.object({
  token: Joi.string().length(8).pattern(/^[A-F0-9]{8}$/).required().messages({
    'string.length': 'Backup code must be exactly 8 characters',
    'string.pattern.base': 'Backup code must contain only uppercase letters and numbers',
    'any.required': 'Backup code is required'
  })
});

const mfaTokenOrBackupSchema = Joi.object({
  token: Joi.string().required().custom((value, helpers) => {
    // Check if it's a 6-digit TOTP token
    if (/^\d{6}$/.test(value)) {
      return value;
    }
    // Check if it's an 8-character backup code
    if (/^[A-F0-9]{8}$/.test(value.toUpperCase())) {
      return value.toUpperCase();
    }
    return helpers.error('any.invalid');
  }).messages({
    'any.invalid': 'Token must be either a 6-digit TOTP code or an 8-character backup code',
    'any.required': 'Token is required'
  })
});

export class MFAController {
  /**
   * Setup MFA for a user - generates secret and QR code
   */
  static async setupMFA(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const setupResult = await MFAService.setupMFA(userId);

      res.json({
        success: true,
        message: 'MFA setup initiated. Please scan the QR code with your authenticator app and verify with a token.',
        data: {
          qrCodeUrl: setupResult.qrCodeUrl,
          backupCodes: setupResult.backupCodes,
          instructions: [
            '1. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)',
            '2. Save the backup codes in a secure location',
            '3. Verify setup by providing a 6-digit code from your authenticator app'
          ]
        }
      });
    } catch (error: any) {
      logger.error('MFA setup error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'MFA setup failed'
      });
    }
  }

  /**
   * Verify MFA token and complete setup
   */
  static async verifyAndEnableMFA(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Validate request body
      const { error, value } = mfaTokenSchema.validate(req.body);
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

      const user = await MFAService.verifyAndEnableMFA(userId, value.token);

      res.json({
        success: true,
        message: 'MFA has been successfully enabled for your account',
        data: {
          user: {
            id: user._id,
            email: user.email,
            mfaEnabled: user.mfaEnabled,
            mfaSetupCompleted: user.mfaSetupCompleted
          }
        }
      });
    } catch (error: any) {
      logger.error('MFA verification error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'MFA verification failed'
      });
    }
  }

  /**
   * Verify MFA token for authentication
   */
  static async verifyMFA(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Validate request body - accept both TOTP tokens and backup codes
      const { error, value } = mfaTokenOrBackupSchema.validate(req.body);
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

      const verification = await MFAService.verifyMFAToken(userId, value.token);

      if (verification.isValid) {
        res.json({
          success: true,
          message: 'MFA token verified successfully'
        });
      } else {
        res.status(401).json({
          success: false,
          error: 'Invalid MFA token or backup code'
        });
      }
    } catch (error: any) {
      logger.error('MFA token verification error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'MFA verification failed'
      });
    }
  }

  /**
   * Disable MFA for a user
   */
  static async disableMFA(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Validate request body
      const { error, value } = mfaTokenOrBackupSchema.validate(req.body);
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

      const user = await MFAService.disableMFA(userId, value.token);

      res.json({
        success: true,
        message: 'MFA has been disabled for your account',
        data: {
          user: {
            id: user._id,
            email: user.email,
            mfaEnabled: user.mfaEnabled,
            mfaSetupCompleted: user.mfaSetupCompleted
          }
        }
      });
    } catch (error: any) {
      logger.error('MFA disable error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to disable MFA'
      });
    }
  }

  /**
   * Regenerate backup codes
   */
  static async regenerateBackupCodes(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Validate request body
      const { error, value } = mfaTokenSchema.validate(req.body);
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

      const backupCodes = await MFAService.regenerateBackupCodes(userId, value.token);

      res.json({
        success: true,
        message: 'New backup codes have been generated. Please save them in a secure location.',
        data: {
          backupCodes,
          warning: 'These codes will only be shown once. Save them securely as they replace your previous backup codes.'
        }
      });
    } catch (error: any) {
      logger.error('Backup codes regeneration error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to regenerate backup codes'
      });
    }
  }

  /**
   * Get MFA status for a user
   */
  static async getMFAStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const status = await MFAService.getMFAStatus(userId);

      res.json({
        success: true,
        data: status
      });
    } catch (error: any) {
      logger.error('Get MFA status error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to get MFA status'
      });
    }
  }
}