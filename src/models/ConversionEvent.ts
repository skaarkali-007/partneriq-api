import mongoose, { Document, Schema } from 'mongoose';

export interface IConversionEvent extends Document {
  _id: string;
  trackingCode: string;
  customerId: string;
  productId: string;
  initialSpendAmount: number;
  conversionTimestamp: Date;
  attributionMethod: 'cookie' | 'portal' | 's2s' | 'none'; // server-to-server
  commissionEligible: boolean;
  sessionId?: string;
  fingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  clickEventId?: string; // Reference to the original click event
  attributionWindowDays: number;
  deduplicationKey: string;
  
  // Methods
  generateDeduplicationKey(): string;
  isWithinAttributionWindow(clickTimestamp: Date): boolean;
}

const conversionEventSchema = new Schema<IConversionEvent>({
  trackingCode: {
    type: String,
    required: [true, 'Tracking code is required'],
    index: true
  },
  customerId: {
    type: String,
    required: [true, 'Customer ID is required'],
    index: true
  },
  productId: {
    type: String,
    required: [true, 'Product ID is required'],
    ref: 'Product',
    index: true
  },
  initialSpendAmount: {
    type: Number,
    required: [true, 'Initial spend amount is required'],
    min: [0, 'Initial spend amount must be positive']
  },
  conversionTimestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  attributionMethod: {
    type: String,
    enum: ['cookie', 'portal', 's2s', 'none'],
    required: [true, 'Attribution method is required'],
    index: true
  },
  commissionEligible: {
    type: Boolean,
    default: true,
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    default: null,
    index: true
  },
  fingerprint: {
    type: String,
    default: null,
    index: true
  },
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  },
  clickEventId: {
    type: String,
    default: null,
    ref: 'ClickEvent'
  },
  attributionWindowDays: {
    type: Number,
    default: 30,
    min: 1,
    max: 90
  },
  deduplicationKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  }
}, {
  timestamps: false, // We use our own timestamp field
  collection: 'conversion_events',
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete (ret as any)._id;
      delete (ret as any).__v;
      return ret;
    }
  }
});

// Generate deduplication key to prevent duplicate conversions
conversionEventSchema.methods.generateDeduplicationKey = function(): string {
  const crypto = require('crypto');
  const data = `${this.customerId}|${this.productId}|${this.conversionTimestamp.toISOString().split('T')[0]}`;
  return crypto.createHash('sha256').update(data).digest('hex');
};

// Check if conversion is within attribution window
conversionEventSchema.methods.isWithinAttributionWindow = function(clickTimestamp: Date): boolean {
  const timeDiff = this.conversionTimestamp.getTime() - clickTimestamp.getTime();
  const daysDiff = timeDiff / (1000 * 60 * 60 * 24);
  return daysDiff <= this.attributionWindowDays && daysDiff >= 0;
};

// Indexes for optimal query performance
conversionEventSchema.index({ trackingCode: 1, conversionTimestamp: -1 });
conversionEventSchema.index({ customerId: 1, conversionTimestamp: -1 });
conversionEventSchema.index({ productId: 1, conversionTimestamp: -1 });
conversionEventSchema.index({ conversionTimestamp: -1 }); // For analytics and reporting
conversionEventSchema.index({ commissionEligible: 1, conversionTimestamp: -1 });
conversionEventSchema.index({ attributionMethod: 1, conversionTimestamp: -1 });

// Compound indexes for common queries
conversionEventSchema.index({ trackingCode: 1, customerId: 1, productId: 1 });
conversionEventSchema.index({ trackingCode: 1, commissionEligible: 1, conversionTimestamp: -1 });
conversionEventSchema.index({ customerId: 1, productId: 1, conversionTimestamp: -1 });

// TTL index for automatic cleanup (2 years for compliance)
conversionEventSchema.index({ conversionTimestamp: 1 }, { expireAfterSeconds: 2 * 365 * 24 * 60 * 60 });

// Pre-save middleware to generate deduplication key
conversionEventSchema.pre('save', function(next) {
  if (this.isNew && !this.deduplicationKey) {
    const crypto = require('crypto');
    const data = `${this.customerId}|${this.productId}|${this.conversionTimestamp.toISOString().split('T')[0]}`;
    this.deduplicationKey = crypto.createHash('sha256').update(data).digest('hex');
  }
  next();
});

export const ConversionEvent = mongoose.model<IConversionEvent>('ConversionEvent', conversionEventSchema);