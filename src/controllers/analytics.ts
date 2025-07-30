import { Request, Response } from 'express';
import { AnalyticsService } from '../services/analytics';
import { logger } from '../utils/logger';

export class AnalyticsController {
  /**
   * Get performance metrics
   */
  static async getPerformanceMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { startDate, endDate, marketerId, productId } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Start date and end date are required'
          }
        });
        return;
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid date format'
          }
        });
        return;
      }

      const metrics = await AnalyticsService.getPerformanceMetrics(
        start,
        end,
        marketerId as string,
        productId as string
      );

      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      logger.error('Error getting performance metrics:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve performance metrics'
        }
      });
    }
  }

  /**
   * Get conversion analytics
   */
  static async getConversionAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const { startDate, endDate, marketerId } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Start date and end date are required'
          }
        });
        return;
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid date format'
          }
        });
        return;
      }

      const analytics = await AnalyticsService.getConversionAnalytics(
        start,
        end,
        marketerId as string
      );

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error getting conversion analytics:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve conversion analytics'
        }
      });
    }
  }

  /**
   * Get real-time metrics
   */
  static async getRealtimeMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await AnalyticsService.getRealtimeMetrics();

      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      logger.error('Error getting realtime metrics:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve realtime metrics'
        }
      });
    }
  }

  /**
   * Generate custom report
   */
  static async generateCustomReport(req: Request, res: Response): Promise<void> {
    try {
      const { reportType, filters = {}, groupBy, sortBy, limit } = req.body;

      if (!reportType || !['clicks', 'conversions', 'commissions'].includes(reportType)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Valid report type is required (clicks, conversions, commissions)'
          }
        });
        return;
      }

      const reportData = await AnalyticsService.generateCustomReport(
        reportType,
        filters,
        groupBy,
        sortBy,
        limit ? parseInt(limit) : undefined
      );

      res.json({
        success: true,
        data: reportData
      });
    } catch (error) {
      logger.error('Error generating custom report:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate custom report'
        }
      });
    }
  }

  /**
   * Export report data
   */
  static async exportReportData(req: Request, res: Response): Promise<void> {
    try {
      const { reportType, filters = {}, groupBy, sortBy, format = 'json' } = req.query;

      if (!reportType || !['clicks', 'conversions', 'commissions'].includes(reportType as string)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Valid report type is required (clicks, conversions, commissions)'
          }
        });
        return;
      }

      if (!['json', 'csv', 'xlsx'].includes(format as string)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Valid format is required (json, csv, xlsx)'
          }
        });
        return;
      }

      // Parse filters if it's a string
      let parsedFilters = filters;
      if (typeof filters === 'string') {
        try {
          parsedFilters = JSON.parse(filters as string);
        } catch (error) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid filters format'
            }
          });
          return;
        }
      }

      // Generate report data
      const reportData = await AnalyticsService.generateCustomReport(
        reportType as 'clicks' | 'conversions' | 'commissions',
        parsedFilters,
        groupBy as string,
        sortBy as string
      );

      // Export data
      const exportedData = await AnalyticsService.exportData(reportData, {
        format: format as 'json' | 'csv' | 'xlsx',
        includeHeaders: true
      });

      // Set appropriate headers
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `${reportType}_report_${timestamp}`;

      switch (format) {
        case 'json':
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
          break;
        case 'csv':
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
          break;
        case 'xlsx':
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
          break;
      }

      res.send(exportedData);
    } catch (error) {
      logger.error('Error exporting report data:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to export report data'
        }
      });
    }
  }

  /**
   * Initialize real-time analytics
   */
  static async initializeRealtimeAnalytics(req: Request, res: Response): Promise<void> {
    try {
      await AnalyticsService.initializeRealtimeAnalytics();

      res.json({
        success: true,
        message: 'Real-time analytics initialized'
      });
    } catch (error) {
      logger.error('Error initializing real-time analytics:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to initialize real-time analytics'
        }
      });
    }
  }

  /**
   * Get dashboard summary for marketers
   */
  static async getDashboardSummary(req: any, res: any): Promise<void> {
    try {
      const marketerId = req.user?.id;
      if (!marketerId) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        });
        return;
      }

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Get metrics for different periods
      const [monthlyMetrics, weeklyMetrics, realtimeMetrics] = await Promise.all([
        AnalyticsService.getPerformanceMetrics(thirtyDaysAgo, now, marketerId),
        AnalyticsService.getPerformanceMetrics(sevenDaysAgo, now, marketerId),
        AnalyticsService.getRealtimeMetrics()
      ]);

      // Get conversion analytics for the month
      const conversionAnalytics = await AnalyticsService.getConversionAnalytics(
        thirtyDaysAgo,
        now,
        marketerId
      );

      res.json({
        success: true,
        data: {
          monthly: monthlyMetrics,
          weekly: weeklyMetrics,
          realtime: realtimeMetrics,
          conversions: conversionAnalytics
        }
      });
    } catch (error) {
      logger.error('Error getting dashboard summary:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve dashboard summary'
        }
      });
    }
  }

  /**
   * Get admin analytics overview
   */
  static async getAdminAnalyticsOverview(req: Request, res: Response): Promise<void> {
    try {
      const { period = '30' } = req.query;
      const days = parseInt(period as string);
      
      if (isNaN(days) || days < 1 || days > 365) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Period must be between 1 and 365 days'
          }
        });
        return;
      }

      const now = new Date();
      const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      // Get platform-wide metrics
      const [performanceMetrics, conversionAnalytics, realtimeMetrics] = await Promise.all([
        AnalyticsService.getPerformanceMetrics(startDate, now),
        AnalyticsService.getConversionAnalytics(startDate, now),
        AnalyticsService.getRealtimeMetrics()
      ]);

      // Get top performing marketers
      const topMarketersReport = await AnalyticsService.generateCustomReport(
        'conversions',
        { startDate, endDate: now },
        'trackingCode',
        'count',
        10
      );

      res.json({
        success: true,
        data: {
          performance: performanceMetrics,
          conversions: conversionAnalytics,
          realtime: realtimeMetrics,
          topMarketers: topMarketersReport.data,
          period: {
            days,
            startDate,
            endDate: now
          }
        }
      });
    } catch (error) {
      logger.error('Error getting admin analytics overview:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve admin analytics overview'
        }
      });
    }
  }
}