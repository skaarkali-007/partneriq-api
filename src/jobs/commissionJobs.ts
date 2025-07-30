import { CommissionService } from '../services/commission';
import { logger } from '../utils/logger';

/**
 * Job to automatically approve commissions that have passed their clearance period
 */
export class CommissionJobs {
  /**
   * Process commissions eligible for automatic approval
   * This job should be run periodically (e.g., daily) to check for commissions
   * that have passed their clearance period and automatically approve them
   */
  static async processEligibleCommissions(): Promise<void> {
    try {
      logger.info('Starting commission approval job');
      
      const result = await CommissionService.bulkApproveEligibleCommissions();
      
      logger.info(`Commission approval job completed: ${result.approved} commissions approved`, {
        approved: result.approved,
        errors: result.errors.length,
        errorDetails: result.errors
      });

      if (result.errors.length > 0) {
        logger.warn('Some commissions failed to approve during bulk approval', {
          errors: result.errors
        });
      }
    } catch (error) {
      logger.error('Commission approval job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Run comprehensive automated commission processing
   * This is the main job that should be scheduled to run daily
   */
  static async runAutomatedProcessing(): Promise<void> {
    try {
      logger.info('Starting automated commission processing job');
      
      const result = await CommissionService.processAutomatedCommissionUpdates();
      
      logger.info('Automated commission processing completed', {
        summary: result.summary,
        autoApproved: result.autoApproved,
        errorCount: result.errors.length
      });

      if (result.errors.length > 0) {
        logger.warn('Errors occurred during automated commission processing', {
          errors: result.errors
        });
      }
    } catch (error) {
      logger.error('Automated commission processing job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Generate commission lifecycle report
   * This job can be used to generate periodic reports on commission status
   */
  static async generateLifecycleReport(): Promise<{
    pending: number;
    approved: number;
    paid: number;
    clawedBack: number;
    eligibleForApproval: number;
  }> {
    try {
      logger.info('Generating commission lifecycle report');

      const [
        pendingCommissions,
        approvedCommissions,
        paidCommissions,
        clawedBackCommissions,
        eligibleCommissions
      ] = await Promise.all([
        CommissionService.getCommissions({ status: 'pending' }, 1, 1000),
        CommissionService.getCommissions({ status: 'approved' }, 1, 1000),
        CommissionService.getCommissions({ status: 'paid' }, 1, 1000),
        CommissionService.getCommissions({ status: 'clawed_back' }, 1, 1000),
        CommissionService.getCommissionsEligibleForApproval()
      ]);

      const report = {
        pending: pendingCommissions.pagination.total,
        approved: approvedCommissions.pagination.total,
        paid: paidCommissions.pagination.total,
        clawedBack: clawedBackCommissions.pagination.total,
        eligibleForApproval: eligibleCommissions.length
      };

      logger.info('Commission lifecycle report generated', report);
      return report;
    } catch (error) {
      logger.error('Failed to generate commission lifecycle report', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Check for commissions approaching their clearance period end
   * This can be used to send notifications to administrators
   */
  static async checkApproachingClearance(daysBeforeExpiry: number = 3): Promise<any[]> {
    try {
      logger.info(`Checking for commissions approaching clearance period (${daysBeforeExpiry} days)`);

      const approachingDate = new Date();
      approachingDate.setDate(approachingDate.getDate() + daysBeforeExpiry);

      const { commissions } = await CommissionService.getCommissions({
        status: 'pending'
      }, 1, 1000);

      const approachingCommissions = commissions.filter(commission => {
        const eligibleDate = new Date(commission.eligibleForPayoutDate);
        return eligibleDate <= approachingDate && eligibleDate > new Date();
      });

      logger.info(`Found ${approachingCommissions.length} commissions approaching clearance period`);
      return approachingCommissions;
    } catch (error) {
      logger.error('Failed to check approaching clearance periods', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}