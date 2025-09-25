import { ReferralLink, IReferralLink } from '../../models/ReferralLink';
import { ClickEvent, IClickEvent } from '../../models/ClickEvent';
import { ConversionEvent, IConversionEvent } from '../../models/ConversionEvent';
import { Product } from '../../models/Product';
import { User } from '../../models/User';
import { logger } from '../../utils/logger';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { EventEmitter } from 'events';
import {config} from "dotenv"

export interface CreateReferralLinkData {
  marketerId: string;
  productId: string;
  expiresAt?: Date;
}

export interface ReferralLinkStats {
  totalLinks: number;
  activeLinks: number;
  expiredLinks: number;
  totalClicks: number;
  totalConversions: number;
  conversionRate: number;
}

export interface ClickTrackingData {
  trackingCode: string;
  ipAddress: string;
  userAgent: string;
  referrer?: string;
  sessionId: string;
  customerId?: string;
}

export interface ConversionTrackingData {
  trackingCode?: string;
  customerId: string;
  productId: string;
  initialSpendAmount: number;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  attributionMethod?: 'cookie' | 'portal' | 's2s';
}

export interface AttributionResult {
  success: boolean;
  trackingCode?: string;
  marketerId?: string;
  attributionMethod: 'cookie' | 'portal' | 's2s' | 'none';
  clickEventId?: string;
  attributionWindowDays?: number;
}

export interface ConversionAnalytics {
  totalConversions: number;
  totalRevenue: number;
  averageOrderValue: number;
  conversionsByMethod: {
    cookie: number;
    portal: number;
    s2s: number;
  };
  conversionsByProduct: Array<{
    productId: string;
    productName: string;
    conversions: number;
    revenue: number;
  }>;
  conversionsByTimeframe: Array<{
    date: string;
    conversions: number;
    revenue: number;
  }>;
}

export interface CustomerDeduplicationResult {
  isDuplicate: boolean;
  existingConversionId?: string;
  duplicateReason?: 'same_customer_product_day' | 'same_customer_product_hour' | 'deduplication_key';
}

export interface ConversionNotificationData {
  conversionId: string;
  customerId: string;
  marketerId?: string;
  productId: string;
  trackingCode: string;
  initialSpendAmount: number;
  attributionMethod: string;
  commissionEligible: boolean;
  timestamp: Date;
}

export class TrackingService {
  private static conversionNotifier = new EventEmitter();
  private static changeStreamWatcher: any | null = null;
  /**
   * Generate a new referral link for a marketer and product
   */
  static async createReferralLink(data: CreateReferralLinkData): Promise<IReferralLink> {
    try {
      // Validate marketer exists and is active
      const marketer = await User.findById(data.marketerId);
      if (!marketer) {
        throw new Error('Marketer not found');
      }
      if (marketer.status !== 'active') {
        throw new Error('Marketer account is not active');
      }
      if (marketer.role !== 'marketer') {
        throw new Error('User is not a marketer');
      }

      // Validate product exists and is active
      const product = await Product.findById(data.productId);
      if (!product) {
        throw new Error('Product not found');
      }
      if (product.status !== 'active') {
        throw new Error('Product is not active');
      }

      // Check if an active link already exists for this marketer-product combination
      const existingLink = await ReferralLink.findOne({
        marketerId: data.marketerId,
        productId: data.productId,
        isActive: true,
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      if (existingLink) {
        logger.info(`Returning existing active referral link for marketer ${data.marketerId} and product ${data.productId}`);
        return existingLink;
      }

      // Create new referral link
      const referralLink = new ReferralLink({
        marketerId: data.marketerId,
        productId: data.productId,
        expiresAt: data.expiresAt,
        linkUrl: 'temp' // Temporary value, will be updated after tracking code is generated
      });

      // Generate tracking code (done in pre-save middleware)
      await referralLink.save();

      // Generate the full URL with tracking code
      const baseUrl = process.env.BACKEND_URL || 'http://localhost:3004';
      referralLink.linkUrl = `${baseUrl}/api/v1/landing/track/${referralLink.trackingCode}`;
      await referralLink.save();

      logger.info(`Created new referral link with tracking code: ${referralLink.trackingCode}`);
      return referralLink;

    } catch (error) {
      logger.error('Error creating referral link:', error);
      throw error;
    }
  }

  /**
   * Get all referral links for a marketer
   */
  static async getMarketerReferralLinks(
    marketerId: string,
    options: {
      includeInactive?: boolean;
      productId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ links: IReferralLink[]; total: number }> {
    try {
      const query: any = { marketerId };

      if (!options.includeInactive) {
        query.isActive = true;
        query.$or = [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ];
      }

      if (options.productId) {
        query.productId = options.productId;
      }

      const total = await ReferralLink.countDocuments(query);
      
      let linksQuery = ReferralLink.find(query)
        .populate('productId', 'name category commissionType commissionRate commissionFlatAmount')
        .sort({ createdAt: -1 });

      if (options.limit) {
        linksQuery = linksQuery.limit(options.limit);
      }

      if (options.offset) {
        linksQuery = linksQuery.skip(options.offset);
      }

      const links = await linksQuery.exec();

      return { links, total };

    } catch (error) {
      logger.error('Error fetching marketer referral links:', error);
      throw error;
    }
  }

  /**
   * Get referral link by tracking code
   */
  static async getReferralLinkByTrackingCode(trackingCode: string): Promise<IReferralLink | null> {
    try {
      const link = await ReferralLink.findOne({ trackingCode })
        .populate('marketerId', 'email status')
        .populate('productId', 'name landingPageUrl status');

      return link;

    } catch (error) {
      logger.error('Error fetching referral link by tracking code:', error);
      throw error;
    }
  }

  /**
   * Toggle referral link status (activate/deactivate)
   */
  static async toggleReferralLinkStatus(linkId: string, marketerId: string, isActive: boolean): Promise<IReferralLink> {
    try {
      const link = await ReferralLink.findOne({ _id: linkId, marketerId });
      
      if (!link) {
        throw new Error('Referral link not found or access denied');
      }

      link.isActive = isActive;
      await link.save();

      logger.info(`${isActive ? 'Activated' : 'Deactivated'} referral link: ${link.trackingCode}`);
      return link;

    } catch (error) {
      logger.error('Error toggling referral link status:', error);
      throw error;
    }
  }

  /**
   * Deactivate a referral link (legacy method - kept for backward compatibility)
   */
  static async deactivateReferralLink(linkId: string, marketerId: string): Promise<IReferralLink> {
    return this.toggleReferralLinkStatus(linkId, marketerId, false);
  }

  /**
   * Delete a referral link (soft delete by deactivating)
   */
  static async deleteReferralLink(linkId: string, marketerId: string): Promise<IReferralLink> {
    try {
      const link = await ReferralLink.findOne({ _id: linkId, marketerId });
      
      if (!link) {
        throw new Error('Referral link not found or access denied');
      }

      // Soft delete by deactivating and marking as deleted
      link.isActive = false;
      // Add a deleted flag if the model supports it, otherwise just deactivate
      await link.save();

      logger.info(`Deleted referral link: ${link.trackingCode}`);
      return link;

    } catch (error) {
      logger.error('Error deleting referral link:', error);
      throw error;
    }
  }

  /**
   * Update referral link expiration
   */
  static async updateReferralLinkExpiration(
    linkId: string, 
    marketerId: string, 
    expiresAt: Date | null
  ): Promise<IReferralLink> {
    try {
      const link = await ReferralLink.findOne({ _id: linkId, marketerId });
      
      if (!link) {
        throw new Error('Referral link not found or access denied');
      }

      if (expiresAt === null) {
        link.expiresAt = undefined;
      } else {
        link.expiresAt = expiresAt;
      }
      await link.save();

      logger.info(`Updated expiration for referral link: ${link.trackingCode}`);
      return link;

    } catch (error) {
      logger.error('Error updating referral link expiration:', error);
      throw error;
    }
  }

  /**
   * Get referral link statistics for a marketer
   */
  static async getMarketerReferralStats(marketerId: string): Promise<ReferralLinkStats> {
    try {
      const pipeline = [
        { $match: { marketerId } },
        {
          $group: {
            _id: null,
            totalLinks: { $sum: 1 },
            activeLinks: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$isActive', true] },
                      {
                        $or: [
                          { $eq: ['$expiresAt', null] },
                          { $gt: ['$expiresAt', new Date()] }
                        ]
                      }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            expiredLinks: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$expiresAt', null] },
                      { $lte: ['$expiresAt', new Date()] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            totalClicks: { $sum: '$clickCount' },
            totalConversions: { $sum: '$conversionCount' }
          }
        }
      ];

      const result = await ReferralLink.aggregate(pipeline);
      const stats = result[0] || {
        totalLinks: 0,
        activeLinks: 0,
        expiredLinks: 0,
        totalClicks: 0,
        totalConversions: 0
      };

      // Calculate conversion rate
      stats.conversionRate = stats.totalClicks > 0 
        ? (stats.totalConversions / stats.totalClicks) * 100 
        : 0;

      return stats;

    } catch (error) {
      logger.error('Error fetching marketer referral stats:', error);
      throw error;
    }
  }

  /**
   * Clean up expired referral links (utility method for scheduled tasks)
   */
  static async cleanupExpiredLinks(): Promise<number> {
    try {
      const result = await ReferralLink.updateMany(
        {
          isActive: true,
          expiresAt: { $lte: new Date() }
        },
        {
          $set: { isActive: false }
        }
      );

      logger.info(`Deactivated ${result.modifiedCount} expired referral links`);
      return result.modifiedCount;

    } catch (error) {
      logger.error('Error cleaning up expired referral links:', error);
      throw error;
    }
  }

  /**
   * Validate tracking code format
   */
  static validateTrackingCode(trackingCode: string): boolean {
    // Expected format: TIMESTAMP_MARKETERID_PRODUCTID_RANDOMHEX
    const pattern = /^[A-Z0-9]+_[A-Z0-9]{4}_[A-Z0-9]{4}_[A-Z0-9]{16}$/;
    return pattern.test(trackingCode);
  }

  /**
   * Track a click event when user clicks on referral link
   */
  static async trackClick(data: ClickTrackingData): Promise<IClickEvent> {
    try {
      // Validate tracking code exists and is active
      const referralLink = await ReferralLink.findOne({ 
        trackingCode: data.trackingCode,
        isActive: true,
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      if (!referralLink) {
        throw new Error('Invalid or expired tracking code');
      }

      // Parse user agent for device information
      const deviceInfo = this.parseUserAgent(data.userAgent);

      // Create click event
      const clickEvent = new ClickEvent({
        trackingCode: data.trackingCode,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        referrer: data.referrer,
        sessionId: data.sessionId,
        customerId: data.customerId,
        device: deviceInfo.device,
        browser: deviceInfo.browser,
        os: deviceInfo.os
      });

      await clickEvent.save();

      // Increment click count on referral link
      await referralLink.incrementClickCount();

      logger.info(`Tracked click for tracking code: ${data.trackingCode}, session: ${data.sessionId}`);
      return clickEvent;

    } catch (error) {
      logger.error('Error tracking click:', error);
      throw error;
    }
  }

  /**
   * Perform attribution for a conversion event
   */
  static async performAttribution(data: ConversionTrackingData): Promise<AttributionResult> {
    try {
      let attributionResult: AttributionResult = {
        success: false,
        attributionMethod: 'none'
      };

      // Method 1: Direct tracking code attribution (portal-based or server-to-server)
      if (data.trackingCode) {
        const directAttribution = await this.performDirectAttribution(data.trackingCode, data.customerId);
        if (directAttribution.success) {
          attributionResult = directAttribution;
          attributionResult.attributionMethod = data.attributionMethod || 'portal';
        }
      }

      // Method 2: Cookie-based attribution (session and fingerprint matching)
      if (!attributionResult.success && (data.sessionId || data.ipAddress)) {
        const cookieAttribution = await this.performCookieAttribution({
          customerId: data.customerId,
          sessionId: data.sessionId,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent
        });
        if (cookieAttribution.success) {
          attributionResult = cookieAttribution;
          attributionResult.attributionMethod = 'cookie';
        }
      }

      logger.info(`Attribution result for customer ${data.customerId}: ${JSON.stringify(attributionResult)}`);
      return attributionResult;

    } catch (error) {
      logger.error('Error performing attribution:', error);
      return {
        success: false,
        attributionMethod: 'none'
      };
    }
  }

  /**
   * Record a conversion event
   */
  static async recordConversion(data: ConversionTrackingData): Promise<IConversionEvent> {
    try {
      // Perform attribution first
      const attribution = await this.performAttribution(data);

      // Generate deduplication key
      const crypto = require('crypto');
      const deduplicationData = `${data.customerId}|${data.productId}|${new Date().toISOString().split('T')[0]}`;
      const deduplicationKey = crypto.createHash('sha256').update(deduplicationData).digest('hex');

      // Create conversion event
      const conversionEvent = new ConversionEvent({
        trackingCode: attribution.trackingCode || data.trackingCode || 'UNKNOWN',
        customerId: data.customerId,
        productId: data.productId,
        initialSpendAmount: data.initialSpendAmount,
        attributionMethod: attribution.attributionMethod,
        commissionEligible: attribution.success,
        sessionId: data.sessionId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        clickEventId: attribution.clickEventId,
        attributionWindowDays: attribution.attributionWindowDays || 30,
        deduplicationKey
      });

      await conversionEvent.save();

      // If attribution was successful, increment conversion count on referral link
      if (attribution.success && attribution.trackingCode) {
        const referralLink = await ReferralLink.findOne({ trackingCode: attribution.trackingCode });
        if (referralLink) {
          await referralLink.incrementConversionCount();
        }
      }

      logger.info(`Recorded conversion for customer ${data.customerId}, amount: ${data.initialSpendAmount}, eligible: ${attribution.success}`);
      return conversionEvent;

    } catch (error) {
      logger.error('Error recording conversion:', error);
      throw error;
    }
  }

  /**
   * Get click events for a tracking code
   */
  static async getClickEvents(
    trackingCode: string,
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<{ events: IClickEvent[]; total: number }> {
    try {
      const query: any = { trackingCode };

      if (options.startDate || options.endDate) {
        query.timestamp = {};
        if (options.startDate) {
          query.timestamp.$gte = options.startDate;
        }
        if (options.endDate) {
          query.timestamp.$lte = options.endDate;
        }
      }

      const total = await ClickEvent.countDocuments(query);
      
      let eventsQuery = ClickEvent.find(query).sort({ timestamp: -1 });

      if (options.limit) {
        eventsQuery = eventsQuery.limit(options.limit);
      }

      if (options.offset) {
        eventsQuery = eventsQuery.skip(options.offset);
      }

      const events = await eventsQuery.exec();

      return { events, total };

    } catch (error) {
      logger.error('Error fetching click events:', error);
      throw error;
    }
  }

  /**
   * Get conversion events for a tracking code
   */
  static async getConversionEvents(
    trackingCode: string,
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<{ events: IConversionEvent[]; total: number }> {
    try {
      const query: any = { trackingCode };

      if (options.startDate || options.endDate) {
        query.conversionTimestamp = {};
        if (options.startDate) {
          query.conversionTimestamp.$gte = options.startDate;
        }
        if (options.endDate) {
          query.conversionTimestamp.$lte = options.endDate;
        }
      }

      const total = await ConversionEvent.countDocuments(query);
      
      let eventsQuery = ConversionEvent.find(query)
        .populate('productId', 'name category')
        .sort({ conversionTimestamp: -1 });

      if (options.limit) {
        eventsQuery = eventsQuery.limit(options.limit);
      }

      if (options.offset) {
        eventsQuery = eventsQuery.skip(options.offset);
      }

      const events = await eventsQuery.exec();

      return { events, total };

    } catch (error) {
      logger.error('Error fetching conversion events:', error);
      throw error;
    }
  }

  /**
   * Private method: Perform direct attribution using tracking code
   */
  private static async performDirectAttribution(trackingCode: string, customerId: string): Promise<AttributionResult> {
    try {
      const referralLink = await ReferralLink.findOne({ 
        trackingCode,
        isActive: true 
      }).populate('marketerId', '_id');

      if (!referralLink) {
        return { success: false, attributionMethod: 'none' };
      }

      return {
        success: true,
        trackingCode,
        marketerId: referralLink.marketerId.toString(),
        attributionMethod: 'portal',
        attributionWindowDays: 30
      };

    } catch (error) {
      logger.error('Error in direct attribution:', error);
      return { success: false, attributionMethod: 'none' };
    }
  }

  /**
   * Private method: Perform cookie-based attribution
   */
  private static async performCookieAttribution(data: {
    customerId: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AttributionResult> {
    try {
      const attributionWindow = 30; // days
      const cutoffDate = new Date(Date.now() - (attributionWindow * 24 * 60 * 60 * 1000));

      let clickEvent: IClickEvent | null = null;

      // Try session-based attribution first (most reliable)
      if (data.sessionId) {
        clickEvent = await ClickEvent.findOne({
          sessionId: data.sessionId,
          timestamp: { $gte: cutoffDate }
        }).sort({ timestamp: -1 });
      }

      // If no session match, try fingerprint-based attribution
      if (!clickEvent && data.ipAddress && data.userAgent) {
        const fingerprint = crypto.createHash('sha256')
          .update(`${data.ipAddress}|${data.userAgent}|${data.sessionId || ''}`)
          .digest('hex')
          .substring(0, 16);

        clickEvent = await ClickEvent.findOne({
          fingerprint,
          timestamp: { $gte: cutoffDate }
        }).sort({ timestamp: -1 });
      }

      // If no fingerprint match, try IP-based attribution (least reliable)
      if (!clickEvent && data.ipAddress) {
        clickEvent = await ClickEvent.findOne({
          ipAddress: data.ipAddress,
          timestamp: { $gte: cutoffDate }
        }).sort({ timestamp: -1 });
      }

      if (!clickEvent) {
        return { success: false, attributionMethod: 'none' };
      }

      // Get referral link to find marketer
      const referralLink = await ReferralLink.findOne({ 
        trackingCode: clickEvent.trackingCode 
      }).populate('marketerId', '_id');

      if (!referralLink) {
        return { success: false, attributionMethod: 'none' };
      }

      return {
        success: true,
        trackingCode: clickEvent.trackingCode,
        marketerId: referralLink.marketerId.toString(),
        attributionMethod: 'cookie',
        clickEventId: clickEvent._id,
        attributionWindowDays: attributionWindow
      };

    } catch (error) {
      logger.error('Error in cookie attribution:', error);
      return { success: false, attributionMethod: 'none' };
    }
  }

  /**
   * Enhanced conversion recording with MongoDB aggregation-based deduplication
   */
  static async recordConversionWithDeduplication(data: ConversionTrackingData): Promise<{
    conversionEvent: IConversionEvent;
    deduplicationResult: CustomerDeduplicationResult;
  }> {
    try {
      // Check for duplicates using MongoDB aggregation
      const deduplicationResult = await this.checkCustomerDeduplication(
        data.customerId,
        data.productId,
        data.initialSpendAmount
      );

      if (deduplicationResult.isDuplicate) {
        logger.warn(`Duplicate conversion detected for customer ${data.customerId}: ${deduplicationResult.duplicateReason}`);
        
        // Return existing conversion event
        const existingConversion = await ConversionEvent.findById(deduplicationResult.existingConversionId);
        if (existingConversion) {
          return {
            conversionEvent: existingConversion,
            deduplicationResult
          };
        }
      }

      // Proceed with normal conversion recording
      const conversionEvent = await this.recordConversion(data);

      // Emit real-time notification
      await this.emitConversionNotification(conversionEvent);

      return {
        conversionEvent,
        deduplicationResult: { isDuplicate: false }
      };

    } catch (error) {
      logger.error('Error recording conversion with deduplication:', error);
      throw error;
    }
  }

  /**
   * Check for customer deduplication using MongoDB aggregation
   */
  static async checkCustomerDeduplication(
    customerId: string,
    productId: string,
    initialSpendAmount: number
  ): Promise<CustomerDeduplicationResult> {
    try {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // MongoDB aggregation pipeline to check for duplicates
      const duplicateCheckPipeline: any[] = [
        {
          $match: {
            customerId,
            productId,
            conversionTimestamp: { $gte: oneDayAgo }
          }
        },
        {
          $addFields: {
            timeDiffHours: {
              $divide: [
                { $subtract: [now, '$conversionTimestamp'] },
                1000 * 60 * 60
              ]
            },
            amountDiff: {
              $abs: { $subtract: ['$initialSpendAmount', initialSpendAmount] }
            }
          }
        },
        {
          $match: {
            $or: [
              // Same customer, product, and day
              {
                timeDiffHours: { $lte: 24 },
                amountDiff: { $lte: 1 } // Allow small amount differences due to rounding
              },
              // Same customer, product, and hour (stricter check)
              {
                timeDiffHours: { $lte: 1 },
                amountDiff: { $lte: 100 } // Allow larger amount differences within an hour
              }
            ]
          }
        },
        {
          $sort: { conversionTimestamp: -1 }
        },
        {
          $limit: 1
        }
      ];

      const duplicates = await ConversionEvent.aggregate(duplicateCheckPipeline);

      if (duplicates.length > 0) {
        const duplicate = duplicates[0];
        const timeDiffHours = duplicate.timeDiffHours;
        
        return {
          isDuplicate: true,
          existingConversionId: duplicate._id.toString(),
          duplicateReason: timeDiffHours <= 1 ? 'same_customer_product_hour' : 'same_customer_product_day'
        };
      }

      return { isDuplicate: false };

    } catch (error) {
      logger.error('Error checking customer deduplication:', error);
      return { isDuplicate: false };
    }
  }

  /**
   * Get conversion analytics using MongoDB aggregation
   */
  static async getConversionAnalytics(
    filters: {
      marketerId?: string;
      productId?: string;
      startDate?: Date;
      endDate?: Date;
      trackingCode?: string;
    } = {}
  ): Promise<ConversionAnalytics> {
    try {
      const matchStage: any = {
        commissionEligible: true
      };

      // Apply filters
      if (filters.startDate || filters.endDate) {
        matchStage.conversionTimestamp = {};
        if (filters.startDate) {
          matchStage.conversionTimestamp.$gte = filters.startDate;
        }
        if (filters.endDate) {
          matchStage.conversionTimestamp.$lte = filters.endDate;
        }
      }

      if (filters.productId) {
        matchStage.productId = filters.productId;
      }

      if (filters.trackingCode) {
        matchStage.trackingCode = filters.trackingCode;
      }

      // If marketerId is provided, we need to join with referral links
      let pipeline: any[] = [];

      if (filters.marketerId) {
        // First get tracking codes for the marketer
        const referralLinks = await ReferralLink.find({ marketerId: filters.marketerId });
        const trackingCodes = referralLinks.map(link => link.trackingCode);
        matchStage.trackingCode = { $in: trackingCodes };
      }

      // Main aggregation pipeline
      pipeline = [
        { $match: matchStage },
        {
          $lookup: {
            from: 'products',
            localField: 'productId',
            foreignField: '_id',
            as: 'product'
          }
        },
        {
          $unwind: {
            path: '$product',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $facet: {
            // Overall statistics
            totalStats: [
              {
                $group: {
                  _id: null,
                  totalConversions: { $sum: 1 },
                  totalRevenue: { $sum: '$initialSpendAmount' },
                  averageOrderValue: { $avg: '$initialSpendAmount' }
                }
              }
            ],
            // Conversions by attribution method
            conversionsByMethod: [
              {
                $group: {
                  _id: '$attributionMethod',
                  count: { $sum: 1 }
                }
              }
            ],
            // Conversions by product
            conversionsByProduct: [
              {
                $group: {
                  _id: {
                    productId: '$productId',
                    productName: '$product.name'
                  },
                  conversions: { $sum: 1 },
                  revenue: { $sum: '$initialSpendAmount' }
                }
              },
              {
                $sort: { revenue: -1 }
              },
              {
                $limit: 10
              }
            ],
            // Conversions by timeframe (daily)
            conversionsByTimeframe: [
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$conversionTimestamp'
                    }
                  },
                  conversions: { $sum: 1 },
                  revenue: { $sum: '$initialSpendAmount' }
                }
              },
              {
                $sort: { _id: 1 }
              }
            ]
          }
        }
      ] as any[];

      const result = await ConversionEvent.aggregate(pipeline);
      const data = result[0];

      // Process results
      const totalStats = data.totalStats[0] || {
        totalConversions: 0,
        totalRevenue: 0,
        averageOrderValue: 0
      };

      const conversionsByMethod = {
        cookie: 0,
        portal: 0,
        s2s: 0
      };

      data.conversionsByMethod.forEach((item: any) => {
        if (item._id && conversionsByMethod.hasOwnProperty(item._id)) {
          conversionsByMethod[item._id as keyof typeof conversionsByMethod] = item.count;
        }
      });

      const conversionsByProduct = data.conversionsByProduct.map((item: any) => ({
        productId: item._id.productId,
        productName: item._id.productName || 'Unknown Product',
        conversions: item.conversions,
        revenue: item.revenue
      }));

      const conversionsByTimeframe = data.conversionsByTimeframe.map((item: any) => ({
        date: item._id,
        conversions: item.conversions,
        revenue: item.revenue
      }));

      return {
        totalConversions: totalStats.totalConversions,
        totalRevenue: totalStats.totalRevenue,
        averageOrderValue: totalStats.averageOrderValue,
        conversionsByMethod,
        conversionsByProduct,
        conversionsByTimeframe
      };

    } catch (error) {
      logger.error('Error getting conversion analytics:', error);
      throw error;
    }
  }

  /**
   * Initialize MongoDB change streams for real-time conversion notifications
   */
  static async initializeConversionChangeStream(): Promise<void> {
    try {
      if (this.changeStreamWatcher) {
        logger.info('Change stream already initialized');
        return;
      }

      // Create change stream on conversion events collection
      this.changeStreamWatcher = ConversionEvent.watch([
        {
          $match: {
            'operationType': 'insert',
            'fullDocument.commissionEligible': true
          }
        }
      ], {
        fullDocument: 'updateLookup'
      });

      this.changeStreamWatcher.on('change', async (change: any) => {
        try {
          if (change.operationType === 'insert' && change.fullDocument) {
            const conversionEvent = change.fullDocument as IConversionEvent;
            await this.handleConversionChangeStreamEvent(conversionEvent);
          }
        } catch (error) {
          logger.error('Error handling change stream event:', error);
        }
      });

      this.changeStreamWatcher.on('error', (error: any) => {
        logger.error('Change stream error:', error);
        // Attempt to reconnect
        setTimeout(() => {
          this.initializeConversionChangeStream();
        }, 5000);
      });

      logger.info('Conversion change stream initialized successfully');

    } catch (error) {
      logger.error('Error initializing conversion change stream:', error);
      throw error;
    }
  }

  /**
   * Close MongoDB change stream
   */
  static async closeConversionChangeStream(): Promise<void> {
    try {
      if (this.changeStreamWatcher) {
        await this.changeStreamWatcher.close();
        this.changeStreamWatcher = null;
        logger.info('Conversion change stream closed');
      }
    } catch (error) {
      logger.error('Error closing conversion change stream:', error);
    }
  }

  /**
   * Handle conversion change stream events
   */
  private static async handleConversionChangeStreamEvent(conversionEvent: IConversionEvent): Promise<void> {
    try {
      // Get marketer information for notification
      const referralLink = await ReferralLink.findOne({ 
        trackingCode: conversionEvent.trackingCode 
      }).populate('marketerId', 'email');

      if (referralLink && referralLink.marketerId) {
        const notificationData: ConversionNotificationData = {
          conversionId: conversionEvent._id,
          customerId: conversionEvent.customerId,
          marketerId: (referralLink.marketerId as any)._id,
          productId: conversionEvent.productId,
          trackingCode: conversionEvent.trackingCode,
          initialSpendAmount: conversionEvent.initialSpendAmount,
          attributionMethod: conversionEvent.attributionMethod,
          commissionEligible: conversionEvent.commissionEligible,
          timestamp: conversionEvent.conversionTimestamp
        };

        // Emit notification event
        this.conversionNotifier.emit('conversion', notificationData);
        
        logger.info(`Real-time conversion notification sent for conversion ${conversionEvent._id}`);
      }

    } catch (error) {
      logger.error('Error handling conversion change stream event:', error);
    }
  }

  /**
   * Emit conversion notification
   */
  private static async emitConversionNotification(conversionEvent: IConversionEvent): Promise<void> {
    try {
      if (!conversionEvent.commissionEligible) {
        return; // Only notify for commission-eligible conversions
      }

      // Get marketer information
      const referralLink = await ReferralLink.findOne({ 
        trackingCode: conversionEvent.trackingCode 
      }).populate('marketerId', 'email');

      if (referralLink && referralLink.marketerId) {
        const notificationData: ConversionNotificationData = {
          conversionId: conversionEvent._id,
          customerId: conversionEvent.customerId,
          marketerId: (referralLink.marketerId as any)._id,
          productId: conversionEvent.productId,
          trackingCode: conversionEvent.trackingCode,
          initialSpendAmount: conversionEvent.initialSpendAmount,
          attributionMethod: conversionEvent.attributionMethod,
          commissionEligible: conversionEvent.commissionEligible,
          timestamp: conversionEvent.conversionTimestamp
        };

        // Emit notification event
        this.conversionNotifier.emit('conversion', notificationData);
        
        logger.info(`Conversion notification emitted for conversion ${conversionEvent._id}`);
      }

    } catch (error) {
      logger.error('Error emitting conversion notification:', error);
    }
  }

  /**
   * Subscribe to conversion notifications
   */
  static onConversionNotification(callback: (data: ConversionNotificationData) => void): void {
    this.conversionNotifier.on('conversion', callback);
  }

  /**
   * Unsubscribe from conversion notifications
   */
  static offConversionNotification(callback: (data: ConversionNotificationData) => void): void {
    this.conversionNotifier.off('conversion', callback);
  }

  /**
   * Get conversion events with advanced MongoDB queries
   */
  static async getAdvancedConversionEvents(
    filters: {
      marketerId?: string;
      productIds?: string[];
      customerIds?: string[];
      trackingCodes?: string[];
      attributionMethods?: string[];
      commissionEligible?: boolean;
      minAmount?: number;
      maxAmount?: number;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
      sortBy?: 'conversionTimestamp' | 'initialSpendAmount' | 'customerId';
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<{ events: IConversionEvent[]; total: number; analytics: any }> {
    try {
      const matchStage: any = {};

      // Apply filters
      if (filters.productIds && filters.productIds.length > 0) {
        matchStage.productId = { $in: filters.productIds };
      }

      if (filters.customerIds && filters.customerIds.length > 0) {
        matchStage.customerId = { $in: filters.customerIds };
      }

      if (filters.trackingCodes && filters.trackingCodes.length > 0) {
        matchStage.trackingCode = { $in: filters.trackingCodes };
      }

      if (filters.attributionMethods && filters.attributionMethods.length > 0) {
        matchStage.attributionMethod = { $in: filters.attributionMethods };
      }

      if (filters.commissionEligible !== undefined) {
        matchStage.commissionEligible = filters.commissionEligible;
      }

      if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
        matchStage.initialSpendAmount = {};
        if (filters.minAmount !== undefined) {
          matchStage.initialSpendAmount.$gte = filters.minAmount;
        }
        if (filters.maxAmount !== undefined) {
          matchStage.initialSpendAmount.$lte = filters.maxAmount;
        }
      }

      if (filters.startDate || filters.endDate) {
        matchStage.conversionTimestamp = {};
        if (filters.startDate) {
          matchStage.conversionTimestamp.$gte = filters.startDate;
        }
        if (filters.endDate) {
          matchStage.conversionTimestamp.$lte = filters.endDate;
        }
      }

      // Handle marketer filter by getting their tracking codes
      if (filters.marketerId) {
        const referralLinks = await ReferralLink.find({ marketerId: filters.marketerId });
        const trackingCodes = referralLinks.map(link => link.trackingCode);
        
        if (matchStage.trackingCode) {
          // Intersect with existing tracking codes filter
          const existingCodes = Array.isArray(matchStage.trackingCode.$in) 
            ? matchStage.trackingCode.$in 
            : [matchStage.trackingCode];
          matchStage.trackingCode = { $in: trackingCodes.filter(code => existingCodes.includes(code)) };
        } else {
          matchStage.trackingCode = { $in: trackingCodes };
        }
      }

      // Build aggregation pipeline
      const sortField = filters.sortBy || 'conversionTimestamp';
      const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
      
      const pipeline: any[] = [
        { $match: matchStage },
        {
          $lookup: {
            from: 'products',
            localField: 'productId',
            foreignField: '_id',
            as: 'product'
          }
        },
        {
          $unwind: {
            path: '$product',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $facet: {
            events: [
              {
                $sort: { [sortField]: sortOrder }
              },
              ...(filters.offset ? [{ $skip: filters.offset }] : []),
              ...(filters.limit ? [{ $limit: filters.limit }] : [])
            ],
            total: [
              { $count: 'count' }
            ],
            analytics: [
              {
                $group: {
                  _id: null,
                  totalConversions: { $sum: 1 },
                  totalRevenue: { $sum: '$initialSpendAmount' },
                  averageOrderValue: { $avg: '$initialSpendAmount' },
                  minAmount: { $min: '$initialSpendAmount' },
                  maxAmount: { $max: '$initialSpendAmount' },
                  commissionEligibleCount: {
                    $sum: { $cond: ['$commissionEligible', 1, 0] }
                  }
                }
              }
            ]
          }
        }
      ];

      const result = await ConversionEvent.aggregate(pipeline);
      const data = result[0];

      return {
        events: data.events,
        total: data.total[0]?.count || 0,
        analytics: data.analytics[0] || {
          totalConversions: 0,
          totalRevenue: 0,
          averageOrderValue: 0,
          minAmount: 0,
          maxAmount: 0,
          commissionEligibleCount: 0
        }
      };

    } catch (error) {
      logger.error('Error getting advanced conversion events:', error);
      throw error;
    }
  }

  /**
   * Private method: Parse user agent string for device information
   */
  private static parseUserAgent(userAgent: string): {
    device: string;
    browser: string;
    os: string;
  } {
    const ua = userAgent.toLowerCase();
    
    // Simple user agent parsing (in production, consider using a library like ua-parser-js)
    let device = 'desktop';
    let browser = 'unknown';
    let os = 'unknown';

    // Device detection
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      device = 'mobile';
    } else if (ua.includes('tablet') || ua.includes('ipad')) {
      device = 'tablet';
    }

    // Browser detection (order matters - Chrome includes Safari in UA string)
    if (ua.includes('chrome') && !ua.includes('edg')) browser = 'chrome';
    else if (ua.includes('firefox')) browser = 'firefox';
    else if (ua.includes('edg')) browser = 'edge';
    else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'safari';
    else if (ua.includes('opera') || ua.includes('opr')) browser = 'opera';

    // OS detection
    if (ua.includes('windows')) os = 'windows';
    else if (ua.includes('mac')) os = 'macos';
    else if (ua.includes('linux')) os = 'linux';
    else if (ua.includes('android')) os = 'android';
    else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) os = 'ios';

    return { device, browser, os };
  }
}