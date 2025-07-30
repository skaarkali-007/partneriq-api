import mongoose, { Document, Schema } from 'mongoose';
import crypto from 'crypto';

export interface IKYCDocument {
  _id?: mongoose.Types.ObjectId;
  type: 'government_id' | 'proof_of_address' | 'selfie' | 'other';
  filename: string;
  originalName: string;
  encryptedPath: string;
  encryptionKey: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
}

export interface IUserProfile extends Document {
  _id: string;
  userId: mongoose.Types.ObjectId;
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: Date;
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  kycStatus: 'pending' | 'in_review' | 'approved' | 'rejected' | 'requires_resubmission';
  kycDocuments: IKYCDocument[];
  kycSubmittedAt?: Date;
  kycApprovedAt?: Date;
  kycRejectedAt?: Date;
  kycRejectionReason?: string;
  kycReviewedBy?: mongoose.Types.ObjectId;
  complianceQuizScore?: number;
  complianceQuizCompletedAt?: Date;
  complianceQuizPassed: boolean;
  taxId?: string; // Encrypted
  bankAccountInfo?: {
    accountNumber: string; // Encrypted
    routingNumber: string; // Encrypted
    bankName: string;
    accountType: 'checking' | 'savings';
  };
  createdAt: Date;
  updatedAt: Date;

  // Methods
  encryptSensitiveField(value: string): { encrypted: string; key: string };
  decryptSensitiveField(encrypted: string, key: string): string;
  addKYCDocument(document: Omit<IKYCDocument, 'uploadedAt' | 'status'>): void;
  updateKYCStatus(status: IUserProfile['kycStatus'], reviewerId?: string, reason?: string): void;
}

const kycDocumentSchema = new Schema<IKYCDocument>({
  type: {
    type: String,
    enum: ['government_id', 'proof_of_address', 'selfie', 'other'],
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  encryptedPath: {
    type: String,
    required: true
  },
  encryptionKey: {
    type: String,
    required: true,
    select: false // Don't include in queries by default
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionReason: String,
  reviewedBy: String,
  reviewedAt: Date
}, { _id: true });

const addressSchema = new Schema({
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, required: true, default: 'US' }
}, { _id: false });

const bankAccountSchema = new Schema({
  accountNumber: { type: String, required: true, select: false },
  routingNumber: { type: String, required: true, select: false },
  bankName: { type: String, required: true },
  accountType: { 
    type: String, 
    enum: ['checking', 'savings'], 
    required: true 
  }
}, { _id: false });

const userProfileSchema = new Schema<IUserProfile>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  firstName: {
    type: String,
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  phone: {
    type: String,
    trim: true,
    match: [/^\+?[\d\s\-\(\)]+$/, 'Please provide a valid phone number']
  },
  dateOfBirth: {
    type: Date,
    validate: {
      validator: function(value: Date) {
        if (!value) return true; // Optional field
        const age = (Date.now() - value.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        return age >= 18; // Must be at least 18 years old
      },
      message: 'Must be at least 18 years old'
    }
  },
  address: addressSchema,
  kycStatus: {
    type: String,
    enum: ['pending', 'in_review', 'approved', 'rejected', 'requires_resubmission'],
    default: 'pending'
  },
  kycDocuments: [kycDocumentSchema],
  kycSubmittedAt: Date,
  kycApprovedAt: Date,
  kycRejectedAt: Date,
  kycRejectionReason: String,
  kycReviewedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  complianceQuizScore: {
    type: Number,
    min: 0,
    max: 100
  },
  complianceQuizCompletedAt: Date,
  complianceQuizPassed: {
    type: Boolean,
    default: false
  },
  taxId: {
    type: String,
    select: false // Don't include in queries by default
  },
  bankAccountInfo: bankAccountSchema
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete (ret as any)._id;
      delete (ret as any).__v;
      // Remove sensitive fields from JSON output
      if (ret.kycDocuments) {
        ret.kycDocuments = ret.kycDocuments.map((doc: any) => {
          delete doc.encryptionKey;
          return doc;
        });
      }
      delete (ret as any).taxId;
      if (ret.bankAccountInfo) {
        delete (ret.bankAccountInfo as any).accountNumber;
        delete (ret.bankAccountInfo as any).routingNumber;
      }
      return ret;
    }
  }
});

// Encryption methods
userProfileSchema.methods.encryptSensitiveField = function(value: string): { encrypted: string; key: string } {
  const algorithm = 'aes-256-gcm';
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  cipher.setAAD(Buffer.from('userprofile'));
  
  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted: iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted,
    key: key.toString('hex')
  };
};

userProfileSchema.methods.decryptSensitiveField = function(encrypted: string, keyHex: string): string {
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(keyHex, 'hex');
  
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedData = parts[2];
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAAD(Buffer.from('userprofile'));
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

// Add KYC document method
userProfileSchema.methods.addKYCDocument = function(document: Omit<IKYCDocument, 'uploadedAt' | 'status'>) {
  this.kycDocuments.push({
    ...document,
    uploadedAt: new Date(),
    status: 'pending'
  });
};

// Update KYC status method
userProfileSchema.methods.updateKYCStatus = function(
  status: IUserProfile['kycStatus'], 
  reviewerId?: string, 
  reason?: string
) {
  this.kycStatus = status;
  
  if (reviewerId) {
    this.kycReviewedBy = new mongoose.Types.ObjectId(reviewerId);
  }
  
  const now = new Date();
  
  switch (status) {
    case 'in_review':
      this.kycSubmittedAt = now;
      break;
    case 'approved':
      this.kycApprovedAt = now;
      this.kycRejectedAt = undefined;
      this.kycRejectionReason = undefined;
      break;
    case 'rejected':
    case 'requires_resubmission':
      this.kycRejectedAt = now;
      this.kycRejectionReason = reason;
      this.kycApprovedAt = undefined;
      break;
  }
};

// Indexes for performance
userProfileSchema.index({ userId: 1 }, { unique: true });
userProfileSchema.index({ kycStatus: 1 });
userProfileSchema.index({ kycSubmittedAt: 1 });
userProfileSchema.index({ complianceQuizPassed: 1 });

export const UserProfile = mongoose.model<IUserProfile>('UserProfile', userProfileSchema);