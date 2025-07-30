import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { AuditService } from '../services/audit';
import { logger } from '../utils/logger';
import { User } from '../models/User';

export interface AdminAuthenticatedRequest extends AuthenticatedRequest {
  adminSession?: {
    loginTime: Date;
    lastActivity: Date;
    sessionId: string;
  };
}

/**
 * Enhanced admin authentication middleware with additional security features
 */
export const adminAuthenticate = async (req: AdminAuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // First, ensure basic authentication
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Ensure user has admin role
    if (req.user.role !== 'admin') {
      // Log unauthorized access attempt
      await AuditService.logSystemAction(
        req.user._id,
        'unauthorized_admin_access_attempt',
        {
          attemptedResource: req.path,
          userRole: req.user.role,
          userEmail: req.user.email
        },
        req
      );

      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    // Check if admin account is active
    if (req.user.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Admin account is not active'
      });
    }

    // Add admin session tracking
    req.adminSession = {
      loginTime: new Date(),
      lastActivity: new Date(),
      sessionId: req.headers['x-session-id'] as string || 'unknown'
    };

    // Log admin access for high-privilege operations
    const sensitiveOperations = [
      '/users/bulk-action',
      '/users/:userId/status',
      '/products',
      '/commissions',
      '/payouts'
    ];

    const isSensitiveOperation = sensitiveOperations.some(pattern => 
      req.path.includes(pattern.replace(':userId', ''))
    );

    if (isSensitiveOperation && req.method !== 'GET') {
      // Temporarily disabled audit logging for development
      try {
        await AuditService.logSystemAction(
          req.user._id,
          'admin_sensitive_operation_access',
          {
            method: req.method,
            path: req.path,
            body: req.body,
            query: req.query
          },
          req
        );
      } catch (auditError) {
        // Log audit error but don't block the request
        logger.error('Audit logging failed:', auditError);
      }
    }

    next();
  } catch (error) {
    logger.error('Admin authentication error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication verification failed'
    });
  }
};

/**
 * Middleware to require additional MFA verification for critical admin operations
 */
export const requireAdminMFA = async (req: AdminAuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Check if MFA is enabled for this admin
    if (!req.user.mfaEnabled) {
      return res.status(403).json({
        success: false,
        error: 'MFA must be enabled for admin operations',
        requireMFASetup: true
      });
    }

    // Check for MFA token in headers
    const mfaToken = req.headers['x-admin-mfa-token'] as string;
    
    if (!mfaToken) {
      return res.status(403).json({
        success: false,
        error: 'MFA verification required for this operation',
        requireMFA: true
      });
    }

    // Verify MFA token using the MFA service
    const { MFAService } = await import('../services/mfa');
    const mfaResult = await MFAService.verifyMFAToken(req.user._id, mfaToken);
    
    if (!mfaResult.isValid) {
      await AuditService.logSystemAction(
        req.user._id,
        'admin_mfa_verification_failed',
        { operation: req.path },
        req
      );

      return res.status(403).json({
        success: false,
        error: 'Invalid MFA token',
        requireMFA: true
      });
    }

    // Log successful MFA verification
    await AuditService.logSystemAction(
      req.user._id,
      'admin_mfa_verified',
      { operation: req.path },
      req
    );

    next();
  } catch (error) {
    logger.error('Admin MFA verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'MFA verification failed'
    });
  }
};

/**
 * Rate limiting middleware for admin operations
 */
export const adminRateLimit = (maxRequests: number = 100, windowMs: number = 15 * 60 * 1000) => {
  const requestCounts = new Map<string, { count: number; resetTime: number }>();

  return async (req: AdminAuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next();
    }

    const key = `admin_${req.user._id}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    for (const [k, v] of requestCounts.entries()) {
      if (v.resetTime < windowStart) {
        requestCounts.delete(k);
      }
    }

    const current = requestCounts.get(key) || { count: 0, resetTime: now + windowMs };

    if (current.resetTime < now) {
      // Reset window
      current.count = 1;
      current.resetTime = now + windowMs;
    } else {
      current.count++;
    }

    requestCounts.set(key, current);

    if (current.count > maxRequests) {
      // Log rate limit exceeded
      await AuditService.logSystemAction(
        req.user._id,
        'admin_rate_limit_exceeded',
        {
          requestCount: current.count,
          maxRequests,
          windowMs,
          path: req.path
        },
        req
      );

      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((current.resetTime - now) / 1000)
      });
    }

    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests.toString(),
      'X-RateLimit-Remaining': (maxRequests - current.count).toString(),
      'X-RateLimit-Reset': new Date(current.resetTime).toISOString()
    });

    next();
  };
};

/**
 * Middleware to log admin session activity
 */
export const logAdminActivity = async (req: AdminAuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'admin') {
    return next();
  }

  // Log the admin activity after the request is processed
  const originalSend = res.send;
  res.send = function(data) {
    // Only log successful operations (2xx status codes)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // Don't await this to avoid blocking the response
      AuditService.logSystemAction(
        req.user!._id,
        'admin_activity',
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          timestamp: new Date()
        },
        req
      ).catch(error => {
        logger.error('Failed to log admin activity:', error);
      });
    }

    return originalSend.call(this, data);
  };

  next();
};