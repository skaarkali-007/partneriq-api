import { Commission, ICommission } from '../../models/Commission';
import { CommissionAdjustment, ICommissionAdjustment } from '../../models/CommissionAdjustment';
import { Product, IProduct } from '../../models/Product';
import { User } from '../../models/User';
import mongoose from 'mongoose';

export interface CommissionCalculationData {
  marketerId: string;
  customerId: string;
  productId: string;
  trackingCode: string;
  initialSpendAmount: number;
  conversionDate: Date;
  clearancePeriodDays?: number;
  // Additional fields for enhanced calculation
  customCommissionRate?: number;
  customCommissionAmount?: number;
  overrideProductRules?: boolean;
}

export interface CommissionSummary {
  totalEarned: number;
  pendingAmount: number;
  approvedAmount: number;
  paidAmount: number;
  clawedBackAmount: number;
  totalCommissions: number;
}

export interface CommissionFilters {
  marketerId?: string;
  productId?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
}

export interface CommissionRules {
  commissionType: 'percentage' | 'flat';
  commissionRate?: number;
  commissionFlatAmount?: number;
  minInitialSpend: number;
  tieredRates?: TieredCommissionRate[];
}

export interface TieredCommissionRate {
  minAmount: number;
  maxAmount?: number;
  rate: number;
}

export class CommissionService {
  /**
   * Calculate commission amount based on rules and spend amount
   */
  static calculateCommissionAmount(
    initialSpendAmount: number, 
    rules: CommissionRules,
    customRate?: number,
    customAmount?: number,
    overrideRules?: boolean
  ): { commissionAmount: number; commissionRate: number } {
    // If custom override is provided, use that instead of product rules
    if (overrideRules && (customRate !== undefined || customAmount !== undefined)) {
      if (customAmount !== undefined) {
        return {
          commissionAmount: customAmount,
          commissionRate: customAmount / initialSpendAmount // For tracking purposes
        };
      } else if (customRate !== undefined) {
        return {
          commissionRate: customRate,
          commissionAmount: initialSpendAmount * customRate
        };
      }
    }

    // Check for tiered rates first
    if (rules.tieredRates && rules.tieredRates.length > 0) {
      // Sort tiers by minAmount to ensure proper evaluation
      const sortedTiers = [...rules.tieredRates].sort((a, b) => a.minAmount - b.minAmount);
      
      // Find the applicable tier
      const applicableTier = sortedTiers.find(tier => 
        initialSpendAmount >= tier.minAmount && 
        (!tier.maxAmount || initialSpendAmount <= tier.maxAmount)
      );
      
      if (applicableTier) {
        return {
          commissionRate: applicableTier.rate,
          commissionAmount: initialSpendAmount * applicableTier.rate
        };
      }
    }

    // Fall back to standard calculation
    if (rules.commissionType === 'percentage') {
      if (!rules.commissionRate) {
        throw new Error('Product commission rate is not defined');
      }
      return {
        commissionRate: rules.commissionRate,
        commissionAmount: initialSpendAmount * rules.commissionRate
      };
    } else if (rules.commissionType === 'flat') {
      if (!rules.commissionFlatAmount) {
        throw new Error('Product flat commission amount is not defined');
      }
      return {
        commissionRate: rules.commissionFlatAmount / initialSpendAmount, // For tracking purposes
        commissionAmount: rules.commissionFlatAmount
      };
    } else {
      throw new Error('Invalid commission type');
    }
  }

  /**
   * Calculate and create a new commission based on conversion data
   */
  static async calculateCommission(data: CommissionCalculationData): Promise<ICommission> {
    // Use transactions only if not in test environment
    const useTransactions = process.env.NODE_ENV !== 'test';
    let session: mongoose.ClientSession | undefined;

    if (useTransactions) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    try {
      // Validate marketer exists and is active
      const marketerQuery = User.findById(data.marketerId);
      const marketer = session ? await marketerQuery.session(session) : await marketerQuery;
      if (!marketer || marketer.status !== 'active') {
        throw new Error('Invalid or inactive marketer');
      }

      // Validate product exists and is active
      const productQuery = Product.findById(data.productId);
      const product = session ? await productQuery.session(session) : await productQuery;
      if (!product || product.status !== 'active') {
        throw new Error('Invalid or inactive product');
      }

      // Check if initial spend meets minimum requirement (unless overriding product rules)
      if (!data.overrideProductRules && data.initialSpendAmount < product.minInitialSpend) {
        throw new Error(`Initial spend amount ${data.initialSpendAmount} is below minimum required ${product.minInitialSpend}`);
      }

      // Check for duplicate commission (same customer, product, tracking code)
      const existingCommissionQuery = Commission.findOne({
        customerId: data.customerId,
        productId: data.productId,
        trackingCode: data.trackingCode
      });
      const existingCommission = session ? await existingCommissionQuery.session(session) : await existingCommissionQuery;

      if (existingCommission) {
        throw new Error('Commission already exists for this customer and product combination');
      }

      // Extract product rules for commission calculation
      const productRules: CommissionRules = {
        commissionType: product.commissionType,
        commissionRate: product.commissionRate,
        commissionFlatAmount: product.commissionFlatAmount,
        minInitialSpend: product.minInitialSpend,
        // Tiered rates would be added here if implemented in the Product model
      };

      // Calculate commission amount based on product commission structure
      const { commissionAmount, commissionRate } = this.calculateCommissionAmount(
        data.initialSpendAmount,
        productRules,
        data.customCommissionRate,
        data.customCommissionAmount,
        data.overrideProductRules
      );

      // Create commission record
      const commission = new Commission({
        marketerId: data.marketerId,
        customerId: data.customerId,
        productId: data.productId,
        trackingCode: data.trackingCode,
        initialSpendAmount: data.initialSpendAmount,
        commissionRate,
        commissionAmount,
        status: 'pending',
        conversionDate: data.conversionDate,
        clearancePeriodDays: data.clearancePeriodDays || 30
      });

      const savedCommission = session ? await commission.save({ session }) : await commission.save();

      if (useTransactions && session) {
        await session.commitTransaction();
      }
      return savedCommission;
    } catch (error) {
      if (useTransactions && session) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (session) {
        session.endSession();
      }
    }
  }

  /**
   * Get commission summary for a marketer
   */
  static async getCommissionSummary(marketerId: string): Promise<CommissionSummary> {
    const pipeline = [
      { $match: { marketerId } },
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$commissionAmount' },
          count: { $sum: 1 }
        }
      }
    ];

    const results = await Commission.aggregate(pipeline);
    
    const summary: CommissionSummary = {
      totalEarned: 0,
      pendingAmount: 0,
      approvedAmount: 0,
      paidAmount: 0,
      clawedBackAmount: 0,
      totalCommissions: 0
    };

    results.forEach(result => {
      summary.totalCommissions += result.count;
      
      switch (result._id) {
        case 'pending':
          summary.pendingAmount = result.totalAmount;
          break;
        case 'approved':
          summary.approvedAmount = result.totalAmount;
          break;
        case 'paid':
          summary.paidAmount = result.totalAmount;
          break;
        case 'clawed_back':
          summary.clawedBackAmount = result.totalAmount;
          break;
      }
    });

    summary.totalEarned = summary.pendingAmount + summary.approvedAmount + summary.paidAmount;

    return summary;
  }

  /**
   * Get commissions with filtering and pagination
   */
  static async getCommissions(
    filters: CommissionFilters = {},
    page: number = 1,
    limit: number = 10,
    sortBy: string = 'conversionDate',
    sortOrder: 'asc' | 'desc' = 'desc'
  ) {
    const query: any = {};

    // Apply filters
    if (filters.marketerId) query.marketerId = filters.marketerId;
    if (filters.productId) query.productId = filters.productId;
    if (filters.status) query.status = filters.status;
    
    if (filters.startDate || filters.endDate) {
      query.conversionDate = {};
      if (filters.startDate) query.conversionDate.$gte = filters.startDate;
      if (filters.endDate) query.conversionDate.$lte = filters.endDate;
    }

    if (filters.minAmount || filters.maxAmount) {
      query.commissionAmount = {};
      if (filters.minAmount) query.commissionAmount.$gte = filters.minAmount;
      if (filters.maxAmount) query.commissionAmount.$lte = filters.maxAmount;
    }

    const skip = (page - 1) * limit;
    const sortOptions: any = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const [commissions, total] = await Promise.all([
      Commission.find(query)
        .populate('marketerId', 'email')
        .populate('productId', 'name category')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit),
      Commission.countDocuments(query)
    ]);

    return {
      commissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get commission by ID with related data
   */
  static async getCommissionById(commissionId: string): Promise<ICommission | null> {
    return Commission.findById(commissionId)
      .populate('marketerId', 'email')
      .populate('productId', 'name category commissionType commissionRate commissionFlatAmount');
  }

  /**
   * Update commission status with enhanced lifecycle management
   */
  static async updateCommissionStatus(
    commissionId: string,
    status: 'pending' | 'approved' | 'paid' | 'clawed_back' | 'rejected',
    adminId?: string,
    rejectionReason?: string
  ): Promise<ICommission> {
    const commission = await Commission.findById(commissionId);
    if (!commission) {
      throw new Error('Commission not found');
    }

    // Validate status transition
    const validTransitions: Record<string, string[]> = {
      'pending': ['approved', 'rejected', 'clawed_back'],
      'approved': ['paid', 'clawed_back'],
      'paid': ['clawed_back'],
      'rejected': [], // No transitions from rejected
      'clawed_back': [] // No transitions from clawed_back
    };

    if (!validTransitions[commission.status].includes(status)) {
      throw new Error(`Invalid status transition from ${commission.status} to ${status}`);
    }

    const oldStatus = commission.status;
    commission.status = status;
    
    if (status === 'approved') {
      commission.approvalDate = new Date();
    }

    // Create audit trail for status changes
    if (adminId) {
      const adjustment = new CommissionAdjustment({
        commissionId: commission._id,
        adjustmentType: 'status_change',
        amount: 0, // No amount change for status updates
        reason: status === 'rejected' && rejectionReason 
          ? `Status changed from ${oldStatus} to ${status}: ${rejectionReason}`
          : `Status changed from ${oldStatus} to ${status}`,
        adminId
      });
      await adjustment.save();
    }

    return commission.save();
  }

  /**
   * Approve commission with optional admin override
   */
  static async approveCommission(
    commissionId: string,
    adminId?: string,
    overrideClearancePeriod: boolean = false
  ): Promise<ICommission> {
    const commission = await Commission.findById(commissionId);
    if (!commission) {
      throw new Error('Commission not found');
    }

    if (commission.status !== 'pending') {
      throw new Error(`Cannot approve commission with status ${commission.status}`);
    }

    // Check if clearance period has passed (unless overridden by admin)
    if (!overrideClearancePeriod && new Date() < commission.eligibleForPayoutDate) {
      throw new Error('Commission is still within clearance period and cannot be approved yet');
    }

    return this.updateCommissionStatus(commissionId, 'approved', adminId);
  }

  /**
   * Reject commission with reason
   */
  static async rejectCommission(
    commissionId: string,
    rejectionReason: string,
    adminId?: string
  ): Promise<ICommission> {
    const commission = await Commission.findById(commissionId);
    if (!commission) {
      throw new Error('Commission not found');
    }

    if (commission.status !== 'pending') {
      throw new Error(`Cannot reject commission with status ${commission.status}`);
    }

    return this.updateCommissionStatus(commissionId, 'rejected', adminId, rejectionReason);
  }

  /**
   * Mark commission as paid
   */
  static async markCommissionAsPaid(
    commissionId: string,
    adminId?: string,
    paymentReference?: string
  ): Promise<ICommission> {
    const commission = await Commission.findById(commissionId);
    if (!commission) {
      throw new Error('Commission not found');
    }

    if (commission.status !== 'approved') {
      throw new Error(`Cannot mark commission as paid with status ${commission.status}`);
    }

    const updatedCommission = await this.updateCommissionStatus(commissionId, 'paid', adminId);

    // Create payment record in adjustments for audit trail
    if (adminId && paymentReference) {
      const adjustment = new CommissionAdjustment({
        commissionId: commission._id,
        adjustmentType: 'payment',
        amount: commission.commissionAmount,
        reason: `Payment processed - Reference: ${paymentReference}`,
        adminId
      });
      await adjustment.save();
    }

    return updatedCommission;
  }

  /**
   * Get commissions eligible for automatic approval (past clearance period)
   */
  static async getCommissionsEligibleForApproval(): Promise<ICommission[]> {
    const now = new Date();
    
    return Commission.find({
      status: 'pending',
      eligibleForPayoutDate: { $lte: now }
    }).populate('marketerId', 'email')
      .populate('productId', 'name category');
  }

  /**
   * Bulk approve eligible commissions
   */
  static async bulkApproveEligibleCommissions(): Promise<{ approved: number; errors: string[] }> {
    const eligibleCommissions = await this.getCommissionsEligibleForApproval();
    const errors: string[] = [];
    let approved = 0;

    for (const commission of eligibleCommissions) {
      try {
        await this.updateCommissionStatus(commission._id, 'approved');
        approved++;
      } catch (error) {
        errors.push(`Failed to approve commission ${commission._id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { approved, errors };
  }

  /**
   * Process automated commission lifecycle updates
   * This method should be called by a scheduled job (e.g., daily cron job)
   */
  static async processAutomatedCommissionUpdates(): Promise<{
    autoApproved: number;
    errors: string[];
    summary: string;
  }> {
    const startTime = new Date();
    const errors: string[] = [];
    let autoApproved = 0;

    try {
      // Auto-approve commissions that have passed their clearance period
      const approvalResult = await this.bulkApproveEligibleCommissions();
      autoApproved = approvalResult.approved;
      errors.push(...approvalResult.errors);

      const endTime = new Date();
      const processingTime = endTime.getTime() - startTime.getTime();

      const summary = `Automated commission processing completed in ${processingTime}ms. ` +
        `Auto-approved: ${autoApproved} commissions. ` +
        `Errors: ${errors.length}`;

      return {
        autoApproved,
        errors,
        summary
      };
    } catch (error) {
      const errorMessage = `Failed to process automated commission updates: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMessage);
      
      return {
        autoApproved: 0,
        errors,
        summary: errorMessage
      };
    }
  }

  /**
   * Get commission lifecycle statistics
   */
  static async getCommissionLifecycleStats(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalCommissions: number;
    statusBreakdown: Record<string, number>;
    averageClearanceTime: number; // in days
    pendingCommissions: number;
    eligibleForApproval: number;
  }> {
    const matchStage: any = {};
    
    if (startDate || endDate) {
      matchStage.conversionDate = {};
      if (startDate) matchStage.conversionDate.$gte = startDate;
      if (endDate) matchStage.conversionDate.$lte = endDate;
    }

    // Get status breakdown
    const statusPipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ];

    const statusResults = await Commission.aggregate(statusPipeline);
    const statusBreakdown: Record<string, number> = {};
    let totalCommissions = 0;

    statusResults.forEach(result => {
      statusBreakdown[result._id] = result.count;
      totalCommissions += result.count;
    });

    // Calculate average clearance time for approved commissions
    const clearanceTimePipeline = [
      { 
        $match: { 
          ...matchStage,
          status: 'approved',
          approvalDate: { $exists: true }
        }
      },
      {
        $project: {
          clearanceTime: {
            $divide: [
              { $subtract: ['$approvalDate', '$conversionDate'] },
              1000 * 60 * 60 * 24 // Convert to days
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgClearanceTime: { $avg: '$clearanceTime' }
        }
      }
    ];

    const clearanceResults = await Commission.aggregate(clearanceTimePipeline);
    const averageClearanceTime = clearanceResults.length > 0 ? clearanceResults[0].avgClearanceTime : 0;

    // Get current eligible commissions count
    const eligibleCommissions = await this.getCommissionsEligibleForApproval();

    return {
      totalCommissions,
      statusBreakdown,
      averageClearanceTime: Math.round(averageClearanceTime * 100) / 100, // Round to 2 decimal places
      pendingCommissions: statusBreakdown.pending || 0,
      eligibleForApproval: eligibleCommissions.length
    };
  }

  /**
   * Get commission status transition history
   */
  static async getCommissionStatusHistory(commissionId: string): Promise<{
    commission: ICommission | null;
    statusHistory: Array<{
      status: string;
      timestamp: Date;
      adminId?: string;
      reason: string;
    }>;
  }> {
    const commission = await Commission.findById(commissionId)
      .populate('marketerId', 'email')
      .populate('productId', 'name category');

    if (!commission) {
      return {
        commission: null,
        statusHistory: []
      };
    }

    // Get status change adjustments
    const adjustments = await CommissionAdjustment.find({
      commissionId,
      adjustmentType: 'status_change'
    })
    .populate('adminId', 'email')
    .sort({ createdAt: 1 });

    // Build status history
    const statusHistory: Array<{
      status: string;
      timestamp: Date;
      adminId?: string;
      reason: string;
    }> = [
      {
        status: 'pending',
        timestamp: commission.createdAt,
        reason: 'Commission created'
      }
    ];

    adjustments.forEach(adjustment => {
      // Extract new status from reason
      const statusMatch = adjustment.reason.match(/Status changed from \w+ to (\w+)/);
      if (statusMatch) {
        statusHistory.push({
          status: statusMatch[1],
          timestamp: adjustment.createdAt,
          adminId: adjustment.adminId,
          reason: adjustment.reason
        });
      }
    });

    return {
      commission,
      statusHistory
    };
  }

  /**
   * Get detailed commission data for a marketer
   */
  static async getMarketerCommissionDetails(marketerId: string) {
    try {
      const commissions = await Commission.find({ marketerId })
        .populate('productId', 'name commissionType commissionRate commissionFlatAmount')
        .populate('customerId', 'firstName lastName email')
        .sort({ conversionDate: -1 });
      
      const commissionDetails = commissions.map(commission => ({
        customerId: commission.customerId,
        customerName: commission.customerId ? 
          `${(commission.customerId as any)?.firstName || ''} ${(commission.customerId as any)?.lastName || ''}`.trim() || 'N/A' : 'N/A',
        customerEmail: (commission.customerId as any)?.email || 'N/A',
        productName: (commission.productId as any)?.name || 'N/A',
        initialSpend: commission.initialSpendAmount || 0,
        commissionEarned: commission.commissionAmount || 0,
        commissionStatus: commission.status || 'pending',
        commissionPaid: commission.status === 'paid',
        commissionPaidDate: commission.status === 'paid' ? commission.updatedAt : undefined,
        onboardingStatus: 'completed', // Assuming if commission exists, onboarding is completed
        createdAt: commission.createdAt
      }));
      
      return commissionDetails;
    } catch (error) {
      console.error('Error getting marketer commission details:', error);
      throw error;
    }
  }

  /**
   * Calculate total available balance for a marketer (approved commissions)
   */
  static async getAvailableBalance(marketerId: string): Promise<number> {
    const result = await Commission.aggregate([
      { $match: { marketerId, status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
    ]);

    return result.length > 0 ? result[0].total : 0;
  }

  /**
   * Get commission analytics for a date range
   */
  static async getCommissionAnalytics(
    startDate: Date,
    endDate: Date,
    marketerId?: string
  ) {
    const matchStage: any = {
      conversionDate: { $gte: startDate, $lte: endDate }
    };

    if (marketerId) {
      matchStage.marketerId = marketerId;
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: {
            year: { $year: '$conversionDate' },
            month: { $month: '$conversionDate' },
            day: { $dayOfMonth: '$conversionDate' }
          },
          totalCommissions: { $sum: 1 },
          totalAmount: { $sum: '$commissionAmount' },
          avgAmount: { $avg: '$commissionAmount' },
          statusBreakdown: {
            $push: {
              status: '$status',
              amount: '$commissionAmount'
            }
          }
        }
      },
      {
        $sort: { '_id.year': 1 as 1, '_id.month': 1 as 1, '_id.day': 1 as 1 }
      }
    ];

    return Commission.aggregate(pipeline);
  }

  /**
   * Calculate commissions in batch for multiple conversions
   */
  static async batchCalculateCommissions(
    dataArray: CommissionCalculationData[]
  ): Promise<{ commissions: ICommission[]; errors: { index: number; error: string }[] }> {
    const commissions: ICommission[] = [];
    const errors: { index: number; error: string }[] = [];

    // Use transactions only if not in test environment
    const useTransactions = process.env.NODE_ENV !== 'test';
    let session: mongoose.ClientSession | undefined;

    if (useTransactions) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    try {
      for (let i = 0; i < dataArray.length; i++) {
        try {
          const commission = await this.calculateCommission({
            ...dataArray[i],
            // Pass session explicitly to ensure all operations are part of the same transaction
          });
          commissions.push(commission);
        } catch (error) {
          errors.push({
            index: i,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      if (useTransactions && session) {
        await session.commitTransaction();
      }

      return { commissions, errors };
    } catch (error) {
      if (useTransactions && session) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (session) {
        session.endSession();
      }
    }
  }

  /**
   * Recalculate commission amount for an existing commission
   * Useful for adjustments or corrections
   */
  static async recalculateCommission(
    commissionId: string,
    newAmount?: number,
    newRate?: number,
    adminId?: string
  ): Promise<ICommission> {
    const commission = await Commission.findById(commissionId);
    if (!commission) {
      throw new Error('Commission not found');
    }

    // Only allow recalculation for pending commissions
    if (commission.status !== 'pending') {
      throw new Error('Only pending commissions can be recalculated');
    }

    // Get product details to apply rules
    const product = await Product.findById(commission.productId);
    if (!product) {
      throw new Error('Product not found');
    }

    // Extract product rules
    const productRules: CommissionRules = {
      commissionType: product.commissionType,
      commissionRate: product.commissionRate,
      commissionFlatAmount: product.commissionFlatAmount,
      minInitialSpend: product.minInitialSpend
    };

    // Calculate new commission amount
    const { commissionAmount, commissionRate } = this.calculateCommissionAmount(
      commission.initialSpendAmount,
      productRules,
      newRate,
      newAmount,
      true // Override product rules with custom values
    );

    // Update commission
    commission.commissionRate = commissionRate;
    commission.commissionAmount = commissionAmount;

    // Create adjustment record if admin ID is provided
    if (adminId) {
      const adjustment = new CommissionAdjustment({
        commissionId: commission._id,
        adjustmentType: 'correction',
        amount: commissionAmount - commission.commissionAmount, // Difference from original
        reason: 'Manual recalculation',
        adminId
      });

      await adjustment.save();
    }

    return commission.save();
  }

  /**
   * Process commission clawback for refunds and chargebacks
   */
  static async processClawback(
    commissionId: string,
    clawbackAmount: number,
    reason: string,
    adminId: string,
    clawbackType: 'refund' | 'chargeback' | 'manual' = 'manual'
  ): Promise<{ commission: ICommission; adjustment: ICommissionAdjustment }> {
    const commission = await Commission.findById(commissionId);
    if (!commission) {
      throw new Error('Commission not found');
    }

    // Only allow clawback for approved or paid commissions
    if (!['approved', 'paid'].includes(commission.status)) {
      throw new Error(`Cannot process clawback for commission with status ${commission.status}`);
    }

    // Validate clawback amount
    if (clawbackAmount <= 0) {
      throw new Error('Clawback amount must be positive');
    }

    if (clawbackAmount > commission.commissionAmount) {
      throw new Error('Clawback amount cannot exceed original commission amount');
    }

    // Use transactions only if not in test environment
    const useTransactions = process.env.NODE_ENV !== 'test';
    let session: mongoose.ClientSession | undefined;

    if (useTransactions) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    try {
      // Update commission status to clawed_back
      commission.status = 'clawed_back';
      const savedCommission = session ? await commission.save({ session }) : await commission.save();

      // Create clawback adjustment record
      const adjustment = new CommissionAdjustment({
        commissionId: commission._id,
        adjustmentType: 'clawback',
        amount: -clawbackAmount, // Negative amount for clawback
        reason: `${clawbackType.toUpperCase()} clawback: ${reason}`,
        adminId
      });

      const savedAdjustment = session ? await adjustment.save({ session }) : await adjustment.save();

      if (useTransactions && session) {
        await session.commitTransaction();
      }

      return {
        commission: savedCommission,
        adjustment: savedAdjustment
      };
    } catch (error) {
      if (useTransactions && session) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (session) {
        session.endSession();
      }
    }
  }

  /**
   * Process partial clawback (when only part of commission needs to be clawed back)
   */
  static async processPartialClawback(
    commissionId: string,
    clawbackAmount: number,
    reason: string,
    adminId: string,
    clawbackType: 'refund' | 'chargeback' | 'manual' = 'manual'
  ): Promise<{ commission: ICommission; adjustment: ICommissionAdjustment }> {
    const commission = await Commission.findById(commissionId);
    if (!commission) {
      throw new Error('Commission not found');
    }

    // Only allow partial clawback for approved or paid commissions
    if (!['approved', 'paid'].includes(commission.status)) {
      throw new Error(`Cannot process partial clawback for commission with status ${commission.status}`);
    }

    // Validate clawback amount
    if (clawbackAmount <= 0) {
      throw new Error('Clawback amount must be positive');
    }

    if (clawbackAmount >= commission.commissionAmount) {
      throw new Error('Use full clawback for amounts equal to or greater than commission amount');
    }

    // Use transactions only if not in test environment
    const useTransactions = process.env.NODE_ENV !== 'test';
    let session: mongoose.ClientSession | undefined;

    if (useTransactions) {
      session = await mongoose.startSession();
    }

    try {
      if (useTransactions && session) {
        session.startTransaction();
      }

      // Create partial clawback adjustment record (commission remains in current status)
      const adjustment = new CommissionAdjustment({
        commissionId: commission._id,
        adjustmentType: 'clawback',
        amount: -clawbackAmount, // Negative amount for clawback
        reason: `Partial ${clawbackType.toUpperCase()} clawback: ${reason}`,
        adminId
      });

      const savedAdjustment = session ? await adjustment.save({ session }) : await adjustment.save();

      if (useTransactions && session) {
        await session.commitTransaction();
      }

      return {
        commission,
        adjustment: savedAdjustment
      };
    } catch (error) {
      if (useTransactions && session) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (session) {
        session.endSession();
      }
    }
  }

  /**
   * Apply manual commission adjustment (bonus, correction, etc.)
   */
  static async applyManualAdjustment(
    commissionId: string,
    adjustmentAmount: number,
    adjustmentType: 'bonus' | 'correction',
    reason: string,
    adminId: string
  ): Promise<{ commission: ICommission; adjustment: ICommissionAdjustment }> {
    const commission = await Commission.findById(commissionId);
    if (!commission) {
      throw new Error('Commission not found');
    }

    // Only allow adjustments for pending, approved, or paid commissions
    if (!['pending', 'approved', 'paid'].includes(commission.status)) {
      throw new Error(`Cannot apply adjustment to commission with status ${commission.status}`);
    }

    // Validate adjustment amount
    if (adjustmentAmount === 0) {
      throw new Error('Adjustment amount cannot be zero');
    }

    // For corrections that would make commission negative, prevent it
    if (adjustmentAmount < 0 && Math.abs(adjustmentAmount) > commission.commissionAmount) {
      throw new Error('Negative adjustment cannot exceed original commission amount');
    }

    // Use transactions only if not in test environment
    const useTransactions = process.env.NODE_ENV !== 'test';
    let session: mongoose.ClientSession | undefined;

    if (useTransactions) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    try {
      // For corrections, update the commission amount
      if (adjustmentType === 'correction') {
        commission.commissionAmount = Math.max(0, commission.commissionAmount + adjustmentAmount);
        await (session ? commission.save({ session }) : commission.save());
      }

      // Create adjustment record
      const adjustment = new CommissionAdjustment({
        commissionId: commission._id,
        adjustmentType,
        amount: adjustmentAmount,
        reason: `Manual ${adjustmentType}: ${reason}`,
        adminId
      });

      const savedAdjustment = session ? await adjustment.save({ session }) : await adjustment.save();

      if (useTransactions && session) {
        await session.commitTransaction();
      }

      return {
        commission,
        adjustment: savedAdjustment
      };
    } catch (error) {
      if (useTransactions && session) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (session) {
        session.endSession();
      }
    }
  }

  /**
   * Get all adjustments for a commission
   */
  static async getCommissionAdjustments(commissionId: string): Promise<ICommissionAdjustment[]> {
    return CommissionAdjustment.find({ commissionId })
      .populate('adminId', 'email')
      .sort({ createdAt: -1 });
  }

  /**
   * Get commission with all adjustments and net amount
   */
  static async getCommissionWithAdjustments(commissionId: string): Promise<{
    commission: ICommission | null;
    adjustments: ICommissionAdjustment[];
    netAmount: number;
    totalAdjustments: number;
  }> {
    const commission = await Commission.findById(commissionId)
      .populate('marketerId', 'email')
      .populate('productId', 'name category');

    if (!commission) {
      return {
        commission: null,
        adjustments: [],
        netAmount: 0,
        totalAdjustments: 0
      };
    }

    const adjustments = await this.getCommissionAdjustments(commissionId);
    
    // Calculate total adjustments
    const totalAdjustments = adjustments.reduce((sum, adj) => sum + adj.amount, 0);
    
    // Calculate net amount (original commission + adjustments)
    const netAmount = commission.commissionAmount + totalAdjustments;

    return {
      commission,
      adjustments,
      netAmount: Math.max(0, netAmount), // Ensure net amount is not negative
      totalAdjustments
    };
  }

  /**
   * Get clawback statistics for reporting
   */
  static async getClawbackStatistics(
    startDate?: Date,
    endDate?: Date,
    marketerId?: string
  ): Promise<{
    totalClawbacks: number;
    totalClawbackAmount: number;
    clawbacksByType: Record<string, { count: number; amount: number }>;
    affectedCommissions: number;
    clawbackRate: number; // Percentage of commissions that were clawed back
  }> {
    const matchStage: any = {
      adjustmentType: 'clawback'
    };

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    // Get clawback adjustments
    const clawbackPipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalClawbacks: { $sum: 1 },
          totalClawbackAmount: { $sum: { $abs: '$amount' } }, // Use absolute value since clawbacks are negative
          affectedCommissions: { $addToSet: '$commissionId' }
        }
      }
    ];

    const clawbackResults = await CommissionAdjustment.aggregate(clawbackPipeline);
    
    // Get clawbacks by type (extract from reason field)
    const clawbacksByTypePipeline = [
      { $match: matchStage },
      {
        $project: {
          amount: { $abs: '$amount' },
          type: {
            $cond: {
              if: { $regexMatch: { input: '$reason', regex: /REFUND/i } },
              then: 'refund',
              else: {
                $cond: {
                  if: { $regexMatch: { input: '$reason', regex: /CHARGEBACK/i } },
                  then: 'chargeback',
                  else: 'manual'
                }
              }
            }
          }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      }
    ];

    const typeResults = await CommissionAdjustment.aggregate(clawbacksByTypePipeline);

    // Get total commissions for clawback rate calculation
    const totalCommissionsQuery: any = {};
    if (marketerId) {
      totalCommissionsQuery.marketerId = marketerId;
    }
    if (startDate || endDate) {
      totalCommissionsQuery.createdAt = {};
      if (startDate) totalCommissionsQuery.createdAt.$gte = startDate;
      if (endDate) totalCommissionsQuery.createdAt.$lte = endDate;
    }

    const totalCommissions = await Commission.countDocuments(totalCommissionsQuery);

    // Process results
    const result = {
      totalClawbacks: 0,
      totalClawbackAmount: 0,
      clawbacksByType: {} as Record<string, { count: number; amount: number }>,
      affectedCommissions: 0,
      clawbackRate: 0
    };

    if (clawbackResults.length > 0) {
      const clawbackData = clawbackResults[0];
      result.totalClawbacks = clawbackData.totalClawbacks;
      result.totalClawbackAmount = clawbackData.totalClawbackAmount;
      result.affectedCommissions = clawbackData.affectedCommissions.length;
    }

    typeResults.forEach(typeResult => {
      result.clawbacksByType[typeResult._id] = {
        count: typeResult.count,
        amount: typeResult.amount
      };
    });

    result.clawbackRate = totalCommissions > 0 ? (result.affectedCommissions / totalCommissions) * 100 : 0;

    return result;
  }

  /**
   * Get product-specific commission performance
   */
  static async getProductCommissionPerformance(productId: string): Promise<{
    totalCommissions: number;
    totalAmount: number;
    conversionRate?: number;
    averageCommission: number;
    statusBreakdown: Record<string, { count: number; amount: number }>;
  }> {
    const commissionStats = await Commission.aggregate([
      { $match: { productId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionAmount' }
        }
      }
    ]);

    // Calculate total clicks from tracking service if available
    // This would require integration with the tracking service
    // const totalClicks = await TrackingService.getProductClickCount(productId);

    const result = {
      totalCommissions: 0,
      totalAmount: 0,
      // conversionRate: totalClicks > 0 ? commissionStats.reduce((sum, stat) => sum + stat.count, 0) / totalClicks : undefined,
      averageCommission: 0,
      statusBreakdown: {} as Record<string, { count: number; amount: number }>
    };

    let totalCount = 0;

    commissionStats.forEach(stat => {
      result.statusBreakdown[stat._id] = {
        count: stat.count,
        amount: stat.totalAmount
      };

      totalCount += stat.count;
      result.totalAmount += stat.totalAmount;
    });

    result.totalCommissions = totalCount;
    result.averageCommission = totalCount > 0 ? result.totalAmount / totalCount : 0;

    return result;
  }
}