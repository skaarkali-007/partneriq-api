import mongoose from 'mongoose';
import { ClickEvent } from '../../models/ClickEvent';
import { ConversionEvent } from '../../models/ConversionEvent';
import { ReferralLink } from '../../models/ReferralLink';
import { Commission } from '../../models/Commission';
import { logger } from '../../utils/logger';

export interface PerformanceMetrics {
  totalClicks: number;
  totalConversions: number;
  conversionRate: number;
  totalCommissionAmount: number;
  averageCommissionAmount: number;
  totalCustomers: number;
  period: {
    start: Date;
    end: Date;
  };
}

export interface ConversionAnalytics {
  conversionsByDay: Array<{
    date: string;
    conversions: number;
    revenue: number;
  }>;
  conversionsByProduct: Array<{
    productId: string;
    productName?: string;
    conversions: number;
    revenue: number;
  }>;
  conversionsByMarketer: Array<{
    marketerId: string;
    conversions: number;
    revenue: number;
  }>;
}

export interface RealtimeMetrics {
  activeUsers: number;
  recentClicks: number;
  recentConversions: number;
  hourlyStats: Array<{
    hour: number;
    clicks: number;
    conversions: number;
  }>;
}

export interface CustomReportData {
  data: any[];
  totalCount: number;
  aggregatedMetrics?: any;
}

export interface ExportOptions {
  format: 'json' | 'csv' | 'xlsx';
  includeHeaders?: boolean;
  dateFormat?: string;
}

export class AnalyticsService {
  private static changeStream: any | null = null;
  private static realtimeCallbacks: Array<(data: any) => void> = [];

  /**
   * Get comprehensive performance metrics using MongoDB aggregation
   */
  static async getPerformanceMetrics(
    startDate: Date,
    endDate: Date,
    marketerId?: string,
    productId?: string
  ): Promise<PerformanceMetrics> {
    try {
      const matchStage: any = {
        timestamp: { $gte: startDate, $lte: endDate }
      };

      if (marketerId) {
        // Get tracking codes for the marketer
        const referralLinks = await ReferralLink.find({ marketerId }).select('trackingCode');
        const trackingCodes = referralLinks.map(link => link.trackingCode);
        matchStage.trackingCode = { $in: trackingCodes };
      }

      if (productId) {
        // Get tracking codes for the product
        const referralLinks = await ReferralLink.find({ productId }).select('trackingCode');
        const trackingCodes = referralLinks.map(link => link.trackingCode);
        matchStage.trackingCode = { $in: trackingCodes };
      }

      // Aggregation pipeline for clicks
      const clicksPipeline: any[] = [
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalClicks: { $sum: 1 },
            uniqueCustomers: { $addToSet: '$customerId' }
          }
        }
      ];

      // Aggregation pipeline for conversions
      const conversionMatchStage: any = {
        conversionTimestamp: { $gte: startDate, $lte: endDate },
        commissionEligible: true
      };

      if (marketerId) {
        const referralLinks = await ReferralLink.find({ marketerId }).select('trackingCode');
        const trackingCodes = referralLinks.map(link => link.trackingCode);
        conversionMatchStage.trackingCode = { $in: trackingCodes };
      }

      if (productId) {
        conversionMatchStage.productId = productId;
      }

      const conversionsPipeline: any[] = [
        { $match: conversionMatchStage },
        {
          $group: {
            _id: null,
            totalConversions: { $sum: 1 },
            totalRevenue: { $sum: '$initialSpendAmount' },
            uniqueCustomers: { $addToSet: '$customerId' }
          }
        }
      ];

      // Commission aggregation
      const commissionMatchStage: any = {
        conversionDate: { $gte: startDate, $lte: endDate },
        status: { $in: ['approved', 'paid'] }
      };

      if (marketerId) {
        commissionMatchStage.marketerId = marketerId;
      }

      if (productId) {
        commissionMatchStage.productId = productId;
      }

      const commissionPipeline: any[] = [
        { $match: commissionMatchStage },
        {
          $group: {
            _id: null,
            totalCommissionAmount: { $sum: '$commissionAmount' },
            averageCommissionAmount: { $avg: '$commissionAmount' },
            commissionCount: { $sum: 1 }
          }
        }
      ];

      // Execute aggregations in parallel
      const [clicksResult, conversionsResult, commissionsResult] = await Promise.all([
        ClickEvent.aggregate(clicksPipeline),
        ConversionEvent.aggregate(conversionsPipeline),
        Commission.aggregate(commissionPipeline)
      ]);

      const clicks = clicksResult[0] || { totalClicks: 0, uniqueCustomers: [] };
      const conversions = conversionsResult[0] || { totalConversions: 0, totalRevenue: 0, uniqueCustomers: [] };
      const commissions = commissionsResult[0] || { totalCommissionAmount: 0, averageCommissionAmount: 0 };

      const conversionRate = clicks.totalClicks > 0 ? (conversions.totalConversions / clicks.totalClicks) * 100 : 0;

      return {
        totalClicks: clicks.totalClicks,
        totalConversions: conversions.totalConversions,
        conversionRate: Math.round(conversionRate * 100) / 100,
        totalCommissionAmount: commissions.totalCommissionAmount || 0,
        averageCommissionAmount: commissions.averageCommissionAmount || 0,
        totalCustomers: conversions.uniqueCustomers.length,
        period: {
          start: startDate,
          end: endDate
        }
      };
    } catch (error) {
      logger.error('Error getting performance metrics:', error);
      throw new Error('Failed to retrieve performance metrics');
    }
  }

  /**
   * Get detailed conversion analytics using MongoDB aggregation
   */
  static async getConversionAnalytics(
    startDate: Date,
    endDate: Date,
    marketerId?: string
  ): Promise<ConversionAnalytics> {
    try {
      const matchStage: any = {
        conversionTimestamp: { $gte: startDate, $lte: endDate },
        commissionEligible: true
      };

      if (marketerId) {
        const referralLinks = await ReferralLink.find({ marketerId }).select('trackingCode');
        const trackingCodes = referralLinks.map(link => link.trackingCode);
        matchStage.trackingCode = { $in: trackingCodes };
      }

      // Conversions by day
      const conversionsByDayPipeline: any[] = [
        { $match: matchStage },
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
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            date: '$_id',
            conversions: 1,
            revenue: 1,
            _id: 0
          }
        }
      ];

      // Conversions by product
      const conversionsByProductPipeline: any[] = [
        { $match: matchStage },
        {
          $group: {
            _id: '$productId',
            conversions: { $sum: 1 },
            revenue: { $sum: '$initialSpendAmount' }
          }
        },
        { $sort: { conversions: -1 } },
        {
          $project: {
            productId: '$_id',
            conversions: 1,
            revenue: 1,
            _id: 0
          }
        }
      ];

      // Conversions by marketer (if not filtered by specific marketer)
      let conversionsByMarketerPipeline: any[] = [];
      if (!marketerId) {
        conversionsByMarketerPipeline = [
          { $match: matchStage },
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
            $group: {
              _id: '$referralLink.marketerId',
              conversions: { $sum: 1 },
              revenue: { $sum: '$initialSpendAmount' }
            }
          },
          { $sort: { conversions: -1 } },
          {
            $project: {
              marketerId: '$_id',
              conversions: 1,
              revenue: 1,
              _id: 0
            }
          }
        ];
      }

      // Execute aggregations
      const [conversionsByDay, conversionsByProduct, conversionsByMarketer] = await Promise.all([
        ConversionEvent.aggregate(conversionsByDayPipeline),
        ConversionEvent.aggregate(conversionsByProductPipeline),
        marketerId ? Promise.resolve([]) : ConversionEvent.aggregate(conversionsByMarketerPipeline)
      ]);

      return {
        conversionsByDay,
        conversionsByProduct,
        conversionsByMarketer
      };
    } catch (error) {
      logger.error('Error getting conversion analytics:', error);
      throw new Error('Failed to retrieve conversion analytics');
    }
  }

  /**
   * Get real-time metrics using MongoDB change streams
   */
  static async getRealtimeMetrics(): Promise<RealtimeMetrics> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Recent clicks (last hour)
      const recentClicksPipeline: any[] = [
        {
          $match: {
            timestamp: { $gte: oneHourAgo }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            uniqueSessions: { $addToSet: '$sessionId' }
          }
        }
      ];

      // Recent conversions (last hour)
      const recentConversionsPipeline: any[] = [
        {
          $match: {
            conversionTimestamp: { $gte: oneHourAgo },
            commissionEligible: true
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 }
          }
        }
      ];

      // Hourly stats for the last 24 hours
      const hourlyStatsPipeline: any[] = [
        {
          $match: {
            timestamp: { $gte: oneDayAgo }
          }
        },
        {
          $group: {
            _id: {
              $hour: '$timestamp'
            },
            clicks: { $sum: 1 }
          }
        },
        {
          $project: {
            hour: '$_id',
            clicks: 1,
            _id: 0
          }
        },
        { $sort: { hour: 1 } }
      ];

      // Execute aggregations
      const [recentClicksResult, recentConversionsResult, hourlyStatsResult] = await Promise.all([
        ClickEvent.aggregate(recentClicksPipeline),
        ConversionEvent.aggregate(recentConversionsPipeline),
        ClickEvent.aggregate(hourlyStatsPipeline)
      ]);

      const recentClicks = recentClicksResult[0] || { count: 0, uniqueSessions: [] };
      const recentConversions = recentConversionsResult[0] || { count: 0 };

      return {
        activeUsers: recentClicks.uniqueSessions.length,
        recentClicks: recentClicks.count,
        recentConversions: recentConversions.count,
        hourlyStats: hourlyStatsResult
      };
    } catch (error) {
      logger.error('Error getting realtime metrics:', error);
      throw new Error('Failed to retrieve realtime metrics');
    }
  }

  /**
   * Generate custom reports using MongoDB aggregation framework
   */
  static async generateCustomReport(
    reportType: 'clicks' | 'conversions' | 'commissions',
    filters: any = {},
    groupBy?: string,
    sortBy?: string,
    limit?: number
  ): Promise<CustomReportData> {
    try {
      let collection: any;
      let pipeline: any[] = [];

      // Determine collection and base match stage
      switch (reportType) {
        case 'clicks':
          collection = ClickEvent;
          break;
        case 'conversions':
          collection = ConversionEvent;
          break;
        case 'commissions':
          collection = Commission;
          break;
        default:
          throw new Error('Invalid report type');
      }

      // Build match stage from filters
      const matchStage: any = {};
      
      if (filters.startDate && filters.endDate) {
        const dateField = reportType === 'clicks' ? 'timestamp' : 
                         reportType === 'conversions' ? 'conversionTimestamp' : 'conversionDate';
        matchStage[dateField] = {
          $gte: new Date(filters.startDate),
          $lte: new Date(filters.endDate)
        };
      }

      if (filters.marketerId) {
        if (reportType === 'commissions') {
          matchStage.marketerId = filters.marketerId;
        } else {
          // For clicks and conversions, need to get tracking codes
          const referralLinks = await ReferralLink.find({ marketerId: filters.marketerId }).select('trackingCode');
          const trackingCodes = referralLinks.map(link => link.trackingCode);
          matchStage.trackingCode = { $in: trackingCodes };
        }
      }

      if (filters.productId) {
        if (reportType === 'clicks') {
          const referralLinks = await ReferralLink.find({ productId: filters.productId }).select('trackingCode');
          const trackingCodes = referralLinks.map(link => link.trackingCode);
          matchStage.trackingCode = { $in: trackingCodes };
        } else {
          matchStage.productId = filters.productId;
        }
      }

      if (filters.status && reportType === 'commissions') {
        matchStage.status = filters.status;
      }

      if (filters.commissionEligible !== undefined && reportType === 'conversions') {
        matchStage.commissionEligible = filters.commissionEligible;
      }

      pipeline.push({ $match: matchStage });

      // Add grouping if specified
      if (groupBy) {
        const groupStage: any = {
          _id: `$${groupBy}`,
          count: { $sum: 1 }
        };

        // Add relevant sum fields based on report type
        if (reportType === 'conversions') {
          groupStage.totalRevenue = { $sum: '$initialSpendAmount' };
          groupStage.avgRevenue = { $avg: '$initialSpendAmount' };
        } else if (reportType === 'commissions') {
          groupStage.totalCommission = { $sum: '$commissionAmount' };
          groupStage.avgCommission = { $avg: '$commissionAmount' };
        }

        pipeline.push({ $group: groupStage });

        // Project to clean up the output
        const projectStage: any = {
          [groupBy]: '$_id',
          count: 1,
          _id: 0
        };

        if (reportType === 'conversions') {
          projectStage.totalRevenue = 1;
          projectStage.avgRevenue = 1;
        } else if (reportType === 'commissions') {
          projectStage.totalCommission = 1;
          projectStage.avgCommission = 1;
        }

        pipeline.push({ $project: projectStage });
      }

      // Add sorting
      if (sortBy) {
        const sortStage: any = {};
        sortStage[sortBy] = -1; // Default to descending
        pipeline.push({ $sort: sortStage });
      }

      // Add limit
      if (limit) {
        pipeline.push({ $limit: limit });
      }

      // Execute the aggregation
      const data = await collection.aggregate(pipeline);

      // Get total count for pagination
      const countPipeline = [{ $match: matchStage }, { $count: 'total' }];
      const countResult = await collection.aggregate(countPipeline);
      const totalCount = countResult[0]?.total || 0;

      // Calculate aggregated metrics
      let aggregatedMetrics: any = {};
      if (data.length > 0) {
        if (reportType === 'conversions' && groupBy) {
          aggregatedMetrics = {
            totalRevenue: data.reduce((sum: number, item: any) => sum + (item.totalRevenue || 0), 0),
            totalConversions: data.reduce((sum: number, item: any) => sum + item.count, 0),
            avgRevenuePerGroup: data.reduce((sum: number, item: any) => sum + (item.avgRevenue || 0), 0) / data.length
          };
        } else if (reportType === 'commissions' && groupBy) {
          aggregatedMetrics = {
            totalCommission: data.reduce((sum: number, item: any) => sum + (item.totalCommission || 0), 0),
            totalCommissions: data.reduce((sum: number, item: any) => sum + item.count, 0),
            avgCommissionPerGroup: data.reduce((sum: number, item: any) => sum + (item.avgCommission || 0), 0) / data.length
          };
        }
      }

      return {
        data,
        totalCount,
        aggregatedMetrics
      };
    } catch (error) {
      logger.error('Error generating custom report:', error);
      throw new Error('Failed to generate custom report');
    }
  }

  /**
   * Export data in multiple formats using MongoDB queries
   */
  static async exportData(
    reportData: CustomReportData,
    options: ExportOptions
  ): Promise<string | Buffer> {
    try {
      const { format, includeHeaders = true, dateFormat = 'YYYY-MM-DD' } = options;

      switch (format) {
        case 'json':
          return JSON.stringify({
            data: reportData.data,
            totalCount: reportData.totalCount,
            aggregatedMetrics: reportData.aggregatedMetrics,
            exportedAt: new Date().toISOString()
          }, null, 2);

        case 'csv':
          return this.convertToCSV(reportData.data, includeHeaders);

        case 'xlsx':
          return this.convertToXLSX(reportData.data, includeHeaders);

        default:
          throw new Error('Unsupported export format');
      }
    } catch (error) {
      logger.error('Error exporting data:', error);
      throw new Error('Failed to export data');
    }
  }

  /**
   * Initialize real-time analytics using MongoDB change streams
   */
  static async initializeRealtimeAnalytics(): Promise<void> {
    try {
      if (this.changeStream) {
        await this.closeRealtimeAnalytics();
      }

      // Watch for changes in conversion events
      this.changeStream = ConversionEvent.watch([
        {
          $match: {
            operationType: 'insert',
            'fullDocument.commissionEligible': true
          }
        }
      ]);

      this.changeStream.on('change', (change: any) => {
        const conversionData = {
          type: 'conversion',
          data: change.fullDocument,
          timestamp: new Date()
        };

        // Notify all registered callbacks
        this.realtimeCallbacks.forEach(callback => {
          try {
            callback(conversionData);
          } catch (error) {
            logger.error('Error in realtime callback:', error);
          }
        });
      });

      logger.info('Real-time analytics initialized');
    } catch (error) {
      logger.error('Error initializing real-time analytics:', error);
      throw new Error('Failed to initialize real-time analytics');
    }
  }

  /**
   * Register callback for real-time updates
   */
  static registerRealtimeCallback(callback: (data: any) => void): void {
    this.realtimeCallbacks.push(callback);
  }

  /**
   * Unregister callback for real-time updates
   */
  static unregisterRealtimeCallback(callback: (data: any) => void): void {
    const index = this.realtimeCallbacks.indexOf(callback);
    if (index > -1) {
      this.realtimeCallbacks.splice(index, 1);
    }
  }

  /**
   * Close real-time analytics change stream
   */
  static async closeRealtimeAnalytics(): Promise<void> {
    try {
      if (this.changeStream) {
        await this.changeStream.close();
        this.changeStream = null;
        this.realtimeCallbacks = [];
        logger.info('Real-time analytics closed');
      }
    } catch (error) {
      logger.error('Error closing real-time analytics:', error);
    }
  }

  /**
   * Convert data to CSV format
   */
  private static convertToCSV(data: any[], includeHeaders: boolean): string {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    let csv = '';

    if (includeHeaders) {
      csv += headers.join(',') + '\n';
    }

    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value.toString();
      });
      csv += values.join(',') + '\n';
    });

    return csv;
  }

  /**
   * Convert data to XLSX format (placeholder - would need xlsx library)
   */
  private static convertToXLSX(data: any[], includeHeaders: boolean): Buffer {
    // This is a placeholder implementation
    // In a real implementation, you would use a library like 'xlsx' or 'exceljs'
    throw new Error('XLSX export not implemented - requires xlsx library');
  }
}