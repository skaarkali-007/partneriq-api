import { Request, Response } from 'express';
import { MarketerAnalyticsService } from '../services/analytics/marketerAnalytics';
import { logger } from '../utils/logger';

export class MarketerAnalyticsController {
  /**
   * Get conversion rate analysis for a marketer
   */
  static async getConversionRateAnalysis(req: any, res: any): Promise<void> {
    try {
      const { marketerId } = req.params;
      const { startDate, endDate } = req.query;

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

      // Check if user can access this marketer's data
      if (req.user?.role !== 'admin' && req.user?.id !== marketerId) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied to this marketer data'
          }
        });
        return;
      }

      const analysis = await MarketerAnalyticsService.getConversionRateAnalysis(
        marketerId,
        start,
        end
      );

      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      logger.error('Error getting conversion rate analysis:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve conversion rate analysis'
        }
      });
    }
  }

  /**
   * Get commission trend analysis for a marketer
   */
  static async getCommissionTrendAnalysis(req: any, res: any): Promise<void> {
    try {
      const { marketerId } = req.params;
      const { startDate, endDate } = req.query;

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

      // Check if user can access this marketer's data
      if (req.user?.role !== 'admin' && req.user?.id !== marketerId) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied to this marketer data'
          }
        });
        return;
      }

      const analysis = await MarketerAnalyticsService.getCommissionTrendAnalysis(
        marketerId,
        start,
        end
      );

      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      logger.error('Error getting commission trend analysis:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve commission trend analysis'
        }
      });
    }
  }

  /**
   * Get customer acquisition cost analysis for a marketer
   */
  static async getCustomerAcquisitionCost(req: any, res: any): Promise<void> {
    try {
      const { marketerId } = req.params;
      const { startDate, endDate, marketingSpend } = req.query;

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

      // Check if user can access this marketer's data
      if (req.user?.role !== 'admin' && req.user?.id !== marketerId) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied to this marketer data'
          }
        });
        return;
      }

      const spend = marketingSpend ? parseFloat(marketingSpend as string) : undefined;

      const analysis = await MarketerAnalyticsService.getCustomerAcquisitionCost(
        marketerId,
        start,
        end,
        spend
      );

      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      logger.error('Error getting customer acquisition cost:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve customer acquisition cost'
        }
      });
    }
  }

  /**
   * Get performance benchmark for a marketer
   */
  static async getPerformanceBenchmark(req: any, res: any): Promise<void> {
    try {
      const { marketerId } = req.params;
      const { startDate, endDate } = req.query;

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

      // Check if user can access this marketer's data
      if (req.user?.role !== 'admin' && req.user?.id !== marketerId) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied to this marketer data'
          }
        });
        return;
      }

      const benchmark = await MarketerAnalyticsService.getPerformanceBenchmark(
        marketerId,
        start,
        end
      );

      res.json({
        success: true,
        data: benchmark
      });
    } catch (error) {
      logger.error('Error getting performance benchmark:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve performance benchmark'
        }
      });
    }
  }

  /**
   * Get comprehensive marketer analytics dashboard
   */
  static async getMarketerDashboard(req: any, res: any): Promise<void> {
    try {
      const { marketerId } = req.params;
      const { startDate, endDate, marketingSpend } = req.query;

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

      // Check if user can access this marketer's data
      if (req.user?.role !== 'admin' && req.user?.id !== marketerId) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied to this marketer data'
          }
        });
        return;
      }

      const spend = marketingSpend ? parseFloat(marketingSpend as string) : undefined;

      // Get all analytics in parallel
      const [conversionRate, commissionTrend, acquisitionCost, benchmark] = await Promise.all([
        MarketerAnalyticsService.getConversionRateAnalysis(marketerId, start, end),
        MarketerAnalyticsService.getCommissionTrendAnalysis(marketerId, start, end),
        MarketerAnalyticsService.getCustomerAcquisitionCost(marketerId, start, end, spend),
        MarketerAnalyticsService.getPerformanceBenchmark(marketerId, start, end)
      ]);

      res.json({
        success: true,
        data: {
          conversionRate,
          commissionTrend,
          acquisitionCost,
          benchmark,
          period: {
            start,
            end
          }
        }
      });
    } catch (error) {
      logger.error('Error getting marketer dashboard:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve marketer dashboard'
        }
      });
    }
  }

  /**
   * Get current user's analytics (for authenticated marketer)
   */
  static async getCurrentMarketerAnalytics(req: any, res: any): Promise<void> {
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

      const { startDate, endDate, marketingSpend } = req.query;

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

      const spend = marketingSpend ? parseFloat(marketingSpend as string) : undefined;

      // Get all analytics in parallel
      const [conversionRate, commissionTrend, acquisitionCost, benchmark] = await Promise.all([
        MarketerAnalyticsService.getConversionRateAnalysis(marketerId, start, end),
        MarketerAnalyticsService.getCommissionTrendAnalysis(marketerId, start, end),
        MarketerAnalyticsService.getCustomerAcquisitionCost(marketerId, start, end, spend),
        MarketerAnalyticsService.getPerformanceBenchmark(marketerId, start, end)
      ]);

      res.json({
        success: true,
        data: {
          conversionRate,
          commissionTrend,
          acquisitionCost,
          benchmark,
          period: {
            start,
            end
          }
        }
      });
    } catch (error) {
      logger.error('Error getting current marketer analytics:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve marketer analytics'
        }
      });
    }
  }
}