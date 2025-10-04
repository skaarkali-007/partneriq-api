import { User, IUser } from '../../models/User';
import { generateTokenPair, verifyRefreshToken, TokenPair } from '../../utils/jwt';
import { logger } from '../../utils/logger';
import { MFAService } from '../mfa';
import crypto from 'crypto';

export interface RegisterUserData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: 'marketer' | 'admin';
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResult {
  user: IUser;
  tokens: TokenPair;
}

export class AuthService {
  static async registerUser(userData: RegisterUserData): Promise<{ user: IUser; verificationToken: string }> {
    try {
      // Check if user already exists
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Check if we're in alpha stage for auto-verification
      const isAlphaStage = process.env.STAGE === 'alpha';
      logger.info(`Registration stage check: STAGE=${process.env.STAGE}, isAlphaStage=${isAlphaStage}`);

      // Create new user
      const user = new User({
        email: userData.email,
        password: userData.password,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role || 'marketer',
        status: isAlphaStage ? 'active' : 'pending', // Auto-activate in alpha stage
        emailVerified: isAlphaStage, // Auto-verify email in alpha stage
        createdInAlphaStage: isAlphaStage // Track if created during alpha stage
      });

      // Generate email verification token (still needed for non-alpha stages)
      const verificationToken = user.generateEmailVerificationToken();
      
      await user.save();
      
      if (isAlphaStage) {
        logger.info(`User registered and auto-verified (alpha stage): ${user.email}`);
      } else {
        logger.info(`User registered: ${user.email}`);
      }
      
      return { user, verificationToken };
    } catch (error) {
      logger.error('User registration failed:', error);
      throw error;
    }
  }

  static async loginUser(credentials: LoginCredentials): Promise<AuthResult> {
    try {
      // Find user and include password for comparison
      const user = await User.findOne({ email: credentials.email }).select('+password');
      
      if (!user) {
        throw new Error('Invalid email or password');
      }

      // Check password
      const isPasswordValid = await user.comparePassword(credentials.password);
      if (!isPasswordValid) {
        throw new Error('Invalid email or password');
      }

      // Check if user is active
      if (user.status !== 'active') {
        throw new Error('Account is not active. Please contact support.');
      }

      // Check if email is verified (skip in alpha stage)
      const isAlphaStage = process.env.STAGE === 'alpha';
      logger.info(`Login stage check: STAGE=${process.env.STAGE}, isAlphaStage=${isAlphaStage}, emailVerified=${user.emailVerified}`);
      if (!user.emailVerified && !isAlphaStage) {
        throw new Error('Please verify your email before logging in');
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate tokens
      const tokens = generateTokenPair(user);
      
      logger.info(`User logged in: ${user.email}`);
      
      return { user, tokens };
    } catch (error) {
      logger.error('User login failed:', error);
      throw error;
    }
  }

  static async refreshTokens(refreshToken: string): Promise<TokenPair> {
    try {
      const decoded = verifyRefreshToken(refreshToken);
      
      // Find user to ensure they still exist and are active
      const user = await User.findById(decoded.userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      if (user.status !== 'active') {
        throw new Error('Account is not active');
      }

      // Generate new token pair (this will create new tokens with different timestamps)
      const tokens = generateTokenPair(user);
      
      logger.info(`Tokens refreshed for user: ${user.email}`);
      
      return tokens;
    } catch (error) {
      logger.error('Token refresh failed:', error);
      throw error;
    }
  }

  static async verifyEmail(token: string): Promise<IUser> {
    try {
      // Hash the token to match stored hash
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      
      const user = await User.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpires: { $gt: new Date() }
      }).select('+emailVerificationToken +emailVerificationExpires');

      if (!user) {
        throw new Error('Invalid or expired verification token');
      }

      // Update user verification status
      user.emailVerified = true;
      user.status = 'active'; // Activate account upon email verification
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      
      await user.save();
      
      logger.info(`Email verified for user: ${user.email}`);
      
      return user;
    } catch (error) {
      logger.error('Email verification failed:', error);
      throw error;
    }
  }

  static async resendVerificationEmail(email: string): Promise<string> {
    try {
      const user = await User.findOne({ email }).select('+emailVerificationToken +emailVerificationExpires');
      
      if (!user) {
        throw new Error('User not found');
      }

      if (user.emailVerified) {
        throw new Error('Email is already verified');
      }

      // Generate new verification token
      const verificationToken = user.generateEmailVerificationToken();
      await user.save();
      
      logger.info(`Verification email resent to: ${user.email}`);
      
      return verificationToken;
    } catch (error) {
      logger.error('Resend verification email failed:', error);
      throw error;
    }
  }

  static async requestPasswordReset(email: string): Promise<string> {
    try {
      const user = await User.findOne({ email });
      
      if (!user) {
        // Don't reveal if user exists or not for security
        logger.info(`Password reset requested for non-existent email: ${email}`);
        return 'dummy-token'; // Return dummy token to prevent email enumeration
      }

      const resetToken = user.generatePasswordResetToken();
      await user.save();
      
      logger.info(`Password reset requested for: ${user.email}`);
      
      return resetToken;
    } catch (error) {
      logger.error('Password reset request failed:', error);
      throw error;
    }
  }

  static async resetPassword(token: string, newPassword: string): Promise<IUser> {
    try {
      // Hash the token to match stored hash
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      
      const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: new Date() }
      }).select('+passwordResetToken +passwordResetExpires');

      if (!user) {
        throw new Error('Invalid or expired reset token');
      }

      // Update password
      user.password = newPassword;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      
      await user.save();
      
      logger.info(`Password reset completed for user: ${user.email}`);
      
      return user;
    } catch (error) {
      logger.error('Password reset failed:', error);
      throw error;
    }
  }
}