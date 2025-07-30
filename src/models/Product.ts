import mongoose, { Document, Schema } from 'mongoose';

export interface IProduct extends Document {
  _id: string;
  name: string;
  description: string;
  category: string;
  commissionType: 'percentage' | 'flat';
  commissionRate?: number; // For percentage-based commissions (e.g., 0.05 for 5%)
  commissionFlatAmount?: number; // For flat-rate commissions
  minInitialSpend: number;
  status: 'active' | 'inactive';
  landingPageUrl: string;
  tags: string[];
  onboardingType: 'simple' | 'complex'; // Simple: basic info only, Complex: full KYC
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [255, 'Product name cannot exceed 255 characters']
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    trim: true,
    maxlength: [2000, 'Product description cannot exceed 2000 characters']
  },
  category: {
    type: String,
    required: [true, 'Product category is required'],
    trim: true,
    maxlength: [100, 'Category cannot exceed 100 characters']
  },
  commissionType: {
    type: String,
    enum: ['percentage', 'flat'],
    default: 'percentage',
    required: true
  },
  commissionRate: {
    type: Number,
    min: [0, 'Commission rate cannot be negative'],
    max: [1, 'Commission rate cannot exceed 100%']
  },
  commissionFlatAmount: {
    type: Number,
    min: [0, 'Commission flat amount cannot be negative']
  },
  minInitialSpend: {
    type: Number,
    required: [true, 'Minimum initial spend is required'],
    min: [0, 'Minimum initial spend cannot be negative']
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
    required: true
  },
  landingPageUrl: {
    type: String,
    required: [true, 'Landing page URL is required'],
    trim: true,
    validate: {
      validator: function(value: string) {
        // Basic URL validation
        try {
          new URL(value);
          return true;
        } catch {
          return false;
        }
      },
      message: 'Please provide a valid URL'
    }
  },
  tags: {
    type: [String],
    default: [],
    validate: {
      validator: function(tags: string[]) {
        return tags.length <= 20; // Limit to 20 tags
      },
      message: 'Cannot have more than 20 tags'
    }
  },
  onboardingType: {
    type: String,
    enum: ['simple', 'complex'],
    default: 'simple',
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
productSchema.index({ name: 1 });
productSchema.index({ category: 1 });
productSchema.index({ status: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ createdAt: -1 });

// Compound index for search and filtering
productSchema.index({ status: 1, category: 1, name: 1 });

// Pre-save middleware to validate commission structure
productSchema.pre('save', function(next) {
  if (this.commissionType === 'percentage' && (this.commissionRate === undefined || this.commissionRate === null)) {
    return next(new Error('Commission rate is required for percentage-based commissions'));
  }
  
  if (this.commissionType === 'flat' && (this.commissionFlatAmount === undefined || this.commissionFlatAmount === null)) {
    return next(new Error('Commission flat amount is required for flat-rate commissions'));
  }
  
  next();
});

export const Product = mongoose.model<IProduct>('Product', productSchema);