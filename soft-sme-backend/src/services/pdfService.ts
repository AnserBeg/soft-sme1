import PDFDocument from 'pdfkit';
import { Pool } from 'pg';
import { getLogoImageSource } from '../utils/pdfLogoHelper';

export class PDFService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private formatCurrency(value: number | string | null | undefined): string {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) {
      return '$0.00';
    }

    const isNegative = amount < 0;
    const absoluteValue = Math.abs(amount);
    const fixed = absoluteValue.toFixed(2);
    const [wholePart, decimalPart] = fixed.split('.');
    const withSeparators = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const signPrefix = isNegative ? '-$' : '$';

    return `${signPrefix}${withSeparators}.${decimalPart}`;
  }

  // Generate professional purchase order PDF (same as download)
  async generatePurchaseOrderPDF(purchaseOrderId: number): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        // Fetch business profile
        const businessProfileResult = await this.pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
        const businessProfile = businessProfileResult.rows[0];

        const purchaseOrderResult = await this.pool.query(
          `SELECT ph.*, vm.vendor_name, vm.street_address as vendor_street_address, vm.city as vendor_city, vm.province as vendor_province, vm.country as vendor_country, vm.telephone_number as vendor_phone, vm.email as vendor_email, vm.postal_code as vendor_postal_code, ph.gst_rate FROM PurchaseHistory ph JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id WHERE ph.purchase_id = $1`,
          [purchaseOrderId]
        );

        if (purchaseOrderResult.rows.length === 0) {
          reject(new Error('Purchase order not found'));
          return;
        }

        const purchaseOrder = purchaseOrderResult.rows[0];
        const lineItemsResult = await this.pool.query(
          'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
          [purchaseOrderId]
        );
        purchaseOrder.lineItems = lineItemsResult.rows;

        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];
        
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          resolve(pdfBuffer);
        });
        doc.on('error', reject);

        // --- HEADER ---
        let headerY = 50;
        let logoHeight = 100;
        let logoWidth = 180;
        let pageWidth = 600;
        let logoX = 50;
        let companyTitleX = logoX + logoWidth + 20;
        
        const logoSource = await getLogoImageSource(businessProfile?.logo_url);
        if (logoSource) {
          try {
            doc.image(logoSource, logoX, headerY, { fit: [logoWidth, logoHeight] });
          } catch (error) {
            console.error('Error adding logo to PDF:', error);
          }
        }
        
        // Company name (right of logo, vertically centered with logo)
        const fontSize = 16;
        // Company name slightly above vertical center of logo
        const companyTitleY = headerY + (logoHeight / 2) - (fontSize / 2) - 6;
        if (businessProfile) {
          doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#000000').text(
            (businessProfile.business_name || '').toUpperCase(),
            companyTitleX,
            companyTitleY,
            { align: 'left', width: pageWidth - companyTitleX - 50 }
          );
        }
        
        // Move Y below header (tight 4px gap)
        const logoBottom = headerY + logoHeight;
        const nameBottom = companyTitleY + fontSize;
        let y = Math.max(logoBottom, nameBottom) + 4;
        
        // Horizontal line
        doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
        y += 18;

        // --- Company & Vendor Info Block ---
        // Headings
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Company Information', 50, y);
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Vendor', 320, y);
        y += 16;
        
        // Company info (left column)
        doc.font('Helvetica').fontSize(11).fillColor('#000000');
        const companyInfoLines = [
          businessProfile?.business_name,
          businessProfile?.street_address,
          [businessProfile?.city, businessProfile?.province, businessProfile?.country, businessProfile?.postal_code].filter(Boolean).join(', '),
          businessProfile?.email,
          businessProfile?.telephone_number
        ].filter(line => line && line.trim() !== '').join('\n');
        doc.text(companyInfoLines, 50, y, { width: 250 });
        
        // Vendor info (right column)
        doc.font('Helvetica').fontSize(11).fillColor('#000000');
        const vendorInfoLines = [
          purchaseOrder.vendor_name,
          purchaseOrder.vendor_street_address,
          [purchaseOrder.vendor_city, purchaseOrder.vendor_province, purchaseOrder.vendor_country, purchaseOrder.vendor_postal_code].filter(Boolean).join(', '),
          purchaseOrder.vendor_email,
          purchaseOrder.vendor_phone
        ].filter(line => line && line.trim() !== '').join('\n');
        doc.text(vendorInfoLines, 320, y, { width: 230 });
        
        // Calculate the max height used by either block
        const companyInfoHeight = doc.heightOfString(companyInfoLines, { width: 250 });
        const vendorInfoHeight = doc.heightOfString(vendorInfoLines, { width: 230 });
        y += Math.max(companyInfoHeight, vendorInfoHeight) + 4;
        
        // Horizontal line
        doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
        y += 18;

        // --- Purchase Order Details ---
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('PURCHASE ORDER', 50, y);
        y += 22;
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Purchase Order #:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(purchaseOrder.purchase_number, 170, y);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Order Date:', 320, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
          purchaseOrder.purchase_date ? new Date(purchaseOrder.purchase_date).toLocaleDateString() : '',
          400, y
        );
        y += 24;
        
        // Horizontal line
        doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
        y += 14;

        // --- Line Item Table ---
        const tableHeaders = ['SN', 'Item Code', 'Description', 'Qty', 'Unit', 'Unit Price', 'Line Total'];
        const colWidths = [30, 70, 140, 40, 40, 80, 80];
        let currentX = 50;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
        tableHeaders.forEach((header, i) => {
          doc.text(header, currentX, y, { width: colWidths[i], align: 'left' });
          currentX += colWidths[i];
        });
        y += 16;
        doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#888888').stroke();
        doc.font('Helvetica').fontSize(10).fillColor('#000000');
        let sn = 1;
        purchaseOrder.lineItems.forEach((item: any) => {
          currentX = 50;
          let rowY = y;
          
          // Calculate required height for this row based on text content
          const snHeight = doc.heightOfString(sn.toString(), { width: colWidths[0] });
          const partNumberHeight = doc.heightOfString(item.part_number || '', { width: colWidths[1] });
          const partDescHeight = doc.heightOfString(item.part_description || '', { width: colWidths[2] });
          const qtyHeight = doc.heightOfString(parseFloat(item.quantity).toString(), { width: colWidths[3] });
          const unitHeight = doc.heightOfString(item.unit || '', { width: colWidths[4] });
          const unitCostHeight = doc.heightOfString(parseFloat(item.unit_cost).toFixed(2), { width: colWidths[5] });
          const lineTotalHeight = doc.heightOfString(parseFloat(item.line_total).toFixed(2), { width: colWidths[6] });
          
          const maxTextHeight = Math.max(snHeight, partNumberHeight, partDescHeight, qtyHeight, unitHeight, unitCostHeight, lineTotalHeight);
          const rowHeight = Math.max(maxTextHeight + 6, 16); // Add padding, minimum 16px
          
          // Check if we need a new page
          if (y + rowHeight > doc.page.height - 100) {
            doc.addPage();
            y = 50;
            rowY = y;
          }
          
          // SN
          doc.text(sn.toString(), currentX, rowY, { 
            width: colWidths[0], 
            align: 'left',
            height: rowHeight
          });
          currentX += colWidths[0];
          
          // Part Number
          doc.text(item.part_number || '', currentX, rowY, { 
            width: colWidths[1], 
            align: 'left',
            height: rowHeight
          });
          currentX += colWidths[1];
          
          // Part Description
          doc.text(item.part_description || '', currentX, rowY, { 
            width: colWidths[2], 
            align: 'left',
            height: rowHeight
          });
          currentX += colWidths[2];
          
          // Quantity
          doc.text(parseFloat(item.quantity).toString(), currentX, rowY, { 
            width: colWidths[3], 
            align: 'left',
            height: rowHeight
          });
          currentX += colWidths[3];
          
          // Unit
          doc.text(item.unit || '', currentX, rowY, { 
            width: colWidths[4], 
            align: 'left',
            height: rowHeight
          });
          currentX += colWidths[4];
          
          // Unit Cost
          doc.text(parseFloat(item.unit_cost).toFixed(2), currentX, rowY, { 
            width: colWidths[5], 
            align: 'right',
            height: rowHeight
          });
          currentX += colWidths[5];
          
          // Line Total
          doc.text(parseFloat(item.line_total).toFixed(2), currentX, rowY, { 
            width: colWidths[6], 
            align: 'right',
            height: rowHeight
          });
          
          // Move y to the next row position
          y += rowHeight + 8;
          
          // Draw row line
          doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#eeeeee').stroke();
          sn++;
        });
        y += 10;
        doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').stroke();
        y += 10;

        // --- Totals Section ---
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Sub Total:', 400, y, { align: 'left', width: 80 });
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(purchaseOrder.subtotal).toFixed(2), 480, y, { align: 'right', width: 70 });
        y += 16;
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Total GST:', 400, y, { align: 'left', width: 80 });
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(purchaseOrder.total_gst_amount).toFixed(2), 480, y, { align: 'right', width: 70 });
        y += 16;
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Total:', 400, y, { align: 'left', width: 80 });
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text(parseFloat(purchaseOrder.total_amount).toFixed(2), 480, y, { align: 'right', width: 70 });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Generate professional quote PDF (exactly like the download endpoint)
  async generateQuotePDF(quoteId: number): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        // Fetch business profile
        const businessProfileResult = await this.pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
        const businessProfile = businessProfileResult.rows[0];

        const quoteResult = await this.pool.query(
          `SELECT 
             q.*,
             c.customer_name,
             c.street_address as customer_street_address,
             c.city as customer_city,
             c.province as customer_province,
             c.country as customer_country,
             c.contact_person,
             c.email as customer_email,
             c.telephone_number as customer_phone,
             c.postal_code as customer_postal_code
           FROM quotes q
           JOIN customermaster c ON q.customer_id = c.customer_id
           WHERE q.quote_id = $1`,
          [quoteId]
        );

        if (quoteResult.rows.length === 0) {
          reject(new Error('Quote not found'));
          return;
        }

        const quote = quoteResult.rows[0];

        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // --- HEADER ---
        let headerY = 50;
        let logoHeight = 100;
        let logoWidth = 180;
        let pageWidth = 600;
        let logoX = 50;
        let companyTitleX = logoX + logoWidth + 20;
        const logoSource = await getLogoImageSource(businessProfile?.logo_url);
        if (logoSource) {
          try {
            doc.image(logoSource, logoX, headerY, { fit: [logoWidth, logoHeight] });
          } catch (error) {
            console.error('Error adding logo to PDF:', error);
          }
        }
        // Company name (right of logo, vertically centered with logo)
        const fontSize = 16;
        const companyTitleY = headerY + (logoHeight / 2) - (fontSize / 2) - 6;
        if (businessProfile) {
          doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#000000').text(
            (businessProfile.business_name || '').toUpperCase(),
            companyTitleX,
            companyTitleY,
            { align: 'left', width: pageWidth - companyTitleX - 50 }
          );
        }
        // Move Y below header (tight 4px gap)
        const logoBottom = headerY + logoHeight;
        const nameBottom = companyTitleY + fontSize;
        let y = Math.max(logoBottom, nameBottom) + 4;
        // Horizontal line
        doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
        y += 18;

        // --- Company & Customer Info Block ---
        // Headings
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Company Information', 50, y);
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Customer', 320, y);
        y += 16;
        // Company info (left column)
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(businessProfile?.business_name || '', 50, y);
        doc.text(businessProfile?.street_address || '', 50, y + 14);
        doc.text(
          [businessProfile?.city, businessProfile?.province, businessProfile?.country, businessProfile?.postal_code].filter(Boolean).join(', '),
          50, y + 28
        );
        doc.text(businessProfile?.email || '', 50, y + 42);
        doc.text(businessProfile?.telephone_number || '', 50, y + 56);
        // Customer info (right column)
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.customer_name || '', 320, y);
        doc.text(quote.customer_street_address || '', 320, y + 14);
        doc.text(
          [quote.customer_city, quote.customer_province, quote.customer_country, quote.customer_postal_code].filter(Boolean).join(', '),
          320, y + 28
        );
        doc.text(quote.customer_email || '', 320, y + 42);
        doc.text(quote.customer_phone || '', 320, y + 56);
        y += 72;
        // Horizontal line
        doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
        y += 18;

        // --- Quote Details ---
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('QUOTE', 50, y);
        y += 22;
        // First line: Quote # and Customer PO #
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Quote #:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.quote_number, 170, y);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Customer PO #:', 320, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.customer_po_number || 'N/A', 450, y);
        y += 16;
        // Second line: Quote Date and Valid Until
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Quote Date:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
          quote.quote_date ? new Date(quote.quote_date).toLocaleDateString() : '',
          170, y
        );
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Valid Until:', 320, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
          quote.valid_until ? new Date(quote.valid_until).toLocaleDateString() : '',
          450, y
        );
        y += 16;
        // Third line: VIN # (conditional rendering)
        if (quote.vin_number && quote.vin_number.trim() !== '') {
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('VIN #:', 50, y);
          doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.vin_number, 170, y);
          y += 16;
        }
        if (quote.vehicle_make && quote.vehicle_make.trim() !== '') {
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Make:', 50, y);
          doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.vehicle_make, 170, y);
          y += 16;
        }
        if (quote.vehicle_model && quote.vehicle_model.trim() !== '') {
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Model:', 50, y);
          doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.vehicle_model, 170, y);
          y += 16;
        }
        y += 8;
        // Horizontal line
        doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
        y += 14;

        // --- Product Information ---
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Product Information', 50, y);
        y += 16;
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Product Name:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000');
        const productNameResult = doc.text(quote.product_name || 'N/A', 170, y, { width: 350 });
        y = Math.max(productNameResult.y, y) + 4;
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Description:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000');
        const productDescResult = doc.text(quote.product_description || 'N/A', 170, y, { width: 350 });
        y = Math.max(productDescResult.y, y) + 8;
        // Horizontal line
        doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
        y += 14;

        // --- Pricing Section ---
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Estimated Price', 50, y);
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000');
        const estimatedPriceText = this.formatCurrency(quote.estimated_cost);
        const priceTextWidth = doc.widthOfString(estimatedPriceText);
        const rightEdge = doc.page.width - doc.page.margins.right;
        const priceX = Math.max(doc.page.margins.left, rightEdge - priceTextWidth);
        doc.text(estimatedPriceText, priceX, y, { lineBreak: false });

        // --- Terms and Conditions ---
        y += 40;
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Terms and Conditions', 50, y);
        y += 16;
        doc.font('Helvetica').fontSize(10).fillColor('#000000');
        if (quote.terms && quote.terms.trim() !== '') {
          doc.text(quote.terms, 50, y, { width: 500 });
        } else {
          doc.text('No terms and conditions specified.', 50, y);
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
} 