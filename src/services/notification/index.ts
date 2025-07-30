import { OnboardingService } from '../onboarding';
import { User } from '../../models/User';
import { Product } from '../../models/Product';
import { logger } from '../../utils/logger';

export interface EmailNotification {
  to: string;
  subject: string;
  template: string;
  data: any;
}

export class NotificationService {
  private static initialized = false;

  /**
   * Initialize notification service and set up event listeners
   */
  static initialize(): void {
    if (this.initialized) return;

    // Listen for onboarding status changes
    OnboardingService.onStatusChange(this.handleStatusChange.bind(this));
    
    // Listen for conversion events
    OnboardingService.onConversion(this.handleConversion.bind(this));

    this.initialized = true;
    logger.info('Notification service initialized');
  }

  /**
   * Handle onboarding status change notifications
   */
  private static async handleStatusChange(data: any): Promise<void> {
    try {
      const { customerId, status, trackingCode, marketerId, productId, email, firstName, lastName } = data;

      // Get product information
      const product = await Product.findById(productId);
      if (!product) {
        logger.error(`Product not found for notification: ${productId}`);
        return;
      }

      // Send notification to customer
      if (email) {
        await this.sendCustomerStatusNotification({
          customerEmail: email,
          customerName: `${firstName} ${lastName}`,
          status,
          productName: product.name,
          customerId
        });
      }

      // Send notification to marketer if available
      if (marketerId) {
        const marketer = await User.findById(marketerId);
        if (marketer && marketer.email) {
          await this.sendMarketerStatusNotification({
            marketerEmail: marketer.email,
            marketerName: `${marketer.firstName || ''} ${marketer.lastName || ''}`.trim(),
            customerName: `${firstName} ${lastName}`,
            status,
            productName: product.name,
            trackingCode
          });
        }
      }

    } catch (error) {
      logger.error('Error handling status change notification:', error);
    }
  }

  /**
   * Handle conversion notifications
   */
  private static async handleConversion(data: any): Promise<void> {
    try {
      const { customerId, trackingCode, marketerId, productId, initialSpendAmount, customerEmail, customerName } = data;

      // Get product information
      const product = await Product.findById(productId);
      if (!product) {
        logger.error(`Product not found for conversion notification: ${productId}`);
        return;
      }

      // Send notification to customer
      if (customerEmail) {
        await this.sendCustomerConversionNotification({
          customerEmail,
          customerName,
          productName: product.name,
          initialSpendAmount
        });
      }

      // Send notification to marketer
      if (marketerId) {
        const marketer = await User.findById(marketerId);
        if (marketer && marketer.email) {
          await this.sendMarketerConversionNotification({
            marketerEmail: marketer.email,
            marketerName: `${marketer.firstName || ''} ${marketer.lastName || ''}`.trim(),
            customerName,
            productName: product.name,
            initialSpendAmount,
            trackingCode
          });
        }
      }

    } catch (error) {
      logger.error('Error handling conversion notification:', error);
    }
  }

  /**
   * Send status notification to customer
   */
  private static async sendCustomerStatusNotification(data: {
    customerEmail: string;
    customerName: string;
    status: string;
    productName: string;
    customerId: string;
  }): Promise<void> {
    try {
      const { customerEmail, customerName, status, productName, customerId } = data;

      let subject = '';
      let template = '';

      switch (status) {
        case 'completed':
          subject = `Application Submitted - ${productName}`;
          template = 'customer-application-submitted';
          break;
        case 'rejected':
          subject = `Application Update - ${productName}`;
          template = 'customer-application-rejected';
          break;
        default:
          // Don't send notifications for intermediate steps
          return;
      }

      const emailData = {
        customerName,
        productName,
        status,
        customerId: customerId.slice(-8).toUpperCase(),
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        supportPhone: process.env.SUPPORT_PHONE || '1-800-123-4567'
      };

      await this.sendEmail({
        to: customerEmail,
        subject,
        template,
        data: emailData
      });

      logger.info(`Sent ${status} notification to customer: ${customerEmail}`);

    } catch (error) {
      logger.error('Error sending customer status notification:', error);
    }
  }

  /**
   * Send status notification to marketer
   */
  private static async sendMarketerStatusNotification(data: {
    marketerEmail: string;
    marketerName: string;
    customerName: string;
    status: string;
    productName: string;
    trackingCode: string;
  }): Promise<void> {
    try {
      const { marketerEmail, marketerName, customerName, status, productName, trackingCode } = data;

      let subject = '';
      let template = '';

      switch (status) {
        case 'completed':
          subject = `Customer Application Submitted - ${customerName}`;
          template = 'marketer-customer-submitted';
          break;
        case 'rejected':
          subject = `Customer Application Rejected - ${customerName}`;
          template = 'marketer-customer-rejected';
          break;
        default:
          // Don't send notifications for intermediate steps
          return;
      }

      const emailData = {
        marketerName,
        customerName,
        productName,
        status,
        trackingCode,
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
      };

      await this.sendEmail({
        to: marketerEmail,
        subject,
        template,
        data: emailData
      });

      logger.info(`Sent ${status} notification to marketer: ${marketerEmail}`);

    } catch (error) {
      logger.error('Error sending marketer status notification:', error);
    }
  }

  /**
   * Send conversion notification to customer
   */
  private static async sendCustomerConversionNotification(data: {
    customerEmail: string;
    customerName: string;
    productName: string;
    initialSpendAmount: number;
  }): Promise<void> {
    try {
      const { customerEmail, customerName, productName, initialSpendAmount } = data;

      const emailData = {
        customerName,
        productName,
        initialSpendAmount: initialSpendAmount.toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD'
        }),
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com'
      };

      await this.sendEmail({
        to: customerEmail,
        subject: `Investment Confirmed - ${productName}`,
        template: 'customer-conversion-confirmed',
        data: emailData
      });

      logger.info(`Sent conversion confirmation to customer: ${customerEmail}`);

    } catch (error) {
      logger.error('Error sending customer conversion notification:', error);
    }
  }

  /**
   * Send conversion notification to marketer
   */
  private static async sendMarketerConversionNotification(data: {
    marketerEmail: string;
    marketerName: string;
    customerName: string;
    productName: string;
    initialSpendAmount: number;
    trackingCode: string;
  }): Promise<void> {
    try {
      const { marketerEmail, marketerName, customerName, productName, initialSpendAmount, trackingCode } = data;

      const emailData = {
        marketerName,
        customerName,
        productName,
        initialSpendAmount: initialSpendAmount.toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD'
        }),
        trackingCode,
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
        commissionsUrl: `${process.env.FRONTEND_URL}/commissions`
      };

      await this.sendEmail({
        to: marketerEmail,
        subject: `Commission Earned - ${customerName} Invested!`,
        template: 'marketer-conversion-earned',
        data: emailData
      });

      logger.info(`Sent conversion notification to marketer: ${marketerEmail}`);

    } catch (error) {
      logger.error('Error sending marketer conversion notification:', error);
    }
  }

  /**
   * Send email using configured email service
   */
  private static async sendEmail(notification: EmailNotification): Promise<void> {
    try {
      // In a real implementation, this would integrate with an email service like:
      // - SendGrid
      // - AWS SES
      // - Mailgun
      // - Nodemailer with SMTP
      
      // For now, we'll just log the email that would be sent
      logger.info('Email notification (would be sent):', {
        to: notification.to,
        subject: notification.subject,
        template: notification.template,
        data: notification.data
      });

      // TODO: Implement actual email sending
      // Example with SendGrid:
      /*
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      
      const msg = {
        to: notification.to,
        from: process.env.FROM_EMAIL,
        subject: notification.subject,
        templateId: notification.template,
        dynamicTemplateData: notification.data
      };
      
      await sgMail.send(msg);
      */

    } catch (error) {
      logger.error('Error sending email:', error);
      throw error;
    }
  }

  /**
   * Send manual notification (for admin use)
   */
  static async sendManualNotification(notification: EmailNotification): Promise<void> {
    await this.sendEmail(notification);
  }
}