import { Request, Response } from 'express';
import { AuthService } from '../services/auth';
import { MFAService } from '../services/mfa';
import { User } from '../models/User';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { sendOTPEmail } from '../services/email';
import crypto from 'crypto';
import Joi from 'joi';

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required'
  }),
  password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]')).required().messages({
    'string.min': 'Password must be at least 8 characters long',
    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
    'any.required': 'Password is required'
  }),
  role: Joi.string().valid('marketer', 'admin').optional()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required()
});

const emailSchema = Joi.object({
  email: Joi.string().email().required()
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]')).required()
});

export class AuthController {
  static async register(req: Request, res: Response) {
    try {
      // Validate request body
      // const { error, value } = registerSchema.validate(req.body);
      // if (error) {
      //   return res.status(400).json({
      //     success: false,
      //     error: 'Validation failed',
      //     details: error.details.map(detail => ({
      //       field: detail.path.join('.'),
      //       message: detail.message
      //     }))
      //   });
      // }

      const { user, verificationToken } = await AuthService.registerUser(req.body);

      // Automatically send OTP for email verification
      try {
        // Generate OTP for immediate verification
        const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        
        // Store OTP in user document
        user.emailVerificationToken = crypto.createHash('sha256').update(otp).digest('hex');
        user.emailVerificationExpires = otpExpires;
        await user.save();
        
        // Send OTP email
        await sendOTPEmail(user.email, otp);
        
        logger.info(`OTP sent to ${user.email} during registration`);
      } catch (emailError) {
        logger.error('Failed to send registration OTP:', emailError);
        // Don't fail registration if email fails, but log it
      }

      res.status(201).json({
        success: true,
        message: 'Registration successful! Please check your email for the 6-digit verification code.',
        data: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            status: user.status,
            emailVerified: user.emailVerified
          },
          emailVerificationRequired: true
        }
      });
    } catch (error: any) {
      logger.error('Registration error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Registration failed'
      });
    }
  }

  static async login(req: Request, res: Response) {
    try {
      // Validate request body
      const { error, value } = loginSchema.validate(req.body);
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

      const { user, tokens } = await AuthService.loginUser(value);

      // Get MFA status for the user
      const mfaStatus = await MFAService.getMFAStatus(user._id);

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            status: user.status,
            emailVerified: user.emailVerified,
            lastLogin: user.lastLogin,
            mfaEnabled: mfaStatus.mfaEnabled,
            mfaSetupCompleted: mfaStatus.mfaSetupCompleted
          },
          tokens
        }
      });
    } catch (error: any) {
      logger.error('Login error:', error);
      res.status(401).json({
        success: false,
        error: error.message || 'Login failed'
      });
    }
  }

  static async refreshToken(req: Request, res: Response) {
    try {
      // Validate request body
      const { error, value } = refreshTokenSchema.validate(req.body);
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

      const tokens = await AuthService.refreshTokens(value.refreshToken);

      res.json({
        success: true,
        message: 'Tokens refreshed successfully',
        data: { tokens }
      });
    } catch (error: any) {
      logger.error('Token refresh error:', error);
      res.status(401).json({
        success: false,
        error: error.message || 'Token refresh failed'
      });
    }
  }

  static async verifyEmail(req: Request, res: Response) {
    try {
      const { token } = req.params;
      
      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Verification token is required'
        });
      }

      const user = await AuthService.verifyEmail(token);

      res.json({
        success: true,
        message: 'Email verified successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            status: user.status,
            emailVerified: user.emailVerified
          }
        }
      });
    } catch (error: any) {
      logger.error('Email verification error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Email verification failed'
      });
    }
  }

  // Development helper endpoint to manually activate accounts
  static async activateAccount(req: Request, res: Response) {
    try {
      if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({
          success: false,
          error: 'This endpoint is only available in development mode'
        });
      }

      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email is required'
        });
      }

      const user = await User.findOne({ email });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Activate the account
      user.status = 'active';
      user.emailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      
      await user.save();

      res.json({
        success: true,
        message: 'Account activated successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            status: user.status,
            emailVerified: user.emailVerified
          }
        }
      });
    } catch (error: any) {
      logger.error('Account activation error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Account activation failed'
      });
    }
  }

  static async resendVerification(req: Request, res: Response) {
    try {
      // Validate request body
      const { error, value } = emailSchema.validate(req.body);
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

      const verificationToken = await AuthService.resendVerificationEmail(value.email);

      // TODO: Send verification email with verificationToken
      logger.info(`New verification token for ${value.email}: ${verificationToken}`);

      res.json({
        success: true,
        message: 'Verification email sent successfully'
      });
    } catch (error: any) {
      logger.error('Resend verification error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to resend verification email'
      });
    }
  }

  // Send OTP for email verification
  static async sendEmailOTP(req: Request, res: Response) {
    try {
      const { email } = req.body;
      
      const user = await User.findOne({ email, emailVerified: false });
      if (!user) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found or already verified' 
        });
      }
      
      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      // Store OTP in user document
      user.emailVerificationToken = crypto.createHash('sha256').update(otp).digest('hex');
      user.emailVerificationExpires = otpExpires;
      await user.save();
      
      // Send OTP email
      await sendOTPEmail(user.email, otp);
      
      res.json({ 
        success: true,
        message: 'OTP sent to your email' 
      });
    } catch (error: any) {
      logger.error('Send email OTP error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to send OTP' 
      });
    }
  }

  // Verify email with OTP
  static async verifyEmailOTP(req: Request, res: Response) {
    try {
      const { email, otp } = req.body;
      
      // Hash the OTP to match stored version
      const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
      
      // Find user with matching OTP that hasn't expired
      const user = await User.findOne({
        email,
        emailVerificationToken: hashedOTP,
        emailVerificationExpires: { $gt: new Date() },
        emailVerified: false
      });
      
      if (!user) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid or expired OTP' 
        });
      }
      
      // Update user as verified
      user.emailVerified = true;
      user.status = 'active'; // Activate account upon email verification
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      
      await user.save();
      
      res.json({ 
        success: true,
        message: 'Email verified successfully with OTP' 
      });
    } catch (error: any) {
      logger.error('Email OTP verification error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Email verification failed' 
      });
    }
  }

  static async requestPasswordReset(req: Request, res: Response) {
    try {
      // Validate request body
      const { error, value } = emailSchema.validate(req.body);
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

      const resetToken = await AuthService.requestPasswordReset(value.email);

      // TODO: Send password reset email with resetToken
      logger.info(`Password reset token for ${value.email}: ${resetToken}`);

      res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent'
      });
    } catch (error: any) {
      logger.error('Password reset request error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process password reset request'
      });
    }
  }

  static async resetPassword(req: Request, res: Response) {
    try {
      // Validate request body
      const { error, value } = resetPasswordSchema.validate(req.body);
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

      const user = await AuthService.resetPassword(value.token, value.password);

      res.json({
        success: true,
        message: 'Password reset successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            status: user.status
          }
        }
      });
    } catch (error: any) {
      logger.error('Password reset error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Password reset failed'
      });
    }
  }

  static async getCurrentUser(req: AuthenticatedRequest, res: Response) {
    try {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not authenticated'
        });
      }

      // Get MFA status for the user
      const mfaStatus = await MFAService.getMFAStatus(user._id);

      res.json({
        success: true,
        data: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          status: user.status,
          emailVerified: user.emailVerified,
          lastLogin: user.lastLogin,
          mfaEnabled: mfaStatus.mfaEnabled,
          mfaSetupCompleted: mfaStatus.mfaSetupCompleted,
          kycRequired: user.kycRequired,
          kycCompleted: user.kycCompleted,
          kycSkipped: user.kycSkipped,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      });
    } catch (error: any) {
      logger.error('Get current user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user information'
      });
    }
  }

  static async skipKYC(req: AuthenticatedRequest, res: Response) {
    try {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not authenticated'
        });
      }

      // Only allow marketers to skip KYC (admins don't need KYC)
      if (user.role !== 'marketer') {
        return res.status(403).json({
          success: false,
          error: 'KYC skip is only available for marketer accounts'
        });
      }

      // Update user to mark KYC as skipped
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          kycSkipped: true,
          kycRequired: false // No longer required since it's skipped
        },
        { new: true }
      );

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      logger.info(`User ${user.email} skipped KYC verification`);

      res.json({
        success: true,
        message: 'KYC verification skipped successfully',
        data: {
          kycRequired: updatedUser.kycRequired,
          kycCompleted: updatedUser.kycCompleted,
          kycSkipped: updatedUser.kycSkipped
        }
      });
    } catch (error: any) {
      logger.error('Skip KYC error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to skip KYC verification'
      });
    }
  }
}