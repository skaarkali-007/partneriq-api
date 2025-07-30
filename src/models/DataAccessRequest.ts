import mongoose, { Document, Schema } from 'mongoose';

export interface IDataAccessRequest extends Document {
  _id: string;
  userId: string;
  requestType: 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction' | 'objection';
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  requestDetails: string;
  requestedData?: string[]; // Specific data types requested
  responseData?: any; // The actual data provided (for access/portability requests)
  rejectionReason?: string;
  requestedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  processedBy?: string; // Admin user ID
  verificationToken?: string; // For email verification of requests
  verificationExpires?: Date;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const dataAccessRequestSchema = new Schema<IDataAccessRequest>({
  userId: {
    type: String,
    ref: 'User',
    required: true,
    index: true
  },
  requestType: {
    type: String,
    enum: ['access', 'rectification', 'erasure', 'portability', 'restriction', 'objection'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'rejected'],
    default: 'pending',
    required: true
  },
  requestDetails: {
    type: String,
    required: true,
    maxlength: 1000
  },
  requestedData: [{
    type: String,
    enum: [
      'profile_data',
      'commission_data',
      'tracking_data',
      'payout_data',
      'consent_data',
      'audit_logs',
      'all_data'
    ]
  }],
  responseData: {
    type: Schema.Types.Mixed
  },
  rejectionReason: {
    type: String,
    maxlength: 500
  },
  requestedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  processedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  processedBy: {
    type: String,
    ref: 'User'
  },
  verificationToken: {
    type: String,
    select: false
  },
  verificationExpires: {
    type: Date,
    select: false
  },
  isVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete (ret as any)._id;
      delete (ret as any).__v;
      delete (ret as any).verificationToken;
      delete (ret as any).verificationExpires;
      return ret;
    }
  }
});

// Indexes for performance
dataAccessRequestSchema.index({ userId: 1, requestedAt: -1 });
dataAccessRequestSchema.index({ status: 1, requestedAt: -1 });
dataAccessRequestSchema.index({ requestType: 1 });
dataAccessRequestSchema.index({ verificationToken: 1 });

// Generate verification token method
dataAccessRequestSchema.methods.generateVerificationToken = function(): string {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  
  this.verificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  return token;
};

export const DataAccessRequest = mongoose.model<IDataAccessRequest>('DataAccessRequest', dataAccessRequestSchema);