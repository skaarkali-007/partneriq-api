import mongoose, { Document, Schema } from 'mongoose';

export interface IConsent extends Document {
  _id: string;
  userId?: string; // Optional - for anonymous users
  sessionId?: string; // For tracking anonymous consent
  ipAddress: string;
  userAgent: string;
  consentTypes: {
    necessary: boolean;
    analytics: boolean;
    marketing: boolean;
    preferences: boolean;
  };
  consentVersion: string; // Version of privacy policy/terms
  consentTimestamp: Date;
  withdrawalTimestamp?: Date;
  isWithdrawn: boolean;
  consentMethod: 'banner' | 'settings' | 'registration' | 'api';
  dataProcessingPurposes: string[]; // What data processing the user consented to
  createdAt: Date;
  updatedAt: Date;
}

const consentSchema = new Schema<IConsent>({
  userId: {
    type: String,
    ref: 'User',
    index: true
  },
  sessionId: {
    type: String,
    index: true
  },
  ipAddress: {
    type: String,
    required: true
  },
  userAgent: {
    type: String,
    required: true
  },
  consentTypes: {
    necessary: {
      type: Boolean,
      default: true // Always true as these are required
    },
    analytics: {
      type: Boolean,
      default: false
    },
    marketing: {
      type: Boolean,
      default: false
    },
    preferences: {
      type: Boolean,
      default: false
    }
  },
  consentVersion: {
    type: String,
    required: true,
    default: '1.0'
  },
  consentTimestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  withdrawalTimestamp: {
    type: Date
  },
  isWithdrawn: {
    type: Boolean,
    default: false
  },
  consentMethod: {
    type: String,
    enum: ['banner', 'settings', 'registration', 'api'],
    required: true
  },
  dataProcessingPurposes: [{
    type: String,
    enum: [
      'account_management',
      'service_provision',
      'analytics',
      'marketing',
      'personalization',
      'security',
      'legal_compliance',
      'communication'
    ]
  }]
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
consentSchema.index({ userId: 1, consentTimestamp: -1 });
consentSchema.index({ sessionId: 1, consentTimestamp: -1 });
consentSchema.index({ isWithdrawn: 1 });
consentSchema.index({ consentVersion: 1 });

export const Consent = mongoose.model<IConsent>('Consent', consentSchema);