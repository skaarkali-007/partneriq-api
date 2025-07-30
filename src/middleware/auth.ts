import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, extractTokenFromHeader, JWTPayload } from '../utils/jwt';
import { User, IUser } from '../models/User';
import { MFAService } from '../services/mfa';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: IUser;
  userId?: string;
}

export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token is required'
      });
    }

    const decoded: JWTPayload = verifyAccessToken(token);
    
    // Fetch user from database to ensure they still exist and are active
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: 'Account is not active'
      });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
};

export const requireRole = (roles: string | string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    next();
  };
};

export const requireEmailVerification = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  if (!req.user.emailVerified) {
    return res.status(403).json({
      success: false,
      error: 'Email verification required'
    });
  }

  next();
};

export const requireMFA = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  // Check if MFA is enabled for this user
  if (!req.user.mfaEnabled) {
    return res.status(403).json({
      success: false,
      error: 'MFA is required for this operation. Please set up MFA first.',
      mfaRequired: true,
      mfaSetupRequired: true
    });
  }

  // Check if MFA token is provided in headers
  const mfaToken = req.headers['x-mfa-token'] as string;
  
  if (!mfaToken) {
    return res.status(403).json({
      success: false,
      error: 'MFA token required for this operation',
      mfaRequired: true,
      mfaSetupRequired: false
    });
  }

  try {
    // Verify MFA token
    const verification = await MFAService.verifyMFAToken(req.user._id, mfaToken);
    
    if (!verification.isValid) {
      return res.status(403).json({
        success: false,
        error: 'Invalid MFA token',
        mfaRequired: true,
        mfaSetupRequired: false
      });
    }

    // MFA verified, proceed
    next();
  } catch (error) {
    logger.error('MFA verification error in middleware:', error);
    return res.status(403).json({
      success: false,
      error: 'MFA verification failed',
      mfaRequired: true,
      mfaSetupRequired: false
    });
  }
};

// Middleware that suggests MFA but doesn't enforce it
export const suggestMFA = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  // Add MFA suggestion to response headers if not enabled
  if (!req.user.mfaEnabled) {
    res.setHeader('X-MFA-Suggestion', 'MFA is recommended for enhanced security');
    res.setHeader('X-MFA-Setup-URL', '/mfa-setup');
  }

  next();
};