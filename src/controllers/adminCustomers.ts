import { Request, Response } from 'express';
import { Customer } from '../models/Customer';
import { User } from '../models/User';
import { Product } from '../models/Product';
import { Commission } from '../models/Commission';
import mongoose from 'mongoose';

// Get all customer applications with filtering and pagination
export const getCustomerApplications = async (req: Request, res: Response) => {
  try {
    const {
      status,
      kycStatus,
      paymentStatus,
      productId,
      marketerId,
      search,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter query
    const filter: any = {};
    
    if (status && status !== 'all') {
      filter.onboardingStatus = status;
    }
    
    if (kycStatus && kycStatus !== 'all') {
      filter['kyc.status'] = kycStatus;
    }
    
    if (paymentStatus && paymentStatus !== 'all') {
      filter.paymentStatus = paymentStatus;
    }
    
    if (productId && productId !== 'all') {
      filter.productId = productId;
    }
    
    if (marketerId && marketerId !== 'all') {
      filter.marketerId = marketerId;
    }
    
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { trackingCode: { $regex: search, $options: 'i' } }
      ];
    }

    // Build aggregation pipeline
    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'users',
          localField: 'marketerId',
          foreignField: '_id',
          as: 'marketer'
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $lookup: {
          from: 'commissions',
          localField: 'commissionId',
          foreignField: '_id',
          as: 'commission'
        }
      },
      {
        $addFields: {
          customerName: { $concat: ['$firstName', ' ', '$lastName'] },
          marketerName: {
            $concat: [
              { $arrayElemAt: ['$marketer.firstName', 0] },
              ' ',
              { $arrayElemAt: ['$marketer.lastName', 0] }
            ]
          },
          marketerEmail: { $arrayElemAt: ['$marketer.email', 0] },
          productName: { $arrayElemAt: ['$product.name', 0] },
          commissionAmount: { $arrayElemAt: ['$commission.amount', 0] },
          commissionStatus: { $arrayElemAt: ['$commission.status', 0] }
        }
      },
      {
        $project: {
          _id: 1,
          trackingCode: 1,
          customerName: 1,
          email: 1,
          phone: 1,
          onboardingStatus: 1,
          currentStep: 1,
          kycStatus: '$kyc.status',
          kycDocumentsCount: { $size: '$kyc.documents' },
          signatureSigned: '$signature.signed',
          initialSpendAmount: 1,
          paymentStatus: 1,
          paymentMethod: 1,
          paymentDate: 1,
          commissionAmount: 1,
          commissionStatus: 1,
          marketerName: 1,
          marketerEmail: 1,
          productName: 1,
          adminReviewedAt: 1,
          adminReviewedBy: 1,
          adminNotes: 1,
          createdAt: 1,
          updatedAt: 1,
          completedAt: 1
        }
      },
      { $sort: { [sortBy as string]: sortOrder === 'desc' ? -1 as const : 1 as const } }
    ];

    // Get total count
    const totalPipeline = [...pipeline, { $count: 'total' }];
    const totalResult = await Customer.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    // Add pagination
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    pipeline.push({ $skip: skip } as any, { $limit: parseInt(limit as string) } as any);

    // Execute query
    const applications = await Customer.aggregate(pipeline);

    res.json({
      success: true,
      data: {
        applications,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total,
          pages: Math.ceil(total / parseInt(limit as string))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching customer applications:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get detailed customer application
export const getCustomerApplication = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;

    const pipeline = [
      { $match: { _id: new mongoose.Types.ObjectId(customerId) } },
      {
        $lookup: {
          from: 'users',
          localField: 'marketerId',
          foreignField: '_id',
          as: 'marketer'
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $lookup: {
          from: 'commissions',
          localField: 'commissionId',
          foreignField: '_id',
          as: 'commission'
        }
      },
      {
        $addFields: {
          marketer: { $arrayElemAt: ['$marketer', 0] },
          product: { $arrayElemAt: ['$product', 0] },
          commission: { $arrayElemAt: ['$commission', 0] }
        }
      }
    ];

    const result = await Customer.aggregate(pipeline);
    const application = result[0];

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Customer application not found'
      });
    }

    res.json({
      success: true,
      data: application
    });
  } catch (error) {
    console.error('Error fetching customer application:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update customer application status
export const updateCustomerStatus = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { status, reason, adminNotes } = req.body;
    const adminId = req.user?.id;

    if (!status || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Status and reason are required'
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Update status using the model method
    await customer.updateAdminStatus(status, reason, adminId);

    // Update admin notes if provided
    if (adminNotes) {
      customer.adminNotes = adminNotes;
      await customer.save();
    }

    // If status is completed, trigger commission creation
    if (status === 'completed' && customer.initialSpendAmount && !customer.commissionId) {
      await createCommissionForCustomer(customer);
    }

    res.json({
      success: true,
      data: {
        customerId: customer._id,
        status: customer.onboardingStatus,
        updatedAt: customer.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating customer status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update customer payment information
export const updateCustomerPayment = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { initialSpendAmount, paymentStatus, paymentMethod, paymentDate, reason } = req.body;
    const adminId = req.user?.id;


    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Reason for payment update is required'
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const oldSpendAmount = customer.initialSpendAmount;

    // Update payment info using the model method
    const paymentData = {
      initialSpendAmount,
      paymentStatus,
      paymentMethod,
      paymentDate
    };

    const cust = await customer.updatePaymentInfo(paymentData, reason, adminId);
    console.log("")
          console.log("")
      
          console.log("cust: ", cust)
          
          console.log("")
          console.log("")

    // If spend amount changed and customer has a commission, recalculate
    if (initialSpendAmount !== undefined && 
        initialSpendAmount !== oldSpendAmount && 
        customer.commissionId && 
        oldSpendAmount !== undefined) {    
      await recalculateCommission(customer, oldSpendAmount, initialSpendAmount);
    }

    // If customer is completed and has spend amount but no commission, create one
    if (customer.onboardingStatus === 'completed' && 
        customer.initialSpendAmount && 
        !customer.commissionId) {
          console.log("")
          console.log("")
      
          console.log("recalc: ")
          
          console.log("")
          console.log("")
      await createCommissionForCustomer(customer);
    }

    res.json({
      success: true,
      data: {
        customerId: customer._id,
        initialSpendAmount: customer.initialSpendAmount,
        paymentStatus: customer.paymentStatus,
        updatedAt: customer.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating customer payment:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Bulk update customer statuses
export const bulkUpdateCustomerStatus = async (req: Request, res: Response) => {
  try {
    const { customerIds, status, reason } = req.body;
    const adminId = req.user?.id;

    if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer IDs array is required'
      });
    }

    if (!status || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Status and reason are required'
      });
    }

    const results = [];
    const errors = [];

    for (const customerId of customerIds) {
      try {
        const customer = await Customer.findById(customerId);
        if (customer) {
          await customer.updateAdminStatus(status, reason, adminId);
          
          // If status is completed, trigger commission creation
          if (status === 'completed' && customer.initialSpendAmount && !customer.commissionId) {
            await createCommissionForCustomer(customer);
          }
          
          results.push({
            customerId,
            success: true,
            status: customer.onboardingStatus
          });
        } else {
          errors.push({
            customerId,
            error: 'Customer not found'
          });
        }
      } catch (error) {
        errors.push({
          customerId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    res.json({
      success: true,
      data: {
        updated: results,
        errors,
        totalProcessed: customerIds.length,
        successCount: results.length,
        errorCount: errors.length
      }
    });
  } catch (error) {
    console.error('Error bulk updating customer status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Helper function to create commission for customer
async function createCommissionForCustomer(customer: any) {
  try {
    // Get product to determine commission rate
    const product = await Product.findById(customer.productId);
    console.log("Product: ", product)
    if (!product ) {
      console.log("Here")
      return;
    }

    // if(!product.commissionRate || !product.commissionFlatAmount){
    //   return
    // }

    // Calculate commission amount
    const commissionAmount = product.commissionRate ? customer.initialSpendAmount * (product.commissionRate) : product.commissionFlatAmount ? product.commissionFlatAmount : 0;

    // Create commission record
    const commission = new Commission({
      marketerId: customer.marketerId,
      customerId: customer._id,
      productId: customer.productId,
      trackingCode: customer.trackingCode,
      commissionAmount: commissionAmount,
      commissionRate: product.commissionRate || 0, // Convert percentage to decimal
      commissionFlatAmount: product.commissionFlatAmount || 0,
      initialSpendAmount: customer.initialSpendAmount,
      status: 'pending',
      conversionDate: customer.completedAt || new Date()
    });

    await commission.save();

    // Update customer with commission info
    customer.commissionId = commission._id;
    customer.commissionAmount = commissionAmount;
    customer.commissionStatus = 'pending';
    await customer.save();

  } catch (error) {
    console.error('Error creating commission for customer:', error);
  }
}

// Helper function to recalculate commission
async function recalculateCommission(customer: any, oldAmount: number, newAmount: number) {
  try {
    const commission = await Commission.findById(customer.commissionId);
    if (!commission) {
      return;
    }

    const product = await Product.findById(customer.productId);
    if (!product || !product.commissionRate || !product.commissionFlatAmount) {
      return;
    }

    // Calculate new commission amount
    const newCommissionAmount = product.commissionRate ? newAmount * (product.commissionRate) : product.commissionFlatAmount ? product.commissionFlatAmount : 0;
    const oldCommissionAmount = commission.commissionAmount;

    // Update commission record
    commission.commissionAmount = newCommissionAmount;
    commission.initialSpendAmount = newAmount;
    await commission.save();

    // Update customer commission info
    customer.commissionAmount = newCommissionAmount;
    await customer.save();

    console.log(`Commission recalculated for customer ${customer._id}: ${oldCommissionAmount} -> ${newCommissionAmount}`);

  } catch (error) {
    console.error('Error recalculating commission:', error);
  }
}

// Get customer application statistics
export const getCustomerApplicationStats = async (req: Request, res: Response) => {
  try {
    const stats = await Customer.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          started: { $sum: { $cond: [{ $eq: ['$onboardingStatus', 'started'] }, 1, 0] } },
          personalInfo: { $sum: { $cond: [{ $eq: ['$onboardingStatus', 'personal_info'] }, 1, 0] } },
          kycDocuments: { $sum: { $cond: [{ $eq: ['$onboardingStatus', 'kyc_documents'] }, 1, 0] } },
          signature: { $sum: { $cond: [{ $eq: ['$onboardingStatus', 'signature'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$onboardingStatus', 'completed'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$onboardingStatus', 'rejected'] }, 1, 0] } },
          
          kycPending: { $sum: { $cond: [{ $eq: ['$kyc.status', 'pending'] }, 1, 0] } },
          kycInReview: { $sum: { $cond: [{ $eq: ['$kyc.status', 'in_review'] }, 1, 0] } },
          kycApproved: { $sum: { $cond: [{ $eq: ['$kyc.status', 'approved'] }, 1, 0] } },
          kycRejected: { $sum: { $cond: [{ $eq: ['$kyc.status', 'rejected'] }, 1, 0] } },
          
          totalSpend: { $sum: '$initialSpendAmount' },
          totalCommissions: { $sum: '$commissionAmount' }
        }
      }
    ]);

    const result = stats[0] || {
      total: 0,
      started: 0,
      personalInfo: 0,
      kycDocuments: 0,
      signature: 0,
      completed: 0,
      rejected: 0,
      kycPending: 0,
      kycInReview: 0,
      kycApproved: 0,
      kycRejected: 0,
      totalSpend: 0,
      totalCommissions: 0
    };

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching customer application stats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};