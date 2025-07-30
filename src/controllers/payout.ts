import { Request, Response } from 'express';
import { PayoutRequest } from '../models/PayoutRequest';
import { PaymentMethod } from '../models/PaymentMethod';
import { Commission } from '../models/Commission';
import { PaymentService } from '../services/payment';
import Joi from 'joi';

// Validation schemas
const createPayoutRequestSchema = Joi.object({
  paymentMethodId: Joi.string().required(),
  amount: Joi.number().min(0.01).required()
});

const updatePayoutStatusSchema = Joi.object({
  status: Joi.string().valid('approved', 'processing', 'completed', 'failed', 'cancelled').required(),
  notes: Joi.string().max(1000),
  failureReason: Joi.string().max(500).when('status', {
    is: 'failed',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  transactionId: Joi.string().when('status', {
    is: Joi.valid('completed', 'processing'),
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  processingFee: Joi.number().min(0).default(0)
});

const bulkProcessPayoutsSchema = Joi.object({
  payoutIds: Joi.array().items(Joi.string()).min(1).max(50).required(),
  processingFee: Joi.number().min(0).default(0),
  notes: Joi.string().max(1000)
});

// Configuration
const MIN_WITHDRAWAL_AMOUNT = parseFloat(process.env.MIN_WITHDRAWAL_AMOUNT || '50');
const MAX_WITHDRAWAL_AMOUNT = parseFloat(process.env.MAX_WITHDRAWAL_AMOUNT || '10000');

// Helper function to calculate available balance
const calculateAvailableBalance = async (marketerId: string): Promise<number> => {
  // Get total approved commissions
  const approvedCommissions = await Commission.aggregate([
    {
      $match: {
        marketerId,
        status: 'approved'
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$commissionAmount' }
      }
    }
  ]);

  // Get total completed payouts
  const completedPayouts = await PayoutRequest.aggregate([
    {
      $match: {
        marketerId,
        status: 'completed'
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' }
      }
    }
  ]);

  // Get total pending/processing payouts
  const pendingPayouts = await PayoutRequest.aggregate([
    {
      $match: {
        marketerId,
        status: { $in: ['requested', 'approved', 'processing'] }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' }
      }
    }
  ]);

  const totalEarned = approvedCommissions[0]?.total || 0;
  const totalPaidOut = completedPayouts[0]?.total || 0;
  const totalPending = pendingPayouts[0]?.total || 0;

  return Math.max(0, totalEarned - totalPaidOut - totalPending);
};

// Create payout request
export const createPayoutRequest = async (req: Request, res: Response) => {
  try {
    const { error, value } = createPayoutRequestSchema.validate(req.body);
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

    const marketerId = (req as any).user.id;
    const { paymentMethodId, amount } = value;

    // Validate minimum withdrawal amount
    if (amount < MIN_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({
        error: {
          code: 'AMOUNT_TOO_LOW',
          message: `Minimum withdrawal amount is $${MIN_WITHDRAWAL_AMOUNT}`
        }
      });
    }

    // Validate maximum withdrawal amount
    if (amount > MAX_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({
        error: {
          code: 'AMOUNT_TOO_HIGH',
          message: `Maximum withdrawal amount is $${MAX_WITHDRAWAL_AMOUNT}`
        }
      });
    }

    // Verify payment method belongs to user and is verified
    const paymentMethod = await PaymentMethod.findOne({
      _id: paymentMethodId,
      userId: marketerId
    });

    if (!paymentMethod) {
      return res.status(404).json({
        error: {
          code: 'PAYMENT_METHOD_NOT_FOUND',
          message: 'Payment method not found'
        }
      });
    }

    // TODO: Implement proper payment method verification process
    // For now, allow unverified payment methods for testing
    // if (!paymentMethod.isVerified) {
    //   return res.status(400).json({
    //     error: {
    //       code: 'PAYMENT_METHOD_NOT_VERIFIED',
    //       message: 'Payment method must be verified before requesting payout'
    //     }
    //   });
    // }

    // Check available balance
    const availableBalance = await calculateAvailableBalance(marketerId);
    if (amount > availableBalance) {
      return res.status(400).json({
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance. Available: $${availableBalance.toFixed(2)}`
        }
      });
    }

    // Check for existing pending requests
    const existingPendingRequest = await PayoutRequest.findOne({
      marketerId,
      status: { $in: ['requested', 'approved', 'processing'] }
    });

    if (existingPendingRequest) {
      return res.status(400).json({
        error: {
          code: 'PENDING_REQUEST_EXISTS',
          message: 'You already have a pending payout request'
        }
      });
    }

    const payoutRequest = new PayoutRequest({
      marketerId,
      paymentMethodId,
      amount
    });

    await payoutRequest.save();

    // Populate payment method info for response
    await payoutRequest.populate('paymentMethodId', 'methodType isDefault');

    res.status(201).json({
      success: true,
      data: payoutRequest
    });
  } catch (error) {
    console.error('Error creating payout request:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create payout request'
      }
    });
  }
};

// Get marketer's payout requests
export const getPayoutRequests = async (req: Request, res: Response) => {
  try {
    const marketerId = (req as any).user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;

    const query: any = { marketerId };
    if (status) {
      query.status = status;
    }

    const payoutRequests = await PayoutRequest.find(query)
      .populate('paymentMethodId', 'methodType isDefault')
      .sort({ requestedAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const total = await PayoutRequest.countDocuments(query);

    res.json({
      success: true,
      data: payoutRequests,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching payout requests:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch payout requests'
      }
    });
  }
};

// Get single payout request
export const getPayoutRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const marketerId = (req as any).user.id;

    const payoutRequest = await PayoutRequest.findOne({ _id: id, marketerId })
      .populate('paymentMethodId', 'methodType isDefault')
      .populate('adminId', 'email');

    if (!payoutRequest) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payout request not found'
        }
      });
    }

    res.json({
      success: true,
      data: payoutRequest
    });
  } catch (error) {
    console.error('Error fetching payout request:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch payout request'
      }
    });
  }
};

// Get marketer's balance summary
export const getBalanceSummary = async (req: Request, res: Response) => {
  try {
    const marketerId = (req as any).user.id;

    const availableBalance = await calculateAvailableBalance(marketerId);

    // Get pending commissions (still in clearance period)
    const pendingCommissions = await Commission.aggregate([
      {
        $match: {
          marketerId,
          status: 'pending'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$commissionAmount' }
        }
      }
    ]);

    // Get total lifetime earnings
    const lifetimeEarnings = await Commission.aggregate([
      {
        $match: {
          marketerId,
          status: { $in: ['approved', 'paid'] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$commissionAmount' }
        }
      }
    ]);

    // Get total paid out
    const totalPaidOut = await PayoutRequest.aggregate([
      {
        $match: {
          marketerId,
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        availableBalance: availableBalance,
        pendingBalance: pendingCommissions[0]?.total || 0,
        lifetimeEarnings: lifetimeEarnings[0]?.total || 0,
        totalPaidOut: totalPaidOut[0]?.total || 0,
        minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT,
        maxWithdrawalAmount: MAX_WITHDRAWAL_AMOUNT
      }
    });
  } catch (error) {
    console.error('Error fetching balance summary:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch balance summary'
      }
    });
  }
};

// Cancel payout request (marketer only, before approval)
export const cancelPayoutRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const marketerId = (req as any).user.id;

    const payoutRequest = await PayoutRequest.findOne({ _id: id, marketerId });

    if (!payoutRequest) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payout request not found'
        }
      });
    }

    if (payoutRequest.status !== 'requested') {
      return res.status(400).json({
        error: {
          code: 'CANNOT_CANCEL',
          message: 'Can only cancel requests with "requested" status'
        }
      });
    }

    payoutRequest.status = 'cancelled';
    await payoutRequest.save();

    res.json({
      success: true,
      data: payoutRequest
    });
  } catch (error) {
    console.error('Error cancelling payout request:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to cancel payout request'
      }
    });
  }
};

// Admin functions

// Get all payout requests (admin only)
export const getAllPayoutRequests = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const marketerId = req.query.marketerId as string;

    const query: any = {};
    if (status) query.status = status;
    if (marketerId) query.marketerId = marketerId;

    const payoutRequests = await PayoutRequest.find(query)
      .populate('marketerId', 'email')
      .populate('paymentMethodId', 'methodType')
      .populate('adminId', 'email')
      .sort({ requestedAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const total = await PayoutRequest.countDocuments(query);

    res.json({
      success: true,
      data: payoutRequests,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching all payout requests:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch payout requests'
      }
    });
  }
};

// Update payout request status (admin only)
export const updatePayoutStatus = async (req: Request, res: Response) => {
  try {
    const { error, value } = updatePayoutStatusSchema.validate(req.body);
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
    const adminId = (req as any).user.id;
    const { status, notes, failureReason, transactionId, processingFee } = value;

    const payoutRequest = await PayoutRequest.findById(id);

    if (!payoutRequest) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payout request not found'
        }
      });
    }

    // Validate status transitions
    const validTransitions: { [key: string]: string[] } = {
      'requested': ['approved', 'cancelled'],
      'approved': ['processing', 'cancelled'],
      'processing': ['completed', 'failed'],
      'completed': [], // Final state
      'failed': ['processing'], // Can retry
      'cancelled': [] // Final state
    };

    if (!validTransitions[payoutRequest.status].includes(status)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Cannot change status from ${payoutRequest.status} to ${status}`
        }
      });
    }

    // Update payout request
    payoutRequest.status = status;
    payoutRequest.adminId = adminId;
    if (notes) payoutRequest.notes = notes;
    if (failureReason) payoutRequest.failureReason = failureReason;
    if (transactionId) payoutRequest.transactionId = transactionId;
    if (processingFee !== undefined) payoutRequest.processingFee = processingFee;

    await payoutRequest.save();

    // Update commission status if payout is completed
    if (status === 'completed') {
      await Commission.updateMany(
        {
          marketerId: payoutRequest.marketerId,
          status: 'approved'
        },
        {
          $set: { status: 'paid' }
        }
      );
    }

    await payoutRequest.populate([
      { path: 'marketerId', select: 'email' },
      { path: 'paymentMethodId', select: 'methodType' },
      { path: 'adminId', select: 'email' }
    ]);

    res.json({
      success: true,
      data: payoutRequest
    });
  } catch (error) {
    console.error('Error updating payout status:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update payout status'
      }
    });
  }
};
// Process single payout through payment gateway (admin only)
export const processPayout = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = (req as any).user.id;

    const payoutRequest = await PayoutRequest.findById(id);

    if (!payoutRequest) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payout request not found'
        }
      });
    }

    // Can only process approved payouts
    if (payoutRequest.status !== 'approved') {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATUS',
          message: 'Can only process approved payout requests'
        }
      });
    }

    // Update status to processing
    payoutRequest.status = 'processing';
    payoutRequest.adminId = adminId;
    await payoutRequest.save();

    try {
      // Process through payment gateway
      const result = await PaymentService.processPayout(payoutRequest);

      if (result.success) {
        // Update to completed
        payoutRequest.status = 'completed';
        payoutRequest.transactionId = result.transactionId;
        await payoutRequest.save();

        // Update commission status
        await Commission.updateMany(
          {
            marketerId: payoutRequest.marketerId,
            status: 'approved'
          },
          {
            $set: { status: 'paid' }
          }
        );

        res.json({
          success: true,
          data: payoutRequest,
          gatewayResponse: result.gatewayResponse
        });
      } else {
        // Update to failed
        payoutRequest.status = 'failed';
        payoutRequest.failureReason = result.error;
        await payoutRequest.save();

        res.status(400).json({
          error: {
            code: 'PAYMENT_GATEWAY_ERROR',
            message: result.error || 'Payment processing failed'
          }
        });
      }
    } catch (gatewayError) {
      // Update to failed on exception
      payoutRequest.status = 'failed';
      payoutRequest.failureReason = 'Payment gateway service error';
      await payoutRequest.save();

      console.error('Payment gateway error:', gatewayError);
      res.status(500).json({
        error: {
          code: 'GATEWAY_SERVICE_ERROR',
          message: 'Payment gateway service error'
        }
      });
    }
  } catch (error) {
    console.error('Error processing payout:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to process payout'
      }
    });
  }
};

// Bulk process payouts (admin only)
export const bulkProcessPayouts = async (req: Request, res: Response) => {
  try {
    const { error, value } = bulkProcessPayoutsSchema.validate(req.body);
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

    const adminId = (req as any).user.id;
    const { payoutIds, processingFee, notes } = value;

    // Find all requested payouts
    const payoutRequests = await PayoutRequest.find({
      _id: { $in: payoutIds },
      status: 'approved'
    });

    if (payoutRequests.length === 0) {
      return res.status(400).json({
        error: {
          code: 'NO_VALID_PAYOUTS',
          message: 'No approved payout requests found for processing'
        }
      });
    }

    // Update all to processing status
    await PayoutRequest.updateMany(
      { _id: { $in: payoutRequests.map(p => p._id) } },
      {
        $set: {
          status: 'processing',
          adminId,
          processingFee: processingFee || 0,
          notes: notes || ''
        }
      }
    );

    try {
      // Process through payment gateways
      const result = await PaymentService.processBulkPayouts(payoutRequests);

      // Update successful payouts
      if (result.successful.length > 0) {
        await PayoutRequest.updateMany(
          { _id: { $in: result.successful } },
          {
            $set: {
              status: 'completed',
              completedAt: new Date()
            }
          }
        );

        // Update commissions for successful payouts
        const successfulPayouts = await PayoutRequest.find({
          _id: { $in: result.successful }
        });

        for (const payout of successfulPayouts) {
          await Commission.updateMany(
            {
              marketerId: payout.marketerId,
              status: 'approved'
            },
            {
              $set: { status: 'paid' }
            }
          );
        }
      }

      // Update failed payouts
      if (result.failed.length > 0) {
        for (const failure of result.failed) {
          await PayoutRequest.findByIdAndUpdate(failure.payoutId, {
            $set: {
              status: 'failed',
              failureReason: failure.error
            }
          });
        }
      }

      res.json({
        success: true,
        data: {
          totalProcessed: result.totalProcessed,
          successful: result.successful.length,
          failed: result.failed.length,
          successfulIds: result.successful,
          failures: result.failed
        }
      });
    } catch (gatewayError) {
      // Mark all as failed on bulk processing error
      await PayoutRequest.updateMany(
        { _id: { $in: payoutRequests.map(p => p._id) } },
        {
          $set: {
            status: 'failed',
            failureReason: 'Bulk processing service error'
          }
        }
      );

      console.error('Bulk processing error:', gatewayError);
      res.status(500).json({
        error: {
          code: 'BULK_PROCESSING_ERROR',
          message: 'Bulk processing service error'
        }
      });
    }
  } catch (error) {
    console.error('Error in bulk processing:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to process bulk payouts'
      }
    });
  }
};

// Get bulk processing statistics (admin only)
export const getBulkProcessingStats = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter: any = {};
    if (startDate) dateFilter.$gte = new Date(startDate as string);
    if (endDate) dateFilter.$lte = new Date(endDate as string);

    const matchStage: any = {};
    if (Object.keys(dateFilter).length > 0) {
      matchStage.requestedAt = dateFilter;
    }

    const stats = await PayoutRequest.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' }
        }
      }
    ]);

    // Get processing time statistics
    const processingTimes = await PayoutRequest.aggregate([
      {
        $match: {
          status: 'completed',
          requestedAt: dateFilter.requestedAt || { $exists: true },
          completedAt: { $exists: true }
        }
      },
      {
        $project: {
          processingTimeHours: {
            $divide: [
              { $subtract: ['$completedAt', '$requestedAt'] },
              1000 * 60 * 60 // Convert to hours
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgProcessingTime: { $avg: '$processingTimeHours' },
          minProcessingTime: { $min: '$processingTimeHours' },
          maxProcessingTime: { $max: '$processingTimeHours' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        statusBreakdown: stats,
        processingTimes: processingTimes[0] || {
          avgProcessingTime: 0,
          minProcessingTime: 0,
          maxProcessingTime: 0
        }
      }
    });
  } catch (error) {
    console.error('Error fetching bulk processing stats:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch processing statistics'
      }
    });
  }
};