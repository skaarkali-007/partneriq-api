import mongoose, { Document, Schema } from 'mongoose';
import crypto from 'crypto';

export interface IReferralLink extends Document {
  _id: string;
  marketerId: string;
  productId: string;
  trackingCode: string;
  linkUrl: string;
  isActive: boolean;
  expiresAt?: Date;
  clickCount: number;
  conversionCount: number;
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  generateTrackingCode(): string;
  isExpired(): boolean;
  incrementClickCount(): Promise<void>;
  incrementConversionCount(): Promise<void>;
}

const referralLinkSchema = new Schema<IReferralLink>({
  marketerId: {
    type: String,
    required: [true, 'Marketer ID is required'],
    ref: 'User'
  },
  productId: {
    type: String,
    required: [true, 'Product ID is required'],
    ref: 'Product'
  },
  trackingCode: {
    type: String,
    unique: true,
    index: true
  },
  linkUrl: {
    type: String,
    required: [true, 'Link URL is required'],
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true,
    required: true
  },
  expiresAt: {
    type: Date,
    default: null
  },
  clickCount: {
    type: Number,
    default: 0,
    min: 0
  },
  conversionCount: {
    type: Number,
    default: 0,
    min: 0
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

// Generate unique tracking code
referralLinkSchema.methods.generateTrackingCode = function(): string {
  const timestamp = Date.now().toString(36);
  const randomBytes = crypto.randomBytes(8).toString('hex');
  const marketerId = this.marketerId.slice(-4);
  const productId = this.productId.slice(-4);
  
  return `${timestamp}_${marketerId}_${productId}_${randomBytes}`.toUpperCase();
};

// Check if link is expired
referralLinkSchema.methods.isExpired = function(): boolean {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Increment click count
referralLinkSchema.methods.incrementClickCount = async function(): Promise<void> {
  this.clickCount += 1;
  await this.save();
};

// Increment conversion count
referralLinkSchema.methods.incrementConversionCount = async function(): Promise<void> {
  this.conversionCount += 1;
  await this.save();
};

// Indexes for performance
referralLinkSchema.index({ marketerId: 1 });
referralLinkSchema.index({ productId: 1 });
referralLinkSchema.index({ trackingCode: 1 }, { unique: true });
referralLinkSchema.index({ isActive: 1 });
referralLinkSchema.index({ expiresAt: 1 });
referralLinkSchema.index({ createdAt: -1 });

// Compound indexes for common queries
referralLinkSchema.index({ marketerId: 1, productId: 1 });
referralLinkSchema.index({ marketerId: 1, isActive: 1 });
referralLinkSchema.index({ isActive: 1, expiresAt: 1 });

// Pre-save middleware to generate tracking code if not provided
referralLinkSchema.pre('save', function(next) {
  if (!this.trackingCode && this.isNew) {
    const timestamp = Date.now().toString(36);
    const randomBytes = crypto.randomBytes(8).toString('hex');
    const marketerId = this.marketerId ? this.marketerId.slice(-4) : 'UNKN';
    const productId = this.productId ? this.productId.slice(-4) : 'UNKN';
    
    this.trackingCode = `${timestamp}_${marketerId}_${productId}_${randomBytes}`.toUpperCase();
  }
  next();
});

export const ReferralLink = mongoose.model<IReferralLink>('ReferralLink', referralLinkSchema);