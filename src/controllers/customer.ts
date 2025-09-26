import { Request, Response } from 'express';
import { Customer } from '../models/Customer';
import { ReferralLink } from '../models/ReferralLink';
import { Product } from '../models/Product';
import { OnboardingService } from '../services/onboarding';
import { cloudinaryService } from '../services/cloudinary';
import multer from 'multer';
import path from 'path';

// Configure multer for file uploads (memory storage for Cloudinary)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images and documents are allowed'));
    }
  }
});

export const uploadMiddleware = upload.array('documents', 5);

// Start customer onboarding
export const startOnboarding = async (req: Request, res: Response) => {
  try {
    const { trackingCode, productId } = req.body;
    
    if (!trackingCode || !productId) {
      return res.status(400).json({
        success: false,
        message: 'Tracking code and product ID are required'
      });
    }
    
    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Get the referral link to find the marketer ID
    const referralLink = await ReferralLink.findOne({ trackingCode });
    if (!referralLink) {
      return res.status(404).json({
        success: false,
        message: 'Invalid tracking code'
      });
    }
    
    // Check if customer already exists for this tracking code and product
    let customer = await Customer.findOne({ trackingCode, productId });
    
    if (customer) {
      return res.json({
        success: true,
        data: {
          customerId: customer._id,
          currentStep: customer.currentStep,
          totalSteps: customer.totalSteps,
          onboardingStatus: customer.onboardingStatus,
          product: {
            id: product._id,
            name: product.name,
            description: product.description,
            landingPageUrl: product.landingPageUrl,
            onboardingType: product.onboardingType
          }
        }
      });
    }
    
    // Create new customer record
    const totalSteps = product.onboardingType === 'simple' ? 3 : 5;
    
    customer = new Customer({
      trackingCode,
      productId,
      marketerId: referralLink.marketerId,
      referralLinkId: referralLink._id,
      onboardingStatus: 'started',
      currentStep: 1,
      totalSteps,
      consents: {
        termsAndConditions: false,
        privacyPolicy: false,
        marketingCommunications: false,
        dataProcessing: false,
        consentDate: new Date()
      }
    });
    
    await customer.save();
    
    res.status(201).json({
      success: true,
      data: {
        customerId: customer._id,
        currentStep: customer.currentStep,
        totalSteps: customer.totalSteps,
        onboardingStatus: customer.onboardingStatus,
        product: {
          id: product._id,
          name: product.name,
          description: product.description,
          landingPageUrl: product.landingPageUrl,
          onboardingType: product.onboardingType
        }
      }
    });
  } catch (error) {
    console.error('Error starting onboarding:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update personal information (Step 1)
export const updatePersonalInfo = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const {
      firstName,
      lastName,
      email,
      phone,
      dateOfBirth,
      address,
      consents
    } = req.body;
    
    // Validation
    if (!firstName || !lastName || !email || !phone || !dateOfBirth || !address) {
      return res.status(400).json({
        success: false,
        message: 'All personal information fields are required'
      });
    }
    
    if (!consents?.termsAndConditions || !consents?.privacyPolicy || !consents?.dataProcessing) {
      return res.status(400).json({
        success: false,
        message: 'Required consents must be accepted'
      });
    }
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    // Update customer information
    customer.firstName = firstName;
    customer.lastName = lastName;
    customer.email = email;
    customer.phone = phone;
    customer.dateOfBirth = new Date(dateOfBirth);
    customer.address = address;
    customer.consents = {
      ...consents,
      consentDate: new Date()
    };
    
    await customer.updateOnboardingStep(2, 'personal_info');
    
    res.json({
      success: true,
      data: {
        customerId: customer._id,
        currentStep: customer.currentStep,
        onboardingStatus: customer.onboardingStatus
      }
    });
  } catch (error) {
    console.error('Error updating personal info:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update simple personal information (Step 1 for simple onboarding)
export const updateSimplePersonalInfo = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const {
      firstName,
      lastName,
      email,
      phone,
      dateOfBirth,
      consents
    } = req.body;
    
    // Validation for simple onboarding (no address required)
    if (!firstName || !lastName || !email || !phone || !dateOfBirth) {
      return res.status(400).json({
        success: false,
        message: 'All personal information fields are required'
      });
    }
    
    if (!consents?.termsAndConditions || !consents?.privacyPolicy || !consents?.dataProcessing) {
      return res.status(400).json({
        success: false,
        message: 'Required consents must be accepted'
      });
    }
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    // Update customer information (no address for simple onboarding)
    customer.firstName = firstName;
    customer.lastName = lastName;
    customer.email = email;
    customer.phone = phone;
    customer.dateOfBirth = new Date(dateOfBirth);
    customer.consents = {
      ...consents,
      consentDate: new Date()
    };
    
    // For simple onboarding, go to step 2 (initial spend)
    await customer.updateOnboardingStep(2, 'personal_info');
    
    res.json({
      success: true,
      data: {
        customerId: customer._id,
        currentStep: customer.currentStep,
        onboardingStatus: customer.onboardingStatus
      }
    });
  } catch (error) {
    console.error('Error updating simple personal info:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Upload KYC documents (Step 2)
export const uploadKYCDocuments = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one document is required'
      });
    }
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Check if Cloudinary is configured
    if (!cloudinaryService.isReady()) {
      return res.status(500).json({
        success: false,
        message: 'File upload service is not configured. Please contact support.'
      });
    }
    
    try {
      // Upload files to Cloudinary
      const uploadPromises = files.map(async (file, index) => {
        const documentType = req.body.documentTypes?.[index] || 'other';
        
        const uploadResult = await cloudinaryService.uploadKYCDocument(
          file.buffer,
          documentType,
          customerId,
          file.originalname
        );
        
        return {
          type: documentType,
          fileName: file.originalname,
          fileUrl: uploadResult.secure_url,
          publicId: uploadResult.public_id,
          fileSize: uploadResult.bytes,
          format: uploadResult.format,
          uploadedAt: new Date()
        };
      });
      
      const documents = await Promise.all(uploadPromises);
      
      // Add documents to customer
      for (const document of documents) {
        await customer.addKYCDocument(document);
      }
      
      await customer.updateOnboardingStep(3, 'kyc_documents');
      
      res.json({
        success: true,
        data: {
          customerId: customer._id,
          currentStep: customer.currentStep,
          onboardingStatus: customer.onboardingStatus,
          documents: customer.kyc.documents
        }
      });
      
    } catch (uploadError) {
      console.error('Error uploading to Cloudinary:', uploadError);
      res.status(500).json({
        success: false,
        message: 'Failed to upload documents. Please try again.'
      });
    }
  } catch (error) {
    console.error('Error uploading KYC documents:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Complete e-signature (Step 3)
export const completeSignature = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { signatureData } = req.body;
    
    if (!signatureData) {
      return res.status(400).json({
        success: false,
        message: 'Signature data is required'
      });
    }
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    const ipAddress = req.ip || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    await customer.completeSignature(signatureData, ipAddress, userAgent);
    
    // Update onboarding status using the service to trigger notifications
    await OnboardingService.updateOnboardingStatus({
      customerId: customer._id,
      status: 'completed',
      step: 4,
      completedAt: customer.completedAt
    });
    
    res.json({
      success: true,
      data: {
        customerId: customer._id,
        currentStep: customer.currentStep,
        onboardingStatus: customer.onboardingStatus,
        completedAt: customer.completedAt
      }
    });
  } catch (error) {
    console.error('Error completing signature:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get customer onboarding status
export const getOnboardingStatus = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    const product = await Product.findById(customer.productId);
    
    res.json({
      success: true,
      data: {
        customerId: customer._id,
        currentStep: customer.currentStep,
        totalSteps: customer.totalSteps,
        onboardingStatus: customer.onboardingStatus,
        personalInfo: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          dateOfBirth: customer.dateOfBirth,
          address: customer.address
        },
        kyc: {
          status: customer.kyc.status,
          documentsCount: customer.kyc.documents.length
        },
        signature: {
          signed: customer.signature.signed,
          signedAt: customer.signature.signedAt
        },
        product: product ? {
          id: product._id,
          name: product.name,
          description: product.description
        } : null,
        createdAt: customer.createdAt,
        completedAt: customer.completedAt
      }
    });
  } catch (error) {
    console.error('Error getting onboarding status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Validate step data
export const validateStepData = async (req: Request, res: Response) => {
  try {
    const { step } = req.params;
    const stepNumber = parseInt(step);
    
    switch (stepNumber) {
      case 1: // Personal information validation
        const { firstName, lastName, email, phone, dateOfBirth, address, consents } = req.body;
        
        const errors: string[] = [];
        
        if (!firstName?.trim()) errors.push('First name is required');
        if (!lastName?.trim()) errors.push('Last name is required');
        if (!email?.trim()) errors.push('Email is required');
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Invalid email format');
        if (!phone?.trim()) errors.push('Phone number is required');
        if (!dateOfBirth) errors.push('Date of birth is required');
        else {
          const age = new Date().getFullYear() - new Date(dateOfBirth).getFullYear();
          if (age < 18) errors.push('Must be at least 18 years old');
        }
        if (!address?.street?.trim()) errors.push('Street address is required');
        if (!address?.city?.trim()) errors.push('City is required');
        if (!address?.state?.trim()) errors.push('State is required');
        if (!address?.zipCode?.trim()) errors.push('ZIP code is required');
        if (!consents?.termsAndConditions) errors.push('Terms and conditions must be accepted');
        if (!consents?.privacyPolicy) errors.push('Privacy policy must be accepted');
        if (!consents?.dataProcessing) errors.push('Data processing consent must be accepted');
        
        return res.json({
          success: errors.length === 0,
          errors: errors.length > 0 ? errors : undefined
        });
        
      case 2: // KYC documents validation
        return res.json({
          success: true,
          message: 'Documents will be validated upon upload'
        });
        
      case 3: // Signature validation
        const { signatureData } = req.body;
        if (!signatureData) {
          return res.json({
            success: false,
            errors: ['Signature is required']
          });
        }
        return res.json({ success: true });
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid step number'
        });
    }
  } catch (error) {
    console.error('Error validating step data:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
// Record conversion when customer makes initial spend
export const recordConversion = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { 
      initialSpend, 
      spendDate, 
      paymentMethod, 
      transactionReference, 
      notes 
    } = req.body;
    
    if (!initialSpend || initialSpend <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Initial spend amount is required and must be greater than 0'
      });
    }
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    // Update customer with initial spend
    customer.initialSpendAmount = initialSpend;
    customer.initialSpendDate = spendDate ? new Date(spendDate) : new Date();
    customer.paymentStatus = 'completed';
    customer.paymentMethod = paymentMethod;
    customer.paymentDate = spendDate ? new Date(spendDate) : new Date();
    
    // Add conversion notes if provided
    if (notes || paymentMethod || transactionReference) {
      const conversionNotes = [];
      if (paymentMethod) conversionNotes.push(`Payment Method: ${paymentMethod}`);
      if (transactionReference) conversionNotes.push(`Transaction Ref: ${transactionReference}`);
      if (notes) conversionNotes.push(`Notes: ${notes}`);
      customer.adminNotes = conversionNotes.join(' | ');
    }
    
    // Get product to check onboarding type
    const product = await Product.findById(customer.productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Record conversion and calculate commission
    const conversionData = {
      customerId,
      trackingCode: customer.trackingCode,
      productId: customer.productId,
      initialSpendAmount: initialSpend,
      sessionId: req.cookies?.affiliate_session,
      ipAddress: req.ip || req.socket?.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown'
    };
    
    await OnboardingService.recordConversion(conversionData);
    
    // Move to next step in onboarding
    const isSimpleOnboarding = product.onboardingType === 'simple';
    const nextStep = isSimpleOnboarding ? 3 : 5; // Final step for both flows
    await customer.updateOnboardingStep(nextStep, 'completed');
    
    // Update onboarding status to completed
    await OnboardingService.updateOnboardingStatus({
      customerId: customer._id,
      status: 'completed',
      step: nextStep,
      completedAt: new Date()
    });
    
    await customer.save();
    
    res.json({
      success: true,
      data: {
        customerId: customer._id,
        currentStep: customer.currentStep,
        onboardingStatus: customer.onboardingStatus,
        initialSpend: customer.initialSpendAmount,
        conversionRecorded: true
      }
    });
  } catch (error) {
    console.error('Error recording conversion:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get detailed customer status (for marketers)
export const getDetailedCustomerStatus = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    
    const customerStatus = await OnboardingService.getCustomerStatus(customerId);
    
    res.json({
      success: true,
      data: customerStatus
    });
    
  } catch (error) {
    console.error('Error getting detailed customer status:', error);
    if (error instanceof Error && error.message === 'Customer not found') {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get customers for a marketer
export const getMarketerCustomers = async (req: Request, res: Response) => {
  try {
    const { marketerId } = req.params;
    const {
      status,
      limit = 20,
      offset = 0,
      startDate,
      endDate
    } = req.query;
    
    const options: any = {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    };
    
    if (status) {
      options.status = status as string;
    }
    
    if (startDate) {
      options.startDate = new Date(startDate as string);
    }
    
    if (endDate) {
      options.endDate = new Date(endDate as string);
    }
    
    const result = await OnboardingService.getMarketerCustomers(marketerId, options);
    
    res.json({
      success: true,
      data: {
        referrals: result.referrals,
        total: result.total
      }
    });
    
  } catch (error) {
    console.error('Error getting marketer customers:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get onboarding analytics for a marketer
export const getOnboardingAnalytics = async (req: Request, res: Response) => {
  try {
    const { marketerId } = req.params;
    
    const analytics = await OnboardingService.getOnboardingAnalytics(marketerId);
    
    res.json({
      success: true,
      data: analytics
    });
    
  } catch (error) {
    console.error('Error getting onboarding analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update customer status (admin only)
export const updateCustomerStatus = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { status, step, rejectionReason } = req.body;
    
    if (!status || !step) {
      return res.status(400).json({
        success: false,
        message: 'Status and step are required'
      });
    }
    
    const updateData = {
      customerId,
      status,
      step: parseInt(step),
      completedAt: status === 'completed' ? new Date() : undefined,
      rejectionReason
    };
    
    const updatedCustomer = await OnboardingService.updateOnboardingStatus(updateData);
    
    res.json({
      success: true,
      data: {
        customerId: updatedCustomer._id,
        status: updatedCustomer.onboardingStatus,
        step: updatedCustomer.currentStep,
        updatedAt: updatedCustomer.updatedAt
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

// Skip KYC process and move to completion
export const skipKYC = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Get the product to determine onboarding type
    const product = await Product.findById(customer.productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Update customer to skip KYC and move to completion
    const finalStep = product.onboardingType === 'simple' ? 2 : 4;
    
    customer.currentStep = finalStep;
    customer.onboardingStatus = 'completed';
    customer.completedAt = new Date();
    
    // Mark KYC as skipped
    customer.kyc.status = 'skipped';
    customer.kyc.skippedAt = new Date();
    
    await customer.save();
    
    res.json({
      success: true,
      data: {
        customerId: customer._id,
        currentStep: customer.currentStep,
        totalSteps: customer.totalSteps,
        onboardingStatus: customer.onboardingStatus,
        kycStatus: customer.kyc.status,
        completedAt: customer.completedAt
      }
    });
    
  } catch (error) {
    console.error('Error skipping KYC:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
// Delete KYC document
export const deleteKYCDocument = async (req: Request, res: Response) => {
  try {
    const { customerId, documentId } = req.params;
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    // Find the document
    const documentIndex = customer.kyc.documents.findIndex(
      doc => doc._id?.toString() === documentId
    );
    
    if (documentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    const document = customer.kyc.documents[documentIndex];
    
    // Delete from Cloudinary if publicId exists
    if (document.publicId && cloudinaryService.isReady()) {
      try {
        await cloudinaryService.deleteFile(document.publicId);
      } catch (cloudinaryError) {
        console.error('Error deleting from Cloudinary:', cloudinaryError);
        // Continue with database deletion even if Cloudinary deletion fails
      }
    }
    
    // Remove document from customer record
    customer.kyc.documents.splice(documentIndex, 1);
    
    // Update KYC status if no documents remain
    if (customer.kyc.documents.length === 0) {
      customer.kyc.status = 'pending';
    }
    
    await customer.save();
    
    res.json({
      success: true,
      data: {
        customerId: customer._id,
        documentsCount: customer.kyc.documents.length,
        kycStatus: customer.kyc.status
      }
    });
    
  } catch (error) {
    console.error('Error deleting KYC document:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get KYC document details
export const getKYCDocument = async (req: Request, res: Response) => {
  try {
    const { customerId, documentId } = req.params;
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    const document = customer.kyc.documents.find(
      doc => doc._id?.toString() === documentId
    );
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    // Generate a secure URL with transformations if needed
    let secureUrl = document.fileUrl;
    if (document.publicId && cloudinaryService.isReady()) {
      try {
        secureUrl = cloudinaryService.generateSecureUrl(document.publicId, [
          { quality: 'auto:good' },
          { fetch_format: 'auto' }
        ]);
      } catch (error) {
        console.error('Error generating secure URL:', error);
        // Fall back to stored URL
      }
    }
    
    res.json({
      success: true,
      data: {
        id: document._id,
        type: document.type,
        fileName: document.fileName,
        fileUrl: secureUrl,
        fileSize: document.fileSize,
        format: document.format,
        uploadedAt: document.uploadedAt
      }
    });
    
  } catch (error) {
    console.error('Error getting KYC document:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};