import { Customer, ICustomer } from '../../models/Customer';
import { TrackingService } from '../tracking';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';

export interface OnboardingStatusUpdate {
  customerId: string;
  status: string;
  step: number;
  completedAt?: Date;
  rejectionReason?: string;
}

export interface ConversionData {
  customerId: string;
  trackingCode: string;
  productId: string;
  initialSpendAmount: number;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class OnboardingService {
  private static statusNotifier = new EventEmitter();

  /**
   * Update customer onboarding status and trigger notifications
   */
  static async updateOnboardingStatus(data: OnboardingStatusUpdate): Promise<ICustomer> {
    try {
      const customer = await Customer.findById(data.customerId);
      
      if (!customer) {
        throw new Error('Customer not found');
      }

      // Update customer status
      customer.onboardingStatus = data.status as any;
      customer.currentStep = data.step;
      
      if (data.completedAt) {
        customer.completedAt = data.completedAt;
      }

      await customer.save();

      // Emit status change event for notifications
      this.statusNotifier.emit('statusChanged', {
        customerId: customer._id,
        status: data.status,
        step: data.step,
        trackingCode: customer.trackingCode,
        marketerId: customer.marketerId,
        productId: customer.productId,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        completedAt: data.completedAt,
        rejectionReason: data.rejectionReason
      });

      logger.info(`Updated onboarding status for customer ${data.customerId}: ${data.status}`);
      return customer;

    } catch (error) {
      logger.error('Error updating onboarding status:', error);
      throw error;
    }
  }

  /**
   * Record conversion when customer completes initial spend
   */
  static async recordConversion(data: ConversionData): Promise<void> {
    try {
      const customer = await Customer.findById(data.customerId);
      
      if (!customer) {
        throw new Error('Customer not found');
      }

      // Update customer with initial spend information
      customer.initialSpendAmount = data.initialSpendAmount;
      customer.initialSpendDate = new Date();
      await customer.save();

      // Record conversion in tracking system
      const conversionData = {
        trackingCode: data.trackingCode,
        customerId: data.customerId,
        productId: data.productId,
        initialSpendAmount: data.initialSpendAmount,
        sessionId: data.sessionId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        attributionMethod: 'portal' as const
      };

      await TrackingService.recordConversionWithDeduplication(conversionData);

      // Create commission for the marketer if customer has a marketer
      if (customer.marketerId) {
        try {
          const { CommissionService } = await import('../commission');
          
          const commissionData = {
            marketerId: customer.marketerId,
            customerId: data.customerId,
            productId: data.productId,
            trackingCode: data.trackingCode,
            initialSpendAmount: data.initialSpendAmount,
            conversionDate: new Date()
          };

          const commission = await CommissionService.calculateCommission(commissionData);
          
          logger.info(`Created commission ${commission._id} for marketer ${customer.marketerId}: $${commission.commissionAmount}`);
        } catch (commissionError) {
          logger.error('Error creating commission:', commissionError);
          // Don't throw here - we still want the conversion to be recorded even if commission creation fails
        }
      }

      // Emit conversion event for notifications
      this.statusNotifier.emit('conversionRecorded', {
        customerId: customer._id,
        trackingCode: data.trackingCode,
        marketerId: customer.marketerId,
        productId: data.productId,
        initialSpendAmount: data.initialSpendAmount,
        customerEmail: customer.email,
        customerName: `${customer.firstName} ${customer.lastName}`
      });

      logger.info(`Recorded conversion for customer ${data.customerId}: $${data.initialSpendAmount}`);

    } catch (error) {
      logger.error('Error recording conversion:', error);
      throw error;
    }
  }

  /**
   * Get customer onboarding status with detailed information
   */
  static async getCustomerStatus(customerId: string): Promise<any> {
    try {
      const customer = await Customer.findById(customerId);
      
      if (!customer) {
        throw new Error('Customer not found');
      }

      return {
        customerId: customer._id,
        trackingCode: customer.trackingCode,
        productId: customer.productId,
        marketerId: customer.marketerId,
        onboardingStatus: customer.onboardingStatus,
        currentStep: customer.currentStep,
        totalSteps: customer.totalSteps,
        personalInfo: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          dateOfBirth: customer.dateOfBirth,
          address: customer.address
        },
        kyc: {
          status: customer.kyc.status,
          documentsCount: customer.kyc.documents.length,
          reviewedAt: customer.kyc.reviewedAt,
          rejectionReason: customer.kyc.rejectionReason
        },
        signature: {
          signed: customer.signature.signed,
          signedAt: customer.signature.signedAt
        },
        financial: {
          initialSpendAmount: customer.initialSpendAmount,
          initialSpendDate: customer.initialSpendDate
        },
        timestamps: {
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
          completedAt: customer.completedAt
        }
      };

    } catch (error) {
      logger.error('Error getting customer status:', error);
      throw error;
    }
  }

  /**
   * Get all customers for a specific marketer with status filtering
   */
  static async getMarketerCustomers(
    marketerId: string,
    options: {
      status?: string;
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<{ referrals: any[]; total: number }> {
    try {
      const query: any = { marketerId };

      if (options.status) {
        query.onboardingStatus = options.status;
      }

      if (options.startDate || options.endDate) {
        query.createdAt = {};
        if (options.startDate) {
          query.createdAt.$gte = options.startDate;
        }
        if (options.endDate) {
          query.createdAt.$lte = options.endDate;
        }
      }

      const total = await Customer.countDocuments(query);
      
      let customersQuery = Customer.find(query)
        .populate('productId', 'name category')
        .select('trackingCode productId onboardingStatus currentStep firstName lastName email createdAt completedAt initialSpendAmount')
        .sort({ createdAt: -1 });

      if (options.limit) {
        customersQuery = customersQuery.limit(options.limit);
      }

      if (options.offset) {
        customersQuery = customersQuery.skip(options.offset);
      }

      const customers = await customersQuery.exec();

      // Transform customer data to match CustomerReferral interface
      const referrals = customers.map(customer => ({
        id: customer._id.toString(),
        customerId: customer._id.toString(),
        customerEmail: customer.email,
        customerName: customer.firstName && customer.lastName 
          ? `${customer.firstName} ${customer.lastName}` 
          : customer.email,
        trackingCode: customer.trackingCode,
        productId: typeof customer.productId === 'object' && customer.productId ? (customer.productId as any)._id : customer.productId,
        productName: typeof customer.productId === 'object' && customer.productId ? (customer.productId as any).name : 'Unknown Product',
        status: customer.onboardingStatus === 'completed' ? 'converted' : 
                customer.onboardingStatus === 'started' ? 'pending' : 'onboarding',
        referredAt: customer.createdAt.toISOString(),
        convertedAt: customer.completedAt?.toISOString(),
        lastActivityAt: customer.updatedAt?.toISOString() || customer.createdAt.toISOString(),
        initialSpend: customer.initialSpendAmount,
        source: 'cookie' // Default source, could be enhanced later
      }));

      return { referrals, total };

    } catch (error) {
      logger.error('Error getting marketer customers:', error);
      throw error;
    }
  }

  /**
   * Get onboarding analytics for a marketer
   */
  static async getOnboardingAnalytics(marketerId: string): Promise<any> {
    try {
      const pipeline = [
        { $match: { marketerId } },
        {
          $group: {
            _id: null,
            totalCustomers: { $sum: 1 },
            completedApplications: {
              $sum: {
                $cond: [{ $eq: ['$onboardingStatus', 'completed'] }, 1, 0]
              }
            },
            rejectedApplications: {
              $sum: {
                $cond: [{ $eq: ['$onboardingStatus', 'rejected'] }, 1, 0]
              }
            },
            inProgressApplications: {
              $sum: {
                $cond: [
                  { $in: ['$onboardingStatus', ['started', 'personal_info', 'kyc_documents', 'signature']] },
                  1,
                  0
                ]
              }
            },
            totalInitialSpend: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$initialSpendAmount', null] }, { $gt: ['$initialSpendAmount', 0] }] },
                  '$initialSpendAmount',
                  0
                ]
              }
            },
            conversions: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$initialSpendAmount', null] }, { $gt: ['$initialSpendAmount', 0] }] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ];

      const result = await Customer.aggregate(pipeline);
      const analytics = result[0] || {
        totalCustomers: 0,
        completedApplications: 0,
        rejectedApplications: 0,
        inProgressApplications: 0,
        totalInitialSpend: 0,
        conversions: 0
      };

      // Calculate conversion rate
      analytics.conversionRate = analytics.completedApplications > 0 
        ? (analytics.conversions / analytics.completedApplications) * 100 
        : 0;

      // Calculate average spend per conversion
      analytics.averageSpendPerConversion = analytics.conversions > 0
        ? analytics.totalInitialSpend / analytics.conversions
        : 0;

      return analytics;

    } catch (error) {
      logger.error('Error getting onboarding analytics:', error);
      throw error;
    }
  }

  /**
   * Subscribe to status change events
   */
  static onStatusChange(callback: (data: any) => void): void {
    this.statusNotifier.on('statusChanged', callback);
  }

  /**
   * Subscribe to conversion events
   */
  static onConversion(callback: (data: any) => void): void {
    this.statusNotifier.on('conversionRecorded', callback);
  }

  /**
   * Unsubscribe from events
   */
  static removeListener(event: string, callback: (data: any) => void): void {
    this.statusNotifier.removeListener(event, callback);
  }
}