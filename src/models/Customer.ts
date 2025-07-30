import mongoose, { Document, Schema } from 'mongoose';

export interface ICustomer extends Document {
  _id: string;
  trackingCode: string;
  referralLinkId?: string;
  marketerId?: string;
  productId: string;
  
  // Personal Information
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: Date;
  
  // Address Information
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  
  // KYC Information
  kyc: {
    status: 'pending' | 'in_review' | 'approved' | 'rejected';
    documents: Array<{
      type: 'government_id' | 'proof_of_address' | 'income_verification' | 'other';
      fileName: string;
      fileUrl: string;
      uploadedAt: Date;
    }>;
    reviewedAt?: Date;
    reviewedBy?: string;
    rejectionReason?: string;
  };
  
  // Application Status
  onboardingStatus: 'started' | 'personal_info' | 'kyc_documents' | 'signature' | 'completed' | 'rejected';
  currentStep: number;
  totalSteps: number;
  
  // E-signature
  signature: {
    signed: boolean;
    signedAt?: Date;
    signatureData?: string; // Base64 encoded signature
    ipAddress?: string;
    userAgent?: string;
  };
  
  // Financial Information
  initialSpendAmount?: number;
  initialSpendDate?: Date;
  
  // Consent and Legal
  consents: {
    termsAndConditions: boolean;
    privacyPolicy: boolean;
    marketingCommunications: boolean;
    dataProcessing: boolean;
    consentDate: Date;
  };
  
  // Admin Management Fields
  adminReviewedAt?: Date;
  adminReviewedBy?: string;
  adminNotes?: string;
  statusChangeReason?: string;
  
  // Payment Management
  paymentStatus?: 'pending' | 'completed' | 'failed' | 'refunded';
  paymentMethod?: string;
  paymentDate?: Date;
  
  // Commission Integration
  commissionId?: string;
  commissionAmount?: number;
  commissionStatus?: 'pending' | 'approved' | 'paid' | 'cancelled';
  
  // Audit Trail
  statusHistory: Array<{
    fromStatus: string;
    toStatus: string;
    reason: string;
    changedBy: string;
    changedAt: Date;
  }>;
  
  paymentHistory: Array<{
    field: string;
    oldValue: any;
    newValue: any;
    reason: string;
    changedBy: string;
    changedAt: Date;
  }>;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  
  // Methods
  updateOnboardingStep(step: number, status: string): Promise<ICustomer>;
  addKYCDocument(document: any): Promise<ICustomer>;
  completeSignature(signatureData: string, ipAddress: string, userAgent: string): Promise<ICustomer>;
  updateAdminStatus(status: string, reason: string, adminId: string): Promise<ICustomer>;
  updatePaymentInfo(paymentData: any, reason: string, adminId: string): Promise<ICustomer>;
}

const CustomerSchema = new Schema<ICustomer>({
  trackingCode: {
    type: String,
    required: true,
    index: true
  },
  referralLinkId: {
    type: String,
    index: true
  },
  marketerId: {
    type: String,
    index: true
  },
  productId: {
    type: String,
    required: true,
    index: true
  },
  
  // Personal Information
  firstName: {
    type: String,
    trim: true
  },
  lastName: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    index: true
  },
  phone: {
    type: String,
    trim: true
  },
  dateOfBirth: {
    type: Date
  },
  
  // Address Information
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zipCode: { type: String, trim: true },
    country: { type: String, trim: true, default: 'US' }
  },
  
  // KYC Information
  kyc: {
    status: {
      type: String,
      enum: ['pending', 'in_review', 'approved', 'rejected'],
      default: 'pending'
    },
    documents: [{
      type: {
        type: String,
        enum: ['government_id', 'proof_of_address', 'income_verification', 'other'],
        required: true
      },
      fileName: { type: String, required: true },
      fileUrl: { type: String, required: true },
      uploadedAt: { type: Date, default: Date.now }
    }],
    reviewedAt: Date,
    reviewedBy: String,
    rejectionReason: String
  },
  
  // Application Status
  onboardingStatus: {
    type: String,
    enum: ['started', 'personal_info', 'kyc_documents', 'signature', 'completed', 'rejected'],
    default: 'started'
  },
  currentStep: {
    type: Number,
    default: 1
  },
  totalSteps: {
    type: Number,
    default: 4
  },
  
  // E-signature
  signature: {
    signed: { type: Boolean, default: false },
    signedAt: Date,
    signatureData: String,
    ipAddress: String,
    userAgent: String
  },
  
  // Financial Information
  initialSpendAmount: Number,
  initialSpendDate: Date,
  
  // Consent and Legal
  consents: {
    termsAndConditions: { type: Boolean, required: true },
    privacyPolicy: { type: Boolean, required: true },
    marketingCommunications: { type: Boolean, default: false },
    dataProcessing: { type: Boolean, required: true },
    consentDate: { type: Date, default: Date.now }
  },
  
  // Admin Management Fields
  adminReviewedAt: Date,
  adminReviewedBy: String,
  adminNotes: String,
  statusChangeReason: String,
  
  // Payment Management
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: String,
  paymentDate: Date,
  
  // Commission Integration
  commissionId: String,
  commissionAmount: Number,
  commissionStatus: {
    type: String,
    enum: ['pending', 'approved', 'paid', 'cancelled']
  },
  
  // Audit Trail
  statusHistory: [{
    fromStatus: String,
    toStatus: { type: String, required: true },
    reason: String,
    changedBy: { type: String, required: true },
    changedAt: { type: Date, default: Date.now }
  }],
  
  paymentHistory: [{
    field: { type: String, required: true },
    oldValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    reason: String,
    changedBy: { type: String, required: true },
    changedAt: { type: Date, default: Date.now }
  }],
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  completedAt: Date
}, {
  timestamps: true
});

// Indexes for performance
CustomerSchema.index({ trackingCode: 1, productId: 1 });
CustomerSchema.index({ email: 1, productId: 1 });
CustomerSchema.index({ marketerId: 1, onboardingStatus: 1 });
CustomerSchema.index({ createdAt: -1 });

// Additional indexes for admin queries
CustomerSchema.index({ onboardingStatus: 1, createdAt: -1 });
CustomerSchema.index({ 'kyc.status': 1, createdAt: -1 });
CustomerSchema.index({ paymentStatus: 1, createdAt: -1 });
CustomerSchema.index({ adminReviewedBy: 1, adminReviewedAt: -1 });

// Pre-save middleware to update the updatedAt field
CustomerSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});



// Instance methods
CustomerSchema.methods.updateOnboardingStep = function(step: number, status: string) {
  this.currentStep = step;
  this.onboardingStatus = status;
  return this.save();
};

CustomerSchema.methods.addKYCDocument = function(document: any) {
  this.kyc.documents.push(document);
  if (this.kyc.status === 'pending') {
    this.kyc.status = 'in_review';
  }
  return this.save();
};

CustomerSchema.methods.completeSignature = function(signatureData: string, ipAddress: string, userAgent: string) {
  this.signature = {
    signed: true,
    signedAt: new Date(),
    signatureData,
    ipAddress,
    userAgent
  };
  this.onboardingStatus = 'completed';
  this.completedAt = new Date();
  return this.save();
};

CustomerSchema.methods.updateAdminStatus = function(status: string, reason: string, adminId: string) {
  // Add to status history
  this.statusHistory.push({
    fromStatus: this.onboardingStatus,
    toStatus: status,
    reason,
    changedBy: adminId,
    changedAt: new Date()
  });
  
  // Update current status
  this.onboardingStatus = status;
  this.statusChangeReason = reason;
  this.adminReviewedAt = new Date();
  this.adminReviewedBy = adminId;
  
  if (status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
  }
  
  return this.save();
};

CustomerSchema.methods.updatePaymentInfo = function(paymentData: any, reason: string, adminId: string) {
  // Track changes in payment history
  const changes = [];
  
  if (paymentData.initialSpendAmount !== undefined && paymentData.initialSpendAmount !== this.initialSpendAmount) {
    this.paymentHistory.push({
      field: 'initialSpendAmount',
      oldValue: this.initialSpendAmount,
      newValue: paymentData.initialSpendAmount,
      reason,
      changedBy: adminId,
      changedAt: new Date()
    });
    this.initialSpendAmount = paymentData.initialSpendAmount;
  }
  
  if (paymentData.paymentStatus !== undefined && paymentData.paymentStatus !== this.paymentStatus) {
    this.paymentHistory.push({
      field: 'paymentStatus',
      oldValue: this.paymentStatus,
      newValue: paymentData.paymentStatus,
      reason,
      changedBy: adminId,
      changedAt: new Date()
    });
    this.paymentStatus = paymentData.paymentStatus;
  }
  
  if (paymentData.paymentMethod !== undefined && paymentData.paymentMethod !== this.paymentMethod) {
    this.paymentHistory.push({
      field: 'paymentMethod',
      oldValue: this.paymentMethod,
      newValue: paymentData.paymentMethod,
      reason,
      changedBy: adminId,
      changedAt: new Date()
    });
    this.paymentMethod = paymentData.paymentMethod;
  }
  
  if (paymentData.paymentDate !== undefined) {
    const newDate = new Date(paymentData.paymentDate);
    if (newDate.getTime() !== this.paymentDate?.getTime()) {
      this.paymentHistory.push({
        field: 'paymentDate',
        oldValue: this.paymentDate,
        newValue: newDate,
        reason,
        changedBy: adminId,
        changedAt: new Date()
      });
      this.paymentDate = newDate;
    }
  }
  
  // Update admin tracking
  this.adminReviewedAt = new Date();
  this.adminReviewedBy = adminId;
  
  return this.save();
};

export const Customer = mongoose.model<ICustomer>('Customer', CustomerSchema);