import { Request, Response } from 'express';
import { User, IUser } from '../models/User';
import { UserProfile } from '../models/UserProfile';
import { Commission } from '../models/Commission';
import { PayoutRequest } from '../models/PayoutRequest';
import { Product } from '../models/Product';
import { ProductMaterial } from '../models/ProductMaterial';
import { AuditLog } from '../models/AuditLog';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';
import { AuditService } from '../services/audit';
import Joi from 'joi';

// Validation schemas
const updateUserStatusSchema = Joi.object({
  status: Joi.string().valid('pending', 'active', 'suspended', 'revoked').required(),
  reason: Joi.string().optional()
});

const bulkUserActionSchema = Joi.object({
  userIds: Joi.array().items(Joi.string().required()).min(1).required(),
  action: Joi.string().valid('approve', 'suspend', 'revoke').required(),
  reason: Joi.string().optional()
});

export class AdminController {
  // User Management
  static async getAllUsers(req: AuthenticatedRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const role = req.query.role as string;
      const status = req.query.status as string;
      const search = req.query.search as string;

      const skip = (page - 1) * limit;
      
      // Build filter query
      const filter: any = {};
      if (role) filter.role = role;
      if (status) filter.status = status;
      if (search) {
        filter.$or = [
          { email: { $regex: search, $options: 'i' } },
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } }
        ];
      }

      const [users, total] = await Promise.all([
        User.find(filter)
          .select('-password -emailVerificationToken -passwordResetToken -mfaSecret -mfaBackupCodes')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(filter)
      ]);

      // Get user profiles for additional info
      const userIds = users.map(user => user._id);
      const profiles = await UserProfile.find({ userId: { $in: userIds } }).lean();
      const profileMap = new Map(profiles.map(p => [p.userId.toString(), p]));

      // Combine user data with profiles
      const usersWithProfiles = users.map(user => ({
        ...user,
        profile: profileMap.get(user._id.toString()) || null
      }));

      res.json({
        success: true,
        data: {
          users: usersWithProfiles,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error: any) {
      logger.error('Get all users error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch users'
      });
    }
  }

  static async getUserDetails(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;

      const user = await User.findById(userId)
        .select('-password -emailVerificationToken -passwordResetToken -mfaSecret -mfaBackupCodes')
        .lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Get user profile
      const profile = await UserProfile.findOne({ userId }).lean();

      // Get user statistics
      const [commissionStats, payoutStats] = await Promise.all([
        Commission.aggregate([
          { $match: { marketerId: userId } },
          {
            $group: {
              _id: null,
              totalCommissions: { $sum: '$commissionAmount' },
              pendingCommissions: {
                $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$commissionAmount', 0] }
              },
              approvedCommissions: {
                $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$commissionAmount', 0] }
              },
              paidCommissions: {
                $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$commissionAmount', 0] }
              },
              totalConversions: { $sum: 1 }
            }
          }
        ]),
        PayoutRequest.aggregate([
          { $match: { marketerId: userId } },
          {
            $group: {
              _id: null,
              totalPayouts: { $sum: '$amount' },
              completedPayouts: {
                $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] }
              },
              pendingPayouts: {
                $sum: { $cond: [{ $in: ['$status', ['requested', 'approved', 'processing']] }, '$amount', 0] }
              },
              totalRequests: { $sum: 1 }
            }
          }
        ])
      ]);

      res.json({
        success: true,
        data: {
          user,
          profile,
          stats: {
            commissions: commissionStats[0] || {
              totalCommissions: 0,
              pendingCommissions: 0,
              approvedCommissions: 0,
              paidCommissions: 0,
              totalConversions: 0
            },
            payouts: payoutStats[0] || {
              totalPayouts: 0,
              completedPayouts: 0,
              pendingPayouts: 0,
              totalRequests: 0
            }
          }
        }
      });
    } catch (error: any) {
      logger.error('Get user details error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user details'
      });
    }
  }

  static async updateUserStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;
      const { error, value } = updateUserStatusSchema.validate(req.body);
      
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const oldStatus = user.status;
      user.status = value.status;
      await user.save();

      // Log admin activity using audit service
      await AuditService.logUserAction(
        req.user!._id,
        'user_status_changed',
        userId,
        { status: oldStatus },
        { status: value.status },
        value.reason,
        req
      );

      res.json({
        success: true,
        message: 'User status updated successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            status: user.status
          }
        }
      });
    } catch (error: any) {
      logger.error('Update user status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update user status'
      });
    }
  }

  static async bulkUserAction(req: AuthenticatedRequest, res: Response) {
    try {
      const { error, value } = bulkUserActionSchema.validate(req.body);
      
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      const { userIds, action, reason } = value;
      
      // Map actions to status
      const statusMap: { [key: string]: string } = {
        approve: 'active',
        suspend: 'suspended',
        revoke: 'revoked'
      };

      const newStatus = statusMap[action];
      
      const result = await User.updateMany(
        { _id: { $in: userIds } },
        { status: newStatus }
      );

      // Log admin activity using audit service
      await AuditService.logAction({
        adminId: req.user!._id,
        action: 'user_bulk_action',
        resource: 'user',
        details: {
          userIds,
          action,
          newStatus,
          reason,
          modifiedCount: result.modifiedCount
        },
        ...AuditService.extractRequestMetadata(req)
      });

      res.json({
        success: true,
        message: `Successfully ${action}d ${result.modifiedCount} users`,
        data: {
          modifiedCount: result.modifiedCount
        }
      });
    } catch (error: any) {
      logger.error('Bulk user action error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to perform bulk action'
      });
    }
  }

  // Dashboard Analytics
  static async getDashboardStats(req: AuthenticatedRequest, res: Response) {
    try {
      const [
        userStats,
        commissionStats,
        payoutStats,
        productStats
      ] = await Promise.all([
        // User statistics
        User.aggregate([
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ]),
        // Commission statistics
        Commission.aggregate([
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalAmount: { $sum: '$commissionAmount' }
            }
          }
        ]),
        // Payout statistics
        PayoutRequest.aggregate([
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalAmount: { $sum: '$amount' }
            }
          }
        ]),
        // Product statistics
        Product.aggregate([
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ])
      ]);

      // Format statistics
      const formatStats = (stats: any[], defaultKeys: string[]) => {
        const result: { [key: string]: number } = {};
        defaultKeys.forEach(key => result[key] = 0);
        stats.forEach(stat => result[stat._id] = stat.count);
        return result;
      };

      const formatAmountStats = (stats: any[], defaultKeys: string[]) => {
        const result: { [key: string]: { count: number; amount: number } } = {};
        defaultKeys.forEach(key => result[key] = { count: 0, amount: 0 });
        stats.forEach(stat => result[stat._id] = { count: stat.count, amount: stat.totalAmount || 0 });
        return result;
      };

      res.json({
        success: true,
        data: {
          users: formatStats(userStats, ['pending', 'active', 'suspended', 'revoked']),
          commissions: formatAmountStats(commissionStats, ['pending', 'approved', 'paid', 'clawed_back']),
          payouts: formatAmountStats(payoutStats, ['requested', 'approved', 'processing', 'completed', 'failed']),
          products: formatStats(productStats, ['active', 'inactive'])
        }
      });
    } catch (error: any) {
      logger.error('Get dashboard stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard statistics'
      });
    }
  }

  // Activity Logs
  static async getActivityLogs(req: AuthenticatedRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const adminId = req.query.adminId as string;
      const action = req.query.action as string;
      const resource = req.query.resource as string;
      const resourceId = req.query.resourceId as string;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const result = await AuditService.getAuditLogs({
        adminId,
        action,
        resource,
        resourceId,
        startDate,
        endDate,
        page,
        limit
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      logger.error('Get activity logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch activity logs'
      });
    }
  }

  // Audit Statistics
  static async getAuditStats(req: AuthenticatedRequest, res: Response) {
    try {
      const adminId = req.query.adminId as string;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const stats = await AuditService.getAuditStats({
        adminId,
        startDate,
        endDate
      });

      res.json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      logger.error('Get audit stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch audit statistics'
      });
    }
  }

  // KYC Management
  static async getKYCDocuments(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;

      const profile = await UserProfile.findOne({ userId })
        .populate('userId', 'email firstName lastName')
        .populate('kycReviewedBy', 'email firstName lastName');

      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'User profile not found'
        });
      }

      res.json({
        success: true,
        data: {
          profile: {
            id: profile._id,
            userId: profile.userId,
            kycStatus: profile.kycStatus,
            kycSubmittedAt: profile.kycSubmittedAt,
            kycApprovedAt: profile.kycApprovedAt,
            kycRejectedAt: profile.kycRejectedAt,
            kycRejectionReason: profile.kycRejectionReason,
            kycReviewedBy: profile.kycReviewedBy,
            complianceQuizScore: profile.complianceQuizScore,
            complianceQuizPassed: profile.complianceQuizPassed,
            documents: profile.kycDocuments.map(doc => ({
              id: doc._id,
              type: doc.type,
              filename: doc.filename,
              originalName: doc.originalName,
              mimeType: doc.mimeType,
              size: doc.size,
              uploadedAt: doc.uploadedAt,
              status: doc.status,
              rejectionReason: doc.rejectionReason,
              reviewedBy: doc.reviewedBy,
              reviewedAt: doc.reviewedAt
            }))
          }
        }
      });
    } catch (error: any) {
      logger.error('Get KYC documents error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch KYC documents'
      });
    }
  }

  static async updateKYCStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;
      const { status, reason } = req.body;

      if (!['pending', 'in_review', 'approved', 'rejected', 'requires_resubmission'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid KYC status'
        });
      }

      const profile = await UserProfile.findOne({ userId });
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'User profile not found'
        });
      }

      const oldStatus = profile.kycStatus;
      profile.updateKYCStatus(status, req.user!._id, reason);
      await profile.save();

      // Log the KYC status change
      await AuditService.logUserAction(
        req.user!._id,
        'kyc_status_changed',
        userId,
        { kycStatus: oldStatus },
        { kycStatus: status },
        reason,
        req
      );

      res.json({
        success: true,
        message: 'KYC status updated successfully',
        data: {
          kycStatus: profile.kycStatus,
          kycApprovedAt: profile.kycApprovedAt,
          kycRejectedAt: profile.kycRejectedAt,
          kycRejectionReason: profile.kycRejectionReason
        }
      });
    } catch (error: any) {
      logger.error('Update KYC status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update KYC status'
      });
    }
  }

  static async reviewKYCDocument(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, documentId } = req.params;
      const { status, rejectionReason } = req.body;

      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid document status'
        });
      }

      const profile = await UserProfile.findOne({ userId });
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'User profile not found'
        });
      }

      const document = profile.kycDocuments.find(doc => doc._id?.toString() === documentId);
      if (!document) {
        return res.status(404).json({
          success: false,
          error: 'Document not found'
        });
      }

      const oldStatus = document.status;
      document.status = status;
      document.reviewedBy = req.user!._id;
      document.reviewedAt = new Date();
      
      if (status === 'rejected' && rejectionReason) {
        document.rejectionReason = rejectionReason;
      }

      await profile.save();

      // Log the document review
      await AuditService.logUserAction(
        req.user!._id,
        'kyc_document_reviewed',
        userId,
        { documentStatus: oldStatus },
        { documentStatus: status },
        rejectionReason,
        req
      );

      res.json({
        success: true,
        message: 'Document reviewed successfully',
        data: {
          document: {
            id: document._id,
            status: document.status,
            reviewedBy: document.reviewedBy,
            reviewedAt: document.reviewedAt,
            rejectionReason: document.rejectionReason
          }
        }
      });
    } catch (error: any) {
      logger.error('Review KYC document error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to review document'
      });
    }
  }

  static async downloadKYCDocument(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, documentId } = req.params;

      const profile = await UserProfile.findOne({ userId })
        .select('+kycDocuments.encryptionKey');

      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'User profile not found'
        });
      }

      const document = profile.kycDocuments.find(doc => doc._id?.toString() === documentId);
      if (!document) {
        return res.status(404).json({
          success: false,
          error: 'Document not found'
        });
      }

      // Log document access
      await AuditService.logUserAction(
        req.user!._id,
        'kyc_document_accessed',
        userId,
        undefined,
        { documentId, documentType: document.type },
        'Document downloaded for review',
        req
      );

      // In a real implementation, you would decrypt and serve the file
      // For now, we'll return the document metadata
      res.json({
        success: true,
        data: {
          document: {
            id: document._id,
            type: document.type,
            filename: document.filename,
            originalName: document.originalName,
            mimeType: document.mimeType,
            size: document.size,
            uploadedAt: document.uploadedAt
          }
        },
        message: 'Document access logged. In production, this would serve the decrypted file.'
      });
    } catch (error: any) {
      logger.error('Download KYC document error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to download document'
      });
    }
  }

  // Product Management
  static async getAllProductsAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const category = req.query.category as string;
      const status = req.query.status as string;
      const search = req.query.search as string;
      const sortBy = req.query.sortBy as string || 'createdAt';
      const sortOrder = req.query.sortOrder as string || 'desc';

      const skip = (page - 1) * limit;
      
      // Build filter query
      const filter: any = {};
      if (category) filter.category = category;
      if (status) filter.status = status;
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { category: { $regex: search, $options: 'i' } }
        ];
      }

      const sortOptions: any = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const [products, total] = await Promise.all([
        Product.find(filter)
          .sort(sortOptions)
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.countDocuments(filter)
      ]);

      // Get material counts for each product
      const productIds = products.map(p => p._id);
      const materialCounts = await ProductMaterial.aggregate([
        { $match: { productId: { $in: productIds } } },
        { $group: { _id: '$productId', count: { $sum: 1 } } }
      ]);

      const materialCountMap = new Map(materialCounts.map(m => [m._id.toString(), m.count]));

      const productsWithStats = products.map(product => ({
        ...product,
        materialCount: materialCountMap.get(product._id.toString()) || 0
      }));

      res.json({
        success: true,
        data: {
          products: productsWithStats,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error: any) {
      logger.error('Get all products admin error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch products'
      });
    }
  }

  static async createProductAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      const productData = req.body;

      // Validate required fields
      if (!productData.name || !productData.description || !productData.category) {
        return res.status(400).json({
          success: false,
          error: 'Name, description, and category are required'
        });
      }

      const product = new Product(productData);
      await product.save();

      // Log product creation
      await AuditService.logProductAction(
        req.user!._id,
        'product_created',
        product._id,
        undefined,
        product.toObject(),
        'Product created via admin panel',
        req
      );

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: { product }
      });
    } catch (error: any) {
      logger.error('Create product admin error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create product'
      });
    }
  }

  static async updateProductAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      const { productId } = req.params;
      const updateData = req.body;

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      const oldProduct = product.toObject();
      Object.assign(product, updateData);
      await product.save();

      // Log product update
      await AuditService.logProductAction(
        req.user!._id,
        'product_updated',
        productId,
        oldProduct,
        product.toObject(),
        'Product updated via admin panel',
        req
      );

      res.json({
        success: true,
        message: 'Product updated successfully',
        data: { product }
      });
    } catch (error: any) {
      logger.error('Update product admin error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update product'
      });
    }
  }

  static async deleteProductAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      const { productId } = req.params;

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      // Check if product has associated materials
      const materialCount = await ProductMaterial.countDocuments({ productId });
      if (materialCount > 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete product with associated materials. Delete materials first.'
        });
      }

      await Product.findByIdAndDelete(productId);

      // Log product deletion
      await AuditService.logProductAction(
        req.user!._id,
        'product_deleted',
        productId,
        product.toObject(),
        undefined,
        'Product deleted via admin panel',
        req
      );

      res.json({
        success: true,
        message: 'Product deleted successfully'
      });
    } catch (error: any) {
      logger.error('Delete product admin error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete product'
      });
    }
  }

  static async getProductPerformance(req: AuthenticatedRequest, res: Response) {
    try {
      const { productId } = req.params;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

      // Get commission statistics for the product
      const commissionStats = await Commission.aggregate([
        {
          $match: {
            productId,
            conversionDate: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: null,
            totalCommissions: { $sum: '$commissionAmount' },
            totalConversions: { $sum: 1 },
            avgCommissionAmount: { $avg: '$commissionAmount' },
            statusBreakdown: {
              $push: {
                status: '$status',
                amount: '$commissionAmount'
              }
            }
          }
        }
      ]);

      // Get conversion trends by day
      const conversionTrends = await Commission.aggregate([
        {
          $match: {
            productId,
            conversionDate: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$conversionDate' }
            },
            conversions: { $sum: 1 },
            totalAmount: { $sum: '$commissionAmount' }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      // Get top performing marketers for this product
      const topMarketers = await Commission.aggregate([
        {
          $match: {
            productId,
            conversionDate: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$marketerId',
            totalCommissions: { $sum: '$commissionAmount' },
            totalConversions: { $sum: 1 }
          }
        },
        { $sort: { totalCommissions: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'marketer'
          }
        },
        { $unwind: '$marketer' }
      ]);

      res.json({
        success: true,
        data: {
          stats: commissionStats[0] || {
            totalCommissions: 0,
            totalConversions: 0,
            avgCommissionAmount: 0,
            statusBreakdown: []
          },
          trends: conversionTrends,
          topMarketers: topMarketers.map(m => ({
            marketerId: m._id,
            marketerName: `${m.marketer.firstName} ${m.marketer.lastName}`,
            marketerEmail: m.marketer.email,
            totalCommissions: m.totalCommissions,
            totalConversions: m.totalConversions
          }))
        }
      });
    } catch (error: any) {
      logger.error('Get product performance error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch product performance'
      });
    }
  }

  // Commission Management
  static async getAllCommissionsAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string;
      const marketerId = req.query.marketerId as string;
      const productId = req.query.productId as string;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const skip = (page - 1) * limit;
      
      // Build filter query
      const filter: any = {};
      if (status) filter.status = status;
      if (marketerId) filter.marketerId = marketerId;
      if (productId) filter.productId = productId;
      if (startDate || endDate) {
        filter.conversionDate = {};
        if (startDate) filter.conversionDate.$gte = startDate;
        if (endDate) filter.conversionDate.$lte = endDate;
      }

      const [commissions, total] = await Promise.all([
        Commission.find(filter)
          .populate('marketerId', 'email firstName lastName')
          .populate('productId', 'name category')
          .sort({ conversionDate: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Commission.countDocuments(filter)
      ]);

      res.json({
        success: true,
        data: {
          commissions,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error: any) {
      logger.error('Get all commissions admin error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch commissions'
      });
    }
  }

  static async updateCommissionStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const { commissionId } = req.params;
      const { status, reason } = req.body;

      if (!['pending', 'approved', 'paid', 'clawed_back'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid commission status'
        });
      }

      const commission = await Commission.findById(commissionId);
      if (!commission) {
        return res.status(404).json({
          success: false,
          error: 'Commission not found'
        });
      }

      const oldStatus = commission.status;
      commission.status = status;
      
      if (status === 'approved') {
        commission.approvalDate = new Date();
      }

      await commission.save();

      // Log commission status change
      await AuditService.logCommissionAction(
        req.user!._id,
        'commission_status_changed',
        commissionId,
        { status: oldStatus },
        { status },
        reason,
        req
      );

      res.json({
        success: true,
        message: 'Commission status updated successfully',
        data: { commission }
      });
    } catch (error: any) {
      logger.error('Update commission status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update commission status'
      });
    }
  }

  static async bulkUpdateCommissions(req: AuthenticatedRequest, res: Response) {
    try {
      const { commissionIds, status, reason } = req.body;

      if (!Array.isArray(commissionIds) || commissionIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Commission IDs array is required'
        });
      }

      if (!['pending', 'approved', 'paid', 'clawed_back'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid commission status'
        });
      }

      const updateData: any = { status };
      if (status === 'approved') {
        updateData.approvalDate = new Date();
      }

      const result = await Commission.updateMany(
        { _id: { $in: commissionIds } },
        updateData
      );

      // Log bulk commission update
      await AuditService.logAction({
        adminId: req.user!._id,
        action: 'commission_bulk_update',
        resource: 'commission',
        details: {
          commissionIds,
          newStatus: status,
          reason,
          modifiedCount: result.modifiedCount
        },
        ...AuditService.extractRequestMetadata(req)
      });

      res.json({
        success: true,
        message: `Successfully updated ${result.modifiedCount} commissions`,
        data: {
          modifiedCount: result.modifiedCount
        }
      });
    } catch (error: any) {
      logger.error('Bulk update commissions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update commissions'
      });
    }
  }

  // Payout Management
  static async getAllPayoutsAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string;
      const marketerId = req.query.marketerId as string;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const skip = (page - 1) * limit;
      
      // Build filter query
      const filter: any = {};
      if (status) filter.status = status;
      if (marketerId) filter.marketerId = marketerId;
      if (startDate || endDate) {
        filter.requestedAt = {};
        if (startDate) filter.requestedAt.$gte = startDate;
        if (endDate) filter.requestedAt.$lte = endDate;
      }

      const [payouts, total] = await Promise.all([
        PayoutRequest.find(filter)
          .populate('marketerId', 'email firstName lastName')
          .populate('paymentMethodId', 'methodType')
          .populate('adminId', 'email firstName lastName')
          .sort({ requestedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        PayoutRequest.countDocuments(filter)
      ]);

      res.json({
        success: true,
        data: {
          payouts,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error: any) {
      logger.error('Get all payouts admin error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch payouts'
      });
    }
  }

  static async updatePayoutStatusAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      const { payoutId } = req.params;
      const { status, reason, transactionId } = req.body;

      if (!['requested', 'approved', 'processing', 'completed', 'failed', 'cancelled'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid payout status'
        });
      }

      const payout = await PayoutRequest.findById(payoutId);
      if (!payout) {
        return res.status(404).json({
          success: false,
          error: 'Payout request not found'
        });
      }

      const oldStatus = payout.status;
      payout.status = status;
      payout.adminId = req.user!._id;
      
      if (status === 'approved') {
        payout.approvedAt = new Date();
      } else if (status === 'completed') {
        payout.completedAt = new Date();
        if (transactionId) payout.transactionId = transactionId;
      } else if (status === 'failed') {
        payout.failureReason = reason;
      }

      if (reason) payout.notes = reason;

      await payout.save();

      // Update commission status if payout is completed
      if (status === 'completed') {
        await Commission.updateMany(
          {
            marketerId: payout.marketerId,
            status: 'approved'
          },
          {
            $set: { status: 'paid' }
          }
        );
      }

      // Log payout status change
      await AuditService.logPayoutAction(
        req.user!._id,
        'payout_status_changed',
        payoutId,
        { status: oldStatus },
        { status },
        reason,
        req
      );

      res.json({
        success: true,
        message: 'Payout status updated successfully',
        data: { payout }
      });
    } catch (error: any) {
      logger.error('Update payout status admin error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update payout status'
      });
    }
  }

  static async bulkProcessPayoutsAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      const { payoutIds, action, reason } = req.body;

      if (!Array.isArray(payoutIds) || payoutIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Payout IDs array is required'
        });
      }

      if (!['approve', 'complete', 'reject'].includes(action)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid action'
        });
      }

      const statusMap: { [key: string]: string } = {
        approve: 'approved',
        complete: 'completed',
        reject: 'failed'
      };

      const newStatus = statusMap[action];
      const updateData: any = { 
        status: newStatus,
        adminId: req.user!._id
      };

      if (newStatus === 'approved') {
        updateData.approvedAt = new Date();
      } else if (newStatus === 'completed') {
        updateData.completedAt = new Date();
      } else if (newStatus === 'failed') {
        updateData.failureReason = reason;
      }

      if (reason) updateData.notes = reason;

      const result = await PayoutRequest.updateMany(
        { _id: { $in: payoutIds } },
        updateData
      );

      // Update commission status for completed payouts
      if (newStatus === 'completed') {
        const completedPayouts = await PayoutRequest.find({ _id: { $in: payoutIds } });
        for (const payout of completedPayouts) {
          await Commission.updateMany(
            {
              marketerId: payout.marketerId,
              status: 'approved'
            },
            {
              $set: { status: 'paid' }
            }
          );
        }
      }

      // Log bulk payout action
      await AuditService.logAction({
        adminId: req.user!._id,
        action: 'payout_bulk_action',
        resource: 'payout',
        details: {
          payoutIds,
          action,
          newStatus,
          reason,
          modifiedCount: result.modifiedCount
        },
        ...AuditService.extractRequestMetadata(req)
      });

      res.json({
        success: true,
        message: `Successfully ${action}d ${result.modifiedCount} payouts`,
        data: {
          modifiedCount: result.modifiedCount
        }
      });
    } catch (error: any) {
      logger.error('Bulk process payouts admin error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process payouts'
      });
    }
  }

  static async getPayoutStats(req: AuthenticatedRequest, res: Response) {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

      // Get payout statistics
      const payoutStats = await PayoutRequest.aggregate([
        {
          $match: {
            requestedAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
            avgAmount: { $avg: '$amount' }
          }
        }
      ]);

      // Get processing time statistics
      const processingTimes = await PayoutRequest.aggregate([
        {
          $match: {
            status: 'completed',
            requestedAt: { $gte: startDate, $lte: endDate },
            completedAt: { $exists: true }
          }
        },
        {
          $project: {
            processingTimeHours: {
              $divide: [
                { $subtract: ['$completedAt', '$requestedAt'] },
                1000 * 60 * 60
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            avgProcessingTime: { $avg: '$processingTimeHours' },
            minProcessingTime: { $min: '$processingTimeHours' },
            maxProcessingTime: { $max: '$processingTimeHours' }
          }
        }
      ]);

      // Get daily payout trends
      const dailyTrends = await PayoutRequest.aggregate([
        {
          $match: {
            requestedAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$requestedAt' }
            },
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      res.json({
        success: true,
        data: {
          statusBreakdown: payoutStats,
          processingTimes: processingTimes[0] || {
            avgProcessingTime: 0,
            minProcessingTime: 0,
            maxProcessingTime: 0
          },
          dailyTrends
        }
      });
    } catch (error: any) {
      logger.error('Get payout stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch payout statistics'
      });
    }
  }

  static async exportPayoutReport(req: AuthenticatedRequest, res: Response) {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
      const status = req.query.status as string;

      const filter: any = {
        requestedAt: { $gte: startDate, $lte: endDate }
      };
      if (status) filter.status = status;

      const payouts = await PayoutRequest.find(filter)
        .populate('marketerId', 'email firstName lastName')
        .populate('paymentMethodId', 'methodType')
        .populate('adminId', 'email firstName lastName')
        .sort({ requestedAt: -1 })
        .lean();

      // Log the export action
      await AuditService.logSystemAction(
        req.user!._id,
        'data_export',
        {
          exportType: 'payout_report',
          filters: { startDate, endDate, status },
          recordCount: payouts.length
        },
        req
      );

      // Convert to CSV format
      const csvHeaders = [
        'Payout ID',
        'Marketer Email',
        'Marketer Name',
        'Amount',
        'Status',
        'Payment Method',
        'Requested Date',
        'Approved Date',
        'Completed Date',
        'Transaction ID',
        'Admin Email',
        'Notes'
      ];

      const csvRows = payouts.map(payout => {
        const marketer = typeof payout.marketerId === 'object' && payout.marketerId !== null ? payout.marketerId as any : null;
        const paymentMethod = typeof payout.paymentMethodId === 'object' && payout.paymentMethodId !== null ? payout.paymentMethodId as any : null;
        const admin = typeof payout.adminId === 'object' && payout.adminId !== null ? payout.adminId as any : null;
        
        return [
          payout._id.toString(),
          marketer?.email || 'Unknown',
          `${marketer?.firstName || ''} ${marketer?.lastName || ''}`.trim() || 'Unknown',
          payout.amount.toString(),
          payout.status,
          paymentMethod?.methodType || 'Unknown',
          new Date(payout.requestedAt).toISOString(),
          payout.approvedAt ? new Date(payout.approvedAt).toISOString() : '',
          payout.completedAt ? new Date(payout.completedAt).toISOString() : '',
          payout.transactionId || '',
          admin?.email || '',
          payout.notes || ''
        ];
      });

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="payout-report-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvContent);
    } catch (error: any) {
      logger.error('Export payout report error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export payout report'
      });
    }
  }

  // Export Activity Logs
  static async exportActivityLogs(req: AuthenticatedRequest, res: Response) {
    try {
      const adminId = req.query.adminId as string;
      const action = req.query.action as string;
      const resource = req.query.resource as string;
      const resourceId = req.query.resourceId as string;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const result = await AuditService.getAuditLogs({
        adminId,
        action,
        resource,
        resourceId,
        startDate,
        endDate,
        page: 1,
        limit: 10000 // Export all matching records
      });

      // Log the export action
      await AuditService.logSystemAction(
        req.user!._id,
        'data_export',
        {
          exportType: 'activity_logs',
          filters: { adminId, action, resource, resourceId, startDate, endDate },
          recordCount: result.logs.length
        },
        req
      );

      // Convert to CSV format
      const csvHeaders = [
        'Timestamp',
        'Admin Email',
        'Admin Name',
        'Action',
        'Resource',
        'Resource ID',
        'Reason',
        'IP Address',
        'User Agent'
      ];

      const csvRows = result.logs.map(log => {
        const adminInfo = typeof log.adminId === 'object' && log.adminId !== null ? 
          log.adminId as any : null;
        return [
          new Date(log.timestamp).toISOString(),
          adminInfo?.email || 'Unknown',
          `${adminInfo?.firstName || ''} ${adminInfo?.lastName || ''}`.trim() || 'Unknown',
          log.action,
          log.resource,
          log.resourceId || '',
          log.details?.reason || '',
          log.ipAddress || '',
          log.userAgent || ''
        ];
      });

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="activity-logs-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvContent);
    } catch (error: any) {
      logger.error('Export activity logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export activity logs'
      });
    }
  }
}