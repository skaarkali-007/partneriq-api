import { Request, Response } from 'express';
import { PaymentMethod } from '../models/PaymentMethod';
import Joi from 'joi';

// Base validation schema
const basePaymentMethodSchema = Joi.object({
  methodType: Joi.string().valid('bank_transfer', 'paypal', 'stripe', 'bitcoin', 'ethereum', 'usdc', 'usdt').required(),
  accountDetails: Joi.object({
    // Bank transfer fields
    accountNumber: Joi.string().optional(),
    routingNumber: Joi.string().optional(),
    bankName: Joi.string().optional(),
    accountHolderName: Joi.string().optional(),
    // PayPal fields
    paypalEmail: Joi.string().email().optional(),
    // Stripe fields
    stripeAccountId: Joi.string().optional(),
    // Cryptocurrency fields
    walletAddress: Joi.string().optional(),
    walletLabel: Joi.string().optional(),
    network: Joi.string().optional(),
    // Common fields
    currency: Joi.string().length(3).uppercase().default('USD'),
    country: Joi.string().length(2).uppercase().optional()
  }).required(),
  isDefault: Joi.boolean().default(false)
});

const updatePaymentMethodSchema = Joi.object({
  accountDetails: Joi.object({
    accountNumber: Joi.string(),
    routingNumber: Joi.string(),
    bankName: Joi.string(),
    accountHolderName: Joi.string(),
    paypalEmail: Joi.string().email(),
    stripeAccountId: Joi.string(),
    walletAddress: Joi.string(),
    walletLabel: Joi.string(),
    network: Joi.string(),
    currency: Joi.string().length(3).uppercase(),
    country: Joi.string().length(2).uppercase()
  }),
  isDefault: Joi.boolean()
});

// Create payment method
export const createPaymentMethod = async (req: Request, res: Response) => {
  try {
    const { error, value } = basePaymentMethodSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    // Custom validation based on method type
    const validationErrors = [];
    const { methodType, accountDetails } = value;

    if (methodType === 'bank_transfer') {
      if (!accountDetails.accountNumber) validationErrors.push({ field: 'accountDetails.accountNumber', message: 'Account number is required for bank transfer' });
      if (!accountDetails.routingNumber) validationErrors.push({ field: 'accountDetails.routingNumber', message: 'Routing number is required for bank transfer' });
      if (!accountDetails.bankName) validationErrors.push({ field: 'accountDetails.bankName', message: 'Bank name is required for bank transfer' });
      if (!accountDetails.accountHolderName) validationErrors.push({ field: 'accountDetails.accountHolderName', message: 'Account holder name is required for bank transfer' });
      if (!accountDetails.country) validationErrors.push({ field: 'accountDetails.country', message: 'Country is required for bank transfer' });
    } else if (methodType === 'paypal') {
      if (!accountDetails.paypalEmail) validationErrors.push({ field: 'accountDetails.paypalEmail', message: 'PayPal email is required for PayPal payments' });
      if (!accountDetails.country) validationErrors.push({ field: 'accountDetails.country', message: 'Country is required for PayPal payments' });
    } else if (methodType === 'stripe') {
      if (!accountDetails.stripeAccountId) validationErrors.push({ field: 'accountDetails.stripeAccountId', message: 'Stripe account ID is required for Stripe payments' });
      if (!accountDetails.country) validationErrors.push({ field: 'accountDetails.country', message: 'Country is required for Stripe payments' });
    } else if (['bitcoin', 'ethereum', 'usdc', 'usdt'].includes(methodType)) {
      if (!accountDetails.walletAddress) validationErrors.push({ field: 'accountDetails.walletAddress', message: 'Wallet address is required for cryptocurrency payments' });
      
      // Basic wallet address validation
      const walletAddress = accountDetails.walletAddress;
      if (methodType === 'bitcoin' && !walletAddress.match(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/)) {
        validationErrors.push({ field: 'accountDetails.walletAddress', message: 'Invalid Bitcoin wallet address format' });
      } else if (methodType === 'ethereum' && !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        validationErrors.push({ field: 'accountDetails.walletAddress', message: 'Invalid Ethereum wallet address format' });
      } else if ((methodType === 'usdc' || methodType === 'usdt') && !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        validationErrors.push({ field: 'accountDetails.walletAddress', message: 'Invalid wallet address format (must be Ethereum-compatible)' });
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: validationErrors
        }
      });
    }

    const userId = (req as any).user._id;

    // Check if user already has 5 payment methods (limit)
    const existingCount = await PaymentMethod.countDocuments({ userId });
    if (existingCount >= 5) {
      return res.status(400).json({
        error: {
          code: 'LIMIT_EXCEEDED',
          message: 'Maximum of 5 payment methods allowed per user'
        }
      });
    }

    const paymentMethod = new PaymentMethod({
      userId,
      methodType: value.methodType,
      accountDetails: value.accountDetails,
      isDefault: value.isDefault
    });

    await paymentMethod.save();

    res.status(201).json({
      success: true,
      data: paymentMethod
    });
  } catch (error) {
    console.error('Error creating payment method:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create payment method'
      }
    });
  }
};

// Get user's payment methods
export const getPaymentMethods = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    
    const paymentMethods = await PaymentMethod.find({ userId })
      .sort({ isDefault: -1, createdAt: -1 });

    res.json({
      success: true,
      data: paymentMethods
    });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch payment methods'
      }
    });
  }
};

// Get single payment method
export const getPaymentMethod = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user._id;

    const paymentMethod = await PaymentMethod.findOne({ _id: id, userId });
    
    if (!paymentMethod) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payment method not found'
        }
      });
    }

    res.json({
      success: true,
      data: paymentMethod
    });
  } catch (error) {
    console.error('Error fetching payment method:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch payment method'
      }
    });
  }
};

// Update payment method
export const updatePaymentMethod = async (req: Request, res: Response) => {
  try {
    const { error, value } = updatePaymentMethodSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const { id } = req.params;
    const userId = (req as any).user._id;

    const paymentMethod = await PaymentMethod.findOne({ _id: id, userId });
    
    if (!paymentMethod) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payment method not found'
        }
      });
    }

    // Update fields
    if (value.accountDetails) {
      paymentMethod.accountDetails = { ...paymentMethod.accountDetails, ...value.accountDetails };
    }
    if (typeof value.isDefault === 'boolean') {
      paymentMethod.isDefault = value.isDefault;
    }

    // Reset verification status if account details changed
    if (value.accountDetails) {
      paymentMethod.verificationStatus = 'pending';
      paymentMethod.isVerified = false;
      paymentMethod.verificationDate = undefined;
    }

    await paymentMethod.save();

    res.json({
      success: true,
      data: paymentMethod
    });
  } catch (error) {
    console.error('Error updating payment method:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update payment method'
      }
    });
  }
};

// Delete payment method
export const deletePaymentMethod = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const paymentMethod = await PaymentMethod.findOne({ _id: id, userId });
    
    if (!paymentMethod) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payment method not found'
        }
      });
    }

    // Check if there are pending payout requests using this payment method
    const { PayoutRequest } = require('../models/PayoutRequest');
    const pendingPayouts = await PayoutRequest.countDocuments({
      paymentMethodId: id,
      status: { $in: ['requested', 'approved', 'processing'] }
    });

    if (pendingPayouts > 0) {
      return res.status(400).json({
        error: {
          code: 'PAYMENT_METHOD_IN_USE',
          message: 'Cannot delete payment method with pending payout requests'
        }
      });
    }

    await PaymentMethod.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Payment method deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting payment method:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to delete payment method'
      }
    });
  }
};

// Set default payment method
export const setDefaultPaymentMethod = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const paymentMethod = await PaymentMethod.findOne({ _id: id, userId });
    
    if (!paymentMethod) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payment method not found'
        }
      });
    }

    paymentMethod.isDefault = true;
    await paymentMethod.save();

    res.json({
      success: true,
      data: paymentMethod
    });
  } catch (error) {
    console.error('Error setting default payment method:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to set default payment method'
      }
    });
  }
};

// Verify payment method (admin only)
export const verifyPaymentMethod = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!['verified', 'failed'].includes(status)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Status must be either "verified" or "failed"'
        }
      });
    }

    const paymentMethod = await PaymentMethod.findById(id);
    
    if (!paymentMethod) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payment method not found'
        }
      });
    }

    paymentMethod.verificationStatus = status;
    paymentMethod.isVerified = status === 'verified';
    paymentMethod.verificationDate = new Date();

    await paymentMethod.save();

    res.json({
      success: true,
      data: paymentMethod
    });
  } catch (error) {
    console.error('Error verifying payment method:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to verify payment method'
      }
    });
  }
};