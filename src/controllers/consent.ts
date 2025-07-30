import { Request, Response } from 'express';
import { ConsentService, ConsentData } from '../services/consent';
import { logger } from '../utils/logger';

import { AuthenticatedRequest } from '../middleware/auth';

/**
 * Record user consent (can be used by authenticated or anonymous users)
 */
export const recordConsent = async (req: Request, res: Response) => {
  try {
    const { consentTypes, dataProcessingPurposes, consentMethod = 'api' } = req.body;
    
    // Validate required fields
    if (!consentTypes || !dataProcessingPurposes) {
      return res.status(400).json({
        success: false,
        message: 'Consent types and data processing purposes are required'
      });
    }

    // Validate consent types structure
    const requiredConsentTypes = ['necessary', 'analytics', 'marketing', 'preferences'];
    for (const type of requiredConsentTypes) {
      if (typeof consentTypes[type] !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: `Invalid consent type: ${type} must be boolean`
        });
      }
    }

    const { ipAddress, userAgent } = ConsentService.extractRequestInfo(req);
    const authReq = req as AuthenticatedRequest;
    
    let sessionId = req.session.id;
    if (!sessionId) {
      sessionId = ConsentService.generateSessionId();
      req.session.id = sessionId;
    }

    const consent = await ConsentService.recordConsent({
      userId: authReq.user?.id,
      sessionId: authReq.user ? undefined : sessionId,
      ipAddress,
      userAgent,
      consentTypes,
      consentMethod,
      dataProcessingPurposes
    });

    res.status(201).json({
      success: true,
      message: 'Consent recorded successfully',
      data: consent
    });
  } catch (error) {
    logger.error('Error in recordConsent:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record consent'
    });
  }
};

/**
 * Get current consent status
 */
export const getCurrentConsent = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const sessionId = req.session.id;

    const consent = await ConsentService.getCurrentConsent(authReq.user?.id, sessionId);

    if (!consent) {
      return res.status(404).json({
        success: false,
        message: 'No consent record found'
      });
    }

    res.json({
      success: true,
      data: consent
    });
  } catch (error) {
    logger.error('Error in getCurrentConsent:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get consent'
    });
  }
};

/**
 * Withdraw consent (requires authentication)
 */
export const withdrawConsent = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { reason } = req.body;

    await ConsentService.withdrawConsent(authReq.user.id, reason);

    res.json({
      success: true,
      message: 'Consent withdrawn successfully'
    });
  } catch (error) {
    logger.error('Error in withdrawConsent:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to withdraw consent'
    });
  }
};

/**
 * Get consent history (requires authentication)
 */
export const getConsentHistory = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const history = await ConsentService.getConsentHistory(authReq.user.id);

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    logger.error('Error in getConsentHistory:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get consent history'
    });
  }
};

/**
 * Create data access request (requires authentication)
 */
export const createDataAccessRequest = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { requestType, requestDetails, requestedData } = req.body;

    if (!requestType || !requestDetails) {
      return res.status(400).json({
        success: false,
        message: 'Request type and details are required'
      });
    }

    const validRequestTypes = ['access', 'rectification', 'erasure', 'portability', 'restriction', 'objection'];
    if (!validRequestTypes.includes(requestType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request type'
      });
    }

    const request = await ConsentService.createDataAccessRequest(
      authReq.user.id,
      requestType,
      requestDetails,
      requestedData
    );

    res.status(201).json({
      success: true,
      message: 'Data access request created successfully. Please check your email to verify the request.',
      data: request
    });
  } catch (error) {
    logger.error('Error in createDataAccessRequest:', error);
    
    if (error instanceof Error && error.message.includes('already have a pending')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create data access request'
    });
  }
};

/**
 * Verify data access request
 */
export const verifyDataAccessRequest = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    const request = await ConsentService.verifyDataAccessRequest(token);

    res.json({
      success: true,
      message: 'Data access request verified successfully',
      data: request
    });
  } catch (error) {
    logger.error('Error in verifyDataAccessRequest:', error);
    
    if (error instanceof Error && error.message.includes('Invalid or expired')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to verify data access request'
    });
  }
};

/**
 * Get data access requests (requires authentication)
 */
export const getDataAccessRequests = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const requests = await ConsentService.getDataAccessRequests(authReq.user.id);

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    logger.error('Error in getDataAccessRequests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get data access requests'
    });
  }
};

/**
 * Check consent for specific purpose (utility endpoint)
 */
export const checkConsentForPurpose = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { purpose } = req.params;

    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const validPurposes = ['necessary', 'analytics', 'marketing', 'preferences'];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid consent purpose'
      });
    }

    const hasConsent = await ConsentService.hasConsentForPurpose(
      authReq.user.id, 
      purpose as keyof ConsentData
    );

    res.json({
      success: true,
      data: {
        purpose,
        hasConsent
      }
    });
  } catch (error) {
    logger.error('Error in checkConsentForPurpose:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check consent'
    });
  }
};