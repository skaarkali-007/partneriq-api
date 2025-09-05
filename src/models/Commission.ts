import mongoose, { Document, Schema } from 'mongoose';

export interface ICommission extends Document {
  _id: string;
  marketerId: string;
  customerId: string;
  productId: string;
  trackingCode: string;
  initialSpendAmount: number;
  commissionRate?: number;
  commissionFlatAmount?: number;
  commissionAmount: number;
  status: 'pending' | 'approved' | 'paid' | 'clawed_back' | 'rejected';
  conversionDate: Date;
  approvalDate?: Date;
  clearancePeriodDays: number;
  eligibleForPayoutDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const commissionSchema = new Schema<ICommission>({
  marketerId: {
    type: String,
    required: [true, 'Marketer ID is required'],
    ref: 'User'
  },
  customerId: {
    type: String,
    required: [true, 'Customer ID is required']
  },
  productId: {
    type: String,
    required: [true, 'Product ID is required'],
    ref: 'Product'
  },
  trackingCode: {
    type: String,
    required: [true, 'Tracking code is required'],
    index: true
  },
  initialSpendAmount: {
    type: Number,
    required: [true, 'Initial spend amount is required'],
    min: [0, 'Initial spend amount cannot be negative']
  },
  commissionRate: {
    type: Number,
    //required: [true, 'Commission rate is required'],
    min: [0, 'Commission rate cannot be negative'],
    max: [1, 'Commission rate cannot exceed 100%']
  },
  commissionFlatAmount: {
    type: Number,
    //required: [true, 'Commission rate is required'],
    min: [0, 'Commission rate cannot be negative'],
  },

  commissionAmount: {
    type: Number,
    required: [true, 'Commission amount is required'],
    min: [0, 'Commission amount cannot be negative']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'paid', 'clawed_back', 'rejected'],
    default: 'pending',
    required: true
  },
  conversionDate: {
    type: Date,
    required: [true, 'Conversion date is required']
  },
  approvalDate: {
    type: Date
  },
  clearancePeriodDays: {
    type: Number,
    default: 30,
    min: [0, 'Clearance period cannot be negative']
  },
  eligibleForPayoutDate: {
    type: Date
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
commissionSchema.index({ marketerId: 1 });
commissionSchema.index({ customerId: 1 });
commissionSchema.index({ productId: 1 });
commissionSchema.index({ trackingCode: 1 });
commissionSchema.index({ status: 1 });
commissionSchema.index({ conversionDate: -1 });
commissionSchema.index({ eligibleForPayoutDate: 1 });

// Compound indexes for common queries
commissionSchema.index({ marketerId: 1, status: 1 });
commissionSchema.index({ status: 1, eligibleForPayoutDate: 1 });
commissionSchema.index({ marketerId: 1, conversionDate: -1 });

// Pre-save middleware to calculate eligible for payout date
commissionSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('conversionDate') || this.isModified('clearancePeriodDays')) {
    this.eligibleForPayoutDate = new Date(this.conversionDate.getTime() + (this.clearancePeriodDays * 24 * 60 * 60 * 1000));
  }
  next();
});

export const Commission = mongoose.model<ICommission>('Commission', commissionSchema);