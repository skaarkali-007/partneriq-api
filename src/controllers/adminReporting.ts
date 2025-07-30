import { Request, Response } from 'express';
import { AdminReportingService } from '../services/analytics/adminReporting';
import { logger } from '../utils/logger';

export class AdminReportingController {
  /**
   * Get platform-wide performance dashboard
   */
  static async getPlatformPerformanceDashboard(req: Request, res: Response): Promise<void> {
    try {
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

      const dashboard = await AdminReportingService.getPlatformPerformanceDashboard(start, end);

      res.json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      logger.error('Error getting platform performance dashboard:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve platform performance dashboard'
        }
      });
    }
  }

  /**
   * Get financial report for commission and payouts
   */
  static async getFinancialReport(req: Request, res: Response): Promise<void> {
    try {
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

      const report = await AdminReportingService.getFinancialReport(start, end);

      res.json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('Error getting financial report:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve financial report'
        }
      });
    }
  }

  /**
   * Get compliance report for audit purposes
   */
  static async getComplianceReport(req: Request, res: Response): Promise<void> {
    try {
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

      const report = await AdminReportingService.getComplianceReport(start, end);

      res.json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('Error getting compliance report:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve compliance report'
        }
      });
    }
  }

  /**
   * Get comprehensive admin dashboard with all reports
   */
  static async getAdminDashboard(req: Request, res: Response): Promise<void> {
    try {
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

      // Get all reports in parallel
      const [platformPerformance, financialReport, complianceReport] = await Promise.all([
        AdminReportingService.getPlatformPerformanceDashboard(start, end),
        AdminReportingService.getFinancialReport(start, end),
        AdminReportingService.getComplianceReport(start, end)
      ]);

      res.json({
        success: true,
        data: {
          platformPerformance,
          financialReport,
          complianceReport,
          period: {
            start,
            end
          }
        }
      });
    } catch (error) {
      logger.error('Error getting admin dashboard:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve admin dashboard'
        }
      });
    }
  }

  /**
   * Export report data in various formats
   */
  static async exportReport(req: Request, res: Response): Promise<void> {
    try {
      const { reportType, startDate, endDate, format = 'json' } = req.query;

      if (!reportType || !startDate || !endDate) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Report type, start date, and end date are required'
          }
        });
        return;
      }

      if (!['platform_performance', 'financial', 'compliance'].includes(reportType as string)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid report type. Must be platform_performance, financial, or compliance'
          }
        });
        return;
      }

      if (!['json', 'csv', 'xlsx'].includes(format as string)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid format. Must be json, csv, or xlsx'
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

      // Get the appropriate report data
      let reportData: any;
      switch (reportType) {
        case 'platform_performance':
          reportData = await AdminReportingService.getPlatformPerformanceDashboard(start, end);
          break;
        case 'financial':
          reportData = await AdminReportingService.getFinancialReport(start, end);
          break;
        case 'compliance':
          reportData = await AdminReportingService.getComplianceReport(start, end);
          break;
      }

      // Set appropriate headers
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `${reportType}_report_${timestamp}`;

      switch (format) {
        case 'json':
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
          res.send(JSON.stringify({
            data: reportData,
            exportedAt: new Date().toISOString()
          }, null, 2));
          break;

        case 'csv':
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
          // Convert to CSV (simplified implementation)
          const csvData = this.convertToCSV(reportData);
          res.send(csvData);
          break;

        case 'xlsx':
          res.status(501).json({
            error: {
              code: 'NOT_IMPLEMENTED',
              message: 'XLSX export not yet implemented'
            }
          });
          break;
      }
    } catch (error) {
      logger.error('Error exporting report:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to export report'
        }
      });
    }
  }

  /**
   * Get report generation status and history
   */
  static async getReportHistory(req: any, res: any): Promise<void> {
    try {
      const { page = 1, limit = 20, reportType } = req.query;

      // This would typically query a report history table
      // For now, return mock data
      const mockHistory = [
        {
          id: '1',
          reportType: 'platform_performance',
          generatedAt: new Date(),
          generatedBy: req.user?.id,
          status: 'completed',
          fileUrl: '/reports/platform_performance_2024-01-15.json'
        },
        {
          id: '2',
          reportType: 'financial',
          generatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          generatedBy: req.user?.id,
          status: 'completed',
          fileUrl: '/reports/financial_2024-01-14.json'
        }
      ];

      res.json({
        success: true,
        data: {
          reports: mockHistory,
          pagination: {
            page: parseInt(page as string),
            limit: parseInt(limit as string),
            total: mockHistory.length,
            pages: Math.ceil(mockHistory.length / parseInt(limit as string))
          }
        }
      });
    } catch (error) {
      logger.error('Error getting report history:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve report history'
        }
      });
    }
  }

  /**
   * Helper method to convert report data to CSV
   */
  private static convertToCSV(data: any): string {
    // This is a simplified CSV conversion
    // In a real implementation, you would properly flatten the nested data structure
    const jsonString = JSON.stringify(data, null, 2);
    return `"Report Data"\n"${jsonString.replace(/"/g, '""')}"`;
  }
}