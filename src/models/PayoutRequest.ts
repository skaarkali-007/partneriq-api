import mongoose, { Document, Schema } from 'mongoose';

export interface IPayoutRequest extends Document {
  _id: string;
  marketerId: string;
  paymentMethodId: string;
  amount: number;
  status: 'requested' | 'approved' | 'processing' | 'completed' | 'failed' | 'cancelled';
  requestedAt: Date;
  approvedAt?: Date;
  processedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
  transactionId?: string; // From payment gateway
  adminId?: string; // Who approved/processed
  notes?: string; // Admin notes
  processingFee?: number;
  netAmount?: number; // Amount after fees
  createdAt: Date;
  updatedAt: Date;
}

const payoutRequestSchema = new Schema<IPayoutRequest>({
  marketerId: {
    type: String,
    required: [true, 'Marketer ID is required'],
    ref: 'User',
    index: true
  },
  paymentMethodId: {
    type: String,
    required: [true, 'Payment method ID is required'],
    ref: 'PaymentMethod'
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0.01, 'Amount must be greater than 0']
  },
  status: {
    type: String,
    enum: ['requested', 'approved', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'requested',
    required: true
  },
  requestedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  approvedAt: {
    type: Date
  },
  processedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  failureReason: {
    type: String,
    maxlength: [500, 'Failure reason cannot exceed 500 characters']
  },
  transactionId: {
    type: String,
    index: true
  },
  adminId: {
    type: String,
    ref: 'User'
  },
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  processingFee: {
    type: Number,
    min: [0, 'Processing fee cannot be negative'],
    default: 0
  },
  netAmount: {
    type: Number,
    min: [0, 'Net amount cannot be negative']
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete (ret as any)._id;
      delete (ret as any).__v;
      return ret;
    }
  }
});

// Indexes for performance
payoutRequestSchema.index({ marketerId: 1 });
payoutRequestSchema.index({ status: 1 });
payoutRequestSchema.index({ requestedAt: -1 });
payoutRequestSchema.index({ transactionId: 1 });
payoutRequestSchema.index({ adminId: 1 });

// Compound indexes for common queries
payoutRequestSchema.index({ marketerId: 1, status: 1 });
payoutRequestSchema.index({ status: 1, requestedAt: -1 });
payoutRequestSchema.index({ marketerId: 1, requestedAt: -1 });

// Pre-save middleware to calculate net amount
payoutRequestSchema.pre('save', function(next) {
  if (this.isModified('amount') || this.isModified('processingFee')) {
    this.netAmount = this.amount - (this.processingFee || 0);
  }
  next();
});

// Pre-save middleware to set timestamps based on status changes
payoutRequestSchema.pre('save', function(next) {
  const now = new Date();
  
  if (this.isModified('status')) {
    switch (this.status) {
      case 'approved':
        if (!this.approvedAt) this.approvedAt = now;
        break;
      case 'processing':
        if (!this.processedAt) this.processedAt = now;
        break;
      case 'completed':
        if (!this.completedAt) this.completedAt = now;
        break;
    }
  }
  
  next();
});

export const PayoutRequest = mongoose.model<IPayoutRequest>('PayoutRequest', payoutRequestSchema);