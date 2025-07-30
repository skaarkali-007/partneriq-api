import { Request, Response } from 'express';
import Joi from 'joi';
import { CommissionService } from '../services/commission';
import { Commission } from '../models/Commission';

// Validation schemas
const calculateCommissionSchema = Joi.object({
  marketerId: Joi.string().required().messages({
    'string.empty': 'Marketer ID is required',
    'any.required': 'Marketer ID is required'
  }),
  customerId: Joi.string().required().messages({
    'string.empty': 'Customer ID is required',
    'any.required': 'Customer ID is required'
  }),
  productId: Joi.string().required().messages({
    'string.empty': 'Product ID is required',
    'any.required': 'Product ID is required'
  }),
  trackingCode: Joi.string().required().messages({
    'string.empty': 'Tracking code is required',
    'any.required': 'Tracking code is required'
  }),
  initialSpendAmount: Joi.number().min(0).required().messages({
    'number.min': 'Initial spend amount cannot be negative',
    'any.required': 'Initial spend amount is required'
  }),
  conversionDate: Joi.date().iso().required().messages({
    'date.format': 'Conversion date must be a valid ISO date',
    'any.required': 'Conversion date is required'
  }),
  clearancePeriodDays: Joi.number().integer().min(0).max(365).optional().messages({
    'number.min': 'Clearance period cannot be negative',
    'number.max': 'Clearance period cannot exceed 365 days'
  }),
  // New fields for enhanced calculation
  customCommissionRate: Joi.number().min(0).max(1).optional().messages({
    'number.min': 'Custom commission rate cannot be negative',
    'number.max': 'Custom commission rate cannot exceed 100%'
  }),
  customCommissionAmount: Joi.number().min(0).optional().messages({
    'number.min': 'Custom commission amount cannot be negative'
  }),
  overrideProductRules: Joi.boolean().optional()
});

const getCommissionsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid('conversionDate', 'commissionAmount', 'status', 'createdAt').default('conversionDate'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  marketerId: Joi.string().optional(),
  productId: Joi.string().optional(),
  status: Joi.string().valid('pending', 'approved', 'paid', 'clawed_back', 'rejected').optional(),
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().optional(),
  minAmount: Joi.number().min(0).optional(),
  maxAmount: Joi.number().min(0).optional()
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid('pending', 'approved', 'paid', 'clawed_back', 'rejected').required().messages({
    'any.only': 'Status must be one of: pending, approved, paid, clawed_back, rejected',
    'any.required': 'Status is required'
  }),
  adminId: Joi.string().optional(),
  rejectionReason: Joi.string().when('status', {
    is: 'rejected',
    then: Joi.required().messages({
      'any.required': 'Rejection reason is required when rejecting a commission'
    }),
    otherwise: Joi.optional()
  })
});

const approveCommissionSchema = Joi.object({
  adminId: Joi.string().optional(),
  overrideClearancePeriod: Joi.boolean().default(false)
});

const rejectCommissionSchema = Joi.object({
  rejectionReason: Joi.string().required().messages({
    'string.empty': 'Rejection reason is required',
    'any.required': 'Rejection reason is required'
  }),
  adminId: Joi.string().optional()
});

const markAsPaidSchema = Joi.object({
  adminId: Joi.string().optional(),
  paymentReference: Joi.string().optional()
});

const commissionIdSchema = Joi.object({
  id: Joi.string().required().messages({
    'string.empty': 'Commission ID is required',
    'any.required': 'Commission ID is required'
  })
});

/**
 * Calculate and create a new commission
 */
export const calculateCommission = async (req: Request, res: Response) => {
  try {
    const { error, value } = calculateCommissionSchema.validate(req.body);
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

    const commission = await CommissionService.calculateCommission(value);

    res.status(201).json({
      success: true,
      data: commission
    });
  } catch (error) {
    console.error('Error calculating commission:', error);
    
    if (error instanceof Error) {
      // Handle specific business logic errors
      if (error.message.includes('Invalid or inactive') || 
          error.message.includes('below minimum') ||
          error.message.includes('already exists') ||
          error.message.includes('not defined')) {
        return res.status(400).json({
          error: {
            code: 'BUSINESS_RULE_ERROR',
            message: error.message
          }
        });
      }
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to calculate commission'
      }
    });
  }
};

/**
 * Get commission summary for a marketer
 */
export const getCommissionSummary = async (req: Request, res: Response) => {
  try {
    const { marketerId } = req.params;
    
    if (!marketerId) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Marketer ID is required'
        }
      });
    }

    const summary = await CommissionService.getCommissionSummary(marketerId);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Error getting commission summary:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get commission summary'
      }
    });
  }
};

/**
 * Get commissions with filtering and pagination
 */
export const getCommissions = async (req: Request, res: Response) => {
  try {
    const { error, value } = getCommissionsSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const {
      page,
      limit,
      sortBy,
      sortOrder,
      marketerId,
      productId,
      status,
      startDate,
      endDate,
      minAmount,
      maxAmount
    } = value;

    const filters = {
      marketerId,
      productId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      minAmount,
      maxAmount
    };

    // Remove undefined values
    Object.keys(filters).forEach(key => {
      if (filters[key as keyof typeof filters] === undefined) {
        delete filters[key as keyof typeof filters];
      }
    });

    const result = await CommissionService.getCommissions(
      filters,
      page,
      limit,
      sortBy,
      sortOrder
    );

    res.json({
      success: true,
      data: result.commissions,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Error getting commissions:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get commissions'
      }
    });
  }
};

/**
 * Get commission by ID
 */
export const getCommissionById = async (req: Request, res: Response) => {
  try {
    const { error, value } = commissionIdSchema.validate(req.params);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const commission = await CommissionService.getCommissionById(value.id);
    
    if (!commission) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Commission not found'
        }
      });
    }

    res.json({
      success: true,
      data: commission
    });
  } catch (error) {
    console.error('Error getting commission by ID:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get commission'
      }
    });
  }
};

/**
 * Update commission status
 */
export const updateCommissionStatus = async (req: Request, res: Response) => {
  try {
    const { error: paramsError, value: paramsValue } = commissionIdSchema.validate(req.params);
    if (paramsError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const { error: bodyError, value: bodyValue } = updateStatusSchema.validate(req.body);
    if (bodyError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: bodyError.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const commission = await CommissionService.updateCommissionStatus(
      paramsValue.id,
      bodyValue.status,
      bodyValue.adminId,
      bodyValue.rejectionReason
    );

    res.json({
      success: true,
      data: commission
    });
  } catch (error) {
    console.error('Error updating commission status:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: error.message
          }
        });
      }
      
      if (error.message.includes('Invalid status transition')) {
        return res.status(400).json({
          error: {
            code: 'INVALID_TRANSITION',
            message: error.message
          }
        });
      }
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update commission status'
      }
    });
  }
};

/**
 * Approve commission (admin only)
 */
export const approveCommission = async (req: Request, res: Response) => {
  try {
    const { error: paramsError, value: paramsValue } = commissionIdSchema.validate(req.params);
    if (paramsError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const { error: bodyError, value: bodyValue } = approveCommissionSchema.validate(req.body);
    if (bodyError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: bodyError.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const commission = await CommissionService.approveCommission(
      paramsValue.id,
      bodyValue.adminId,
      bodyValue.overrideClearancePeriod
    );

    res.json({
      success: true,
      data: commission
    });
  } catch (error) {
    console.error('Error approving commission:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: error.message
          }
        });
      }
      
      if (error.message.includes('Cannot approve commission') || 
          error.message.includes('clearance period')) {
        return res.status(400).json({
          error: {
            code: 'INVALID_OPERATION',
            message: error.message
          }
        });
      }
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to approve commission'
      }
    });
  }
};

/**
 * Reject commission (admin only)
 */
export const rejectCommission = async (req: Request, res: Response) => {
  try {
    const { error: paramsError, value: paramsValue } = commissionIdSchema.validate(req.params);
    if (paramsError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const { error: bodyError, value: bodyValue } = rejectCommissionSchema.validate(req.body);
    if (bodyError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: bodyError.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const commission = await CommissionService.rejectCommission(
      paramsValue.id,
      bodyValue.rejectionReason,
      bodyValue.adminId
    );

    res.json({
      success: true,
      data: commission
    });
  } catch (error) {
    console.error('Error rejecting commission:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: error.message
          }
        });
      }
      
      if (error.message.includes('Cannot reject commission')) {
        return res.status(400).json({
          error: {
            code: 'INVALID_OPERATION',
            message: error.message
          }
        });
      }
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to reject commission'
      }
    });
  }
};

/**
 * Mark commission as paid (admin only)
 */
export const markCommissionAsPaid = async (req: Request, res: Response) => {
  try {
    const { error: paramsError, value: paramsValue } = commissionIdSchema.validate(req.params);
    if (paramsError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const { error: bodyError, value: bodyValue } = markAsPaidSchema.validate(req.body);
    if (bodyError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: bodyError.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const commission = await CommissionService.markCommissionAsPaid(
      paramsValue.id,
      bodyValue.adminId,
      bodyValue.paymentReference
    );

    res.json({
      success: true,
      data: commission
    });
  } catch (error) {
    console.error('Error marking commission as paid:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: error.message
          }
        });
      }
      
      if (error.message.includes('Cannot mark commission as paid')) {
        return res.status(400).json({
          error: {
            code: 'INVALID_OPERATION',
            message: error.message
          }
        });
      }
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to mark commission as paid'
      }
    });
  }
};

/**
 * Get available balance for a marketer
 */
export const getAvailableBalance = async (req: Request, res: Response) => {
  try {
    const { marketerId } = req.params;
    
    if (!marketerId) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Marketer ID is required'
        }
      });
    }

    const balance = await CommissionService.getAvailableBalance(marketerId);

    res.json({
      success: true,
      data: {
        marketerId,
        availableBalance: balance
      }
    });
  } catch (error) {
    console.error('Error getting available balance:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get available balance'
      }
    });
  }
};

/**
 * Get commissions eligible for approval (admin only)
 */
export const getEligibleCommissions = async (req: Request, res: Response) => {
  try {
    const eligibleCommissions = await CommissionService.getCommissionsEligibleForApproval();

    res.json({
      success: true,
      data: eligibleCommissions
    });
  } catch (error) {
    console.error('Error getting eligible commissions:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get eligible commissions'
      }
    });
  }
};

/**
 * Bulk approve eligible commissions (admin only)
 */
export const bulkApproveCommissions = async (req: Request, res: Response) => {
  try {
    const result = await CommissionService.bulkApproveEligibleCommissions();

    res.json({
      success: true,
      data: {
        approved: result.approved,
        errors: result.errors
      }
    });
  } catch (error) {
    console.error('Error bulk approving commissions:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to bulk approve commissions'
      }
    });
  }
};

/**
 * Get commission analytics
 */
export const getCommissionAnalytics = async (req: Request, res: Response) => {
  try {
    const schema = Joi.object({
      startDate: Joi.date().iso().required(),
      endDate: Joi.date().iso().required(),
      marketerId: Joi.string().optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const analytics = await CommissionService.getCommissionAnalytics(
      new Date(value.startDate),
      new Date(value.endDate),
      value.marketerId
    );

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error getting commission analytics:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get commission analytics'
      }
    });
  }
};

/**
 * Batch calculate commissions
 */
export const batchCalculateCommissions = async (req: Request, res: Response) => {
  try {
    const schema = Joi.array().items(calculateCommissionSchema).min(1).required();
    
    const { error, value } = schema.validate(req.body);
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

    const result = await CommissionService.batchCalculateCommissions(value);

    res.status(201).json({
      success: true,
      data: {
        commissions: result.commissions,
        errors: result.errors,
        totalProcessed: value.length,
        successCount: result.commissions.length,
        errorCount: result.errors.length
      }
    });
  } catch (error) {
    console.error('Error batch calculating commissions:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to batch calculate commissions'
      }
    });
  }
};

/**
 * Recalculate commission
 */
export const recalculateCommission = async (req: Request, res: Response) => {
  try {
    const { error: paramsError, value: paramsValue } = commissionIdSchema.validate(req.params);
    if (paramsError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const recalculateSchema = Joi.object({
      newAmount: Joi.number().min(0).optional().messages({
        'number.min': 'New commission amount cannot be negative'
      }),
      newRate: Joi.number().min(0).max(1).optional().messages({
        'number.min': 'New commission rate cannot be negative',
        'number.max': 'New commission rate cannot exceed 100%'
      }),
      adminId: Joi.string().optional()
    }).or('newAmount', 'newRate');

    const { error: bodyError, value: bodyValue } = recalculateSchema.validate(req.body);
    if (bodyError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: bodyError.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const commission = await CommissionService.recalculateCommission(
      paramsValue.id,
      bodyValue.newAmount,
      bodyValue.newRate,
      bodyValue.adminId
    );

    res.json({
      success: true,
      data: commission
    });
  } catch (error) {
    console.error('Error recalculating commission:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: error.message
          }
        });
      }
      
      if (error.message.includes('Only pending commissions')) {
        return res.status(400).json({
          error: {
            code: 'INVALID_OPERATION',
            message: error.message
          }
        });
      }
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to recalculate commission'
      }
    });
  }
};

/**
 * Get product commission performance
 */
export const getProductCommissionPerformance = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    
    if (!productId) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Product ID is required'
        }
      });
    }

    const performance = await CommissionService.getProductCommissionPerformance(productId);

    res.json({
      success: true,
      data: performance
    });
  } catch (error) {
    console.error('Error getting product commission performance:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get product commission performance'
      }
    });
  }
};

/**
 * Process automated commission updates (admin only - typically called by scheduled job)
 */
export const processAutomatedCommissionUpdates = async (req: Request, res: Response) => {
  try {
    const result = await CommissionService.processAutomatedCommissionUpdates();

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error processing automated commission updates:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to process automated commission updates'
      }
    });
  }
};

/**
 * Get commission lifecycle statistics (admin only)
 */
export const getCommissionLifecycleStats = async (req: Request, res: Response) => {
  try {
    const schema = Joi.object({
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const stats = await CommissionService.getCommissionLifecycleStats(
      value.startDate ? new Date(value.startDate) : undefined,
      value.endDate ? new Date(value.endDate) : undefined
    );

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting commission lifecycle stats:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get commission lifecycle statistics'
      }
    });
  }
};

/**
 * Get commission status history (admin only)
 */
export const getCommissionStatusHistory = async (req: Request, res: Response) => {
  try {
    const { error, value } = commissionIdSchema.validate(req.params);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const history = await CommissionService.getCommissionStatusHistory(value.id);

    if (!history.commission) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Commission not found'
        }
      });
    }

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Error getting commission status history:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get commission status history'
      }
    });
  }
};

// Clawback and adjustment validation schemas
const processClawbackSchema = Joi.object({
  clawbackAmount: Joi.number().min(0.01).required().messages({
    'number.min': 'Clawback amount must be positive',
    'any.required': 'Clawback amount is required'
  }),
  reason: Joi.string().required().min(5).max(1000).messages({
    'string.empty': 'Reason is required',
    'string.min': 'Reason must be at least 5 characters',
    'string.max': 'Reason cannot exceed 1000 characters',
    'any.required': 'Reason is required'
  }),
  adminId: Joi.string().required().messages({
    'string.empty': 'Admin ID is required',
    'any.required': 'Admin ID is required'
  }),
  clawbackType: Joi.string().valid('refund', 'chargeback', 'manual').default('manual')
});

const manualAdjustmentSchema = Joi.object({
  adjustmentAmount: Joi.number().required().messages({
    'any.required': 'Adjustment amount is required'
  }),
  adjustmentType: Joi.string().valid('bonus', 'correction').required().messages({
    'any.only': 'Adjustment type must be either bonus or correction',
    'any.required': 'Adjustment type is required'
  }),
  reason: Joi.string().required().min(5).max(1000).messages({
    'string.empty': 'Reason is required',
    'string.min': 'Reason must be at least 5 characters',
    'string.max': 'Reason cannot exceed 1000 characters',
    'any.required': 'Reason is required'
  }),
  adminId: Joi.string().required().messages({
    'string.empty': 'Admin ID is required',
    'any.required': 'Admin ID is required'
  })
});

/**
 * Process commission clawback (admin only)
 */
export const processClawback = async (req: Request, res: Response) => {
  try {
    const { error: paramsError, value: paramsValue } = commissionIdSchema.validate(req.params);
    if (paramsError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const { error: bodyError, value: bodyValue } = processClawbackSchema.validate(req.body);
    if (bodyError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: bodyError.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const result = await CommissionService.processClawback(
      paramsValue.id,
      bodyValue.clawbackAmount,
      bodyValue.reason,
      bodyValue.adminId,
      bodyValue.clawbackType
    );

    res.json({
      success: true,
      data: {
        commission: result.commission,
        adjustment: result.adjustment,
        message: 'Commission clawback processed successfully'
      }
    });
  } catch (error) {
    console.error('Error processing clawback:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: error.message
          }
        });
      }
      
      if (error.message.includes('Cannot process clawback') || 
          error.message.includes('Clawback amount') ||
          error.message.includes('must be positive')) {
        return res.status(400).json({
          error: {
            code: 'INVALID_OPERATION',
            message: error.message
          }
        });
      }
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to process clawback'
      }
    });
  }
};

/**
 * Process partial commission clawback (admin only)
 */
export const processPartialClawback = async (req: Request, res: Response) => {
  try {
    const { error: paramsError, value: paramsValue } = commissionIdSchema.validate(req.params);
    if (paramsError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const { error: bodyError, value: bodyValue } = processClawbackSchema.validate(req.body);
    if (bodyError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: bodyError.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const result = await CommissionService.processPartialClawback(
      paramsValue.id,
      bodyValue.clawbackAmount,
      bodyValue.reason,
      bodyValue.adminId,
      bodyValue.clawbackType
    );

    res.json({
      success: true,
      data: {
        commission: result.commission,
        adjustment: result.adjustment,
        message: 'Partial commission clawback processed successfully'
      }
    });
  } catch (error) {
    console.error('Error processing partial clawback:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: error.message
          }
        });
      }
      
      if (error.message.includes('Cannot process partial clawback') || 
          error.message.includes('Clawback amount') ||
          error.message.includes('Use full clawback')) {
        return res.status(400).json({
          error: {
            code: 'INVALID_OPERATION',
            message: error.message
          }
        });
      }
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to process partial clawback'
      }
    });
  }
};

/**
 * Apply manual commission adjustment (admin only)
 */
export const applyManualAdjustment = async (req: Request, res: Response) => {
  try {
    const { error: paramsError, value: paramsValue } = commissionIdSchema.validate(req.params);
    if (paramsError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const { error: bodyError, value: bodyValue } = manualAdjustmentSchema.validate(req.body);
    if (bodyError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: bodyError.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const result = await CommissionService.applyManualAdjustment(
      paramsValue.id,
      bodyValue.adjustmentAmount,
      bodyValue.adjustmentType,
      bodyValue.reason,
      bodyValue.adminId
    );

    res.json({
      success: true,
      data: {
        commission: result.commission,
        adjustment: result.adjustment,
        message: `Manual ${bodyValue.adjustmentType} applied successfully`
      }
    });
  } catch (error) {
    console.error('Error applying manual adjustment:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: error.message
          }
        });
      }
      
      if (error.message.includes('Cannot apply adjustment') || 
          error.message.includes('Adjustment amount') ||
          error.message.includes('cannot exceed')) {
        return res.status(400).json({
          error: {
            code: 'INVALID_OPERATION',
            message: error.message
          }
        });
      }
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to apply manual adjustment'
      }
    });
  }
};

/**
 * Get commission adjustments (admin only)
 */
export const getCommissionAdjustments = async (req: Request, res: Response) => {
  try {
    const { error, value } = commissionIdSchema.validate(req.params);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const adjustments = await CommissionService.getCommissionAdjustments(value.id);

    res.json({
      success: true,
      data: adjustments
    });
  } catch (error) {
    console.error('Error getting commission adjustments:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get commission adjustments'
      }
    });
  }
};

/**
 * Get commission with all adjustments and net amount (admin only)
 */
export const getCommissionWithAdjustments = async (req: Request, res: Response) => {
  try {
    const { error, value } = commissionIdSchema.validate(req.params);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid commission ID'
        }
      });
    }

    const result = await CommissionService.getCommissionWithAdjustments(value.id);

    if (!result.commission) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Commission not found'
        }
      });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting commission with adjustments:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get commission with adjustments'
      }
    });
  }
};

/**
 * Get clawback statistics (admin only)
 */
export const getClawbackStatistics = async (req: Request, res: Response) => {
  try {
    const schema = Joi.object({
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().optional(),
      marketerId: Joi.string().optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        }
      });
    }

    const statistics = await CommissionService.getClawbackStatistics(
      value.startDate ? new Date(value.startDate) : undefined,
      value.endDate ? new Date(value.endDate) : undefined,
      value.marketerId
    );

    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Error getting clawback statistics:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get clawback statistics'
      }
    });
  }
};