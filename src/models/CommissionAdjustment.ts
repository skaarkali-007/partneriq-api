import mongoose, { Document, Schema } from 'mongoose';

export interface ICommissionAdjustment extends Document {
  _id: string;
  commissionId: string;
  adjustmentType: 'clawback' | 'bonus' | 'correction' | 'status_change' | 'payment';
  amount: number;
  reason: string;
  adminId: string;
  createdAt: Date;
  updatedAt: Date;
}

const commissionAdjustmentSchema = new Schema<ICommissionAdjustment>({
  commissionId: {
    type: String,
    required: [true, 'Commission ID is required'],
    ref: 'Commission'
  },
  adjustmentType: {
    type: String,
    enum: ['clawback', 'bonus', 'correction', 'status_change', 'payment'],
    required: [true, 'Adjustment type is required']
  },
  amount: {
    type: Number,
    required: [true, 'Adjustment amount is required']
  },
  reason: {
    type: String,
    required: [true, 'Adjustment reason is required'],
    trim: true,
    maxlength: [1000, 'Reason cannot exceed 1000 characters']
  },
  adminId: {
    type: String,
    required: [true, 'Admin ID is required'],
    ref: 'User'
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
commissionAdjustmentSchema.index({ commissionId: 1 });
commissionAdjustmentSchema.index({ adminId: 1 });
commissionAdjustmentSchema.index({ adjustmentType: 1 });
commissionAdjustmentSchema.index({ createdAt: -1 });

// Compound index for common queries
commissionAdjustmentSchema.index({ commissionId: 1, createdAt: -1 });

export const CommissionAdjustment = mongoose.model<ICommissionAdjustment>('CommissionAdjustment', commissionAdjustmentSchema);