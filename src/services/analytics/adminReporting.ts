import mongoose from 'mongoose';
import { ClickEvent } from '../../models/ClickEvent';
import { ConversionEvent } from '../../models/ConversionEvent';
import { ReferralLink } from '../../models/ReferralLink';
import { Commission } from '../../models/Commission';
import { PayoutRequest } from '../../models/PayoutRequest';
import { User } from '../../models/User';
import { Product } from '../../models/Product';
import { AuditLog } from '../../models/AuditLog';
import { logger } from '../../utils/logger';

export interface PlatformPerformanceDashboard {
  overview: {
    totalMarketers: number;
    activeMarketers: number;
    totalProducts: number;
    activeProducts: number;
    totalClicks: number;
    totalConversions: number;
    totalCommissions: number;
    totalPayouts: number;
    platformConversionRate: number;
  };
  trends: {
    daily: Array<{
      date: string;
      clicks: number;
      conversions: number;
      commissions: number;
      revenue: number;
    }>;
    monthly: Array<{
      month: string;
      clicks: number;
      conversions: number;
      commissions: number;
      revenue: number;
    }>;
  };
  topPerformers: {
    marketers: Array<{
      marketerId: string;
      marketerName: string;
      conversions: number;
      revenue: number;
      commissions: number;
    }>;
    products: Array<{
      productId: string;
      productName: string;
      conversions: number;
      revenue: number;
      commissions: number;
    }>;
  };
  period: {
    start: Date;
    end: Date;
  };
}

export interface FinancialReport {
  summary: {
    totalRevenue: number;
    totalCommissions: number;
    totalPayouts: number;
    pendingCommissions: number;
    pendingPayouts: number;
    netProfit: number;
  };
  commissionBreakdown: {
    byStatus: Array<{
      status: string;
      count: number;
      amount: number;
    }>;
    byProduct: Array<{
      productId: string;
      productName: string;
      commissions: number;
      amount: number;
    }>;
    byMarketer: Array<{
      marketerId: string;
      marketerName: string;
      commissions: number;
      amount: number;
    }>;
  };
  payoutBreakdown: {
    byStatus: Array<{
      status: string;
      count: number;
      amount: number;
    }>;
    byMethod: Array<{
      method: string;
      count: number;
      amount: number;
    }>;
    byMarketer: Array<{
      marketerId: string;
      marketerName: string;
      payouts: number;
      amount: number;
    }>;
  };
  cashFlow: Array<{
    date: string;
    revenue: number;
    commissions: number;
    payouts: number;
    netCashFlow: number;
  }>;
  period: {
    start: Date;
    end: Date;
  };
}

export interface ComplianceReport {
  gdprCompliance: {
    dataAccessRequests: number;
    dataExportRequests: number;
    dataDeletionRequests: number;
    consentWithdrawals: number;
    averageResponseTime: number; // in hours
  };
  auditTrail: {
    totalEvents: number;
    criticalEvents: number;
    securityEvents: number;
    dataAccessEvents: number;
    recentEvents: Array<{
      timestamp: Date;
      userId: string;
      action: string;
      resource: string;
      ipAddress: string;
      severity: string;
    }>;
  };
  userActivity: {
    activeUsers: number;
    suspendedUsers: number;
    revokedUsers: number;
    newRegistrations: number;
    failedLogins: number;
  };
  dataRetention: {
    recordsScheduledForDeletion: number;
    recordsDeleted: number;
    anonymizedRecords: number;
    retentionPolicyViolations: number;
  };
  period: {
    start: Date;
    end: Date;
  };
}

export interface ScheduledReport {
  id: string;
  name: string;
  type: 'platform_performance' | 'financial' | 'compliance';
  schedule: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  lastRun?: Date;
  nextRun: Date;
  isActive: boolean;
  parameters: any;
}

export class AdminReportingService {
  /**
   * Generate platform-wide performance dashboard using MongoDB aggregation
   */
  static async getPlatformPerformanceDashboard(
    startDate: Date,
    endDate: Date
  ): Promise<PlatformPerformanceDashboard> {
    try {
      // Overview metrics aggregation
      const overviewPipeline: any[] = [
        {
          $facet: {
            marketers: [
              { $match: { role: 'marketer' } },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  active: {
                    $sum: {
                      $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
                    }
                  }
                }
              }
            ],
            products: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  active: {
                    $sum: {
                      $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
                    }
                  }
                }
              }
            ]
          }
        }
      ];

      // Clicks and conversions aggregation
      const clicksPipeline: any[] = [
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: null,
            totalClicks: { $sum: 1 }
          }
        }
      ];

      const conversionsPipeline: any[] = [
        {
          $match: {
            conversionTimestamp: { $gte: startDate, $lte: endDate },
            commissionEligible: true
          }
        },
        {
          $group: {
            _id: null,
            totalConversions: { $sum: 1 }
          }
        }
      ];

      // Commissions and payouts aggregation
      const commissionsPipeline: any[] = [
        {
          $match: {
            conversionDate: { $gte: startDate, $lte: endDate },
            status: { $in: ['approved', 'paid'] }
          }
        },
        {
          $group: {
            _id: null,
            totalCommissions: { $sum: 1 },
            totalCommissionAmount: { $sum: '$commissionAmount' }
          }
        }
      ];

      const payoutsPipeline: any[] = [
        {
          $match: {
            requestedAt: { $gte: startDate, $lte: endDate },
            status: { $in: ['completed'] }
          }
        },
        {
          $group: {
            _id: null,
            totalPayouts: { $sum: 1 },
            totalPayoutAmount: { $sum: '$amount' }
          }
        }
      ];

      // Daily trends aggregation
      const dailyTrendsPipeline: any[] = [
        {
          $facet: {
            clicks: [
              {
                $match: {
                  timestamp: { $gte: startDate, $lte: endDate }
                }
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$timestamp'
                    }
                  },
                  clicks: { $sum: 1 }
                }
              }
            ],
            conversions: [
              {
                $match: {
                  conversionTimestamp: { $gte: startDate, $lte: endDate },
                  commissionEligible: true
                }
              },
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
              }
            ],
            commissions: [
              {
                $match: {
                  conversionDate: { $gte: startDate, $lte: endDate },
                  status: { $in: ['approved', 'paid'] }
                }
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$conversionDate'
                    }
                  },
                  commissions: { $sum: 1 }
                }
              }
            ]
          }
        }
      ];

      // Top performing marketers
      const topMarketersPipeline: any[] = [
        {
          $match: {
            conversionTimestamp: { $gte: startDate, $lte: endDate },
            commissionEligible: true
          }
        },
        {
          $lookup: {
            from: 'referral_links',
            localField: 'trackingCode',
            foreignField: 'trackingCode',
            as: 'referralLink'
          }
        },
        { $unwind: '$referralLink' },
        {
          $group: {
            _id: '$referralLink.marketerId',
            conversions: { $sum: 1 },
            revenue: { $sum: '$initialSpendAmount' }
          }
        },
        {
          $lookup: {
            from: 'commissions',
            let: { marketerId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$marketerId', '$$marketerId'] },
                      { $gte: ['$conversionDate', startDate] },
                      { $lte: ['$conversionDate', endDate] },
                      { $in: ['$status', ['approved', 'paid']] }
                    ]
                  }
                }
              },
              {
                $group: {
                  _id: null,
                  commissions: { $sum: '$commissionAmount' }
                }
              }
            ],
            as: 'commissionData'
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'marketer'
          }
        },
        { $unwind: '$marketer' },
        {
          $project: {
            marketerId: '$_id',
            marketerName: {
              $concat: ['$marketer.firstName', ' ', '$marketer.lastName']
            },
            conversions: 1,
            revenue: 1,
            commissions: {
              $ifNull: [{ $arrayElemAt: ['$commissionData.commissions', 0] }, 0]
            },
            _id: 0
          }
        },
        { $sort: { conversions: -1 } },
        { $limit: 10 }
      ];

      // Top performing products
      const topProductsPipeline: any[] = [
        {
          $match: {
            conversionTimestamp: { $gte: startDate, $lte: endDate },
            commissionEligible: true
          }
        },
        {
          $group: {
            _id: '$productId',
            conversions: { $sum: 1 },
            revenue: { $sum: '$initialSpendAmount' }
          }
        },
        {
          $lookup: {
            from: 'commissions',
            let: { productId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$productId', '$$productId'] },
                      { $gte: ['$conversionDate', startDate] },
                      { $lte: ['$conversionDate', endDate] },
                      { $in: ['$status', ['approved', 'paid']] }
                    ]
                  }
                }
              },
              {
                $group: {
                  _id: null,
                  commissions: { $sum: '$commissionAmount' }
                }
              }
            ],
            as: 'commissionData'
          }
        },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $project: {
            productId: '$_id',
            productName: '$product.name',
            conversions: 1,
            revenue: 1,
            commissions: {
              $ifNull: [{ $arrayElemAt: ['$commissionData.commissions', 0] }, 0]
            },
            _id: 0
          }
        },
        { $sort: { conversions: -1 } },
        { $limit: 10 }
      ];

      // Execute all aggregations in parallel
      const [
        overviewResult,
        clicksResult,
        conversionsResult,
        commissionsResult,
        payoutsResult,
        dailyTrendsResult,
        topMarketersResult,
        topProductsResult
      ] = await Promise.all([
        User.aggregate(overviewPipeline),
        ClickEvent.aggregate(clicksPipeline),
        ConversionEvent.aggregate(conversionsPipeline),
        Commission.aggregate(commissionsPipeline),
        PayoutRequest.aggregate(payoutsPipeline),
        ClickEvent.aggregate(dailyTrendsPipeline),
        ConversionEvent.aggregate(topMarketersPipeline),
        ConversionEvent.aggregate(topProductsPipeline)
      ]);

      // Process results
      const overview = overviewResult[0] || { marketers: [{}], products: [{}] };
      const marketersData = overview.marketers[0] || { total: 0, active: 0 };
      const productsData = overview.products[0] || { total: 0, active: 0 };
      const clicksData = clicksResult[0] || { totalClicks: 0 };
      const conversionsData = conversionsResult[0] || { totalConversions: 0 };
      const commissionsData = commissionsResult[0] || { totalCommissions: 0, totalCommissionAmount: 0 };
      const payoutsData = payoutsResult[0] || { totalPayouts: 0, totalPayoutAmount: 0 };

      const platformConversionRate = clicksData.totalClicks > 0 
        ? (conversionsData.totalConversions / clicksData.totalClicks) * 100 
        : 0;

      // Process daily trends
      const dailyTrends = this.processDailyTrends(dailyTrendsResult[0] || { clicks: [], conversions: [], commissions: [] });

      // Generate monthly trends from daily data
      const monthlyTrends = this.generateMonthlyTrends(dailyTrends);

      return {
        overview: {
          totalMarketers: marketersData.total,
          activeMarketers: marketersData.active,
          totalProducts: productsData.total,
          activeProducts: productsData.active,
          totalClicks: clicksData.totalClicks,
          totalConversions: conversionsData.totalConversions,
          totalCommissions: commissionsData.totalCommissions,
          totalPayouts: payoutsData.totalPayouts,
          platformConversionRate: Math.round(platformConversionRate * 100) / 100
        },
        trends: {
          daily: dailyTrends,
          monthly: monthlyTrends
        },
        topPerformers: {
          marketers: topMarketersResult,
          products: topProductsResult
        },
        period: {
          start: startDate,
          end: endDate
        }
      };
    } catch (error) {
      logger.error('Error generating platform performance dashboard:', error);
      throw new Error('Failed to generate platform performance dashboard');
    }
  }

  /**
   * Generate financial reporting for commission and payouts with MongoDB queries
   */
  static async getFinancialReport(
    startDate: Date,
    endDate: Date
  ): Promise<FinancialReport> {
    try {
      // Financial summary aggregation
      const summaryPipeline: any[] = [
        {
          $facet: {
            revenue: [
              {
                $match: {
                  conversionTimestamp: { $gte: startDate, $lte: endDate },
                  commissionEligible: true
                }
              },
              {
                $group: {
                  _id: null,
                  totalRevenue: { $sum: '$initialSpendAmount' }
                }
              }
            ],
            commissions: [
              {
                $match: {
                  conversionDate: { $gte: startDate, $lte: endDate }
                }
              },
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 },
                  amount: { $sum: '$commissionAmount' }
                }
              }
            ],
            payouts: [
              {
                $match: {
                  requestedAt: { $gte: startDate, $lte: endDate }
                }
              },
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 },
                  amount: { $sum: '$amount' }
                }
              }
            ]
          }
        }
      ];

      // Commission breakdown by product
      const commissionByProductPipeline: any[] = [
        {
          $match: {
            conversionDate: { $gte: startDate, $lte: endDate },
            status: { $in: ['approved', 'paid'] }
          }
        },
        {
          $group: {
            _id: '$productId',
            commissions: { $sum: 1 },
            amount: { $sum: '$commissionAmount' }
          }
        },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $project: {
            productId: '$_id',
            productName: '$product.name',
            commissions: 1,
            amount: 1,
            _id: 0
          }
        },
        { $sort: { amount: -1 } }
      ];

      // Commission breakdown by marketer
      const commissionByMarketerPipeline: any[] = [
        {
          $match: {
            conversionDate: { $gte: startDate, $lte: endDate },
            status: { $in: ['approved', 'paid'] }
          }
        },
        {
          $group: {
            _id: '$marketerId',
            commissions: { $sum: 1 },
            amount: { $sum: '$commissionAmount' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'marketer'
          }
        },
        { $unwind: '$marketer' },
        {
          $project: {
            marketerId: '$_id',
            marketerName: {
              $concat: ['$marketer.firstName', ' ', '$marketer.lastName']
            },
            commissions: 1,
            amount: 1,
            _id: 0
          }
        },
        { $sort: { amount: -1 } }
      ];

      // Payout breakdown by method
      const payoutByMethodPipeline: any[] = [
        {
          $match: {
            requestedAt: { $gte: startDate, $lte: endDate },
            status: 'completed'
          }
        },
        {
          $lookup: {
            from: 'paymentmethods',
            localField: 'paymentMethodId',
            foreignField: '_id',
            as: 'paymentMethod'
          }
        },
        { $unwind: '$paymentMethod' },
        {
          $group: {
            _id: '$paymentMethod.methodType',
            count: { $sum: 1 },
            amount: { $sum: '$amount' }
          }
        },
        {
          $project: {
            method: '$_id',
            count: 1,
            amount: 1,
            _id: 0
          }
        },
        { $sort: { amount: -1 } }
      ];

      // Payout breakdown by marketer
      const payoutByMarketerPipeline: any[] = [
        {
          $match: {
            requestedAt: { $gte: startDate, $lte: endDate },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: '$marketerId',
            payouts: { $sum: 1 },
            amount: { $sum: '$amount' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'marketer'
          }
        },
        { $unwind: '$marketer' },
        {
          $project: {
            marketerId: '$_id',
            marketerName: {
              $concat: ['$marketer.firstName', ' ', '$marketer.lastName']
            },
            payouts: 1,
            amount: 1,
            _id: 0
          }
        },
        { $sort: { amount: -1 } }
      ];

      // Cash flow analysis
      const cashFlowPipeline: any[] = [
        {
          $facet: {
            revenue: [
              {
                $match: {
                  conversionTimestamp: { $gte: startDate, $lte: endDate },
                  commissionEligible: true
                }
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$conversionTimestamp'
                    }
                  },
                  revenue: { $sum: '$initialSpendAmount' }
                }
              }
            ],
            commissions: [
              {
                $match: {
                  conversionDate: { $gte: startDate, $lte: endDate },
                  status: { $in: ['approved', 'paid'] }
                }
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$conversionDate'
                    }
                  },
                  commissions: { $sum: '$commissionAmount' }
                }
              }
            ],
            payouts: [
              {
                $match: {
                  completedAt: { $gte: startDate, $lte: endDate },
                  status: 'completed'
                }
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$completedAt'
                    }
                  },
                  payouts: { $sum: '$amount' }
                }
              }
            ]
          }
        }
      ];

      // Execute all aggregations
      const [
        summaryResult,
        commissionByProductResult,
        commissionByMarketerResult,
        payoutByMethodResult,
        payoutByMarketerResult,
        cashFlowResult
      ] = await Promise.all([
        ConversionEvent.aggregate(summaryPipeline),
        Commission.aggregate(commissionByProductPipeline),
        Commission.aggregate(commissionByMarketerPipeline),
        PayoutRequest.aggregate(payoutByMethodPipeline),
        PayoutRequest.aggregate(payoutByMarketerPipeline),
        ConversionEvent.aggregate(cashFlowPipeline)
      ]);

      // Process summary data
      const summary = summaryResult[0] || { revenue: [], commissions: [], payouts: [] };
      const totalRevenue = summary.revenue[0]?.totalRevenue || 0;
      
      const commissionsByStatus = summary.commissions.reduce((acc: any, item: any) => {
        acc[item._id] = item;
        return acc;
      }, {});

      const payoutsByStatus = summary.payouts.reduce((acc: any, item: any) => {
        acc[item._id] = item;
        return acc;
      }, {});

      const totalCommissions = Object.values(commissionsByStatus).reduce((sum: number, item: any) => sum + item.amount, 0);
      const totalPayouts = Object.values(payoutsByStatus).reduce((sum: number, item: any) => sum + item.amount, 0);
      const pendingCommissions = commissionsByStatus.pending?.amount || 0;
      const pendingPayouts = payoutsByStatus.requested?.amount || 0;

      // Process cash flow data
      const cashFlow = this.processCashFlowData(cashFlowResult[0] || { revenue: [], commissions: [], payouts: [] });

      return {
        summary: {
          totalRevenue,
          totalCommissions,
          totalPayouts,
          pendingCommissions,
          pendingPayouts,
          netProfit: totalRevenue - totalCommissions - totalPayouts
        },
        commissionBreakdown: {
          byStatus: Object.values(commissionsByStatus).map((item: any) => ({
            status: item._id,
            count: item.count,
            amount: item.amount
          })),
          byProduct: commissionByProductResult,
          byMarketer: commissionByMarketerResult
        },
        payoutBreakdown: {
          byStatus: Object.values(payoutsByStatus).map((item: any) => ({
            status: item._id,
            count: item.count,
            amount: item.amount
          })),
          byMethod: payoutByMethodResult,
          byMarketer: payoutByMarketerResult
        },
        cashFlow,
        period: {
          start: startDate,
          end: endDate
        }
      };
    } catch (error) {
      logger.error('Error generating financial report:', error);
      throw new Error('Failed to generate financial report');
    }
  }

  /**
   * Generate compliance reporting for audit purposes using MongoDB data
   */
  static async getComplianceReport(
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceReport> {
    try {
      // GDPR compliance metrics
      const gdprPipeline: any[] = [
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            requestType: { $in: ['access', 'export', 'deletion', 'consent_withdrawal'] }
          }
        },
        {
          $group: {
            _id: '$requestType',
            count: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTimeHours' }
          }
        }
      ];

      // Audit trail analysis
      const auditPipeline: any[] = [
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  totalEvents: { $sum: 1 },
                  criticalEvents: {
                    $sum: {
                      $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0]
                    }
                  },
                  securityEvents: {
                    $sum: {
                      $cond: [{ $eq: ['$category', 'security'] }, 1, 0]
                    }
                  },
                  dataAccessEvents: {
                    $sum: {
                      $cond: [{ $eq: ['$category', 'data_access'] }, 1, 0]
                    }
                  }
                }
              }
            ],
            recentEvents: [
              { $sort: { timestamp: -1 } },
              { $limit: 50 },
              {
                $project: {
                  timestamp: 1,
                  userId: '$adminId',
                  action: 1,
                  resource: 1,
                  ipAddress: 1,
                  severity: '$details.severity'
                }
              }
            ]
          }
        }
      ];

      // User activity analysis
      const userActivityPipeline: any[] = [
        {
          $facet: {
            userStats: [
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 }
                }
              }
            ],
            newRegistrations: [
              {
                $match: {
                  createdAt: { $gte: startDate, $lte: endDate }
                }
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 }
                }
              }
            ]
          }
        }
      ];

      // Execute aggregations
      const [gdprResult, auditResult, userActivityResult] = await Promise.all([
        // Note: These would need actual GDPR request models
        Promise.resolve([]), // DataAccessRequest.aggregate(gdprPipeline),
        AuditLog.aggregate(auditPipeline),
        User.aggregate(userActivityPipeline)
      ]);

      // Process results
      const auditData = auditResult[0] || { summary: [{}], recentEvents: [] };
      const auditSummary = auditData.summary[0] || {
        totalEvents: 0,
        criticalEvents: 0,
        securityEvents: 0,
        dataAccessEvents: 0
      };

      const userActivity = userActivityResult[0] || { userStats: [], newRegistrations: [] };
      const userStats = userActivity.userStats.reduce((acc: any, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {});

      return {
        gdprCompliance: {
          dataAccessRequests: 0, // Would be calculated from actual GDPR requests
          dataExportRequests: 0,
          dataDeletionRequests: 0,
          consentWithdrawals: 0,
          averageResponseTime: 0
        },
        auditTrail: {
          totalEvents: auditSummary.totalEvents,
          criticalEvents: auditSummary.criticalEvents,
          securityEvents: auditSummary.securityEvents,
          dataAccessEvents: auditSummary.dataAccessEvents,
          recentEvents: auditData.recentEvents
        },
        userActivity: {
          activeUsers: userStats.active || 0,
          suspendedUsers: userStats.suspended || 0,
          revokedUsers: userStats.revoked || 0,
          newRegistrations: userActivity.newRegistrations[0]?.count || 0,
          failedLogins: 0 // Would be calculated from audit logs
        },
        dataRetention: {
          recordsScheduledForDeletion: 0, // Would be calculated from retention policies
          recordsDeleted: 0,
          anonymizedRecords: 0,
          retentionPolicyViolations: 0
        },
        period: {
          start: startDate,
          end: endDate
        }
      };
    } catch (error) {
      logger.error('Error generating compliance report:', error);
      throw new Error('Failed to generate compliance report');
    }
  }

  /**
   * Helper method to process daily trends data
   */
  private static processDailyTrends(trendsData: any): any[] {
    const { clicks = [], conversions = [], commissions = [] } = trendsData;
    
    // Create a map of all dates
    const dateMap = new Map();
    
    clicks.forEach((item: any) => {
      dateMap.set(item._id, { date: item._id, clicks: item.clicks, conversions: 0, commissions: 0, revenue: 0 });
    });
    
    conversions.forEach((item: any) => {
      const existing = dateMap.get(item._id) || { date: item._id, clicks: 0, conversions: 0, commissions: 0, revenue: 0 };
      existing.conversions = item.conversions;
      existing.revenue = item.revenue;
      dateMap.set(item._id, existing);
    });
    
    commissions.forEach((item: any) => {
      const existing = dateMap.get(item._id) || { date: item._id, clicks: 0, conversions: 0, commissions: 0, revenue: 0 };
      existing.commissions = item.commissions;
      dateMap.set(item._id, existing);
    });
    
    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Helper method to generate monthly trends from daily data
   */
  private static generateMonthlyTrends(dailyTrends: any[]): any[] {
    const monthlyMap = new Map();
    
    dailyTrends.forEach(day => {
      const month = day.date.substring(0, 7); // YYYY-MM
      const existing = monthlyMap.get(month) || { month, clicks: 0, conversions: 0, commissions: 0, revenue: 0 };
      
      existing.clicks += day.clicks;
      existing.conversions += day.conversions;
      existing.commissions += day.commissions;
      existing.revenue += day.revenue;
      
      monthlyMap.set(month, existing);
    });
    
    return Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * Helper method to process cash flow data
   */
  private static processCashFlowData(cashFlowData: any): any[] {
    const { revenue = [], commissions = [], payouts = [] } = cashFlowData;
    
    const dateMap = new Map();
    
    revenue.forEach((item: any) => {
      dateMap.set(item._id, { date: item._id, revenue: item.revenue, commissions: 0, payouts: 0, netCashFlow: 0 });
    });
    
    commissions.forEach((item: any) => {
      const existing = dateMap.get(item._id) || { date: item._id, revenue: 0, commissions: 0, payouts: 0, netCashFlow: 0 };
      existing.commissions = item.commissions;
      dateMap.set(item._id, existing);
    });
    
    payouts.forEach((item: any) => {
      const existing = dateMap.get(item._id) || { date: item._id, revenue: 0, commissions: 0, payouts: 0, netCashFlow: 0 };
      existing.payouts = item.payouts;
      dateMap.set(item._id, existing);
    });
    
    // Calculate net cash flow
    dateMap.forEach((value, key) => {
      value.netCashFlow = value.revenue - value.commissions - value.payouts;
    });
    
    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }
}