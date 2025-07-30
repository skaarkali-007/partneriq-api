import { AuditLog, IAuditLog } from '../../models/AuditLog';
import { logger } from '../../utils/logger';
import { Request } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';

export interface AuditLogData {
  adminId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: {
    oldValue?: any;
    newValue?: any;
    reason?: string;
    metadata?: any;
    userIds?: string[];
    modifiedCount?: number;
    [key: string]: any; // Allow additional properties
  };
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  /**
   * Log an admin action for audit purposes
   */
  static async logAction(data: AuditLogData): Promise<IAuditLog> {
    try {
      const auditLog = new AuditLog({
        adminId: data.adminId,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        details: data.details || {},
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        timestamp: new Date()
      });

      await auditLog.save();
      
      // Also log to application logger for immediate visibility
      logger.info(`Admin action logged: ${data.action}`, {
        adminId: data.adminId,
        resource: data.resource,
        resourceId: data.resourceId,
        action: data.action
      });

      return auditLog;
    } catch (error) {
      logger.error('Failed to log audit action:', error);
      throw error;
    }
  }

  /**
   * Helper method to extract request metadata
   */
  static extractRequestMetadata(req: Request | AuthenticatedRequest) {
    return {
      ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown'
    };
  }

  /**
   * Log user management action
   */
  static async logUserAction(
    adminId: string,
    action: string,
    userId: string,
    oldValue?: any,
    newValue?: any,
    reason?: string,
    req?: Request | AuthenticatedRequest
  ): Promise<IAuditLog> {
    const metadata = req ? this.extractRequestMetadata(req) : {};
    
    return this.logAction({
      adminId,
      action,
      resource: 'user',
      resourceId: userId,
      details: {
        oldValue,
        newValue,
        reason
      },
      ...metadata
    });
  }

  /**
   * Log product management action
   */
  static async logProductAction(
    adminId: string,
    action: string,
    productId: string,
    oldValue?: any,
    newValue?: any,
    reason?: string,
    req?: Request | AuthenticatedRequest
  ): Promise<IAuditLog> {
    const metadata = req ? this.extractRequestMetadata(req) : {};
    
    return this.logAction({
      adminId,
      action,
      resource: 'product',
      resourceId: productId,
      details: {
        oldValue,
        newValue,
        reason
      },
      ...metadata
    });
  }

  /**
   * Log commission management action
   */
  static async logCommissionAction(
    adminId: string,
    action: string,
    commissionId: string,
    oldValue?: any,
    newValue?: any,
    reason?: string,
    req?: Request | AuthenticatedRequest
  ): Promise<IAuditLog> {
    const metadata = req ? this.extractRequestMetadata(req) : {};
    
    return this.logAction({
      adminId,
      action,
      resource: 'commission',
      resourceId: commissionId,
      details: {
        oldValue,
        newValue,
        reason
      },
      ...metadata
    });
  }

  /**
   * Log payout management action
   */
  static async logPayoutAction(
    adminId: string,
    action: string,
    payoutId: string,
    oldValue?: any,
    newValue?: any,
    reason?: string,
    req?: Request | AuthenticatedRequest
  ): Promise<IAuditLog> {
    const metadata = req ? this.extractRequestMetadata(req) : {};
    
    return this.logAction({
      adminId,
      action,
      resource: 'payout',
      resourceId: payoutId,
      details: {
        oldValue,
        newValue,
        reason
      },
      ...metadata
    });
  }

  /**
   * Log system action
   */
  static async logSystemAction(
    adminId: string,
    action: string,
    details?: any,
    req?: Request | AuthenticatedRequest
  ): Promise<IAuditLog> {
    const metadata = req ? this.extractRequestMetadata(req) : {};
    
    return this.logAction({
      adminId,
      action,
      resource: 'system',
      details: {
        metadata: details
      },
      ...metadata
    });
  }

  /**
   * Get audit logs with filtering and pagination
   */
  static async getAuditLogs(filters: {
    adminId?: string;
    action?: string;
    resource?: string;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }) {
    try {
      const {
        adminId,
        action,
        resource,
        resourceId,
        startDate,
        endDate,
        page = 1,
        limit = 50
      } = filters;

      const skip = (page - 1) * limit;
      
      // Build filter query
      const filter: any = {};
      if (adminId) filter.adminId = adminId;
      if (action) filter.action = action;
      if (resource) filter.resource = resource;
      if (resourceId) filter.resourceId = resourceId;
      
      if (startDate || endDate) {
        filter.timestamp = {};
        if (startDate) filter.timestamp.$gte = startDate;
        if (endDate) filter.timestamp.$lte = endDate;
      }

      const [logs, total] = await Promise.all([
        AuditLog.find(filter)
          .populate('adminId', 'email firstName lastName')
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(filter)
      ]);

      return {
        logs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Failed to fetch audit logs:', error);
      throw error;
    }
  }

  /**
   * Get audit statistics
   */
  static async getAuditStats(filters: {
    adminId?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    try {
      const { adminId, startDate, endDate } = filters;
      
      // Build filter query
      const matchFilter: any = {};
      if (adminId) matchFilter.adminId = adminId;
      
      if (startDate || endDate) {
        matchFilter.timestamp = {};
        if (startDate) matchFilter.timestamp.$gte = startDate;
        if (endDate) matchFilter.timestamp.$lte = endDate;
      }

      const stats = await AuditLog.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: {
              action: '$action',
              resource: '$resource'
            },
            count: { $sum: 1 },
            lastActivity: { $max: '$timestamp' }
          }
        },
        {
          $group: {
            _id: '$_id.resource',
            actions: {
              $push: {
                action: '$_id.action',
                count: '$count',
                lastActivity: '$lastActivity'
              }
            },
            totalActions: { $sum: '$count' }
          }
        },
        { $sort: { totalActions: -1 } }
      ]);

      return stats;
    } catch (error) {
      logger.error('Failed to fetch audit statistics:', error);
      throw error;
    }
  }
}