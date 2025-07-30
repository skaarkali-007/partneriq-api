import { Request, Response } from 'express';
import { TrackingService } from '../services/tracking';
import { Product } from '../models/Product';
import { ReferralLink } from '../models/ReferralLink';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Handle referral link clicks and redirect to landing page
 */
export const handleReferralClick = async (req: Request, res: Response) => {
  try {
    const { trackingCode } = req.params;
    
    if (!trackingCode) {
      return res.status(400).json({
        success: false,
        message: 'Tracking code is required'
      });
    }
    
    // Get referral link information
    const referralLink = await TrackingService.getReferralLinkByTrackingCode(trackingCode);
    
    if (!referralLink) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired referral link'
      });
    }
    
    // Check if referral link is active and not expired
    if (!referralLink.isActive || (referralLink.expiresAt && referralLink.expiresAt < new Date())) {
      return res.status(410).json({
        success: false,
        message: 'Referral link has expired'
      });
    }
    
    // Generate session ID for tracking
    const sessionId = uuidv4();
    
    // Track the click event
    const clickData = {
      trackingCode,
      ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      referrer: req.get('Referer'),
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
    
    // Get the product to include in onboarding parameters
    const product = await Product.findById(referralLink.productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Redirect to the onboarding page with tracking parameters
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const onboardingUrl = `${frontendUrl}/onboarding?trackingCode=${trackingCode}&productId=${product._id}&session=${sessionId}`;
    
    res.redirect(302, onboardingUrl);
    
  } catch (error) {
    logger.error('Error handling referral click:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get landing page data for frontend
 */
export const getLandingPageData = async (req: Request, res: Response) => {
  try {
    const { trackingCode } = req.params;
    
    if (!trackingCode) {
      return res.status(400).json({
        success: false,
        message: 'Tracking code is required'
      });
    }
    
    // Get referral link with populated data
    const referralLink = await ReferralLink.findOne({ trackingCode })
      .populate('marketerId', 'email firstName lastName')
      .populate('productId');
    
    if (!referralLink) {
      return res.status(404).json({
        success: false,
        message: 'Invalid tracking code'
      });
    }
    
    // Check if referral link is active
    if (!referralLink.isActive || (referralLink.expiresAt && referralLink.expiresAt < new Date())) {
      return res.status(410).json({
        success: false,
        message: 'Referral link has expired'
      });
    }
    
    const product = referralLink.productId as any;
    const marketer = referralLink.marketerId as any;
    
    res.json({
      success: true,
      data: {
        trackingCode,
        product: {
          id: product._id,
          name: product.name,
          description: product.description,
          category: product.category,
          landingPageUrl: product.landingPageUrl,
          commissionType: product.commissionType,
          commissionRate: product.commissionRate,
          commissionFlatAmount: product.commissionFlatAmount,
          minInitialSpend: product.minInitialSpend
        },
        marketer: {
          id: marketer._id,
          email: marketer.email,
          firstName: marketer.firstName,
          lastName: marketer.lastName
        },
        referralLink: {
          id: referralLink._id,
          createdAt: referralLink.createdAt,
          expiresAt: referralLink.expiresAt,
          clickCount: referralLink.clickCount,
          conversionCount: referralLink.conversionCount
        }
      }
    });
    
  } catch (error) {
    logger.error('Error getting landing page data:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get product information for landing page
 */
export const getProductInfo = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    
    const product = await Product.findById(productId);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    if (product.status !== 'active') {
      return res.status(410).json({
        success: false,
        message: 'Product is not currently available'
      });
    }
    
    res.json({
      success: true,
      data: {
        id: product._id,
        name: product.name,
        description: product.description,
        category: product.category,
        landingPageUrl: product.landingPageUrl,
        minInitialSpend: product.minInitialSpend,
        tags: product.tags,
        createdAt: product.createdAt
      }
    });
    
  } catch (error) {
    logger.error('Error getting product info:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Validate tracking code and get basic info
 */
export const validateTrackingCode = async (req: Request, res: Response) => {
  try {
    const { trackingCode } = req.params;
    
    if (!trackingCode) {
      return res.status(400).json({
        success: false,
        message: 'Tracking code is required'
      });
    }
    
    // Validate tracking code format
    if (!TrackingService.validateTrackingCode(trackingCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tracking code format'
      });
    }
    
    // Check if tracking code exists and is active
    const referralLink = await ReferralLink.findOne({ trackingCode });
    
    if (!referralLink) {
      return res.status(404).json({
        success: false,
        message: 'Tracking code not found'
      });
    }
    
    const isActive = referralLink.isActive && (!referralLink.expiresAt || referralLink.expiresAt > new Date());
    
    res.json({
      success: true,
      data: {
        trackingCode,
        isValid: true,
        isActive,
        expiresAt: referralLink.expiresAt,
        productId: referralLink.productId,
        marketerId: referralLink.marketerId
      }
    });
    
  } catch (error) {
    logger.error('Error validating tracking code:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};