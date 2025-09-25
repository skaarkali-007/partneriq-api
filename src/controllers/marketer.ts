import { Request, Response } from 'express';
import { User } from '../models/User';
import { Customer } from '../models/Customer';
import { ReferralLink } from '../models/ReferralLink';
import { Product } from '../models/Product';
import { CommissionService } from '../services/commission';
import { TrackingService } from '../services/tracking';

// Get marketer dashboard data
export const getDashboardData = async (req: Request, res: Response) => {
  try {
    const marketerId = req.user?.id;
    if (!marketerId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Get commission summary
    const commissionSummary = await CommissionService.getCommissionSummary(marketerId);
    
    // Get recent customers
    const recentCustomers = await Customer.find({ marketerId })
      .populate('productId', 'name')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get referral links
    const referralLinks = await ReferralLink.find({ marketerId })
      .populate('productId', 'name')
      .sort({ createdAt: -1 });
    
    // Calculate performance metrics
    const totalClicks = referralLinks.reduce((sum, link) => sum + (link.clickCount || 0), 0);
    const totalConversions = recentCustomers.filter(c => c.onboardingStatus === 'completed').length;
    const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;
    
    res.json({
      success: true,
      data: {
        commissionSummary,
        recentCustomers: recentCustomers.map(customer => ({
          id: customer._id,
          name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'N/A',
          email: customer.email || 'N/A',
          product: (customer.productId as any)?.name || 'N/A',
          status: customer.onboardingStatus,
          commissionEarned: customer.commissionAmount || 0,
          createdAt: customer.createdAt
        })),
        referralLinks: referralLinks.map(link => ({
          id: link._id,
          product: (link.productId as any)?.name || 'N/A',
          url: link.linkUrl,
          isActive: link.isActive,
          trackingCode: link.trackingCode,
          clickCount: link.clickCount || 0,
          conversionCount: link.conversionCount || 0,
          createdAt: link.createdAt
        })),
        performanceMetrics: {
          totalClicks,
          totalConversions,
          conversionRate: Math.round(conversionRate * 100) / 100
        }
      }
    });
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get commission details
export const getCommissionDetails = async (req: Request, res: Response) => {
  try {
    const marketerId = req.user?.id;
    if (!marketerId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const commissionDetails = await CommissionService.getMarketerCommissionDetails(marketerId);
    
    res.json({
      success: true,
      data: commissionDetails
    });
  } catch (error) {
    console.error('Error getting commission details:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get customer referrals for a marketer
export const getCustomerReferrals = async (req: Request, res: Response) => {
  try {
    const { marketerId } = req.params;
    const { 
      status, 
      product, 
      days, 
      search, 
      commissionStatus, 
      source,
      limit = 50,
      offset = 0 
    } = req.query;

    // Verify the requesting user has access to this marketer's data
    const requestingUserId = req.user?.id;
    if (requestingUserId !== marketerId && req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Build query filters
    const filters: any = { marketerId };

    // Status filter
    if (status && status !== 'all') {
      filters.onboardingStatus = status;
    }

    // Product filter
    if (product && product !== 'all') {
      filters.productId = product;
    }

    // Date range filter
    if (days && days !== '0') {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days as string));
      filters.createdAt = { $gte: daysAgo };
    }

    // Search filter (name or email)
    if (search) {
      filters.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Commission status filter
    if (commissionStatus && commissionStatus !== 'all') {
      if (commissionStatus === 'paid') {
        filters.commissionPaid = true;
      } else if (commissionStatus === 'pending') {
        filters.commissionPaid = false;
        filters.onboardingStatus = 'completed';
      } else if (commissionStatus === 'none') {
        filters.onboardingStatus = { $ne: 'completed' };
      }
    }

    // Get customers with pagination
    const customers = await Customer.find(filters)
      .populate('productId', 'name category commissionType commissionRate commissionFlatAmount')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(offset as string));

    // Get total count for pagination
    const total = await Customer.countDocuments(filters);

    // Transform the data to match the expected CustomerReferral interface
    const referrals = customers.map(customer => ({
      id: customer._id.toString(),
      customerId: customer._id.toString(),
      customerName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'N/A',
      customerEmail: customer.email || 'N/A',
      productId: customer.productId?.toString() || '',
      productName: (customer.productId as any)?.name || 'N/A',
      productCategory: (customer.productId as any)?.category || 'N/A',
      status: customer.onboardingStatus || 'pending',
      referralDate: customer.createdAt,
      conversionDate: customer.onboardingStatus === 'completed' ? customer.updatedAt : null,
      initialSpend: customer.initialSpendAmount || 0,
      commissionAmount: customer.commissionAmount || 0,
      commissionStatus: customer.commissionStatus === 'paid' ? 'paid' : 
                       (customer.onboardingStatus === 'completed' ? 'pending' : 'none'),
      commissionPaidDate: null, // This field doesn't exist in the model, so set to null
      trackingCode: customer.trackingCode || '',
      source: 'direct', // This field doesn't exist in the model, so set default
      notes: customer.adminNotes || '', // Use adminNotes instead
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt
    }));

    res.json({
      success: true,
      data: {
        referrals,
        total,
        pagination: {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          hasMore: (parseInt(offset as string) + parseInt(limit as string)) < total
        }
      }
    });

  } catch (error) {
    console.error('Error getting customer referrals:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};