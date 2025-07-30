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