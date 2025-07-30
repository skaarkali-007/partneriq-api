import mongoose from 'mongoose';
import { User } from '../../models/User';
import { UserProfile } from '../../models/UserProfile';
import { Consent } from '../../models/Consent';
import { DataAccessRequest } from '../../models/DataAccessRequest';
import { Commission } from '../../models/Commission';
import { PayoutRequest } from '../../models/PayoutRequest';
import { PaymentMethod } from '../../models/PaymentMethod';
import { ReferralLink } from '../../models/ReferralLink';
import { ClickEvent } from '../../models/ClickEvent';
import { ConversionEvent } from '../../models/ConversionEvent';
import { AuditLog } from '../../models/AuditLog';
import { logger } from '../../utils/logger';

export interface UserDataExport {
  user: any;
  profile: any;
  consents: any[];
  commissions: any[];
  payouts: any[];
  paymentMethods: any[];
  referralLinks: any[];
  clickEvents: any[];
  conversionEvents: any[];
  auditLogs: any[];
  dataAccessRequests: any[];
  exportedAt: Date;
  exportVersion: string;
}

export interface DataRectificationRequest {
  field: string;
  oldValue: any;
  newValue: any;
  reason?: string;
}

export class GDPRService {
  /**
   * Export all user data for portability (GDPR Article 20)
   */
  static async exportUserData(userId: string): Promise<UserDataExport> {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error('Invalid user ID');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // First get referral links to find tracking codes for this marketer
      const referralLinks = await ReferralLink.find({ marketerId: userId });
      const trackingCodes = referralLinks.map(link => link.trackingCode);

      // Collect all user data from different collections
      const [
        profile,
        consents,
        commissions,
        payouts,
        paymentMethods,
        clickEvents,
        conversionEvents,
        auditLogs,
        dataAccessRequests
      ] = await Promise.all([
        UserProfile.findOne({ userId }),
        Consent.find({ userId }),
        Commission.find({ marketerId: userId }),
        PayoutRequest.find({ marketerId: userId }),
        PaymentMethod.find({ userId }),
        ClickEvent.find({ trackingCode: { $in: trackingCodes } }),
        ConversionEvent.find({ trackingCode: { $in: trackingCodes } }),
        AuditLog.find({ userId }),
        DataAccessRequest.find({ userId })
      ]);

      const exportData: UserDataExport = {
        user: user.toJSON(),
        profile: profile?.toJSON() || null,
        consents: consents.map(c => c.toJSON()),
        commissions: commissions.map(c => c.toJSON()),
        payouts: payouts.map(p => p.toJSON()),
        paymentMethods: paymentMethods.map(pm => {
          const pmData = pm.toJSON();
          // Add redacted message for security (accountDetails are already excluded by toJSON)
          (pmData as any).accountDetails = '[REDACTED FOR SECURITY]';
          return pmData;
        }),
        referralLinks: referralLinks.map(rl => rl.toJSON()),
        clickEvents: clickEvents.map(ce => ce.toJSON()),
        conversionEvents: conversionEvents.map(ce => ce.toJSON()),
        auditLogs: auditLogs.map(al => al.toJSON()),
        dataAccessRequests: dataAccessRequests.map(dar => dar.toJSON()),
        exportedAt: new Date(),
        exportVersion: '1.0'
      };

      // Log the data export
      await this.logDataProcessingActivity(userId, 'data_export', 'User data exported for portability');

      logger.info(`Data export completed for user ${userId}`);
      return exportData;
    } catch (error) {
      logger.error('Error exporting user data:', error);
      throw error;
    }
  }

  /**
   * Delete all user data (GDPR Article 17 - Right to Erasure)
   */
  static async deleteUserData(userId: string, reason: string = 'User requested deletion'): Promise<void> {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error('Invalid user ID');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Log the deletion request before starting
      await this.logDataProcessingActivity(userId, 'data_deletion_started', reason);

      // Get referral links to find tracking codes for this marketer
      const referralLinks = await ReferralLink.find({ marketerId: userId });
      const trackingCodes = referralLinks.map(link => link.trackingCode);

      // Start a transaction for data consistency
      const session = await mongoose.startSession();
      
      try {
        await session.withTransaction(async () => {
          // Delete user data in order (respecting foreign key constraints)
          await Promise.all([
            // Delete tracking data by tracking codes
            ClickEvent.deleteMany({ trackingCode: { $in: trackingCodes } }).session(session),
            ConversionEvent.deleteMany({ trackingCode: { $in: trackingCodes } }).session(session),
            
            // Delete financial data
            Commission.deleteMany({ marketerId: userId }).session(session),
            PayoutRequest.deleteMany({ marketerId: userId }).session(session),
            PaymentMethod.deleteMany({ userId }).session(session),
            
            // Delete referral data
            ReferralLink.deleteMany({ marketerId: userId }).session(session),
            
            // Delete consent and access requests
            Consent.deleteMany({ userId }).session(session),
            DataAccessRequest.deleteMany({ userId }).session(session),
            
            // Delete profile
            UserProfile.deleteMany({ userId }).session(session),
            
            // Delete audit logs (except the deletion log)
            AuditLog.deleteMany({ 
              userId, 
              action: { $ne: 'data_deletion_started' } 
            }).session(session)
          ]);

          // Finally delete the user account
          await User.findByIdAndDelete(userId).session(session);
        });

        logger.info(`User data deletion completed for user ${userId}. Reason: ${reason}`);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      logger.error('Error deleting user data:', error);
      throw error;
    }
  }

  /**
   * Anonymize user data instead of deletion (for cases where deletion is not possible)
   */
  static async anonymizeUserData(userId: string, reason: string = 'Data retention period expired'): Promise<void> {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error('Invalid user ID');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Log the anonymization request
      await this.logDataProcessingActivity(userId, 'data_anonymization', reason);

      const anonymizedEmail = `anonymized_${Date.now()}@deleted.local`;
      const anonymizedName = 'Anonymized User';

      // Start a transaction
      const session = await mongoose.startSession();
      
      try {
        await session.withTransaction(async () => {
          // Anonymize user account
          await User.findByIdAndUpdate(userId, {
            email: anonymizedEmail,
            firstName: anonymizedName,
            lastName: '',
            status: 'revoked',
            emailVerified: false,
            mfaEnabled: false,
            $unset: {
              emailVerificationToken: 1,
              emailVerificationExpires: 1,
              passwordResetToken: 1,
              passwordResetExpires: 1,
              mfaSecret: 1,
              mfaBackupCodes: 1
            }
          }).session(session);

          // Anonymize profile data
          await UserProfile.updateMany({ userId }, {
            firstName: anonymizedName,
            lastName: '',
            phone: '',
            address: '',
            $unset: {
              kycDocuments: 1
            }
          }).session(session);

          // Anonymize payment methods (remove sensitive data)
          await PaymentMethod.updateMany({ userId }, {
            $unset: {
              accountDetails: 1
            }
          }).session(session);

          // Get referral links to find tracking codes for this marketer
          const referralLinks = await ReferralLink.find({ marketerId: userId }).session(session);
          const trackingCodes = referralLinks.map(link => link.trackingCode);

          // Anonymize tracking data (remove IP addresses)
          await ClickEvent.updateMany({ trackingCode: { $in: trackingCodes } }, {
            ipAddress: '0.0.0.0',
            userAgent: 'Anonymized'
          }).session(session);

          // Anonymize consent records
          await Consent.updateMany({ userId }, {
            ipAddress: '0.0.0.0',
            userAgent: 'Anonymized'
          }).session(session);
        });

        logger.info(`User data anonymization completed for user ${userId}. Reason: ${reason}`);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      logger.error('Error anonymizing user data:', error);
      throw error;
    }
  }

  /**
   * Rectify (update) user data (GDPR Article 16)
   */
  static async rectifyUserData(
    userId: string, 
    rectifications: DataRectificationRequest[]
  ): Promise<void> {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error('Invalid user ID');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Log the rectification request
      await this.logDataProcessingActivity(
        userId, 
        'data_rectification', 
        `Rectifying fields: ${rectifications.map(r => r.field).join(', ')}`
      );

      const session = await mongoose.startSession();
      
      try {
        await session.withTransaction(async () => {
          for (const rectification of rectifications) {
            await this.applyRectification(userId, rectification, session);
          }
        });

        logger.info(`Data rectification completed for user ${userId}`);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      logger.error('Error rectifying user data:', error);
      throw error;
    }
  }

  /**
   * Apply a single rectification
   */
  private static async applyRectification(
    userId: string, 
    rectification: DataRectificationRequest,
    session: mongoose.ClientSession
  ): Promise<void> {
    const { field, newValue, reason } = rectification;

    // Define which fields can be rectified and in which collections
    const rectifiableFields: { [key: string]: { model: any; query: any } } = {
      'email': { model: User, query: { _id: userId } },
      'firstName': { model: User, query: { _id: userId } },
      'lastName': { model: User, query: { _id: userId } },
      'profile.firstName': { model: UserProfile, query: { userId } },
      'profile.lastName': { model: UserProfile, query: { userId } },
      'profile.phone': { model: UserProfile, query: { userId } },
      'profile.address': { model: UserProfile, query: { userId } }
    };

    const fieldConfig = rectifiableFields[field];
    if (!fieldConfig) {
      throw new Error(`Field '${field}' cannot be rectified`);
    }

    // Prepare update object
    const updateField = field.startsWith('profile.') ? field.substring(8) : field;
    const updateObj = { [updateField]: newValue };

    // Apply the update
    await fieldConfig.model.updateOne(fieldConfig.query, updateObj).session(session);

    // Log the specific rectification
    await this.logDataProcessingActivity(
      userId,
      'field_rectification',
      `Field '${field}' updated. Reason: ${reason || 'User requested correction'}`
    );
  }

  /**
   * Get user data access summary (for transparency)
   */
  static async getUserDataSummary(userId: string): Promise<any> {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error('Invalid user ID');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get referral links to find tracking codes for this marketer
      const referralLinks = await ReferralLink.find({ marketerId: userId });
      const trackingCodes = referralLinks.map(link => link.trackingCode);

      // Count records in each collection
      const [
        profileCount,
        consentCount,
        commissionCount,
        payoutCount,
        paymentMethodCount,
        referralLinkCount,
        clickEventCount,
        conversionEventCount,
        auditLogCount,
        dataAccessRequestCount
      ] = await Promise.all([
        UserProfile.countDocuments({ userId }),
        Consent.countDocuments({ userId }),
        Commission.countDocuments({ marketerId: userId }),
        PayoutRequest.countDocuments({ marketerId: userId }),
        PaymentMethod.countDocuments({ userId }),
        ReferralLink.countDocuments({ marketerId: userId }),
        ClickEvent.countDocuments({ trackingCode: { $in: trackingCodes } }),
        ConversionEvent.countDocuments({ trackingCode: { $in: trackingCodes } }),
        AuditLog.countDocuments({ userId }),
        DataAccessRequest.countDocuments({ userId })
      ]);

      return {
        userId,
        email: user.email,
        dataCategories: {
          profile: profileCount,
          consents: consentCount,
          commissions: commissionCount,
          payouts: payoutCount,
          paymentMethods: paymentMethodCount,
          referralLinks: referralLinkCount,
          clickEvents: clickEventCount,
          conversionEvents: conversionEventCount,
          auditLogs: auditLogCount,
          dataAccessRequests: dataAccessRequestCount
        },
        totalRecords: profileCount + consentCount + commissionCount + payoutCount + 
                     paymentMethodCount + referralLinkCount + clickEventCount + 
                     conversionEventCount + auditLogCount + dataAccessRequestCount + 1, // +1 for user record
        lastUpdated: user.updatedAt,
        accountStatus: user.status
      };
    } catch (error) {
      logger.error('Error getting user data summary:', error);
      throw error;
    }
  }

  /**
   * Log data processing activities for audit trail
   */
  private static async logDataProcessingActivity(
    userId: string,
    action: string,
    details: string
  ): Promise<void> {
    try {
      const auditLog = new AuditLog({
        userId,
        action,
        details,
        ipAddress: '127.0.0.1', // System action
        userAgent: 'GDPR Service',
        timestamp: new Date()
      });

      await auditLog.save();
    } catch (error) {
      logger.error('Error logging data processing activity:', error);
      // Don't throw error here to avoid breaking the main operation
    }
  }

  /**
   * Validate data export request
   */
  static async validateDataExportRequest(userId: string): Promise<boolean> {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return false;
      }

      const user = await User.findById(userId);
      return !!user;
    } catch (error) {
      logger.error('Error validating data export request:', error);
      return false;
    }
  }

  /**
   * Check if user data can be deleted (business rules)
   */
  static async canDeleteUserData(userId: string): Promise<{ canDelete: boolean; reason?: string }> {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return { canDelete: false, reason: 'Invalid user ID' };
      }

      const user = await User.findById(userId);
      if (!user) {
        return { canDelete: false, reason: 'User not found' };
      }

      // Check for pending payouts
      const pendingPayouts = await PayoutRequest.countDocuments({
        marketerId: userId,
        status: { $in: ['requested', 'approved', 'processing'] }
      });

      if (pendingPayouts > 0) {
        return { 
          canDelete: false, 
          reason: 'Cannot delete user with pending payout requests' 
        };
      }

      // Check for recent commissions (within 30 days)
      const recentCommissions = await Commission.countDocuments({
        marketerId: userId,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      });

      if (recentCommissions > 0) {
        return { 
          canDelete: false, 
          reason: 'Cannot delete user with recent commission activity (within 30 days)' 
        };
      }

      return { canDelete: true };
    } catch (error) {
      logger.error('Error checking if user data can be deleted:', error);
      return { canDelete: false, reason: 'Error checking deletion eligibility' };
    }
  }
}