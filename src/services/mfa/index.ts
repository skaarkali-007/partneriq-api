import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { User, IUser } from '../../models/User';
import { logger } from '../../utils/logger';

export interface MFASetupResult {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export interface MFAVerificationResult {
  isValid: boolean;
  user?: IUser;
}

export class MFAService {
  private static readonly APP_NAME = 'Partner IQ';
  private static readonly BACKUP_CODES_COUNT = 8;
  private static readonly BACKUP_CODE_LENGTH = 8;

  /**
   * Generate MFA setup data for a user
   */
  static async setupMFA(userId: string): Promise<MFASetupResult> {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      if (user.mfaEnabled && user.mfaSetupCompleted) {
        throw new Error('MFA is already enabled for this user');
      }

      // Generate secret
      const secret = speakeasy.generateSecret({
        name: `${this.APP_NAME} (${user.email})`,
        issuer: this.APP_NAME,
        length: 32
      });

      // Generate QR code
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();

      // Store encrypted secret and backup codes (but don't enable MFA yet)
      user.mfaSecret = secret.base32;
      user.mfaBackupCodes = backupCodes.map(code => this.hashBackupCode(code));
      user.mfaSetupCompleted = false; // Will be set to true after verification
      
      await user.save();

      logger.info(`MFA setup initiated for user: ${user.email}`);

      return {
        secret: secret.base32,
        qrCodeUrl,
        backupCodes // Return plain text codes for user to save
      };
    } catch (error) {
      logger.error('MFA setup failed:', error);
      throw error;
    }
  }

  /**
   * Verify TOTP token and complete MFA setup
   */
  static async verifyAndEnableMFA(userId: string, token: string): Promise<IUser> {
    try {
      const user = await User.findById(userId).select('+mfaSecret');
      if (!user) {
        throw new Error('User not found');
      }

      if (!user.mfaSecret) {
        throw new Error('MFA setup not initiated. Please start MFA setup first.');
      }

      if (user.mfaEnabled && user.mfaSetupCompleted) {
        throw new Error('MFA is already enabled for this user');
      }

      // Verify the token
      const isValid = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: token,
        window: 2 // Allow 2 time steps (60 seconds) tolerance
      });

      if (!isValid) {
        throw new Error('Invalid MFA token');
      }

      // Enable MFA
      user.mfaEnabled = true;
      user.mfaSetupCompleted = true;
      await user.save();

      logger.info(`MFA enabled for user: ${user.email}`);

      return user;
    } catch (error) {
      logger.error('MFA verification failed:', error);
      throw error;
    }
  }

  /**
   * Verify TOTP token for authentication
   */
  static async verifyMFAToken(userId: string, token: string): Promise<MFAVerificationResult> {
    try {
      const user = await User.findById(userId).select('+mfaSecret +mfaBackupCodes');
      if (!user) {
        return { isValid: false };
      }

      if (!user.mfaEnabled || !user.mfaSecret) {
        throw new Error('MFA is not enabled for this user');
      }

      // First try TOTP verification
      const isTotpValid = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: token,
        window: 2 // Allow 2 time steps (60 seconds) tolerance
      });

      if (isTotpValid) {
        logger.info(`MFA token verified for user: ${user.email}`);
        return { isValid: true, user };
      }

      // If TOTP fails, try backup codes
      if (user.mfaBackupCodes && user.mfaBackupCodes.length > 0) {
        const hashedToken = this.hashBackupCode(token);
        const backupCodeIndex = user.mfaBackupCodes.findIndex(code => code === hashedToken);
        
        if (backupCodeIndex !== -1) {
          // Remove used backup code
          user.mfaBackupCodes.splice(backupCodeIndex, 1);
          await user.save();
          
          logger.info(`MFA backup code used for user: ${user.email}. Remaining codes: ${user.mfaBackupCodes.length}`);
          return { isValid: true, user };
        }
      }

      logger.warn(`Invalid MFA token attempt for user: ${user.email}`);
      return { isValid: false };
    } catch (error) {
      logger.error('MFA token verification failed:', error);
      throw error;
    }
  }

  /**
   * Disable MFA for a user
   */
  static async disableMFA(userId: string, token: string): Promise<IUser> {
    try {
      const user = await User.findById(userId).select('+mfaSecret +mfaBackupCodes');
      if (!user) {
        throw new Error('User not found');
      }

      if (!user.mfaEnabled) {
        throw new Error('MFA is not enabled for this user');
      }

      // Verify current MFA token before disabling
      const verification = await this.verifyMFAToken(userId, token);
      if (!verification.isValid) {
        throw new Error('Invalid MFA token. Cannot disable MFA without valid token.');
      }

      // Disable MFA and clear secrets
      user.mfaEnabled = false;
      user.mfaSetupCompleted = false;
      user.mfaSecret = undefined;
      user.mfaBackupCodes = [];
      
      await user.save();

      logger.info(`MFA disabled for user: ${user.email}`);

      return user;
    } catch (error) {
      logger.error('MFA disable failed:', error);
      throw error;
    }
  }

  /**
   * Generate new backup codes
   */
  static async regenerateBackupCodes(userId: string, token: string): Promise<string[]> {
    try {
      const user = await User.findById(userId).select('+mfaSecret +mfaBackupCodes');
      if (!user) {
        throw new Error('User not found');
      }

      if (!user.mfaEnabled) {
        throw new Error('MFA is not enabled for this user');
      }

      // Verify current MFA token before regenerating codes
      const verification = await this.verifyMFAToken(userId, token);
      if (!verification.isValid) {
        throw new Error('Invalid MFA token. Cannot regenerate backup codes without valid token.');
      }

      // Generate new backup codes
      const backupCodes = this.generateBackupCodes();
      user.mfaBackupCodes = backupCodes.map(code => this.hashBackupCode(code));
      
      await user.save();

      logger.info(`Backup codes regenerated for user: ${user.email}`);

      return backupCodes; // Return plain text codes for user to save
    } catch (error) {
      logger.error('Backup codes regeneration failed:', error);
      throw error;
    }
  }

  /**
   * Get MFA status for a user
   */
  static async getMFAStatus(userId: string): Promise<{
    mfaEnabled: boolean;
    mfaSetupCompleted: boolean;
    backupCodesCount: number;
  }> {
    try {
      const user = await User.findById(userId).select('+mfaBackupCodes');
      if (!user) {
        throw new Error('User not found');
      }

      return {
        mfaEnabled: user.mfaEnabled,
        mfaSetupCompleted: user.mfaSetupCompleted,
        backupCodesCount: user.mfaBackupCodes?.length || 0
      };
    } catch (error) {
      logger.error('Get MFA status failed:', error);
      throw error;
    }
  }

  /**
   * Check if MFA is required for sensitive operations
   */
  static isMFARequired(user: IUser): boolean {
    return user.mfaEnabled && user.mfaSetupCompleted;
  }

  /**
   * Generate backup codes
   */
  private static generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < this.BACKUP_CODES_COUNT; i++) {
      const code = crypto.randomBytes(this.BACKUP_CODE_LENGTH / 2).toString('hex').toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  /**
   * Hash backup code for storage
   */
  private static hashBackupCode(code: string): string {
    return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
  }
}