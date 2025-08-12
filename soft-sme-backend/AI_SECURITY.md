# AI Security Configuration

## 🔒 **Security Overview**

All AI configuration has been moved to the backend for enhanced security. This prevents:
- Frontend tampering with AI settings
- Exposure of API keys in client-side code
- Unauthorized modification of AI behavior

## ⚙️ **Configuration Options**

Add these environment variables to your `.env` file:

```bash
# Required: Your Gemini API key
GEMINI_API_KEY=your-actual-gemini-api-key-here

# Optional: AI Model Configuration
AI_MODEL=gemini-1.5-flash          # Default: gemini-1.5-flash
AI_MAX_TOKENS=500                  # Default: 500
AI_TEMPERATURE=0.7                 # Default: 0.7
```

## 🛡️ **Security Features**

### **Backend-Only Configuration**
- All AI settings are stored in backend environment variables
- Frontend has no access to AI configuration
- API key is never exposed to client-side code

### **Authentication Required**
- All AI endpoints require valid authentication
- User ID is logged with each AI request for monitoring
- Unauthorized access is blocked

### **Request Logging**
- All AI interactions are logged server-side
- Includes user ID, message preview, and response preview
- Helps with monitoring and debugging

### **Fallback Responses**
- If AI service fails, contextual fallback responses are provided
- Ensures chat functionality remains available
- No sensitive information in fallback responses

## 🔧 **API Endpoints**

### **POST /api/chat/send**
- **Purpose**: Send message to AI assistant
- **Authentication**: Required
- **Body**: `{ "message": "string" }`
- **Response**: `{ "message": "string", "timestamp": "string" }`

### **GET /api/chat/health**
- **Purpose**: Check AI service status
- **Authentication**: Not required
- **Response**: Service status and test response

### **GET /api/chat/config**
- **Purpose**: Get AI configuration (read-only)
- **Authentication**: Required
- **Response**: Model, max tokens, temperature (no sensitive data)

## 🚀 **Setup Instructions**

1. **Add environment variables** to your `.env` file
2. **Restart the backend server**
3. **Test the health endpoint**: `GET /api/chat/health`
4. **Verify authentication** by testing chat functionality

## 📊 **Monitoring**

Check backend logs for AI activity:
```bash
# Look for AI request logs
grep "\[AI\]" your-backend-logs.log

# Example log format:
# [AI] User 123 sent message: "How do I add a customer?"
# [AI] Response to user 123: "To add a new customer..."
```

## 🔄 **Updating Configuration**

To change AI settings:
1. Update environment variables in `.env`
2. Restart the backend server
3. No frontend changes required

## ⚠️ **Security Notes**

- Never commit your `.env` file to version control
- Regularly rotate your API key
- Monitor AI usage for unusual patterns
- Keep backend dependencies updated 