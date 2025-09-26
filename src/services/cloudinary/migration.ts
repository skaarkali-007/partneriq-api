import fs from 'fs';
import path from 'path';
import { Customer } from '../../models/Customer';
import { cloudinaryService } from './index';

export interface MigrationResult {
  success: boolean;
  customerId: string;
  documentId: string;
  oldUrl: string;
  newUrl?: string;
  error?: string;
}

export class CloudinaryMigration {
  /**
   * Migrate all local KYC documents to Cloudinary
   */
  public static async migrateAllKYCDocuments(): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    
    try {
      // Find all customers with KYC documents
      const customers = await Customer.find({
        'kyc.documents.0': { $exists: true }
      });

      console.log(`Found ${customers.length} customers with KYC documents`);

      for (const customer of customers) {
        const customerResults = await this.migrateCustomerDocuments(customer);
        results.push(...customerResults);
      }

      return results;
    } catch (error) {
      console.error('Error during migration:', error);
      throw error;
    }
  }

  /**
   * Migrate KYC documents for a specific customer
   */
  public static async migrateCustomerDocuments(customer: any): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];

    for (const document of customer.kyc.documents) {
      const result = await this.migrateDocument(customer._id.toString(), document);
      results.push(result);

      // If migration was successful, update the document in the database
      if (result.success && result.newUrl) {
        const docIndex = customer.kyc.documents.findIndex(
          (doc: any) => doc._id.toString() === document._id.toString()
        );
        
        if (docIndex !== -1) {
          customer.kyc.documents[docIndex].fileUrl = result.newUrl;
          customer.kyc.documents[docIndex].publicId = this.extractPublicIdFromUrl(result.newUrl);
        }
      }
    }

    // Save the updated customer document
    if (results.some(r => r.success)) {
      await customer.save();
      console.log(`Updated customer ${customer._id} with new Cloudinary URLs`);
    }

    return results;
  }

  /**
   * Migrate a single document
   */
  private static async migrateDocument(customerId: string, document: any): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      customerId,
      documentId: document._id.toString(),
      oldUrl: document.fileUrl
    };

    try {
      // Check if document is already on Cloudinary
      if (document.fileUrl.includes('cloudinary.com') || document.publicId) {
        result.success = true;
        result.newUrl = document.fileUrl;
        return result;
      }

      // Check if local file exists
      const localPath = this.getLocalFilePath(document.fileUrl);
      if (!fs.existsSync(localPath)) {
        result.error = 'Local file not found';
        return result;
      }

      // Read file buffer
      const fileBuffer = fs.readFileSync(localPath);

      // Upload to Cloudinary
      const uploadResult = await cloudinaryService.uploadKYCDocument(
        fileBuffer,
        document.type,
        customerId,
        document.fileName
      );

      result.success = true;
      result.newUrl = uploadResult.secure_url;

      console.log(`Migrated document ${document._id} for customer ${customerId}`);

      // Optionally delete local file after successful upload
      // fs.unlinkSync(localPath);

    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to migrate document ${document._id}:`, error);
    }

    return result;
  }

  /**
   * Convert relative URL to absolute local file path
   */
  private static getLocalFilePath(fileUrl: string): string {
    // Remove leading slash and convert to absolute path
    const relativePath = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
    return path.join(process.cwd(), relativePath);
  }

  /**
   * Extract Cloudinary public ID from URL
   */
  private static extractPublicIdFromUrl(url: string): string {
    const matches = url.match(/\/v\d+\/(.+)\.[^.]+$/);
    return matches ? matches[1] : '';
  }

  /**
   * Generate migration report
   */
  public static generateMigrationReport(results: MigrationResult[]): void {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log('\n=== MIGRATION REPORT ===');
    console.log(`Total documents processed: ${results.length}`);
    console.log(`Successfully migrated: ${successful.length}`);
    console.log(`Failed migrations: ${failed.length}`);

    if (failed.length > 0) {
      console.log('\nFailed migrations:');
      failed.forEach(result => {
        console.log(`- Customer: ${result.customerId}, Document: ${result.documentId}, Error: ${result.error}`);
      });
    }

    console.log('\n=== END REPORT ===\n');
  }

  /**
   * Rollback migration for a specific customer (restore from backup)
   */
  public static async rollbackCustomerMigration(customerId: string, backupData: any): Promise<void> {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      // Restore original document URLs
      customer.kyc.documents = backupData.documents;
      await customer.save();

      console.log(`Rolled back migration for customer ${customerId}`);
    } catch (error) {
      console.error(`Failed to rollback migration for customer ${customerId}:`, error);
      throw error;
    }
  }
}

// CLI script for running migration
if (require.main === module) {
  async function runMigration() {
    try {
      console.log('Starting KYC document migration to Cloudinary...');
      
      if (!cloudinaryService.isReady()) {
        throw new Error('Cloudinary is not configured. Please set environment variables.');
      }

      const results = await CloudinaryMigration.migrateAllKYCDocuments();
      CloudinaryMigration.generateMigrationReport(results);
      
      console.log('Migration completed!');
      process.exit(0);
    } catch (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  }

  runMigration();
}