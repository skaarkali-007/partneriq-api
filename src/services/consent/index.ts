import { Request } from 'express';
import mongoose from 'mongoose';
import { Consent, IConsent } from '../../models/Consent';
import { DataAccessRequest, IDataAccessRequest } from '../../models/DataAccessRequest';
import { User } from '../../models/User';
import { logger } from '../../utils/logger';
import crypto from 'crypto';

export interface ConsentData {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
}

export interface ConsentOptions {
  userId?: string;
  sessionId?: string;
  ipAddress: string;
  userAgent: string;
  consentTypes: ConsentData;
  consentMethod: 'banner' | 'settings' | 'registration' | 'api';
  dataProcessingPurposes: string[];
  consentVersion?: string;
}

export class ConsentService {
  /**
   * Record user consent
   */
  static async recordConsent(options: ConsentOptions): Promise<IConsent> {
    try {
      // If user is logged in, check for existing consent and update
      if (options.userId) {
        const existingConsent = await Consent.findOne({
          userId: options.userId,
          isWithdrawn: false
        }).sort({ consentTimestamp: -1 });

        if (existingConsent) {
          // Update existing consent
          existingConsent.consentTypes = options.consentTypes;
          existingConsent.dataProcessingPurposes = options.dataProcessingPurposes;
          existingConsent.consentTimestamp = new Date();
          existingConsent.consentMethod = options.consentMethod;
          existingConsent.consentVersion = options.consentVersion || '1.0';
          existingConsent.ipAddress = options.ipAddress;
          existingConsent.userAgent = options.userAgent;
          
          await existingConsent.save();
          logger.info(`Updated consent for user ${options.userId}`);
          return existingConsent;
        }
      }

      // Create new consent record
      const consent = new Consent({
        userId: options.userId,
        sessionId: options.sessionId,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        consentTypes: options.consentTypes,
        consentMethod: options.consentMethod,
        dataProcessingPurposes: options.dataProcessingPurposes,
        consentVersion: options.consentVersion || '1.0'
      });

      await consent.save();
      logger.info(`Recorded new consent for ${options.userId ? `user ${options.userId}` : `session ${options.sessionId}`}`);
      return consent;
    } catch (error) {
      logger.error('Error recording consent:', error);
      throw new Error('Failed to record consent');
    }
  }

  /**
   * Get current consent for user or session
   */
  static async getCurrentConsent(userId?: string, sessionId?: string): Promise<IConsent | null> {
    try {
      let query: any = { isWithdrawn: false };
      
      if (userId) {
        query.userId = userId;
      } else if (sessionId) {
        query.sessionId = sessionId;
      } else {
        return null;
      }

      const consent = await Consent.findOne(query).sort({ consentTimestamp: -1 });
      return consent;
    } catch (error) {
      logger.error('Error getting current consent:', error);
      throw new Error('Failed to get consent');
    }
  }

  /**
   * Withdraw consent
   */
  static async withdrawConsent(userId: string, withdrawalReason?: string): Promise<void> {
    try {
      const activeConsents = await Consent.find({
        userId,
        isWithdrawn: false
      });

      for (const consent of activeConsents) {
        consent.isWithdrawn = true;
        consent.withdrawalTimestamp = new Date();
        await consent.save();
      }

      logger.info(`Withdrew consent for user ${userId}. Reason: ${withdrawalReason || 'Not specified'}`);
    } catch (error) {
      logger.error('Error withdrawing consent:', error);
      throw new Error('Failed to withdraw consent');
    }
  }

  /**
   * Check if user has given consent for specific purpose
   */
  static async hasConsentForPurpose(userId: string, purpose: keyof ConsentData): Promise<boolean> {
    try {
      const consent = await this.getCurrentConsent(userId);
      if (!consent) return false;
      
      return consent.consentTypes[purpose] === true;
    } catch (error) {
      logger.error('Error checking consent for purpose:', error);
      return false;
    }
  }

  /**
   * Get consent history for user
   */
  static async getConsentHistory(userId: string): Promise<IConsent[]> {
    try {
      const consents = await Consent.find({ userId }).sort({ consentTimestamp: -1 });
      return consents;
    } catch (error) {
      logger.error('Error getting consent history:', error);
      throw new Error('Failed to get consent history');
    }
  }

  /**
   * Create data access request
   */
  static async createDataAccessRequest(
    userId: string,
    requestType: IDataAccessRequest['requestType'],
    requestDetails: string,
    requestedData?: string[]
  ): Promise<IDataAccessRequest> {
    try {
      // Validate ObjectId format first
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error('User not found');
      }

      // Check if user exists
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check for existing pending requests of the same type
      const existingRequest = await DataAccessRequest.findOne({
        userId,
        requestType,
        status: { $in: ['pending', 'in_progress'] }
      });

      if (existingRequest) {
        throw new Error(`You already have a pending ${requestType} request`);
      }

      const request = new DataAccessRequest({
        userId,
        requestType,
        requestDetails,
        requestedData
      });

      // Generate verification token
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      
      request.verificationToken = crypto.createHash('sha256').update(token).digest('hex');
      request.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      await request.save();

      // TODO: Send verification email to user
      logger.info(`Created data access request (${requestType}) for user ${userId}`);
      
      return request;
    } catch (error) {
      logger.error('Error creating data access request:', error);
      throw error;
    }
  }

  /**
   * Verify data access request
   */
  static async verifyDataAccessRequest(token: string): Promise<IDataAccessRequest> {
    try {
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      
      const request = await DataAccessRequest.findOne({
        verificationToken: hashedToken,
        verificationExpires: { $gt: new Date() },
        isVerified: false
      });

      if (!request) {
        throw new Error('Invalid or expired verification token');
      }

      request.isVerified = true;
      request.verificationToken = undefined;
      request.verificationExpires = undefined;
      await request.save();

      logger.info(`Verified data access request ${request._id}`);
      return request;
    } catch (error) {
      logger.error('Error verifying data access request:', error);
      throw error;
    }
  }

  /**
   * Get data access requests for user
   */
  static async getDataAccessRequests(userId: string): Promise<IDataAccessRequest[]> {
    try {
      const requests = await DataAccessRequest.find({ userId }).sort({ requestedAt: -1 });
      return requests;
    } catch (error) {
      logger.error('Error getting data access requests:', error);
      throw new Error('Failed to get data access requests');
    }
  }

  /**
   * Extract request info from Express request
   */
  static extractRequestInfo(req: Request): { ipAddress: string; userAgent: string } {
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress || 
                     '127.0.0.1';
    
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    return { ipAddress, userAgent };
  }

  /**
   * Generate session ID for anonymous users
   */
  static generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}