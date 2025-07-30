import mongoose from 'mongoose';
import { ClickEvent } from '../../models/ClickEvent';
import { ConversionEvent } from '../../models/ConversionEvent';
import { ReferralLink } from '../../models/ReferralLink';
import { Commission } from '../../models/Commission';
import { logger } from '../../utils/logger';

export interface ConversionRateMetrics {
  marketerId: string;
  totalClicks: number;
  totalConversions: number;
  conversionRate: number;
  period: {
    start: Date;
    end: Date;
  };
  byProduct: Array<{
    productId: string;
    clicks: number;
    conversions: number;
    conversionRate: number;
  }>;
  byTimeframe: Array<{
    date: string;
    clicks: number;
    conversions: number;
    conversionRate: number;
  }>;
}

export interface CommissionTrendAnalysis {
  marketerId: string;
  totalCommissions: number;
  totalAmount: number;
  averageCommission: number;
  period: {
    start: Date;
    end: Date;
  };
  trends: Array<{
    date: string;
    commissions: number;
    amount: number;
    cumulativeAmount: number;
  }>;
  byProduct: Array<{
    productId: string;
    commissions: number;
    amount: number;
    averageCommission: number;
  }>;
  statusBreakdown: Array<{
    status: string;
    count: number;
    amount: number;
  }>;
}

export interface CustomerAcquisitionCost {
  marketerId: string;
  totalCustomers: number;
  totalSpend: number;
  averageCustomerValue: number;
  acquisitionCost: number;
  period: {
    start: Date;
    end: Date;
  };
  byProduct: Array<{
    productId: string;
    customers: number;
    totalSpend: number;
    averageCustomerValue: number;
    acquisitionCost: number;
  }>;
  cohortAnalysis: Array<{
    cohortMonth: string;
    customers: number;
    totalSpend: number;
    averageCustomerValue: number;
  }>;
}

export interface PerformanceBenchmark {
  marketerId: string;
  metrics: {
    conversionRate: number;
    averageCommission: number;
    customerValue: number;
    acquisitionCost: number;
  };
  benchmarks: {
    conversionRate: {
      percentile: number;
      average: number;
      top10Percent: number;
    };
    averageCommission: {
      percentile: number;
      average: number;
      top10Percent: number;
    };
    customerValue: {
      percentile: number;
      average: number;
      top10Percent: number;
    };
    acquisitionCost: {
      percentile: number;
      average: number;
      bottom10Percent: number;
    };
  };
  ranking: {
    overall: number;
    totalMarketers: number;
    category: 'top' | 'above_average' | 'average' | 'below_average' | 'bottom';
  };
}

export class MarketerAnalyticsService {
  /**
   * Get conversion rate tracking and analysis for a marketer
   */
  static async getConversionRateAnalysis(
    marketerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ConversionRateMetrics> {
    try {
      // Get marketer's referral links
      const referralLinks = await ReferralLink.find({ marketerId }).select('trackingCode productId');
      const trackingCodes = referralLinks.map(link => link.trackingCode);
      
      if (trackingCodes.length === 0) {
        return {
          marketerId,
          totalClicks: 0,
          totalConversions: 0,
          conversionRate: 0,
          period: { start: startDate, end: endDate },
          byProduct: [],
          byTimeframe: []
        };
      }

      // Aggregation for total clicks and conversions
      const clicksPipeline: any[] = [
        {
          $match: {
            trackingCode: { $in: trackingCodes },
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
            trackingCode: { $in: trackingCodes },
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

      // Conversion rate by product
      const byProductPipeline: any[] = [
        {
          $match: {
            trackingCode: { $in: trackingCodes },
            conversionTimestamp: { $gte: startDate, $lte: endDate },
            commissionEligible: true
          }
        },
        {
          $group: {
            _id: '$productId',
            conversions: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'click_events',
            let: { productId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $in: ['$trackingCode', trackingCodes] },
                      { $gte: ['$timestamp', startDate] },
                      { $lte: ['$timestamp', endDate] }
                    ]
                  }
                }
              },
              {
                $lookup: {
                  from: 'referrallinks',
                  localField: 'trackingCode',
                  foreignField: 'trackingCode',
                  as: 'referralLink'
                }
              },
              { $unwind: '$referralLink' },
              {
                $match: {
                  $expr: { $eq: ['$referralLink.productId', '$$productId'] }
                }
              },
              {
                $group: {
                  _id: null,
                  clicks: { $sum: 1 }
                }
              }
            ],
            as: 'clickData'
          }
        },
        {
          $project: {
            productId: '$_id',
            conversions: 1,
            clicks: {
              $ifNull: [{ $arrayElemAt: ['$clickData.clicks', 0] }, 0]
            },
            conversionRate: {
              $cond: {
                if: { $gt: [{ $ifNull: [{ $arrayElemAt: ['$clickData.clicks', 0] }, 0] }, 0] },
                then: {
                  $multiply: [
                    { $divide: ['$conversions', { $ifNull: [{ $arrayElemAt: ['$clickData.clicks', 0] }, 1] }] },
                    100
                  ]
                },
                else: 0
              }
            },
            _id: 0
          }
        },
        { $sort: { conversionRate: -1 } }
      ];

      // Conversion rate by timeframe (daily)
      const byTimeframePipeline: any[] = [
        {
          $facet: {
            clicks: [
              {
                $match: {
                  trackingCode: { $in: trackingCodes },
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
                  trackingCode: { $in: trackingCodes },
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
                  conversions: { $sum: 1 }
                }
              }
            ]
          }
        },
        {
          $project: {
            combined: {
              $map: {
                input: '$clicks',
                as: 'click',
                in: {
                  date: '$$click._id',
                  clicks: '$$click.clicks',
                  conversions: {
                    $let: {
                      vars: {
                        conversion: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: '$conversions',
                                cond: { $eq: ['$$this._id', '$$click._id'] }
                              }
                            },
                            0
                          ]
                        }
                      },
                      in: { $ifNull: ['$$conversion.conversions', 0] }
                    }
                  },
                  conversionRate: {
                    $let: {
                      vars: {
                        conversion: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: '$conversions',
                                cond: { $eq: ['$$this._id', '$$click._id'] }
                              }
                            },
                            0
                          ]
                        }
                      },
                      in: {
                        $cond: {
                          if: { $gt: ['$$click.clicks', 0] },
                          then: {
                            $multiply: [
                              { $divide: [{ $ifNull: ['$$conversion.conversions', 0] }, '$$click.clicks'] },
                              100
                            ]
                          },
                          else: 0
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        { $unwind: '$combined' },
        { $replaceRoot: { newRoot: '$combined' } },
        { $sort: { date: 1 } }
      ];

      // Execute aggregations
      const [clicksResult, conversionsResult, byProductResult] = await Promise.all([
        ClickEvent.aggregate(clicksPipeline),
        ConversionEvent.aggregate(conversionsPipeline),
        ConversionEvent.aggregate(byProductPipeline)
      ]);

      const byTimeframeResult = await ClickEvent.aggregate(byTimeframePipeline);

      const totalClicks = clicksResult[0]?.totalClicks || 0;
      const totalConversions = conversionsResult[0]?.totalConversions || 0;
      const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;

      return {
        marketerId,
        totalClicks,
        totalConversions,
        conversionRate: Math.round(conversionRate * 100) / 100,
        period: { start: startDate, end: endDate },
        byProduct: byProductResult,
        byTimeframe: byTimeframeResult
      };
    } catch (error) {
      logger.error('Error getting conversion rate analysis:', error);
      throw new Error('Failed to retrieve conversion rate analysis');
    }
  }

  /**
   * Get commission trend analysis using MongoDB time-series collections
   */
  static async getCommissionTrendAnalysis(
    marketerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<CommissionTrendAnalysis> {
    try {
      // Commission trends by day
      const trendsPipeline: any[] = [
        {
          $match: {
            marketerId,
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
            commissions: { $sum: 1 },
            amount: { $sum: '$commissionAmount' }
          }
        },
        { $sort: { _id: 1 } },
        {
          $group: {
            _id: null,
            trends: {
              $push: {
                date: '$_id',
                commissions: '$commissions',
                amount: '$amount'
              }
            }
          }
        },
        {
          $project: {
            trends: {
              $map: {
                input: { $range: [0, { $size: '$trends' }] },
                as: 'index',
                in: {
                  date: { $arrayElemAt: ['$trends.date', '$$index'] },
                  commissions: { $arrayElemAt: ['$trends.commissions', '$$index'] },
                  amount: { $arrayElemAt: ['$trends.amount', '$$index'] },
                  cumulativeAmount: {
                    $sum: {
                      $slice: [
                        '$trends.amount',
                        0,
                        { $add: ['$$index', 1] }
                      ]
                    }
                  }
                }
              }
            },
            _id: 0
          }
        }
      ];

      // Commission breakdown by product
      const byProductPipeline: any[] = [
        {
          $match: {
            marketerId,
            conversionDate: { $gte: startDate, $lte: endDate },
            status: { $in: ['approved', 'paid'] }
          }
        },
        {
          $group: {
            _id: '$productId',
            commissions: { $sum: 1 },
            amount: { $sum: '$commissionAmount' },
            averageCommission: { $avg: '$commissionAmount' }
          }
        },
        {
          $project: {
            productId: '$_id',
            commissions: 1,
            amount: 1,
            averageCommission: 1,
            _id: 0
          }
        },
        { $sort: { amount: -1 } }
      ];

      // Commission status breakdown
      const statusBreakdownPipeline: any[] = [
        {
          $match: {
            marketerId,
            conversionDate: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            amount: { $sum: '$commissionAmount' }
          }
        },
        {
          $project: {
            status: '$_id',
            count: 1,
            amount: 1,
            _id: 0
          }
        },
        { $sort: { count: -1 } }
      ];

      // Total summary
      const summaryPipeline: any[] = [
        {
          $match: {
            marketerId,
            conversionDate: { $gte: startDate, $lte: endDate },
            status: { $in: ['approved', 'paid'] }
          }
        },
        {
          $group: {
            _id: null,
            totalCommissions: { $sum: 1 },
            totalAmount: { $sum: '$commissionAmount' },
            averageCommission: { $avg: '$commissionAmount' }
          }
        }
      ];

      // Execute aggregations
      const [trendsResult, byProductResult, statusBreakdownResult, summaryResult] = await Promise.all([
        Commission.aggregate(trendsPipeline),
        Commission.aggregate(byProductPipeline),
        Commission.aggregate(statusBreakdownPipeline),
        Commission.aggregate(summaryPipeline)
      ]);

      const summary = summaryResult[0] || { totalCommissions: 0, totalAmount: 0, averageCommission: 0 };
      const trends = trendsResult[0]?.trends || [];

      return {
        marketerId,
        totalCommissions: summary.totalCommissions,
        totalAmount: summary.totalAmount,
        averageCommission: summary.averageCommission,
        period: { start: startDate, end: endDate },
        trends,
        byProduct: byProductResult,
        statusBreakdown: statusBreakdownResult
      };
    } catch (error) {
      logger.error('Error getting commission trend analysis:', error);
      throw new Error('Failed to retrieve commission trend analysis');
    }
  }

  /**
   * Calculate customer acquisition cost with MongoDB aggregation
   */
  static async getCustomerAcquisitionCost(
    marketerId: string,
    startDate: Date,
    endDate: Date,
    marketingSpend?: number
  ): Promise<CustomerAcquisitionCost> {
    try {
      // Get marketer's referral links
      const referralLinks = await ReferralLink.find({ marketerId }).select('trackingCode productId');
      const trackingCodes = referralLinks.map(link => link.trackingCode);

      if (trackingCodes.length === 0) {
        return {
          marketerId,
          totalCustomers: 0,
          totalSpend: 0,
          averageCustomerValue: 0,
          acquisitionCost: 0,
          period: { start: startDate, end: endDate },
          byProduct: [],
          cohortAnalysis: []
        };
      }

      // Customer acquisition metrics
      const customerMetricsPipeline: any[] = [
        {
          $match: {
            trackingCode: { $in: trackingCodes },
            conversionTimestamp: { $gte: startDate, $lte: endDate },
            commissionEligible: true
          }
        },
        {
          $group: {
            _id: null,
            totalCustomers: { $addToSet: '$customerId' },
            totalSpend: { $sum: '$initialSpendAmount' },
            averageCustomerValue: { $avg: '$initialSpendAmount' }
          }
        },
        {
          $project: {
            totalCustomers: { $size: '$totalCustomers' },
            totalSpend: 1,
            averageCustomerValue: 1,
            _id: 0
          }
        }
      ];

      // Customer acquisition by product
      const byProductPipeline: any[] = [
        {
          $match: {
            trackingCode: { $in: trackingCodes },
            conversionTimestamp: { $gte: startDate, $lte: endDate },
            commissionEligible: true
          }
        },
        {
          $group: {
            _id: '$productId',
            customers: { $addToSet: '$customerId' },
            totalSpend: { $sum: '$initialSpendAmount' },
            averageCustomerValue: { $avg: '$initialSpendAmount' }
          }
        },
        {
          $project: {
            productId: '$_id',
            customers: { $size: '$customers' },
            totalSpend: 1,
            averageCustomerValue: 1,
            acquisitionCost: {
              $cond: {
                if: { $gt: [{ $size: '$customers' }, 0] },
                then: { $divide: [marketingSpend || 0, { $size: '$customers' }] },
                else: 0
              }
            },
            _id: 0
          }
        },
        { $sort: { totalSpend: -1 } }
      ];

      // Cohort analysis by month
      const cohortAnalysisPipeline: any[] = [
        {
          $match: {
            trackingCode: { $in: trackingCodes },
            conversionTimestamp: { $gte: startDate, $lte: endDate },
            commissionEligible: true
          }
        },
        {
          $group: {
            _id: {
              cohortMonth: {
                $dateToString: {
                  format: '%Y-%m',
                  date: '$conversionTimestamp'
                }
              }
            },
            customers: { $addToSet: '$customerId' },
            totalSpend: { $sum: '$initialSpendAmount' },
            averageCustomerValue: { $avg: '$initialSpendAmount' }
          }
        },
        {
          $project: {
            cohortMonth: '$_id.cohortMonth',
            customers: { $size: '$customers' },
            totalSpend: 1,
            averageCustomerValue: 1,
            _id: 0
          }
        },
        { $sort: { cohortMonth: 1 } }
      ];

      // Execute aggregations
      const [customerMetricsResult, byProductResult, cohortAnalysisResult] = await Promise.all([
        ConversionEvent.aggregate(customerMetricsPipeline),
        ConversionEvent.aggregate(byProductPipeline),
        ConversionEvent.aggregate(cohortAnalysisPipeline)
      ]);

      const customerMetrics = customerMetricsResult[0] || {
        totalCustomers: 0,
        totalSpend: 0,
        averageCustomerValue: 0
      };

      const acquisitionCost = customerMetrics.totalCustomers > 0 && marketingSpend
        ? marketingSpend / customerMetrics.totalCustomers
        : 0;

      return {
        marketerId,
        totalCustomers: customerMetrics.totalCustomers,
        totalSpend: customerMetrics.totalSpend,
        averageCustomerValue: customerMetrics.averageCustomerValue,
        acquisitionCost,
        period: { start: startDate, end: endDate },
        byProduct: byProductResult,
        cohortAnalysis: cohortAnalysisResult
      };
    } catch (error) {
      logger.error('Error calculating customer acquisition cost:', error);
      throw new Error('Failed to calculate customer acquisition cost');
    }
  }

  /**
   * Get comparative performance benchmarking using MongoDB analytics
   */
  static async getPerformanceBenchmark(
    marketerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<PerformanceBenchmark> {
    try {
      // Get marketer's performance metrics
      const [conversionRate, commissionTrend, acquisitionCost] = await Promise.all([
        this.getConversionRateAnalysis(marketerId, startDate, endDate),
        this.getCommissionTrendAnalysis(marketerId, startDate, endDate),
        this.getCustomerAcquisitionCost(marketerId, startDate, endDate)
      ]);

      const marketerMetrics = {
        conversionRate: conversionRate.conversionRate,
        averageCommission: commissionTrend.averageCommission,
        customerValue: acquisitionCost.averageCustomerValue,
        acquisitionCost: acquisitionCost.acquisitionCost
      };

      // Get platform-wide benchmarks
      const benchmarksPipeline: any[] = [
        {
          $facet: {
            conversionRates: [
              {
                $lookup: {
                  from: 'referrallinks',
                  localField: 'marketerId',
                  foreignField: 'marketerId',
                  as: 'referralLinks'
                }
              },
              { $unwind: '$referralLinks' },
              {
                $lookup: {
                  from: 'click_events',
                  localField: 'referralLinks.trackingCode',
                  foreignField: 'trackingCode',
                  as: 'clicks'
                }
              },
              {
                $lookup: {
                  from: 'conversion_events',
                  localField: 'referralLinks.trackingCode',
                  foreignField: 'trackingCode',
                  as: 'conversions'
                }
              },
              {
                $group: {
                  _id: '$marketerId',
                  clicks: { $sum: { $size: '$clicks' } },
                  conversions: {
                    $sum: {
                      $size: {
                        $filter: {
                          input: '$conversions',
                          cond: {
                            $and: [
                              { $gte: ['$$this.conversionTimestamp', startDate] },
                              { $lte: ['$$this.conversionTimestamp', endDate] },
                              { $eq: ['$$this.commissionEligible', true] }
                            ]
                          }
                        }
                      }
                    }
                  }
                }
              },
              {
                $project: {
                  conversionRate: {
                    $cond: {
                      if: { $gt: ['$clicks', 0] },
                      then: { $multiply: [{ $divide: ['$conversions', '$clicks'] }, 100] },
                      else: 0
                    }
                  }
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
                  _id: '$marketerId',
                  averageCommission: { $avg: '$commissionAmount' }
                }
              }
            ],
            customerValues: [
              {
                $lookup: {
                  from: 'referrallinks',
                  localField: 'marketerId',
                  foreignField: 'marketerId',
                  as: 'referralLinks'
                }
              },
              { $unwind: '$referralLinks' },
              {
                $lookup: {
                  from: 'conversion_events',
                  localField: 'referralLinks.trackingCode',
                  foreignField: 'trackingCode',
                  as: 'conversions'
                }
              },
              { $unwind: '$conversions' },
              {
                $match: {
                  'conversions.conversionTimestamp': { $gte: startDate, $lte: endDate },
                  'conversions.commissionEligible': true
                }
              },
              {
                $group: {
                  _id: '$marketerId',
                  averageCustomerValue: { $avg: '$conversions.initialSpendAmount' }
                }
              }
            ]
          }
        }
      ];

      // This is a simplified benchmark calculation
      // In a real implementation, you would need to run this against all marketers
      const benchmarksResult = await Commission.aggregate(benchmarksPipeline);
      
      // For now, return mock benchmarks - in production this would be calculated from actual data
      const mockBenchmarks = {
        conversionRate: {
          percentile: 75,
          average: 2.5,
          top10Percent: 8.0
        },
        averageCommission: {
          percentile: 60,
          average: 45.0,
          top10Percent: 120.0
        },
        customerValue: {
          percentile: 70,
          average: 850.0,
          top10Percent: 2500.0
        },
        acquisitionCost: {
          percentile: 40,
          average: 125.0,
          bottom10Percent: 50.0
        }
      };

      // Calculate overall ranking (simplified)
      const overallScore = (
        (marketerMetrics.conversionRate / mockBenchmarks.conversionRate.average) * 25 +
        (marketerMetrics.averageCommission / mockBenchmarks.averageCommission.average) * 25 +
        (marketerMetrics.customerValue / mockBenchmarks.customerValue.average) * 25 +
        (mockBenchmarks.acquisitionCost.average / Math.max(marketerMetrics.acquisitionCost, 1)) * 25
      );

      let category: 'top' | 'above_average' | 'average' | 'below_average' | 'bottom';
      if (overallScore >= 150) category = 'top';
      else if (overallScore >= 120) category = 'above_average';
      else if (overallScore >= 80) category = 'average';
      else if (overallScore >= 50) category = 'below_average';
      else category = 'bottom';

      return {
        marketerId,
        metrics: marketerMetrics,
        benchmarks: mockBenchmarks,
        ranking: {
          overall: Math.round(overallScore),
          totalMarketers: 100, // This would be calculated from actual data
          category
        }
      };
    } catch (error) {
      logger.error('Error getting performance benchmark:', error);
      throw new Error('Failed to retrieve performance benchmark');
    }
  }
}