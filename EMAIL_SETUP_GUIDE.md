# Email System Setup Guide

This guide will help you set up and use the email functionality in your Aiven application.

## Overview

The email system allows you to:
- Send custom emails from anywhere in the app
- Send formatted emails for Sales Orders, Purchase Orders, and Quotes
- Track email history and logs
- Configure SMTP settings for your email provider

## Backend Setup

### 1. Install Dependencies

The email system uses Nodemailer. It should already be installed, but if not:

```bash
cd soft-sme-backend
npm install nodemailer @types/nodemailer
```

### 2. Environment Variables

Add these environment variables to your `.env` file:

```env
# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=noreply@yourcompany.com
```

### 3. Database Migration

Run the email logs migration:

```bash
# If you have a migration runner
npm run migrate

# Or manually run the SQL
psql -d your_database -f migrations/create_email_logs_table.sql
```

### 4. Restart Backend

After making changes, restart your backend server:

```bash
npm run dev
```

## Email Provider Setup

### Gmail Setup

1. **Enable 2-Factor Authentication** on your Google account
2. **Generate an App Password**:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate a password for "Mail"
3. **Use the App Password** in your EMAIL_PASS environment variable

### Outlook/Hotmail Setup

1. **Enable "Less secure app access"** (if available)
2. **Use your regular password** in EMAIL_PASS
3. **Host**: `smtp-mail.outlook.com`
4. **Port**: `587`

### Custom SMTP Setup

Contact your email provider for:
- SMTP host
- Port number
- Authentication method
- SSL/TLS requirements

## Frontend Usage

### 1. Email Settings Page

Navigate to `/email-settings` to configure your email settings and test the connection.

### 2. Using Email Components

#### EmailButton Component

Add email buttons to any page:

```tsx
import EmailButton from '../components/EmailButton';

// Custom email
<EmailButton 
  type="custom"
  defaultTo="customer@example.com"
  defaultSubject="Important Update"
  defaultMessage="Hello, this is an important update..."
/>

// Sales Order email
<EmailButton 
  type="sales-order"
  recordId={salesOrderId}
  defaultTo="customer@example.com"
/>

// Purchase Order email
<EmailButton 
  type="purchase-order"
  recordId={purchaseOrderId}
  defaultTo="vendor@example.com"
/>

// Quote email
<EmailButton 
  type="quote"
  recordId={quoteId}
  defaultTo="customer@example.com"
/>
```

#### EmailModal Component

Use the modal directly for more control:

```tsx
import EmailModal from '../components/EmailModal';

const [emailModalOpen, setEmailModalOpen] = useState(false);

<EmailModal
  open={emailModalOpen}
  onClose={() => setEmailModalOpen(false)}
  type="custom"
  defaultTo="recipient@example.com"
  defaultSubject="Test Email"
  defaultMessage="This is a test message."
/>
```

### 3. Adding Email to Existing Pages

#### Sales Order Detail Page

Add an email button to send order confirmations:

```tsx
// In your sales order detail page
<Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
  <Button variant="contained" onClick={handleSave}>
    Save Order
  </Button>
  <EmailButton 
    type="sales-order"
    recordId={salesOrderId}
    defaultTo={customerEmail}
    variant="outlined"
  />
</Box>
```

#### Purchase Order Page

Add email functionality for vendor communications:

```tsx
// In your purchase order page
<EmailButton 
  type="purchase-order"
  recordId={purchaseOrderId}
  defaultTo={vendorEmail}
  variant="contained"
  color="primary"
/>
```

## API Endpoints

### Test Email Connection
```
GET /api/email/test
```

### Send Custom Email
```
POST /api/email/send
{
  "to": "recipient@example.com",
  "subject": "Email Subject",
  "message": "Email message content"
}
```

### Send Sales Order Email
```
POST /api/email/sales-order/:salesOrderId
{
  "to": "customer@example.com"
}
```

### Send Purchase Order Email
```
POST /api/email/purchase-order/:purchaseOrderId
{
  "to": "vendor@example.com"
}
```

### Send Quote Email
```
POST /api/email/quote/:quoteId
{
  "to": "customer@example.com"
}
```

### Get Email Logs
```
GET /api/email/logs
```

## Email Templates

The system includes pre-built templates for:

### Sales Order Email
- Order confirmation
- Customer details
- Item list with quantities and prices
- Total amount

### Purchase Order Email
- PO number and vendor details
- Item list with quantities and costs
- Total amount
- Professional formatting

### Quote Email
- Quote number and customer details
- Item list with quantities and prices
- Total amount
- Validity period (30 days)

### Custom Email
- Plain text or HTML formatting
- Support for attachments
- Flexible content

## Troubleshooting

### Common Issues

1. **"Authentication failed"**
   - Check your email credentials
   - For Gmail, use App Password instead of regular password
   - Ensure 2FA is enabled for Gmail

2. **"Connection timeout"**
   - Verify SMTP host and port
   - Check firewall settings
   - Try different ports (587, 465, 25)

3. **"Email not sending"**
   - Test connection first
   - Check email logs in database
   - Verify recipient email address

4. **"SSL/TLS errors"**
   - Try changing EMAIL_SECURE setting
   - Check if your provider requires SSL
   - Verify port settings

### Testing

1. **Test Connection**: Use the test button in Email Settings
2. **Send Test Email**: Use the "Send Test Email" button
3. **Check Logs**: View email logs in the database
4. **Monitor Console**: Check backend console for error messages

## Security Considerations

1. **Environment Variables**: Never commit email passwords to version control
2. **App Passwords**: Use app-specific passwords for Gmail
3. **Rate Limiting**: Consider implementing rate limiting for email sending
4. **Logging**: Email logs are stored for audit purposes
5. **Validation**: Always validate email addresses before sending

## Advanced Features

### Attachments

Support for file attachments:

```tsx
// In EmailModal
const attachments = [
  {
    filename: 'document.pdf',
    content: fileBuffer,
    contentType: 'application/pdf'
  }
];
```

### HTML Templates

Custom HTML templates can be added to the EmailService:

```tsx
// In emailService.ts
getCustomTemplate(data: any): EmailTemplate {
  return {
    subject: 'Custom Subject',
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h1>Custom Template</h1>
        <p>${data.message}</p>
      </div>
    `
  };
}
```

### Bulk Emails

For sending to multiple recipients:

```tsx
// Multiple recipients
const recipients = ['user1@example.com', 'user2@example.com'];
await emailService.sendEmail({
  to: recipients,
  subject: 'Bulk Email',
  html: '<p>Message content</p>'
});
```

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review email logs in the database
3. Test with a simple email first
4. Verify your email provider settings
5. Check backend console for detailed error messages

The email system is designed to be robust and user-friendly, providing professional email functionality throughout your Aiven application. 