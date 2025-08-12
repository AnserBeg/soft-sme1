# AI Chat Setup Guide

This guide will help you set up the Gemini AI chat feature for your Soft SME application.

## Prerequisites

1. A Google account
2. Access to Google AI Studio (MakerSuite)

## Step 1: Get Your Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the generated API key (it will look like: `AIzaSyC...`)

## Step 2: Configure the API Key

1. Open the file: `src/config/ai.ts`
2. Replace `'YOUR_GEMINI_API_KEY_HERE'` with your actual API key:

```typescript
export const AI_CONFIG = {
  GEMINI_API_KEY: 'AIzaSyC...', // Your actual API key here
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
  MAX_TOKENS: 500,
  TEMPERATURE: 0.7,
};
```

## Step 3: Test the Chat Feature

1. Start your development server: `npm run dev`
2. Navigate to any page in your application
3. Look for the chat bubble in the bottom-right corner
4. Click the chat bubble to open the AI assistant
5. Try asking questions like:
   - "How do I manage inventory?"
   - "Where can I find customer information?"
   - "How do I create a purchase order?"

## Features

The AI assistant is trained to help with:
- **Inventory Management**: Stock levels, product tracking
- **Customer Management**: Customer database, order tracking
- **Purchase Orders**: Creating and managing orders
- **Sales & Quotes**: Quote creation and sales pipeline
- **Time Tracking**: Employee hours and attendance
- **Employee Management**: Staff information and roles
- **Business Profile**: Company settings and configuration

## Security Notes

- Never commit your API key to version control
- Consider using environment variables for production
- The API key is currently stored in the frontend (for demo purposes)
- For production, consider moving API calls to your backend

## Troubleshooting

### API Key Issues
- Make sure your API key is correct and active
- Check that you have billing set up (if required)
- Verify the API key has access to Gemini Pro

### Network Issues
- Check your internet connection
- The app will fall back to predefined responses if the API is unavailable

### Rate Limiting
- The current configuration limits responses to 500 tokens
- Adjust `MAX_TOKENS` in the config if needed

## Customization

You can customize the AI behavior by modifying:
- `TEMPERATURE`: Controls response creativity (0.0-1.0)
- `MAX_TOKENS`: Maximum response length
- `SYSTEM_PROMPT`: The context given to the AI about your system

## Support

If you encounter issues:
1. Check the browser console for error messages
2. Verify your API key is correctly configured
3. Test with simple questions first
4. Check the Gemini API status page for any service issues 