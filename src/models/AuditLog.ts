import mongoose, { Document, Schema } from 'mongoose';

export interface IAuditLog extends Document {
  _id: string;
  adminId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details: {
    oldValue?: any;
    newValue?: any;
    reason?: string;
    metadata?: any;
  };
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  adminId: {
    type: String,
    required: true,
    ref: 'User'
  },
  action: {
    type: String,
    required: true,
    enum: [
      // User management actions
      'user_status_changed',
      'user_bulk_action',
      'user_profile_updated',
      'kyc_status_changed',
      
      // Product management actions
      'product_created',
      'product_updated',
      'product_deleted',
      'product_status_changed',
      'product_material_uploaded',
      'product_material_deleted',
      
      // Commission management actions
      'commission_approved',
      'commission_rejected',
      'commission_clawback',
      'commission_adjustment',
      
      // Payout management actions
      'payout_approved',
      'payout_rejected',
      'payout_processed',
      'bulk_payout_processed',
      
      // System actions
      'admin_login',
      'admin_logout',
      'settings_changed',
      'report_generated',
      'data_export',
      
      // Data retention and GDPR actions
      'retention_policy_started',
      'retention_policy_completed',
      'data_anonymization',
      'data_deletion',
      'manual_anonymization',
      'field_rectification',
      'data_retention_check',
      'gdpr_request'
    ]
  },
  resource: {
    type: String,
    required: true,
    enum: ['user', 'product', 'commission', 'payout', 'system', 'report']
  },
  resourceId: {
    type: String,
    required: false // Some actions might not have a specific resource ID
  },
  details: {
    oldValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    reason: String,
    metadata: Schema.Types.Mixed
  },
  ipAddress: {
    type: String,
    required: false
  },
  userAgent: {
    type: String,
    required: false
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
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
auditLogSchema.index({ adminId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ resource: 1, resourceId: 1, timestamp: -1 });
auditLogSchema.index({ timestamp: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);