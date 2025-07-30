import mongoose, { Document, Schema } from 'mongoose';

export interface IClickEvent extends Document {
  _id: string;
  trackingCode: string;
  ipAddress: string;
  userAgent: string;
  referrer?: string;
  timestamp: Date;
  sessionId: string;
  customerId?: string;
  fingerprint: string;
  country?: string;
  city?: string;
  device?: string;
  browser?: string;
  os?: string;
  
  // Methods
  generateFingerprint(): string;
}

const clickEventSchema = new Schema<IClickEvent>({
  trackingCode: {
    type: String,
    required: [true, 'Tracking code is required'],
    index: true
  },
  ipAddress: {
    type: String,
    required: [true, 'IP address is required'],
    index: true
  },
  userAgent: {
    type: String,
    required: [true, 'User agent is required']
  },
  referrer: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    required: [true, 'Session ID is required'],
    index: true
  },
  customerId: {
    type: String,
    default: null,
    index: true
  },
  fingerprint: {
    type: String,
    required: false,
    index: true
  },
  country: {
    type: String,
    default: null
  },
  city: {
    type: String,
    default: null
  },
  device: {
    type: String,
    default: null
  },
  browser: {
    type: String,
    default: null
  },
  os: {
    type: String,
    default: null
  }
}, {
  timestamps: false, // We use our own timestamp field
  collection: 'click_events',
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete (ret as any)._id;
      delete (ret as any).__v;
      return ret;
    }
  }
});

// Generate device fingerprint for attribution
clickEventSchema.methods.generateFingerprint = function(): string {
  const crypto = require('crypto');
  const data = `${this.ipAddress}|${this.userAgent}|${this.sessionId}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
};

// Indexes for optimal query performance
clickEventSchema.index({ trackingCode: 1, timestamp: -1 });
clickEventSchema.index({ sessionId: 1, timestamp: -1 });
clickEventSchema.index({ customerId: 1, timestamp: -1 });
clickEventSchema.index({ fingerprint: 1, timestamp: -1 });
clickEventSchema.index({ ipAddress: 1, timestamp: -1 });
clickEventSchema.index({ timestamp: -1 }); // For cleanup and analytics

// Compound indexes for common attribution queries
clickEventSchema.index({ trackingCode: 1, sessionId: 1, timestamp: -1 });
clickEventSchema.index({ trackingCode: 1, fingerprint: 1, timestamp: -1 });
clickEventSchema.index({ trackingCode: 1, customerId: 1, timestamp: -1 });

// TTL index for automatic cleanup (90 days)
clickEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Pre-save middleware to generate fingerprint
clickEventSchema.pre('save', function(next) {
  if (this.isNew && !this.fingerprint) {
    const crypto = require('crypto');
    const data = `${this.ipAddress}|${this.userAgent}|${this.sessionId}`;
    this.fingerprint = crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }
  next();
});

export const ClickEvent = mongoose.model<IClickEvent>('ClickEvent', clickEventSchema);