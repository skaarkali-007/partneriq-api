import { PaymentMethod } from '../../models/PaymentMethod';
import { PayoutRequest } from '../../models/PayoutRequest';

export interface PaymentGatewayResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  gatewayResponse?: any;
}

export interface BulkPayoutResult {
  successful: string[];
  failed: Array<{
    payoutId: string;
    error: string;
  }>;
  totalProcessed: number;
}

// PayPal integration service
export class PayPalService {
  private apiUrl: string;
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.apiUrl = process.env.PAYPAL_API_URL || 'https://api.sandbox.paypal.com';
    this.clientId = process.env.PAYPAL_CLIENT_ID || '';
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
  }

  async getAccessToken(): Promise<string> {
    try {
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      
      const response = await fetch(`${this.apiUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });

      const data = await response.json() as any;
      return data.access_token;
    } catch (error) {
      console.error('PayPal auth error:', error);
      throw new Error('Failed to authenticate with PayPal');
    }
  }

  async processPayout(payoutRequest: any, paymentMethod: any): Promise<PaymentGatewayResult> {
    try {
      const accessToken = await this.getAccessToken();
      const accountDetails = paymentMethod.decryptAccountDetails();

      if (!accountDetails?.paypalEmail) {
        return {
          success: false,
          error: 'Invalid PayPal account details'
        };
      }

      const payoutData = {
        sender_batch_header: {
          sender_batch_id: `payout_${payoutRequest._id}_${Date.now()}`,
          email_subject: 'You have a payout!',
          email_message: 'You have received a payout from our affiliate program.'
        },
        items: [{
          recipient_type: 'EMAIL',
          amount: {
            value: payoutRequest.netAmount.toFixed(2),
            currency: 'USD'
          },
          receiver: accountDetails.paypalEmail,
          note: `Affiliate commission payout - Request ID: ${payoutRequest._id}`,
          sender_item_id: payoutRequest._id.toString()
        }]
      };

      const response = await fetch(`${this.apiUrl}/v1/payments/payouts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payoutData)
      });

      const result = await response.json() as any;

      if (response.ok) {
        return {
          success: true,
          transactionId: result.batch_header.payout_batch_id,
          gatewayResponse: result
        };
      } else {
        return {
          success: false,
          error: result.message || 'PayPal payout failed',
          gatewayResponse: result
        };
      }
    } catch (error) {
      console.error('PayPal payout error:', error);
      return {
        success: false,
        error: 'PayPal service error'
      };
    }
  }

  async processBulkPayouts(payoutRequests: any[]): Promise<BulkPayoutResult> {
    const result: BulkPayoutResult = {
      successful: [],
      failed: [],
      totalProcessed: 0
    };

    try {
      const accessToken = await this.getAccessToken();
      
      // Group payouts by currency for batch processing
      const items = [];
      const payoutMap = new Map();

      for (const payout of payoutRequests) {
        const paymentMethod = await PaymentMethod.findById(payout.paymentMethodId);
        if (!paymentMethod) {
          result.failed.push({
            payoutId: payout._id.toString(),
            error: 'Payment method not found'
          });
          continue;
        }

        const accountDetails = paymentMethod.decryptAccountDetails();
        if (!accountDetails?.paypalEmail) {
          result.failed.push({
            payoutId: payout._id.toString(),
            error: 'Invalid PayPal account details'
          });
          continue;
        }

        const item = {
          recipient_type: 'EMAIL',
          amount: {
            value: payout.netAmount.toFixed(2),
            currency: 'USD'
          },
          receiver: accountDetails.paypalEmail,
          note: `Affiliate commission payout - Request ID: ${payout._id}`,
          sender_item_id: payout._id.toString()
        };

        items.push(item);
        payoutMap.set(payout._id.toString(), payout);
      }

      if (items.length === 0) {
        return result;
      }

      const bulkPayoutData = {
        sender_batch_header: {
          sender_batch_id: `bulk_payout_${Date.now()}`,
          email_subject: 'You have a payout!',
          email_message: 'You have received a payout from our affiliate program.'
        },
        items
      };

      const response = await fetch(`${this.apiUrl}/v1/payments/payouts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bulkPayoutData)
      });

      const responseData = await response.json() as any;

      if (response.ok) {
        // Mark all as successful for now - in production, you'd check individual item status
        for (const item of items) {
          result.successful.push(item.sender_item_id);
        }
        result.totalProcessed = items.length;
      } else {
        // Mark all as failed if batch fails
        for (const item of items) {
          result.failed.push({
            payoutId: item.sender_item_id,
            error: responseData.message || 'Bulk payout failed'
          });
        }
      }

    } catch (error) {
      console.error('PayPal bulk payout error:', error);
      // Mark all as failed on exception
      for (const payout of payoutRequests) {
        result.failed.push({
          payoutId: payout._id.toString(),
          error: 'PayPal service error'
        });
      }
    }

    result.totalProcessed = result.successful.length + result.failed.length;
    return result;
  }
}

// Stripe integration service
export class StripeService {
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = process.env.STRIPE_SECRET_KEY || '';
    this.apiUrl = 'https://api.stripe.com/v1';
  }

  async processPayout(payoutRequest: any, paymentMethod: any): Promise<PaymentGatewayResult> {
    try {
      const accountDetails = paymentMethod.decryptAccountDetails();

      if (!accountDetails?.stripeAccountId) {
        return {
          success: false,
          error: 'Invalid Stripe account details'
        };
      }

      // Create a transfer to the connected account
      const transferData = {
        amount: Math.round(payoutRequest.netAmount * 100), // Convert to cents
        currency: 'usd',
        destination: accountDetails.stripeAccountId,
        description: `Affiliate commission payout - Request ID: ${payoutRequest._id}`,
        metadata: {
          payout_request_id: payoutRequest._id.toString(),
          marketer_id: payoutRequest.marketerId
        }
      };

      const response = await fetch(`${this.apiUrl}/transfers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(transferData as any).toString()
      });

      const result = await response.json() as any;

      if (response.ok) {
        return {
          success: true,
          transactionId: result.id,
          gatewayResponse: result
        };
      } else {
        return {
          success: false,
          error: result.error?.message || 'Stripe transfer failed',
          gatewayResponse: result
        };
      }
    } catch (error) {
      console.error('Stripe payout error:', error);
      return {
        success: false,
        error: 'Stripe service error'
      };
    }
  }

  async processBulkPayouts(payoutRequests: any[]): Promise<BulkPayoutResult> {
    const result: BulkPayoutResult = {
      successful: [],
      failed: [],
      totalProcessed: 0
    };

    // Stripe doesn't have native bulk transfers, so process individually
    for (const payout of payoutRequests) {
      try {
        const paymentMethod = await PaymentMethod.findById(payout.paymentMethodId);
        if (!paymentMethod) {
          result.failed.push({
            payoutId: payout._id.toString(),
            error: 'Payment method not found'
          });
          continue;
        }

        const payoutResult = await this.processPayout(payout, paymentMethod);
        
        if (payoutResult.success) {
          result.successful.push(payout._id.toString());
        } else {
          result.failed.push({
            payoutId: payout._id.toString(),
            error: payoutResult.error || 'Unknown error'
          });
        }
      } catch (error) {
        result.failed.push({
          payoutId: payout._id.toString(),
          error: 'Processing error'
        });
      }
    }

    result.totalProcessed = result.successful.length + result.failed.length;
    return result;
  }
}

// Bank transfer service (placeholder - would integrate with banking APIs)
export class BankTransferService {
  async processPayout(payoutRequest: any, paymentMethod: any): Promise<PaymentGatewayResult> {
    // This would integrate with banking APIs like ACH, wire transfer services
    // For now, return a mock success response
    return {
      success: true,
      transactionId: `bank_${Date.now()}_${payoutRequest._id}`,
      gatewayResponse: {
        message: 'Bank transfer initiated - processing may take 1-3 business days'
      }
    };
  }

  async processBulkPayouts(payoutRequests: any[]): Promise<BulkPayoutResult> {
    const result: BulkPayoutResult = {
      successful: [],
      failed: [],
      totalProcessed: payoutRequests.length
    };

    // Mock bulk bank transfer processing
    for (const payout of payoutRequests) {
      result.successful.push(payout._id.toString());
    }

    return result;
  }
}

// Main payment service factory
export class PaymentService {
  static getService(methodType: string) {
    switch (methodType) {
      case 'paypal':
        return new PayPalService();
      case 'stripe':
        return new StripeService();
      case 'bank_transfer':
        return new BankTransferService();
      default:
        throw new Error(`Unsupported payment method: ${methodType}`);
    }
  }

  static async processPayout(payoutRequest: any): Promise<PaymentGatewayResult> {
    const paymentMethod = await PaymentMethod.findById(payoutRequest.paymentMethodId);
    
    if (!paymentMethod) {
      return {
        success: false,
        error: 'Payment method not found'
      };
    }

    const service = this.getService(paymentMethod.methodType);
    return await service.processPayout(payoutRequest, paymentMethod);
  }

  static async processBulkPayouts(payoutRequests: any[]): Promise<BulkPayoutResult> {
    // Group payouts by payment method type
    const groupedPayouts = new Map<string, any[]>();
    
    for (const payout of payoutRequests) {
      const paymentMethod = await PaymentMethod.findById(payout.paymentMethodId);
      if (!paymentMethod) continue;
      
      const methodType = paymentMethod.methodType;
      if (!groupedPayouts.has(methodType)) {
        groupedPayouts.set(methodType, []);
      }
      groupedPayouts.get(methodType)!.push(payout);
    }

    const combinedResult: BulkPayoutResult = {
      successful: [],
      failed: [],
      totalProcessed: 0
    };

    // Process each group with appropriate service
    for (const [methodType, payouts] of groupedPayouts) {
      try {
        const service = this.getService(methodType);
        const result = await service.processBulkPayouts(payouts);
        
        combinedResult.successful.push(...result.successful);
        combinedResult.failed.push(...result.failed);
        combinedResult.totalProcessed += result.totalProcessed;
      } catch (error) {
        // Mark all payouts in this group as failed
        for (const payout of payouts) {
          combinedResult.failed.push({
            payoutId: payout._id.toString(),
            error: `Service error for ${methodType}`
          });
        }
        combinedResult.totalProcessed += payouts.length;
      }
    }

    return combinedResult;
  }
}