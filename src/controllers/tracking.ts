import { Request, Response } from 'express';
import { TrackingService } from '../services/tracking';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a new referral link for a marketer
 */
export const createReferralLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const { marketerId, productId, expiresAt } = req.body;

    if (!marketerId || !productId) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Marketer ID and Product ID are required'
        }
      });
      return;
    }

    const referralLink = await TrackingService.createReferralLink({
      marketerId,
      productId,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    });

    res.status(201).json({
      success: true,
      data: referralLink
    });

  } catch (error: any) {
    logger.error('Error creating referral link:', error);
    res.status(400).json({
      error: {
        code: 'CREATE_LINK_ERROR',
        message: error.message || 'Failed to create referral link'
      }
    });
  }
};

/**
 * Get referral links for a marketer
 */
export const getMarketerReferralLinks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { marketerId } = req.params;
    const { includeInactive, productId, limit, offset } = req.query;

    const options = {
      includeInactive: includeInactive === 'true',
      productId: productId as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    };

    const result = await TrackingService.getMarketerReferralLinks(marketerId, options);

    res.json({
      success: true,
      data: result.links,
      pagination: {
        total: result.total,
        limit: options.limit,
        offset: options.offset
      }
    });

  } catch (error: any) {
    logger.error('Error fetching marketer referral links:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_LINKS_ERROR',
        message: error.message || 'Failed to fetch referral links'
      }
    });
  }
};

/**
 * Track a click event
 */
export const trackClick = async (req: Request, res: Response): Promise<void> => {
  try {
    const { trackingCode } = req.params;
    const { customerId } = req.body;

    // Extract request information
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    const referrer = req.get('Referer');
    
    // Generate or extract session ID
    let sessionId = req.session?.id;
    if (!sessionId) {
      sessionId = req.get('X-Session-ID') || uuidv4();
    }

    const clickData = {
      trackingCode,
      ipAddress,
      userAgent,
      referrer,
      sessionId,
      customerId
    };

    const clickEvent = await TrackingService.trackClick(clickData);

    // Set tracking cookie for attribution
    res.cookie('affiliate_tracking', trackingCode, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    // Set session cookie
    res.cookie('affiliate_session', sessionId, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.json({
      success: true,
      data: {
        clickId: clickEvent._id,
        trackingCode,
        sessionId,
        timestamp: clickEvent.timestamp
      }
    });

  } catch (error: any) {
    logger.error('Error tracking click:', error);
    res.status(400).json({
      error: {
        code: 'TRACK_CLICK_ERROR',
        message: error.message || 'Failed to track click'
      }
    });
  }
};

/**
 * Record a conversion event
 */
export const recordConversion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, productId, initialSpendAmount, trackingCode, attributionMethod } = req.body;

    if (!customerId || !productId || !initialSpendAmount) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Customer ID, Product ID, and Initial Spend Amount are required'
        }
      });
      return;
    }

    // Extract request information for attribution
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    // Try to get session ID from cookie or header
    let sessionId = req.cookies?.affiliate_session || req.get('X-Session-ID');
    
    // Try to get tracking code from cookie if not provided
    const cookieTrackingCode = req.cookies?.affiliate_tracking;

    const conversionData = {
      trackingCode: trackingCode || cookieTrackingCode,
      customerId,
      productId,
      initialSpendAmount: parseFloat(initialSpendAmount),
      sessionId,
      ipAddress,
      userAgent,
      attributionMethod: attributionMethod as 'cookie' | 'portal' | 's2s'
    };

    const conversionEvent = await TrackingService.recordConversion(conversionData);

    res.json({
      success: true,
      data: {
        conversionId: conversionEvent._id,
        trackingCode: conversionEvent.trackingCode,
        attributionMethod: conversionEvent.attributionMethod,
        commissionEligible: conversionEvent.commissionEligible,
        timestamp: conversionEvent.conversionTimestamp
      }
    });

  } catch (error: any) {
    logger.error('Error recording conversion:', error);
    res.status(400).json({
      error: {
        code: 'RECORD_CONVERSION_ERROR',
        message: error.message || 'Failed to record conversion'
      }
    });
  }
};

/**
 * Record a conversion event with enhanced deduplication
 */
export const recordConversionWithDeduplication = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, productId, initialSpendAmount, trackingCode, attributionMethod } = req.body;

    if (!customerId || !productId || !initialSpendAmount) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Customer ID, Product ID, and Initial Spend Amount are required'
        }
      });
      return;
    }

    // Extract request information for attribution
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    // Try to get session ID from cookie or header
    let sessionId = req.cookies?.affiliate_session || req.get('X-Session-ID');
    
    // Try to get tracking code from cookie if not provided
    const cookieTrackingCode = req.cookies?.affiliate_tracking;

    const conversionData = {
      trackingCode: trackingCode || cookieTrackingCode,
      customerId,
      productId,
      initialSpendAmount: parseFloat(initialSpendAmount),
      sessionId,
      ipAddress,
      userAgent,
      attributionMethod: attributionMethod as 'cookie' | 'portal' | 's2s'
    };

    const result = await TrackingService.recordConversionWithDeduplication(conversionData);

    res.json({
      success: true,
      data: {
        conversionId: result.conversionEvent._id,
        trackingCode: result.conversionEvent.trackingCode,
        attributionMethod: result.conversionEvent.attributionMethod,
        commissionEligible: result.conversionEvent.commissionEligible,
        timestamp: result.conversionEvent.conversionTimestamp,
        deduplication: {
          isDuplicate: result.deduplicationResult.isDuplicate,
          duplicateReason: result.deduplicationResult.duplicateReason,
          existingConversionId: result.deduplicationResult.existingConversionId
        }
      }
    });

  } catch (error: any) {
    logger.error('Error recording conversion with deduplication:', error);
    res.status(400).json({
      error: {
        code: 'RECORD_CONVERSION_ERROR',
        message: error.message || 'Failed to record conversion'
      }
    });
  }
};

/**
 * Get conversion analytics using MongoDB aggregation
 */
export const getConversionAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { marketerId, productId, startDate, endDate, trackingCode } = req.query;

    const filters: any = {};

    if (marketerId) filters.marketerId = marketerId as string;
    if (productId) filters.productId = productId as string;
    if (trackingCode) filters.trackingCode = trackingCode as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const analytics = await TrackingService.getConversionAnalytics(filters);

    res.json({
      success: true,
      data: analytics
    });

  } catch (error: any) {
    logger.error('Error getting conversion analytics:', error);
    res.status(500).json({
      error: {
        code: 'ANALYTICS_ERROR',
        message: error.message || 'Failed to get conversion analytics'
      }
    });
  }
};

/**
 * Get advanced conversion events with filtering and analytics
 */
export const getAdvancedConversionEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      marketerId,
      productIds,
      customerIds,
      trackingCodes,
      attributionMethods,
      commissionEligible,
      minAmount,
      maxAmount,
      startDate,
      endDate,
      limit,
      offset,
      sortBy,
      sortOrder
    } = req.query;

    const filters: any = {};

    if (marketerId) filters.marketerId = marketerId as string;
    if (productIds) filters.productIds = (productIds as string).split(',');
    if (customerIds) filters.customerIds = (customerIds as string).split(',');
    if (trackingCodes) filters.trackingCodes = (trackingCodes as string).split(',');
    if (attributionMethods) filters.attributionMethods = (attributionMethods as string).split(',');
    if (commissionEligible !== undefined) filters.commissionEligible = commissionEligible === 'true';
    if (minAmount) filters.minAmount = parseFloat(minAmount as string);
    if (maxAmount) filters.maxAmount = parseFloat(maxAmount as string);
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);
    if (limit) filters.limit = parseInt(limit as string);
    if (offset) filters.offset = parseInt(offset as string);
    if (sortBy) filters.sortBy = sortBy as string;
    if (sortOrder) filters.sortOrder = sortOrder as 'asc' | 'desc';

    const result = await TrackingService.getAdvancedConversionEvents(filters);

    res.json({
      success: true,
      data: result.events,
      pagination: {
        total: result.total,
        limit: filters.limit,
        offset: filters.offset
      },
      analytics: result.analytics
    });

  } catch (error: any) {
    logger.error('Error getting advanced conversion events:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_CONVERSIONS_ERROR',
        message: error.message || 'Failed to fetch conversion events'
      }
    });
  }
};

/**
 * Get click events for a tracking code
 */
export const getClickEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { trackingCode } = req.params;
    const { limit, offset, startDate, endDate } = req.query;

    const options = {
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    };

    const result = await TrackingService.getClickEvents(trackingCode, options);

    res.json({
      success: true,
      data: result.events,
      pagination: {
        total: result.total,
        limit: options.limit,
        offset: options.offset
      }
    });

  } catch (error: any) {
    logger.error('Error fetching click events:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_CLICKS_ERROR',
        message: error.message || 'Failed to fetch click events'
      }
    });
  }
};

/**
 * Get conversion events for a tracking code
 */
export const getConversionEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { trackingCode } = req.params;
    const { limit, offset, startDate, endDate } = req.query;

    const options = {
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    };

    const result = await TrackingService.getConversionEvents(trackingCode, options);

    res.json({
      success: true,
      data: result.events,
      pagination: {
        total: result.total,
        limit: options.limit,
        offset: options.offset
      }
    });

  } catch (error: any) {
    logger.error('Error fetching conversion events:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_CONVERSIONS_ERROR',
        message: error.message || 'Failed to fetch conversion events'
      }
    });
  }
};

/**
 * Get referral link statistics for a marketer
 */
export const getMarketerStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const { marketerId } = req.params;

    const stats = await TrackingService.getMarketerReferralStats(marketerId);

    res.json({
      success: true,
      data: stats
    });

  } catch (error: any) {
    logger.error('Error fetching marketer stats:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_STATS_ERROR',
        message: error.message || 'Failed to fetch marketer statistics'
      }
    });
  }
};

/**
 * Handle referral link redirect and tracking
 */
export const handleReferralRedirect = async (req: Request, res: Response): Promise<void> => {
  try {
    const { trackingCode } = req.params;

    // Get referral link details
    const referralLink = await TrackingService.getReferralLinkByTrackingCode(trackingCode);

    if (!referralLink) {
      res.status(404).json({
        error: {
          code: 'LINK_NOT_FOUND',
          message: 'Referral link not found or expired'
        }
      });
      return;
    }

    // Track the click
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    const referrer = req.get('Referer');
    
    let sessionId = req.session?.id;
    if (!sessionId) {
      sessionId = req.get('X-Session-ID') || uuidv4();
    }

    const clickData = {
      trackingCode,
      ipAddress,
      userAgent,
      referrer,
      sessionId
    };

    await TrackingService.trackClick(clickData);

    // Set tracking cookies
    res.cookie('affiliate_tracking', trackingCode, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.cookie('affiliate_session', sessionId, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    // Redirect to product landing page
    const landingPageUrl = (referralLink.productId as any).landingPageUrl || 
                          process.env.DEFAULT_LANDING_PAGE || 
                          'http://localhost:3000';

    res.redirect(302, landingPageUrl);

  } catch (error: any) {
    logger.error('Error handling referral redirect:', error);
    res.status(500).json({
      error: {
        code: 'REDIRECT_ERROR',
        message: error.message || 'Failed to process referral link'
      }
    });
  }
};